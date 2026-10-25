"""Heuristic source export guard; not a replacement for manual secret review."""
from pathlib import Path
import re
import sys
ROOT = Path(__file__).resolve().parents[1]
IGNORED = {".git", "node_modules", "dist", "__pycache__", ".venv", "models"}
FORBIDDEN = {".openai", ".sites-runtime", ".npm-cache", "state", "artifacts", "outputs", "logs"}
errors = []
count = 0
for path in ROOT.rglob("*"):
    rel = path.relative_to(ROOT)
    if any(part in IGNORED for part in rel.parts):
        continue
    if not path.is_file():
        continue
    count += 1
    if any(part in FORBIDDEN for part in rel.parts) or (path.name.startswith(".env") and path.name != ".env.example"):
        errors.append(f"excluded runtime path: {rel}"); continue
    if path.suffix.lower() in {".wav", ".ogg", ".mp3", ".m4a", ".db", ".sqlite", ".zip", ".gz", ".bin", ".log"}:
        errors.append(f"runtime/binary file: {rel}"); continue
    try:
        text = path.read_text()
    except UnicodeError:
        errors.append(f"unreviewed binary file: {rel}"); continue
    patterns = [r"-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----", r"gh[pousr]_[A-Za-z0-9]{30,}", r"github_pat_[A-Za-z0-9_]{30,}", r"[0-9]{7,}:[A-Za-z0-9_-]{30,}", r"sk-[A-Za-z0-9_-]{24,}"]
    if any(re.search(pattern, text) for pattern in patterns):
        errors.append(f"possible credential: {rel}")
if errors:
    print("Shareability check FAILED:\n" + "\n".join(errors)); sys.exit(1)
print(f"Shareability heuristic passed: {count} source files checked; manually review before publication.")
