# Runtime topology: where everything runs

This document describes the current reference integration, not an imagined always-on agent. Read [delivery and storage semantics](architecture.md), [security](security.md), and [deployment](deployment.md) alongside it.

## Short answer: where do Cloudflare Workers run?

Both JavaScript apps run on **Cloudflare infrastructure**, deployed through OpenAI Sites. They do not run on the user's computer, inside the chat model, or inside the Python transcription process. Cloudflare executes Worker request handlers in V8 isolates across its network; instances are not permanent processes and successive requests need not use the same instance. The repository does not identify or guarantee a particular physical server or region. See [Cloudflare's runtime explanation](https://developers.cloudflare.com/workers/reference/how-workers-works/).

An OpenAI Site is the hosting/integration boundary used here: registration, access policy, native secret configuration, database binding and tool access. A Cloudflare Worker is the JavaScript execution runtime underneath this integration. The private Site and public ingress are **separate deployments**, with separate databases. Neither deployment runs the conversation model.

## Component and responsibility map

| Component | Execution/storage location | Responsibility | What it does not do |
| --- | --- | --- | --- |
| Telegram client and Bot API | Client on the user’s device/browser; Bot API on Telegram infrastructure | Deliver user updates and display bot replies/actions | Preserve the assistant's context or authorize unrelated actions |
| Public ingress, `apps/telegram-ingress` | Cloudflare Worker behind its public Site route | Validate webhook secret and paired sender; encrypt and persist incoming updates | No bot token, public reads, MCP, model, reply generation or root wake-up |
| Relay database, `relay_queue` | Ingress project's managed D1 binding | Persist sealed updates and replay tombstones independently of Worker instance memory | Not Cloudflare Queues, not a push subscription, not an automatic agent trigger |
| Private bridge, `apps/bridge` | Separate Cloudflare Worker behind a private Site access boundary | Pair owner, authenticate tools, import/decrypt messages, reserve/send replies, fetch voice and control typing | No second assistant, no autonomous reasoning, no continuous listener |
| Private bridge database | Private project's separate managed D1 binding | Credentials, inbox/outbox, replay receipts, typing leases and idempotency state | Not the root assistant's full memory/context |
| Native transport listener | Active task in the assistant host's orchestration environment | Read relay through native authenticated database tools; import envelopes; optionally transcribe voice; forward eligible messages to root | Does not author conversational replies; not a guaranteed 24/7 daemon |
| Root assistant | Existing assistant conversation in its provider's runtime | Interpret the request in the existing context, apply permissions, perform authorized work and author the reply | Not embedded in the Worker or replaced by a bot-specific model |
| Offline transcription, `services/transcription` | Trusted cloud execution workspace with Python, ffmpeg and local model files | Convert temporary voice audio to an actual transcript | Does not run inside a Worker, call a speech API, or maintain a bot conversation |

The listener orchestration is host-native and **not shipped as a standalone executable/service in this repository**. The repo provides the bridge/ingress code and transcription CLI; a different user must provide the supported host task, authenticated tool bindings and handoff to their own root assistant. Do not confuse that integration contract with a portable, fully implemented listener SDK.

## Current topology

```text
Telegram client
      |
      | Telegram Bot API webhook (HTTPS + secret header)
      v
PUBLIC SITE / CLOUDFLARE WORKER                  PRIVATE SITE / CLOUDFLARE WORKER
apps/telegram-ingress                           apps/bridge
      |                                               ^
      | encrypt + durable insert                      | authenticated MCP import
      v                                               | and reply/voice tools
Ingress D1: relay_queue                               |
      ^                                               |
      | native authenticated database reads           |
      +-------- ACTIVE HOST TRANSPORT TASK -----------+
                         |
                         | optional voice download -> temporary cloud file
                         |                           -> offline Python ASR
                         |                           -> save actual transcript
                         |
                         | host-native task message / collaboration handoff
                         v
                 EXISTING ROOT ASSISTANT
                         |
                         | authored answer -> private send_reply
                         v
                  Telegram Bot API -> user
```

There is **no public-ingress-to-private-Worker HTTP call** and no public-ingress-to-root wake call. The native database connector is an authenticated control-plane tool, not a public route added to the ingress.

## Text message sequence

1. Telegram sends an update to the ingress's only route, POST `/telegram-webhook`.
2. Ingress verifies the configured secret and exact numeric owner in a direct private chat. It rejects/ignores unsupported or unauthorized content without turning it into an instruction.
3. Ingress encrypts the update and commits it to D1. Only successful durable acceptance returns success. For a new eligible update, the webhook response can request one initial typing action; Telegram does not return a method-success result for that inline action.
4. **While the transport task is active**, it makes native authenticated reads of the relay table. This is active retrieval: the D1 insert does not push an event to that task. The task must handle pagination, retries and duplicate rows.
5. The task passes unchanged sealed envelopes, up to ten at a time, to the private `import_relay_envelopes` tool. The bridge authenticates/decrypts, validates the paired sender again and commits private inbox/replay state. The response includes eligible, unattempted messages without an extra inbox-read call.
6. The transport task forwards those messages to the existing root through the host's native collaboration/task messaging. The root must receive and schedule that handoff before it can respond. Import completion is not proof that the root has begun reasoning.
7. The root applies its existing context and permission rules, does the requested work, and authors a reply. Only then does it call private `send_reply` for the existing update.
8. The bridge reserves the outbox attempt, sends through the official Telegram API and records the result. Ambiguous delivery remains `uncertain`; do not retry it automatically.

No acknowledgment endpoint deletes relay rows after import. Re-import is idempotent. Relay ciphertext expires through activity-driven retention; replay IDs remain. See [retention details](security.md#retention).

## Wake-up and latency: what is and is not event-driven

**The webhook does not directly wake the root assistant in this integration. There is no ten-minute automation in the current reference setup.** The active host transport task is the current retrieval mechanism, not a scheduled ten-minute check and not a fully event-driven queue consumer.

Telegram → ingress is webhook-driven. Ingress → encrypted D1 is request-driven. D1 → transport task is an authenticated read initiated by an active task. Transport task → root is a host-native handoff whose delivery and scheduling are controlled by the assistant host. A native Telegram event source that directly starts this root is not connected in the current setup. Other supported host event sources do not automatically make arbitrary webhooks usable as root triggers.

Approximate end-to-end latency is the sum of:

```text
Telegram delivery + ingress/database commit
+ wait until the next active listener read + native tool/API round trips
+ private import + listener-to-root handoff/scheduling
+ optional voice download/transcription + root reasoning/authorized tools
+ reply API round trip
```

The read cadence and host scheduling are not fixed SLAs in this code. Root availability, other ongoing work, tool latency, rate limits and host delivery boundaries can all add delay. A fast webhook or immediate typing indicator therefore does not imply an immediate reply. Removing an extra inbox read reduces one round trip; it does not remove the listener/handoff boundary.

If the listener stops or the host task is not running, ingress can still accept updates, but they do not automatically start the root. They wait for an authorized task to resume retrieval, subject to retention. Pending updates can expire before they are processed. No response-time, uninterrupted listener lifetime or 24/7 availability guarantee is made.

A future truly event-driven adapter would need a supported, authenticated host event source that maps a committed owner update to the correct existing root, with replay protection, backpressure, retries and the same permission boundary. That adapter is **not implemented here**. Do not fake it by exposing MCP publicly, bypassing access checks, adding hidden model runners or calling an unsupported arbitrary-HTTP wake endpoint.

## Voice path and execution boundary

The listener can perform transport-only speech processing before handoff. It obtains only the authorized retained voice note through `get_voice_audio`, transfers the returned bytes into a temporary file in a trusted cloud executor, runs the pinned offline CPU transcription CLI under a process deadline or sends a request to the optional resident stdio supervisor, saves the actual transcript with `set_voice_transcript`, and forwards the transcript as untrusted content. The resident supervisor reuses one ASR model, enforces a per-request deadline and restarts its child only for a subsequent explicit request after failure. It exposes no network API and does not change the root assistant. The root alone interprets the transcript and authors the answer.

Python, ffmpeg and the Whisper model run in that executor, **not on the Cloudflare Worker**. Initial package/model provisioning needs network access; inference uses local model files with offline mode. User audio must be removed in `finally`, including failures and timeouts. Replacing the execution workspace may require provisioning the model again. Nothing requires a process on the user's personal computer. See [voice setup, size limits and accuracy caveats](../services/transcription/README.md).

## Typing is feedback, not a wake protocol

There are three distinct mechanisms: the ingress's one-time webhook-response action, the private bounded `keep_typing` call, and opt-in import-time renewal. Import-time renewal uses a durable lease and a bounded Worker `ctx.waitUntil` promise; it is not an agent, scheduler or unlimited background service. Read [typing lifecycle and limits](architecture.md#bounded-typing-renewal).

Enable import-time renewal only when import means immediate processing/handoff to an active root. A delayed or inactive root cannot be made responsive by keeping an animation running. The transport task must not run competing renewal loops or show typing for an unattended backlog.

## Security and deployment boundaries

- The public deployment receives only secret-authenticated Telegram updates; it exposes no message retrieval or admin tool. It has no bot token.
- Native database access and private MCP access remain separate authenticated boundaries. A caller-supplied identity header on a public server is not authentication.
- Envelope encryption protects relay payloads at the application layer; private inbox/transcripts are plaintext. Telegram bot chats are not end-to-end encrypted. Telegram, hosting, execution and assistant providers remain in the trust path.
- Bot credentials and encryption secrets belong in native secret storage/private encrypted records, never in source, logs, event payloads or public manifests.
- A GitHub commit or passing CI does not deploy either Site, apply D1 migrations, enable an import flag, start a listener or provision an ASR environment. Each is a separate authorized operation.
- No actual project identifiers, owner identifiers, origins, bot identities or live message examples are necessary to reproduce this architecture; use your own private deployment configuration.

## Verification and limits

Local tests exercise mocked Telegram calls and SQLite behavior. They do not establish Worker placement, native connector permissions, root event delivery, uninterrupted listening, live client typing display or production transcription accuracy. Validate the deployed identity gateway, persistence/retry path, active listener handoff, real reply and voice flow separately using authorized non-sensitive inputs. Record timings privately without storing message text or credentials in the public repository.
