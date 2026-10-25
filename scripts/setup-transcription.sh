#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
service="$root/services/transcription"
command -v ffmpeg >/dev/null || { echo 'Install ffmpeg using your OS package manager first.' >&2; exit 1; }
python3 -m venv "$service/.venv"
"$service/.venv/bin/python" -m pip install --index-url https://pypi.org/simple -r "$service/requirements.txt"
# Downloads the fixed model snapshot from its official publisher on Hugging Face.
"$service/.venv/bin/python" "$service/download_model.py"
