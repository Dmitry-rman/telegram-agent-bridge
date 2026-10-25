# telegram-agent-bridge

A single-owner Telegram transport for an **existing assistant**, with an optional encrypted webhook queue and offline voice transcription. The bridge does not run a second conversation model, duplicate the assistant's memory, or call a model API.

**Status:** reusable source starter, not a one-click universal AI integration. The included hosting adapter targets OpenAI Sites / Cloudflare Workers + D1 and its trusted owner-identity boundary. Other hosts and assistant providers require adapters and authentication review. No deployed resources, credentials, user data, model weights or production registration are included.

```text
Telegram ── polling ───────────────────────────────┐
         └─ webhook → ingress / encrypted queue ──┤
                                                  ↓
                     same assistant ← MCP → private bridge / inbox
                           │                        │
                           ├─ optional offline STT  └─ Telegram replies
                           └─ its existing context and permissions
```

Webhook receipt is immediate queueing, **not guaranteed assistant wake-up**. Processing depends on an active assistant session or the host's explicitly configured scheduler. Nothing here installs a scheduler or an always-on agent.

## Layout

| Folder | Purpose |
| --- | --- |
| `apps/bridge` | Private setup/pairing, durable inbox/outbox, owner-only MCP tools, Telegram replies and voice retrieval |
| `apps/telegram-ingress` | Optional public secret-checked webhook, write-only encrypted durable queue; reads use the hosting provider’s authenticated native database connector |
| `services/transcription` | Bounded CPU Whisper CLI; no network during inference |
| `docs` | Architecture, adapter contract, deployment, security and voice guidance |
| `scripts` | Explicit model provisioning and shareability checks |

## Local checks (no credentials or network)

Prerequisites: **Node.js 24**, npm, **Python 3.12**, Bash.

```bash
npm test          # Both apps' SQLite-backed mocked tests + offline transcription unit tests
npm run build     # Worker artifacts only; does not register or deploy anything
npm run check     # Tests, builds and source shareability checks
```

Tests use built-in Node SQLite and require no npm install. To work on database schemas, `npm ci` installs pinned development dependencies; then `npm run db:generate --workspace @telegram-agent-bridge/bridge` (or `@telegram-agent-bridge/telegram-ingress`). Retain migration history when upgrading an existing deployment. Never copy a live database into this repo.

There is no standalone HTTP development server: the exported Workers need a D1-compatible `DB` binding and a trusted authenticated identity gateway. See [deployment](docs/deployment.md) before exposing any endpoint. `npm run build` deliberately does not create a hosting manifest or provision resources.

## Connect your assistant

1. Deploy the private bridge using your own hosting registration and secret store.
2. Configure the verified platform owner and expected bot username; pair through private `/setup`.
3. Connect that bridge's MCP tools to the **same assistant session/context** you want to use.
4. Choose polling first, or provision the optional ingress and enable webhook mode with explicit approval.
5. Let the assistant read messages as untrusted channel content and call `send_reply` only within your permissions.

Agent contributors: start with [AGENTS.md](AGENTS.md).

See [architecture](docs/architecture.md), [provider adapter contract](docs/provider-adapters.md), [security](docs/security.md), and [voice setup](services/transcription/README.md).

## Sharing and license

Create your own Git repository from this folder. Build/test commands do not commit, push, publish, deploy or register a live bot. Repository publication is a separate owner-authorized action. `.env.example` files contain only placeholders; real `.env*`, local hosting manifests, databases, audio and weights are excluded.

Licensed under the [MIT License](LICENSE), preserving the repository owner’s existing license and attribution. Third-party dependencies and downloaded model weights retain their own licenses; they are not vendored here.

## Known limits

- Single verified owner; not multi-tenant, not group-chat support.
- Included MCP protocol/identity adapter is host-specific; not claimed compatible with every MCP client.
- No guaranteed real-time replies, arbitrary-HTTP wake endpoint, or infinite background polling.
- Uncertain Telegram sends are intentionally not retried automatically: inspect delivery before manual recovery.
- Plaintext message/transcript storage exists in the private inbox; only credentials, voice metadata and relay envelopes have application-level encryption.
- Voice accuracy and CPU time vary; this export has offline unit coverage, not a new live Telegram/hosting end-to-end certification.
- Fresh online installation of the exported upstream transcription dependency set must be validated on the target OS. Models and ffmpeg are installed separately.
