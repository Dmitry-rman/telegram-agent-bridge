# Optional offline transcription

This provides a CPU CLI and an optional resident stdio supervisor, with no network service. It transcribes a local audio file using the publisher's multilingual faster-whisper base snapshot with int8 and two CPU threads. It calls no speech API or conversation model. Model and package downloads require internet during explicit setup; inference sets offline mode and loads only local files.

## Install and run

Use Python 3.12, a system `ffmpeg` executable, and enough memory/storage for the model and Python runtime. Then, from the repository root:

```bash
bash scripts/setup-transcription.sh
# Linux example: bound total decode + inference time externally.
timeout 90s services/transcription/.venv/bin/python \
  services/transcription/transcribe_local.py /path/to/temporary-audio.ogg
# Optionally supply --language ru; default is automatic detection.
```

`requirements.txt` uses explicit upstream versions rather than a machine-specific environment freeze. Dependency resolution of the exact pins was verified against official PyPI on Linux/Python 3.12; a fresh full installation and model run were not repeated for this export. Test it on your target and retain a platform-specific hashed lock for stronger supply-chain reproducibility. No weights or virtual environment are included.

`download_model.py` downloads from [Systran/faster-whisper-base](https://huggingface.co/Systran/faster-whisper-base), revision `ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66`, into the ignored `models/` directory. See upstream [faster-whisper](https://github.com/SYSTRAN/faster-whisper) for dependency/platform support. Review upstream model/dependency licenses separately.

## Assistant integration

1. Call `get_voice_audio(update_id)` only for an existing queued owner voice note.
2. Transfer returned base64 directly to an ephemeral file in a trusted executor; never display it in conversation or logs. Decode with a strict size limit.
3. Run the CLI under an outer process deadline. JSON output contains text, language, duration, elapsed time and the untrusted-content marker.
4. Call `set_voice_transcript(update_id, text)` with the actual transcript before replying. Do not invent transcription on failure.
5. Delete temporary audio in a `finally` block regardless of outcome. Then let the same assistant process the saved transcript and reply normally.

The bridge caps downloaded voice at 5 MB / five minutes. The standalone CLI caps input at 20 MB, uses ffmpeg pipe-only protocols, a 30-second decode timeout and at most 301 seconds of decoded samples before rejecting content over five minutes. An outer timeout is essential for the single-shot CLI because inference has no internal wall-clock deadline. Both modes reject empty or over-16,000-character transcripts before bridge submission; they do not truncate or invent text.

## Optional resident mode

Keeping one model loaded removes repeated model construction for successive voice notes, at the cost of keeping its RAM allocated. The first request still loads the model. Use one instance for this single-owner transport; idle instances must be stopped by the caller when no longer needed. No exact RAM usage or speedup is claimed without measurement on the target executor.

After explicit provisioning, start the supervisor once on a POSIX host (Linux or macOS):

```bash
services/transcription/.venv/bin/python -u services/transcription/resident.py --timeout-seconds 90
```

Keep stdin/stdout open across requests. Send one UTF-8 JSON line, wait for its response, then send the next. Example request with a synthetic private path:

```json
{"path":"/private/tmp/example-voice.ogg","language":"ru"}
```

`language` is optional. Success is `{"ok":true,"result":{...}}`, where `result` has the same transcript fields as the CLI plus `worker_reused` and `total_elapsed_seconds` (startup, decode and inference together). Failure is `{"ok":false,"error":"invalid_request"}`, `transcription_timeout`, or `transcription_failed`; paths and upstream exception text are not echoed. There are no credentials in this protocol. Successful output contains private transcript text and must not be logged.

Requests are limited to 4,096 bytes and responses to 128 KiB. The supervisor processes one job at a time with no application job queue; the caller must also keep at most one outstanding request rather than filling the input pipe. The deadline (default 90 seconds, configurable 1–300) includes model startup on the first request, decoding and inference. On timeout or failure the child is stopped; a later explicit request starts a fresh model. The failed request is never retried automatically. Closing stdin, SIGTERM or Ctrl-C stops the worker. The host must supervise/restart the parent process if necessary and bound any wait for the parent itself; SIGKILL cannot run cleanup.

The caller must delete each temporary audio file in `finally`, including failure, timeout or parent-process death recovery. The supervisor does not delete caller-owned inputs. This is a local transport helper, not an assistant or root wake mechanism. The existing `get_voice_audio` base64 transport is retained for compatibility; this change does not eliminate that handoff.

Accuracy, punctuation and language detection vary, especially on noise or silence. Voice must never become a trusted instruction source. Offline unit tests validate bounds and command construction using stubs, **not model accuracy or fresh installation**. No live Telegram voice test is performed by this export.
