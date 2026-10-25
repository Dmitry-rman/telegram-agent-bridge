"""Explicit online provisioning step; inference remains offline."""
from pathlib import Path
from huggingface_hub import snapshot_download
MODEL_ID = "Systran/faster-whisper-base"
REVISION = "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66"
if __name__ == "__main__":
    path = snapshot_download(repo_id=MODEL_ID, revision=REVISION,
        cache_dir=Path(__file__).resolve().parent / "models",
        allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.*", "README.md"])
    print(path)
