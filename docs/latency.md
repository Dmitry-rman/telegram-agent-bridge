# Latency and owner-triggered updates

The bridge remains transport for the same existing assistant. An already running host listener does not need a second assistant. This repository cannot change the host's task scheduling or guarantee that a committed Telegram update immediately reaches root. See [runtime topology](runtime-topology.md).

## Changes that reduce transport overhead

- Relay import reads encrypted credentials once, normalizes each message once and derives the receipt signing key once per request. Cleanup and all valid inbox/replay pairs commit in one database batch.
- With stored credentials, typing disabled and one to ten valid messages, the import regression test observes four database calls. Ten messages previously required 32. This is a deterministic call-count comparison, not a production response-time benchmark; optional typing adds its own database work.
- Polling looks up all replay receipts in one query for at most 100 returned updates.
- Returned `messages` are ready for processing. The listener should hand them to the same root immediately, without another inbox read or waiting to fill a ten-message batch. Ten is a maximum, not a minimum.
- Optional [resident ASR](../services/transcription/README.md#optional-resident-mode) keeps one offline model loaded across voice requests. It must be explicitly integrated into the existing listener; merely updating source does not replace a single-shot command already used by the host.

## Measure the remaining delay privately

`import_relay_envelopes` returns `timings_ms.verify`, `timings_ms.commit` and `timings_ms.total`. Verification includes configuration/database setup and decrypt/normalize work. Commit is the cleanup/inbox/receipt transaction. Total also includes receipt generation, pending-message selection and optional typing scheduling. These are handler durations; they exclude the wait before the tool call, host tool round trips, root scheduling, model reasoning and the reply network request. They contain no message text, token or owner/chat ID.

In the existing host listener, record monotonic durations for native queue read, private import, handoff, optional ASR and reply confirmation. Keep metrics outside the public repository and omit payloads. Compare text and voice separately; report p50/p95 and queue age rather than claiming speed from typing feedback. Do not run a blocking typing call before handing off a message. Honor import typing leases and Telegram rate-limit delays.

The listener still owns durable pagination, restart recovery and host handoff. A committed import is safe to repeat; do not automatically repeat root side effects merely because delivery to root is ambiguous. An uncertain Telegram send stays blocked.

## Compatibility and recovery

No database migration, secret change or webhook re-registration is required for these changes. Existing pairing, encryption domains, receipts and outbox reservations remain in place. Malformed envelope structure rejects the request before writes; cryptographically invalid/foreign envelopes appear in `failed_update_ids` while valid envelopes commit together. A database failure rolls back all writes in that import and produces an error; safely re-import after resolving the failure.

`skipped_update_ids` is an additive field for authenticated envelopes below the saved polling cursor. Earlier code incorrectly included these in successful commit receipts even though they were not inserted. The legacy cutoff is preserved to avoid weakening replay protection for deployed history. An unexpected skip needs private investigation; do not reset the cursor or delete receipts. In particular, Telegram can randomize its next ID after a week without updates, so this legacy cutoff still needs a separately reviewed migration strategy for that scenario. The change makes the condition visible; it does not claim to solve ID epoch recovery.

Webhook configuration now requires a successful `setWebhook` response in addition to the expected URL before reporting verification. A matching URL cannot prove the secret was updated after a timeout or rejection. Unconfirmed configuration stays in `switching`; inspect it and perform an explicitly authorized reconciliation. These changes do not call `setWebhook` by themselves.

## CI and manual rollout

The existing GitHub workflow runs `npm run check` on push and pull request using Node 24 and Python 3.12. It runs local mocked/SQLite tests, supervisor tests with synthetic subprocesses, builds and the shareability heuristic. It does not deploy, read secrets, download ASR models, or restart a bot.

After CI succeeds, the owner can instruct the existing host assistant to update to the reviewed commit. Preserve its private configuration, databases, model cache and encrypted credentials. Restart only the affected deployed bridge/listener components using their existing host-specific procedure; this source does not provide a universal restart command. No secret values belong in the instruction or repository.

If using resident ASR, stop any previous instance and attach one supervisor to the existing transport process. Confirm one text message and, when authorized, two non-sensitive voice samples: the second should reuse the same child. Privately measure the stages above and verify no competing listener or typing loop is running. Test uncertain-send handling without resending ambiguous production messages. These live checks are separate from passing CI.
