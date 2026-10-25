# Write-only ingress agent guide

Inherits [root rules](../../AGENTS.md). Read the [relay protocol](../../docs/architecture.md#optional-write-only-webhook-relay) and [security boundaries](../../docs/security.md).

For new installations, follow the [owner/agent onboarding runbook](../../docs/onboarding.md); respect its owner-only credential entry, approval gates and acceptance checks.

The Worker accepts only POST `/telegram-webhook` at the configured origin. Validate the Telegram secret and exact numeric private-chat owner; encrypt before persisting, then acknowledge transport receipt. Storage failures must remain retryable.

**Do not add public MCP, status, read, admin or ack routes.** Caller-supplied identity headers are untrusted. No bot token or outbound HTTP belongs here. The owning assistant reads ciphertext through a separate authenticated native hosting database connector and imports it into the private bridge. No deletion/ack loop exists; preserve replay IDs and activity-driven ciphertext retention.

From root: `npm test --workspace @telegram-agent-bridge/telegram-ingress` and `npm run build --workspace @telegram-agent-bridge/telegram-ingress`. Test malformed/forged requests, every forbidden route, storage failures, dedup and expiry. Keep fixtures synthetic and preserve migration history.
