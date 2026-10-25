# telegram-ingress

See the [root README](../../README.md) and [deployment guide](../../docs/deployment.md).

- Tests: `npm test --workspace @telegram-agent-bridge/telegram-ingress` from the root.
- Build: `npm run build --workspace @telegram-agent-bridge/telegram-ingress`.
- Fresh database schema: `schema.sql`; managed migration history: `drizzle/`.
- Configuration placeholders: `.env.example` (documentation only; not auto-loaded).
- No runtime secrets, hosting registration or production state are included.
