# Latency and owner-triggered updates

The bridge remains transport for the same existing assistant. An already running host listener does not need a second assistant. This repository cannot change the host's task scheduling or guarantee that a committed Telegram update immediately reaches root. See [runtime topology](runtime-topology.md).

## Changes that reduce transport overhead

- Relay import reads encrypted credentials once, normalizes each message once and derives the receipt signing key once per request. Cleanup and all valid inbox/replay pairs commit in one database batch.
- With stored credentials, typing disabled and one to ten valid messages, the import regression test observes four database calls. Ten messages previously required 32. This is a deterministic call-count comparison, not a production response-time benchmark; optional typing adds its own database work.
- Polling looks up all replay receipts in one query for at most 100 returned updates.
- Returned `messages` are ready for processing. The listener should hand them to the same root immediately, without another inbox read or waiting to fill a ten-message batch. Ten is a maximum, not a minimum.
- The ingress provides an independent arrival sequence for [incremental queue reads and durable host checkpoints](queue-reading.md). Adopting it requires the ingress migration and a listener query/state update; it does not automatically change an existing host listener.
- Optional [resident ASR](../services/transcription/README.md#optional-resident-mode) keeps one offline model loaded across voice requests. It must be explicitly integrated into the existing listener; merely updating source does not replace a single-shot command already used by the host.

## Measure the remaining delay privately

`import_relay_envelopes` returns `timings_ms.verify`, `timings_ms.commit` and `timings_ms.total`. Verification includes configuration/database setup and decrypt/normalize work. Commit is the cleanup/inbox/receipt transaction. Total also includes receipt generation, pending-message selection and optional typing scheduling. These are handler durations; they exclude the wait before the tool call, host tool round trips, root scheduling, model reasoning and the reply network request. They contain no message text, token or owner/chat ID.

In the existing host listener, record monotonic durations for native queue read, private import, handoff, optional ASR and reply confirmation. Keep metrics outside the public repository and omit payloads. Compare text and voice separately; report p50/p95 and queue age rather than claiming speed from typing feedback. Do not run a blocking typing call before handing off a message. Honor import typing leases and Telegram rate-limit delays.

The listener still owns durable pagination, restart recovery and host handoff. A committed import is safe to repeat; do not automatically repeat root side effects merely because delivery to root is ambiguous. An uncertain Telegram send stays blocked.

## Optional HTTP diagnostics

Set `TRANSPORT_DIAGNOSTICS=true` in the private bridge's host configuration to diagnose one controlled exchange. The default is off; tool arguments cannot enable it. This flag does not accelerate delivery or extend typing. Disable it after collecting the measurements.

Authenticated owner calls to `import_relay_envelopes`, `send_reply`, `send_photo_reply`, `send_typing` and `keep_typing` then return an additive `transport_diagnostics` object. On tool errors it appears in a second text content block, preserving the original error. Each call gets a random `trace_id`. Structured console records with `component=telegram_transport` carry the same ID. Different tool calls have different IDs; correlate their sequence privately in the host.

| Event / field | Boundary measured |
| --- | --- |
| `handler_started_at_ms` | Worker entry, before request parsing and owner authentication |
| `handler_start` | Trace enabled after owner authentication |
| `reply_reserved` | Durable outbox reservation completed |
| `telegram_http_start` | Immediately before calling fetch for `sendMessage`, `sendPhoto` or `sendChatAction` |
| `telegram_http_headers` | Fetch resolved with response headers |
| `telegram_http_end` | Response body parsed, or request failed; includes safe outcome, HTTP status and duration |
| `reply_state_saved` | Durable `sent` or `uncertain` state saved |
| `typing_lease_acquired` | Background typing lease acquired, including its expiration |
| `typing_run_start` / `typing_run_end` | Typing loop started / returned, including stop reason and confirmed action count |
| `typing_background_end` | Background task reached its cleanup end, including on failure |
| `handler_end` | Tool result ready, before final response serialization and host receipt |

`at_ms` values are Unix timestamps in milliseconds (UTC). `elapsed_ms`, `duration_ms` and `handler_elapsed_ms` use the worker's monotonic clock. `request_id` distinguishes HTTP requests within one trace. The returned event list is a snapshot, capped at 64 entries. Background typing can continue after that response; its later events are available only in server logs under the import's trace ID. A lease expiration is not the actual time of the final chat action. HTTP success also does not measure when the Telegram client displays the message.

Collect the tool's start/end times, its diagnostic object and corresponding private console records. Compare full tool duration with `handler_elapsed_ms` to estimate time outside the worker; the difference cannot separate host dispatch from return transport. Use `telegram_http_start` to `telegram_http_end` for the actual HTTP operation, and `reply_state_saved` to identify subsequent database delay. Keep a machine timestamp for handoff to the existing assistant: this happens outside the bridge. Cross-machine timestamp comparisons require synchronized clocks; monotonic durations do not.

These diagnostics cover private bridge HTTP calls only. The ingress's inline webhook `sendChatAction` response has no Telegram confirmation available to this worker and is not measured here. No message text, token, owner/chat/update/message ID, request URL, upstream response body or exception text is logged. Keep trace records and real exchange histories outside the public repository and use the host's private log retention controls. Local mocked tests verify boundaries and redaction, not production latency.

## Typing feedback under host delays

The ingress defaults to `INITIAL_TYPING=true` for compatibility. Set `INITIAL_TYPING=false` on the ingress to omit the early webhook-response action when a delayed host would otherwise leave a visible gap before private import renewal. This intentionally leaves the client without an indicator during queued waiting; it does not speed up import. The ingress still persists updates normally and has no bot token or timer.

On the private bridge, `TYPING_ON_IMPORT=true` enables bounded renewal during immediate processing. `IMPORT_TYPING_SECONDS` accepts integer strings from `1` to `25` and defaults to `20`; `25` extends this feedback window by five seconds without another host tool call. Its lease lasts the selected duration plus five seconds for cleanup (30 seconds at the maximum). Invalid configuration schedules no typing and reports `invalid_duration_configuration`; import still succeeds. Manual `keep_typing` duration is independent.

Use `INITIAL_TYPING=false`, `TYPING_ON_IMPORT=true`, `IMPORT_TYPING_SECONDS=25` when delayed dispatch makes the early indicator misleading. Apply these flags manually on their respective deployments. No webhook re-registration or credential change is needed. Neither a 25-second loop nor its lease guarantees uninterrupted client display: host dispatch before import, platform task termination, database/network delays, rate limits and longer processing still create gaps. Renewal stops when an outbox attempt is observed; it does not continue across an uncertain send. Do not run a second loop during the returned lease.

## Compatibility and recovery

The import batching, diagnostics and typing settings require no new database migration, secret change or webhook re-registration. Arrival sequencing separately requires ingress migration `0001_relay_order.sql` before the updated ingress writer is deployed; see [rollout and reconciliation](queue-reading.md). Existing pairing, encryption domains, receipts and outbox reservations remain in place. Malformed envelope structure rejects the request before writes; cryptographically invalid/foreign envelopes appear in `failed_update_ids` while valid envelopes commit together. A database failure rolls back all writes in that import and produces an error; safely re-import after resolving the failure.

`skipped_update_ids` is an additive field for authenticated envelopes below the saved polling cursor. Earlier code incorrectly included these in successful commit receipts even though they were not inserted. The legacy cutoff is preserved to avoid weakening replay protection for deployed history. An unexpected skip needs private investigation; do not reset the cursor or delete receipts. In particular, Telegram can randomize its next ID after a week without updates, so this legacy cutoff still needs a separately reviewed migration strategy for that scenario. The change makes the condition visible; it does not claim to solve ID epoch recovery.

Webhook configuration now requires a successful `setWebhook` response in addition to the expected URL before reporting verification. A matching URL cannot prove the secret was updated after a timeout or rejection. Unconfirmed configuration stays in `switching`; inspect it and perform an explicitly authorized reconciliation. These changes do not call `setWebhook` by themselves.

## CI and manual rollout

The existing GitHub workflow runs `npm run check` on push and pull request using Node 24 and Python 3.12. It runs local mocked/SQLite tests, supervisor tests with synthetic subprocesses, builds and the shareability heuristic. It does not deploy, read secrets, download ASR models, or restart a bot.

After CI succeeds, the owner can instruct the existing host assistant to update to the reviewed commit. Preserve its private configuration, databases, model cache and encrypted credentials. Restart only the affected deployed bridge/listener components using their existing host-specific procedure; this source does not provide a universal restart command. No secret values belong in the instruction or repository.

If using resident ASR, stop any previous instance and attach one supervisor to the existing transport process. Confirm one text message and, when authorized, two non-sensitive voice samples: the second should reuse the same child. Privately measure the stages above and verify no competing listener or typing loop is running. Test uncertain-send handling without resending ambiguous production messages. These live checks are separate from passing CI.
