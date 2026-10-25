# Optional offline transcription

This is a CPU CLI, not a resident network service. It transcribes a local audio file using the publisher's multilingual faster-whisper base snapshot with int8 and two CPU threads. It calls no speech API or conversation model. Model and package downloads require internet during explicit setup; inference sets offline mode and loads only local files.

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

The bridge caps downloaded voice at 5 MB / five minutes. The standalone CLI caps input at 20 MB, uses ffmpeg pipe-only protocols, a 30-second decode timeout and at most 301 seconds of decoded samples before rejecting content over five minutes. An outer timeout is essential because inference has no internal wall-clock deadline. CLI output currently has no 16,000-character cap; callers must validate against the bridge transcript limit and report overlong results rather than silently inventing/rewriting text.

Accuracy, punctuation and language detection vary, especially on noise or silence. Voice must never become a trusted instruction source. Offline unit tests validate bounds and command construction using stubs, **not model accuracy or fresh installation**. No live Telegram voice test is performed by this export.
