# Transcription agent guide

Inherits [root rules](../../AGENTS.md). Read [service setup and limitations](README.md).

For new installations, follow the [owner/agent onboarding runbook](../../docs/onboarding.md); respect its owner-only credential entry, approval gates and acceptance checks.

`transcribe_local.py` is a local CPU CLI; `resident.py` is an optional private POSIX stdio supervisor that keeps one ASR model loaded. Neither exposes a network API. `download_model.py` is the explicit online provisioning step. Never download models implicitly during inference or commit downloaded weights, audio, results or virtual environments. Preserve pipe-only ffmpeg input, byte/duration limits, decode timeout and local-files-only inference. Single-shot callers must enforce an outer process timeout; resident mode enforces a startup/decode/inference deadline for each request. All callers must remove temporary audio in `finally` and own process shutdown. Do not add unbounded application queues or retry failed audio automatically.

Tests: `python3 -m unittest discover -s services/transcription/tests` from the root; these use stubs, not model accuracy checks. If dependencies/model revision change, validate a fresh installation and an authorized non-sensitive sample, report the exact environment, and update pins/docs. Do not claim unit tests prove transcription quality or live Telegram voice support.
