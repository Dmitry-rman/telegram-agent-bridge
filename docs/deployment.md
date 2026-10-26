# Deployment guide

For a new owner and assisting agent, begin with the [onboarding runbook](onboarding.md). This page is the technical hosting reference, not a request to collect credentials in chat.

Deployment is manual and platform-specific. The source alone cannot register Sites projects. Use the current official hosting tools for your account; no production project identifier is included. `hosting.example.json` is a conceptual checklist, **not** a native hosting manifest.

For an already running integration, GitHub CI only tests the pushed source. The owner separately instructs the existing host assistant to roll out a reviewed commit and restart the affected components. See [latency and owner-triggered updates](latency.md) for compatibility, timing fields and optional resident ASR. Updating code does not itself change secrets, register webhooks or install a schedule.

## Private bridge first

Image replies on an existing installation require private bridge migration `0005_photo_reply.sql` before invoking the updated `send_photo_reply` tool. Refresh cached MCP discovery after deploying the Worker, and verify the host can pass the generator's actual file bytes within its tool gateway limits. This is separate from ingress migration `0001_relay_order.sql`. See [image reply setup and verification](images.md); no new secrets or webhook changes are required.

1. Register your own **private** hosting project with a D1 database bound as `DB`. Use the exported `worker/index.js` / built `dist/server/index.js`.
2. Initialize a fresh database with `schema.sql` or let the platform apply the complete migrations. Keep existing deployments on their migration history.
3. Configure `SITE_ORIGIN` as the canonical HTTPS origin and `SITE_OWNER_ID` from the authenticated `bridge_identity` tool. Identity discovery reports the caller only; all data tools fail closed until owner configuration matches.
4. Set `EXPECTED_BOT_USERNAME` to your own BotFather-created bot, without `@`. Generate a fresh 32-byte master key, encode with standard base64, and save as native secret `BRIDGE_MASTER_KEY`. Do not put it in chat, version control or build artifacts.
5. Connect owner-authenticated MCP access. Open private `/setup`, enter the bot token there and follow the expiring Telegram `/start` pairing challenge. The bot must not already have another webhook. Never accept the first arbitrary sender as owner.
6. Verify `bridge_status`, a bounded `poll_telegram` and an authorized incoming/reply round trip. Tests do not verify your platform's live identity gateway.

## Optional write-only ingress

1. Register a second project with separate D1 `DB`. Its only public route is POST `/telegram-webhook`. There is no `/mcp` capability or public read/admin route.
2. Set `RECEIVER_ORIGIN`. Ensure the assistant can use the hosting provider's authenticated native database connector for this project's `relay_queue`; otherwise retain polling mode.
3. Set `TELEGRAM_OWNER_ID` to the bridge's verified paired numeric ID (`relay_configuration`), never an unverified username.
4. Provision a new random `PRIVATE_INGEST_SECRET` of at least 32 characters at both apps. Provision the same new URL-safe `TELEGRAM_WEBHOOK_SECRET` at both apps and the ingress HTTPS `/telegram-webhook` URL as bridge `TELEGRAM_WEBHOOK_URL`.
5. With explicit owner approval, call `configure_webhook`; review existing webhook conflicts rather than overwriting an unrelated integration. Verify `webhook_status` and a real owner message through native database read → private import (eligible messages returned inline) → reply. This export does not claim that a new deployment round trip has been verified.
6. Paginate native database reads, pass up to ten non-null pending envelopes at a time to `import_relay_envelopes`, and tolerate safe duplicate imports. Process the import result's `messages` directly; retain inbox reads for recovery. Verify a real Telegram client shows the one-time typing indicator on a new owner text/voice update, and that retries/startup updates do not request it. The inline Bot API method has no success result. No acknowledgment or manual deletion is required; retention removes ciphertext on subsequent accepted ingress. Never expose database access through a public endpoint.
7. Configure an authorized active native transport task to read/import and hand off eligible messages to the existing root. The current reference setup uses no ten-minute automation. The listener is host-native, not a standalone daemon bundled here; registering a webhook does not start it. See [runtime topology](runtime-topology.md).

For an existing ingress, apply `0001_relay_order.sql` before deploying the updated ingress writer. It adds arrival-order metadata and backfills existing IDs without reading or changing ciphertext. Until that migration is applied, the new writer fails closed with 503 so Telegram can retry. Once all ingress writers are updated, reconcile missing order rows as described in [incremental queue reads](queue-reading.md) before switching the listener query. Start a new sequence checkpoint at zero; do not reuse a Telegram ID or assume the historical backlog was handed off. The new table is additive: older ingress code can run against it on rollback, but sequence reads must be suspended until reconciliation after returning to the new writer. Do not drop the table or replay tombstones as a rollback shortcut.

For delayed host dispatch, optionally set `INITIAL_TYPING=false` on the ingress and `TYPING_ON_IMPORT=true`, `IMPORT_TYPING_SECONDS=25` on the private bridge. Defaults preserve the previous feedback behavior. These settings require no new migration beyond the existing private typing table and do not change the webhook or secrets. See [typing feedback and limits](latency.md#typing-feedback-under-host-delays).

## Listener and wake-up limitations

The current integration uses an active host-native transport task, not a ten-minute automation. That task initiates authenticated queue reads and forwards imported messages to root through native collaboration messaging. The webhook does not directly wake root, and queue import is not fully event-driven. Host/task lifecycle and handoff scheduling remain latency and availability boundaries. An inactive listener does not become active merely because D1 received a row. See the [runtime sequence and future-adapter boundary](runtime-topology.md#wake-up-and-latency-what-is-and-is-not-event-driven).

A future deployment may use a separately authorized supported scheduler or event adapter, but neither is installed by this repository. Do not claim continuous availability or instant replies from bounded long polling or Worker `waitUntil` tasks.

## Build and rollback

`npm run build` emits worker files without deployment or secrets. Local `.openai/hosting.json`, if created by official hosting registration, is copied by the build but excluded from source/export. Never ship the resulting personalized `dist` folder.

Switch back using explicitly authorized `disable_webhook`, which verifies the configured webhook and does not intentionally drop pending updates. Import outstanding relay messages and review uncertain sends; never reset databases/cursors as a shortcut. Confirm a polling round trip after rollback.

## Official references

- [Telegram Bot API](https://core.telegram.org/bots/api): getUpdates, setWebhook, getWebhookInfo, sendMessage and getFile.
- [Cloudflare D1](https://developers.cloudflare.com/d1/): actual host database limits and migration behavior.
- Consult your installed OpenAI Sites hosting/identity/MCP instructions for account-specific registration. Do not bypass its private access gateway with a raw Worker URL.

Optional import-time typing requires migration `0004_bored_cerebro.sql` and private-server environment flag `TYPING_ON_IMPORT=true` (default off). Enable only for an importer that immediately forwards messages for actual processing. Respect returned typing lease metadata and rate-limit delays; do not add a second listener renewal loop. This changes neither webhook registration nor credentials. Verify on the target Worker runtime that the execution context reaches the exported handler and bounded post-response actions actually run; Node mocks cannot establish that. A real Workers-runtime regression harness remains a follow-up need, particularly for fetch options and execution-context lifecycle.

### Bounded native-cell repair

Ingress migration `0002_relay_chunks.sql` adds a ciphertext-only projection and transactional maintenance triggers. It recovers retained long envelopes by backfilling from the complete database value, not from a truncated tool response. No Worker route, credential, private importer or message content changes. Preserve all existing migrations, queue/order rows, replay tombstones and listener state. Follow the [lossless chunk-reading contract](queue-reading.md#lossless-ciphertext-chunks-for-bounded-native-readers) and verify native complete pages before importing a blocked message. Keep normal reply deduplication and do not resend messages already attempted.
