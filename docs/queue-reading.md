# Incremental native queue reads

This is the contract for the existing host-native listener, not a bundled listener or a new event source. Apply the ingress migration and update the ingress before switching its native database query. No public queue/read/ack endpoint is added.

## Arrival sequence

`relay_order.sequence` is a database-generated, increasing integer independent of Telegram `update_id`. Each ingress acceptance commits ciphertext/replay state and its sequence in one atomic batch. Duplicate webhooks preserve the existing sequence. Sequence rows remain with replay tombstones after ciphertext expires; neither table should be manually truncated. Gaps in sequence numbers are harmless. A reset or replacement database invalidates any saved checkpoint: reconcile explicitly rather than carrying a checkpoint into a new database.

For an existing ingress, migration `0001_relay_order.sql` creates the table/index and backfills **all** existing IDs in `received_at, update_id` order, including expired tombstones. Historical ordering within one second is deterministic, not a claim of original arrival order. New arrivals use insertion order. The private bridge's legacy polling-cursor cutoff is unchanged; this sequence does not fix its separate ID-epoch limitation.

During a rolling update, an older ingress instance could still insert without an order row. After all writers use the updated ingress, reconcile missing rows using the authenticated native database connector before adopting sequence checkpoints:

```sql
INSERT INTO relay_order(update_id)
SELECT q.update_id FROM relay_queue q
WHERE NOT EXISTS (SELECT 1 FROM relay_order o WHERE o.update_id=q.update_id)
ORDER BY q.received_at,q.update_id;
```

This is a metadata-only, owner-operated migration step. The source does not execute it against a deployed database. Keep the prior listener operating until migration/reconciliation completes. Do not enable sequence reads while an old writer can still create unsequenced rows.

## Query without rereading the first page

Use the provider's authenticated native SQL connector and bind the saved checkpoint as `?` (initially zero):

```sql
SELECT o.sequence,q.update_id,q.sealed
FROM relay_order o
JOIN relay_queue q ON q.update_id=o.update_id
WHERE o.sequence > ? AND q.state='pending' AND q.sealed IS NOT NULL
ORDER BY o.sequence
LIMIT 10;
```

Persist checkpoints in private durable host state, not conversation memory, source files or public configuration. `pending` means ciphertext is retained; it does not mean the update has never been imported. `OFFSET` pagination or starting at the first page every time repeatedly scans these old imports. The sequence range query avoids returning those pages once their processing is durably checkpointed. It does not remove a host tool round trip or the separate root handoff.

## Commit and recovery order

1. Read up to ten rows after the saved checkpoint. Pass only `{update_id,sealed}` to the private importer; retain sequence values in private listener state. No need to wait for ten rows to accumulate.
2. Call `import_relay_envelopes`. On failure or a lost result, keep the old checkpoint and repeat the import safely. Never advance based only on having read a row.
3. In **one durable host-state transaction**, save the import result's eligible `messages` as pending handoffs together with the checkpoint for the successfully imported contiguous prefix. This pending state can include private text/transcripts and needs the same private storage/retention controls as the listener's existing message processing. The unchanged importer does not store the listener's checkpoint.
4. Forward pending handoffs immediately to the same root. After a confirmed handoff, mark it delivered in private state. On restart, recover pending handoffs before continuing ordinary reads. If handoff delivery is ambiguous, reconcile using supported host delivery IDs/status; do not blindly repeat assistant side effects. A queue checkpoint is not proof of root delivery.
5. `failed_update_ids` and `skipped_update_ids` are not successful imports. Stop the checkpoint before such a row and investigate privately; a later accepted row must not hide it. If an adapter deliberately continues, it must atomically retain every unresolved row in its own durable recovery ledger first. Never issue another Telegram send to recover an `uncertain` reply.

For example, if a three-row page has sequences 11, 12, 13 and the second import fails, the checkpoint can reach 11 after saving its eligible handoff. It must not jump to 13 and forget 12. An accepted row with no eligible `messages` can be checkpointed: it may be a startup update or an already attempted reply. Keep independent handoff recovery records until resolved.

If the host provides no durable transaction for checkpoint plus pending handoffs, retain the current conservative replay approach. The repository cannot supply that missing host capability. Neither deletion, marking ingress rows `acked`, changing replay receipts, nor resetting the private polling cursor is a substitute.

## Verification

Local SQLite tests cover a page of historical arrivals followed by a lower Telegram ID, duplicate sequence stability, expiration, atomic rollback and migration backfill without changing ciphertext. They do not verify a deployed native connector, its supported SQL/parameters, durable host checkpointing or root delivery. Separately verify the query and restart recovery in the authorized host before adopting it; do not commit the resulting traces or state.
