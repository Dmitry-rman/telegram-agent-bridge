# Deployment guide

Deployment is manual and platform-specific. The source alone cannot register Sites projects. Use the current official hosting tools for your account; no production project identifier is included. `hosting.example.json` is a conceptual checklist, **not** a native hosting manifest.

## Private bridge first

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
5. With explicit owner approval, call `configure_webhook`; review existing webhook conflicts rather than overwriting an unrelated integration. Verify `webhook_status` and a real owner message through native database read → private import → inbox → reply. This export does not claim that a new deployment round trip has been verified.
6. Paginate native database reads, pass up to ten non-null pending envelopes at a time to `import_relay_envelopes`, and tolerate safe duplicate imports. No acknowledgment or manual deletion is required; retention removes ciphertext on subsequent accepted ingress. Never expose database access through a public endpoint.
7. Schedule processing only through your assistant host's supported scheduling capability. No schedule or complete queue-draining daemon is bundled, and no reply-latency guarantee follows from registering the webhook.

## Scheduling limitations

Check the assistant host’s current scheduling limits before enabling a schedule. For example, a host limited to six scheduled runs per hour permits a nominal ten-minute polling cadence, not per-message or instant wake-up. That is a host-specific constraint, not a universal timer installed by this repository, and scheduler delays can add latency. Bounded long polling helps only while an assistant session is actively running.

## Build and rollback

`npm run build` emits worker files without deployment or secrets. Local `.openai/hosting.json`, if created by official hosting registration, is copied by the build but excluded from source/export. Never ship the resulting personalized `dist` folder.

Switch back using explicitly authorized `disable_webhook`, which verifies the configured webhook and does not intentionally drop pending updates. Import outstanding relay messages and review uncertain sends; never reset databases/cursors as a shortcut. Confirm a polling round trip after rollback.

## Official references

- [Telegram Bot API](https://core.telegram.org/bots/api): getUpdates, setWebhook, getWebhookInfo, sendMessage and getFile.
- [Cloudflare D1](https://developers.cloudflare.com/d1/): actual host database limits and migration behavior.
- Consult your installed OpenAI Sites hosting/identity/MCP instructions for account-specific registration. Do not bypass its private access gateway with a raw Worker URL.
