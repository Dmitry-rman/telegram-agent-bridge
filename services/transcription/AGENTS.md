# Transcription agent guide

Inherits [root rules](../../AGENTS.md). Read [service setup and limitations](README.md).

`transcribe_local.py` is a local CPU CLI, not a daemon/API. `download_model.py` is the explicit online provisioning step. Never download models implicitly during inference or commit downloaded weights, audio, results or virtual environments. Preserve pipe-only ffmpeg input, byte/duration limits, decode timeout and local-files-only inference. Caller must enforce an outer process timeout and remove temporary audio in `finally`.

Tests: `python3 -m unittest discover -s services/transcription/tests` from the root; these use stubs, not model accuracy checks. If dependencies/model revision change, validate a fresh installation and an authorized non-sensitive sample, report the exact environment, and update pins/docs. Do not claim unit tests prove transcription quality or live Telegram voice support.
