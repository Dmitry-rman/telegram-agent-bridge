# Documentation guide

Inherits [root rules](../AGENTS.md). Keep the [README](../README.md) as the entrypoint; link detailed material rather than duplicating rules.

- [onboarding](onboarding.md): owner/agent setup sequence, secure token entry, capability gates, verification and recovery stop conditions.
- [runtime topology](runtime-topology.md): execution locations, native listener/root handoff, wake-up and latency boundaries.
- [architecture](architecture.md): message paths, persistence and failure behavior.
- [security](security.md): threat boundaries, permissions and retention.
- [deployment](deployment.md): owner-operated setup, verification and rollback.
- [queue reading](queue-reading.md): arrival sequence, native query, durable checkpoint/handoff recovery and migration.
- [provider adapters](provider-adapters.md): what ports must implement; not a claim of universal support.
- [voice](../services/transcription/README.md): explicit downloads, inference and limitations.

Document only behavior supported by current source. Distinguish local tests, live observations and unverified deployment claims. Do not embed user names, bot identities, URLs, tokens, IDs or operational history. Keep examples reserved/synthetic. Preserve the write-only ingress and same-assistant/no-wake-guarantee distinctions in diagrams and setup instructions.
