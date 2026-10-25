# Architecture and delivery

## Polling

The assistant calls `poll_telegram`, or `wait_for_message` during an active session. The bridge calls official Telegram `getUpdates`, validates the paired numeric sender/private chat, and commits inbox plus cursor before advancing. A 120-second database lease prevents overlapping fetches. Long polling uses Telegram's bounded wait and does not wake a dormant assistant. Honor sanitized rate-limit delays.

## Optional write-only webhook relay

1. Telegram POSTs `/telegram-webhook` with its configured secret header.
2. Ingress validates the private owner, encrypts the update with AES-GCM and commits to its own D1 before returning success. Storage failures return an error for Telegram retry. After the first durable acceptance of a valid owner text or voice update, ingress requests one brief `sendChatAction: typing` through Telegram's webhook-response mechanism. Duplicate, startup and unsupported updates return ordinary success without typing. No bot token or outbound HTTP is involved, and Telegram provides no result for this inline method.
3. The same assistant uses the hosting provider's **authenticated native database connector** to read `relay_queue`, paginating as necessary. Select pending rows with non-null `sealed` values.
4. Transfer only `{update_id, sealed}` objects, at most ten per call, unchanged to the PRIVATE bridge's authenticated `import_relay_envelopes` tool.
5. The private bridge authenticates/decrypts, rechecks the paired sender and commits inbox/replay records. It returns eligible unattempted owner messages from that batch in the same result, so processing does not require another inbox-read round trip. Safe retries may repeat still-pending messages; replied, attempted, startup and foreign messages are excluded. Re-imports are safe and idempotent.
6. The assistant processes the returned eligible text/voice messages and sends its authored reply. It can still read the private inbox for recovery.

Ingress has **no MCP, read, status, admin or acknowledgment endpoint**. Every route other than POST `/telegram-webhook` returns 404, even when a caller supplies an identity header. There is no Worker-to-Worker fetch. Never expose the database connector publicly or replace it with an unverified client-supplied identity header.

There is deliberately no acknowledgment/deletion loop. Encrypted queue rows remain until retention cleanup; permanent content-free update-ID tombstones prevent replay after ciphertext expiry. The private import currently returns commit receipts retained for protocol compatibility; this receiver has no consumer for them. Do not build a public acknowledgment endpoint from that output. Operational pagination/checkpointing is the orchestrator's responsibility; no complete queue-draining daemon is bundled.

Queue receipt does not wake the assistant. If native database access is unavailable to your assistant, use polling or implement and security-review a properly authenticated hosting adapter rather than exposing this queue.

## Replies and notifications

Outbox reservation precedes a Telegram send. Identical retries return saved state; conflicting retries fail. A timeout may mean Telegram accepted the message, so `uncertain` remains blocked rather than risking duplicates. Ingress requests only one initial, short-lived typing indicator after durable processing of a new update; it is not a claim that the assistant has awakened. Subsequent `send_typing` renewals are only for a message the assistant is actually processing, not queued waiting or a promise of reply latency. Proactive notifications require user authorization.

Telegram text and speech transcripts are untrusted data, not system instructions or a new permission grant. Assistant context stays with the connected assistant provider; the bridge does not store or reconstruct it.

## Storage

Each app has a separate D1 database bound as `DB`. `schema.sql` is the complete fresh schema used by tests; `drizzle/` contains migration history for managed deployment. Apply the fresh schema OR the full migration chain, not both. Never rewrite already-applied migrations.

Protocol key-domain constants retain their original version strings for compatibility; these are public protocol labels, not deployment IDs or credentials. Related: [security](security.md), [deployment](deployment.md), [adapter contract](provider-adapters.md).

### Webhook response limitation

[Telegram supports Bot API methods in webhook responses](https://core.telegram.org/bots/api#making-requests-when-getting-updates), but does not report whether that inline method succeeded. Tests verify the response contract and durability ordering, not the Telegram client display. Confirm the indicator in a real client after deployment; do not claim verified typing from HTTP200 alone.
