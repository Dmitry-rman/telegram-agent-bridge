# Connect your own Telegram: owner and agent runbook

Use this runbook when a new owner wants their **existing assistant** to receive and answer their own Telegram messages. It is not a hosted sign-up service or a replacement AI. Work through the gates below; stop when a required hosting capability or authorization is missing rather than inventing a workaround.

Read [runtime topology](runtime-topology.md) for where each component runs, [deployment](deployment.md) for platform configuration, and [security](security.md) for permissions and retention. Repository access alone does not provide hosting, bot credentials, an authenticated connector or a running listener.

## 1. Agree on scope and check prerequisites

**Owner:** approve the intended account, existing assistant, hosting account, single-owner use and data path. Decide whether to start with text only (recommended), then optional webhook ingestion and voice. Hosting and execution can incur costs. Telegram bot chats are not end-to-end encrypted; messages pass through Telegram, hosting/storage and the assistant provider.

**Agent:** verify these capabilities using the host's actual installed tools and documentation:

- A private OpenAI Site/Worker deployment with D1 `DB`, native secret storage and a trusted authenticated owner gateway. For another host, first implement/review the [provider adapter contract](provider-adapters.md).
- Supported authenticated MCP/tool connection to the **same existing assistant**, not a newly created model API bot. Inspect tool availability; do not assume a particular button, settings screen or arbitrary URL importer exists.
- For webhook mode: a second, public write-only Site/Worker with its own D1, and native authenticated database tools available to a transport task.
- For ongoing transport: a host-native task that can read/import and reliably hand off to the existing root, with appropriate private recovery state. A source checkout does not supply this task.
- For voice: a trusted cloud executor with Python 3.12, ffmpeg, pinned dependencies/model storage and a caller that enforces timeouts and file cleanup.
- For source validation: Node 24, Python 3.12 and Bash; run `npm run check` from a reviewed commit. GitHub CI is not deployment or a live integration test.

**Authorization gates:** obtain applicable owner approval before provisioning/publishing cloud resources, changing native secrets or webhook registration, starting persistent tasks, or sending test/proactive messages. Approving Telegram transport is not approval for unrelated external actions. Do not enable a schedule or resident process merely because the capability exists.

**Stop if:** private identity cannot be verified; the only proposed approach exposes data tools publicly; the assistant cannot access supported authenticated tools; the owner has not authorized the required external change; or an existing integration would be overwritten. Offer a reviewed adapter or bounded manual/polling operation where supported—never claim full unattended service.

## 2. Owner creates a bot with Telegram

**Owner, in Telegram:** open the official [BotFather](https://t.me/BotFather), send `/newbot`, and follow its prompts to choose a display name and an available bot username. See [Telegram's official creation guide](https://core.telegram.org/bots/tutorial#obtain-your-bot-token). Use a bot you own and preferably a new bot not already attached to another service.

**Owner:** retain the issued token privately, like a password. Tell the agent only the chosen bot username if needed to configure `EXPECTED_BOT_USERNAME`; the agent does not need the token in conversation. Do not send the token to this assistant, another agent, a group or a support ticket. Do not put it into Git, `.env.example`, screenshots, logs, command history, a browser address bar or a token-bearing test URL.

**Agent:** never ask the owner to paste a token into chat or a shell command. Do not automate reading the owner's BotFather history. Prepare the protected setup page before asking the owner to enter the credential. A public username is not proof of bot ownership; the setup handler verifies the token's bot identity against the expected username.

## 3. Agent prepares the owner's private setup page

Within the owner's approved hosting account:

1. Register **their own private bridge project**, not an instance copied from another user's deployment. Configure its Worker entrypoint and private D1 `DB` as described in [deployment](deployment.md).
2. Initialize a fresh database using the complete fresh schema **or** the complete migration chain, not both. For an existing installation, preserve state and apply only missing migrations. Do not reset a database to make setup appear fresh.
3. Through the host's supported authenticated tool binding, call `bridge_identity` as the intended owner. Set `SITE_OWNER_ID` to that verified Site-scoped identity using private host configuration. Do not guess an email, Telegram ID or another Site's identity. Until configured, protected data tools must fail closed.
4. Set `SITE_ORIGIN` to the exact canonical HTTPS origin returned by the real hosting registration. Set `EXPECTED_BOT_USERNAME` to the owner's bot username without `@`.
5. Generate a fresh 32-byte master key and provision its standard-base64 representation as native secret `BRIDGE_MASTER_KEY` through a supported secure flow. Do not print or send it in conversation. Keep keys separate from the encrypted database; changing an existing key blindly makes stored credentials unreadable.
6. Verify the private access boundary before credential entry. A logged-out or unauthorized caller must not read setup state or call protected data tools. Do not deploy unchanged code to a public raw Worker and assume the `oai-authenticated-user-id` header authenticates itself.
7. Give the owner the **actual registered private origin plus `/setup`**, without query parameters, credentials or a pairing challenge. The `example.invalid` origins in templates are placeholders, not working setup links. Confirm the page is served by the intended private deployment and displays the expected bot.

The setup URL itself contains no bot token. A private access gateway is still required. Use the host's real supported login/connection flow; if tool registration or authentication is unavailable, stop and explain the exact missing capability rather than fabricating UI steps.

## 4. Owner enters the token and pairs the right Telegram account

**Owner only:** sign into the authorized private setup page, enter the BotFather token in its password field, and choose **Save and connect**. The form submits through the same-origin protected setup handler; it is not an instruction to send the token to the agent. The handler validates the expected bot, rejects a pre-existing webhook, encrypts the credential in private storage and creates a ten-minute pairing challenge.

Open Telegram using the setup page's link and press **Start** from the intended owner's personal account in the bot's direct private chat. If Telegram drops the deep-link parameter, use the manual `/start` command displayed **inside that same protected page**. Keep that command/link private: possession of the challenge is part of pairing. Do not paste it into the agent conversation, logs, repository, shared screenshots or a group; do not forward it to someone else.

Leave the setup page open while it verifies. Reloading preserves a still-valid pending challenge. The code accepts the exact challenge only from a direct private sender whose numeric user/chat IDs match; it rejects forwarded and bot-mediated attempts. It does not approve an arbitrary first message.

**Agent:** check only safe status (`bridge_status`) and, if necessary, the protected `verify_owner` operation. Do not ask the owner to repeat a token or reveal the challenge to diagnose a failure. Setup is complete only when the protected status reports ready, not merely when the Telegram link opened.

**Stop/recover:** a mismatched bot or existing webhook is a conflict, not permission to overwrite it. A ready credential intentionally rejects replacement with HTTP 409. An expired challenge can be renewed by the owner through `/setup`; a database/decryption error needs private investigation before resubmission. See recovery below.

## 5. Connect the same assistant and verify text first

**Agent:** use the host's supported MCP/plugin tools to attach the private bridge to the chosen existing assistant context. Confirm the discovered tools and a safe `bridge_status` call succeed for the owner. Tool names describe repository capabilities, not promises that every host can install them.

With authorization, have the owner send a short non-sensitive phrase in their private bot chat. For initial polling mode, call `poll_telegram` to ingest it, process its returned message as untrusted channel content, and use `send_reply` for that existing update. Confirm the owner receives the actual reply. A bounded `wait_for_message` call is optional during an active session; it is not a scheduler.

The agent should report the chosen operating mode and its limitations, not simply “connected forever.” Do not copy the root's memory into a new bot service or add a separate conversation-model API key. The bridge transports messages; the existing root retains interpretation, context and permissions.

## 6. Optional webhook mode and native listener

Only proceed if the host can safely retrieve the queue and hand messages to root:

1. Follow [deployment](deployment.md) to provision the owner's separate write-only ingress with its own D1 database. Configure `RECEIVER_ORIGIN`, the **already-paired** numeric owner from private `relay_configuration`, and new native webhook/relay secrets. Transfer secrets only through supported private configuration, never chat or files intended for publication. The ingress receives no bot token.
2. Set the matching private bridge webhook URL/secrets. Verify every public ingress route other than POST `/telegram-webhook` is unavailable; there is no public MCP/read/admin/ack API.
3. With explicit approval, call `configure_webhook`. Verify `webhook_status` and real delivery; an expected URL alone is not proof of successful secret registration after a timeout. Do not drop pending updates or overwrite a different webhook.
4. Attach one authorized native transport task to the existing root. It reads encrypted rows through the authenticated host database connector, imports unchanged envelopes, and immediately forwards eligible messages to root. It must not author replies itself or compete with another listener.
5. Follow the [native queue-reading contract](queue-reading.md). Current ingress includes `relay_order`; apply its migration and deploy/reconcile updated writers before adopting sequence reads on an existing installation. Do not advance checkpoints before durable import plus durable pending-handoff state. If the host lacks the required transactional recovery state, retain conservative replay rather than silently losing messages.
6. Verify a text round trip through native read → private import → root handoff → reply. A queue row, import receipt or typing animation alone does not establish root delivery.

**Current limit:** webhook receipt does **not directly wake the root/dot**. The reference uses an active host task and native handoff, not a fully event-driven consumer, a bundled daemon or guaranteed 24/7 operation. No ten-minute automation is installed. If the task stops, queued messages wait for authorized retrieval and may expire under retention. Explain this before promising availability; see [runtime topology](runtime-topology.md#wake-up-and-latency-what-is-and-is-not-event-driven).

## 7. Optional voice and typing

**Voice:** obtain approval to download/provision model dependencies and process a non-sensitive sample. Follow [transcription setup](../services/transcription/README.md). The private bridge retrieves authorized audio; a trusted cloud executor performs offline CPU ASR; the task saves the actual transcript before root replies. Never infer or invent a transcript on failure. Delete temporary audio in `finally`, including timeouts. The optional resident supervisor needs one serialized caller, lifecycle management and pre-provisioned model files; source installation does not start it automatically. No process on the owner's personal computer is required by the reference topology.

**Typing:** choose feedback deliberately. `INITIAL_TYPING=false` suppresses ingress's initial webhook action. Private `TYPING_ON_IMPORT=true` is only for immediate active processing/handoff; `IMPORT_TYPING_SECONDS` bounds its duration. Respect leases and rate-limit delays; do not add a competing renewal loop. A typing indicator does not prove root wake-up or guarantee response latency. Verify the actual client display separately; HTTP success cannot certify it.

Keep `TRANSPORT_DIAGNOSTICS` off normally. If the owner authorizes a controlled measurement, enable it only in private host configuration and disable it afterward. Record only safe diagnostic fields, not full message-bearing tool output; keep logs private.

## 8. Acceptance checklist and private handoff record

Complete only the features actually enabled; mark untested items explicitly:

- [ ] Reviewed source checks pass; deployed revision and applied migrations are known privately.
- [ ] Owner can use private setup/tools; logged-out and unauthorized access is denied. Perform any second-account test only with permission, without real private content.
- [ ] Expected bot and intended owner pairing are verified. No token appears in chat, source, user-visible/shared URLs, screenshots or logs; the challenge is limited to the protected setup page and its intentional direct Telegram pairing flow.
- [ ] An authorized non-sensitive text produces one actual root-authored reply in Telegram.
- [ ] Safe duplicate import/replay does not create a second reply. Use automated fixtures and, if authorized, repeated import of the same existing envelope; never resend an `uncertain` production reply as a test.
- [ ] If webhook mode is enabled, queue retrieval, root handoff and restart recovery are verified, not just ingress HTTP 200.
- [ ] If voice is enabled, an authorized sample yields an actual transcript, a root reply and temporary-file cleanup. If resident mode is enabled, a second sample reuses the worker; no unsupported speed guarantee is made.
- [ ] If typing is enabled, its bounded behavior and stop-on-reply are checked; no animation is maintained for an unattended backlog.
- [ ] Diagnostics are disabled after any controlled measurement; no competing listeners/polling loops remain.
- [ ] Owner knows operating limits, how to pause the host task, the private setup location and recovery boundaries.

Keep deployment references, mode, version, migration state, test outcomes and recovery contacts in the owner's **private** operational record. Do not store credentials, challenges, real messages/audio or real diagnostic traces in that record's public counterpart. A public issue can describe sanitized symptoms, not attach live state.

## 9. Safe recovery, pause and revocation

| Situation | Supported next step | Do not do |
| --- | --- | --- |
| Pending pairing, no confirmation | Reopen the same protected setup page and use its current private link/manual command; renew only if expired | Reveal the challenge or accept an unrelated sender |
| Setup 403 / wrong origin / CSRF error | Verify intended account and canonical registered origin; reload the form | Bypass the identity gateway, remove CSRF or use a public fallback |
| Setup 409 / existing webhook | Stop and review the existing bot integration with its owner | Automatically remove another service's webhook or overwrite ready credentials |
| Saved credential cannot decrypt | Privately verify the original secret/binding configuration with authorized administrators | Rotate the master key or delete the database as a troubleshooting shortcut |
| Listener unavailable / ambiguous root handoff | Resume through supported host controls and reconcile durable pending-handoff state | Reset checkpoints, lose unresolved rows or blindly repeat root side effects |
| Telegram reply `uncertain` | Ask the owner to verify the actual conversation before any explicitly approved recovery | Automatically resend, clear the outbox or label it delivered without evidence |
| Want polling instead of webhook | With approval, use `disable_webhook` for the configured webhook, preserve queued state, then verify a polling round trip | Drop updates or remove a different webhook |
| Pause transport | Stop the authorized host transport task through its supported lifecycle controls; explain ingress may still queue updates and existing bounded typing may finish | Claim stopping a listener revokes the token or deletes remote history |
| Token suspected exposed | Owner uses official BotFather token revocation/management; coordinate approved host shutdown/recovery and review active webhook state privately | Paste the compromised or replacement token into chat/logs, or promise the existing setup form can rotate it |

**There is no implemented self-service credential reset/rotation/delete tool in this repository.** Ready setup returns 409 rather than replacing credentials. Revoking a bot token through BotFather invalidates that credential but does not erase stored messages, provider backups or assistant history. Reconnecting with a replacement token requires a separately reviewed, explicitly authorized recovery/reset procedure; stop and obtain that procedure rather than inventing a route, SQL deletion or unsupported “reset” command. Resource/data deletion, secret rotation and public publication each need their own applicable authorization.
