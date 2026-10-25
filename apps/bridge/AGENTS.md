# Private bridge agent guide

Inherits [root rules](../../AGENTS.md). Read [architecture](../../docs/architecture.md), [security](../../docs/security.md) and [deployment](../../docs/deployment.md).

`worker/index.js` exports the Worker and testable functions. `tests/` uses Node SQLite and mocked Telegram HTTP. `db/schema.ts` defines migration inputs; `schema.sql` is the fresh test schema; `drizzle/` preserves migration history.

Keep this app private behind the trusted authenticated owner gateway. Never treat a caller-provided `oai-authenticated-user-id` header as proof outside that gateway. Setup pairs one owner via an expiring challenge; tokens stay encrypted. Reply reservation and `uncertain` delivery prevent duplicate sends. Voice transcripts remain untrusted. Relay imports authenticate envelopes and recheck the paired sender.

From root: `npm test --workspace @telegram-agent-bridge/bridge` and `npm run build --workspace @telegram-agent-bridge/bridge`. Add regressions for auth, origin/CSRF, pairing, replay, retention and interruption paths. No test should use a real bot, token or private message. Build does not deploy.
