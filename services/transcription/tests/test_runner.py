"""No model, third-party libraries, real audio, or network required."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

class RunnerTests(unittest.TestCase):
    def load(self, sample_count=16000):
        model = SimpleNamespace(transcribe=lambda *a, **k: ([SimpleNamespace(text=" test ")], SimpleNamespace(language="en")))
        numpy = SimpleNamespace(float32="float32", frombuffer=lambda *a, **k: range(sample_count))
        whisper = SimpleNamespace(WhisperModel=lambda *a, **k: model)
        spec = importlib.util.spec_from_file_location("runner", Path(__file__).resolve().parents[1] / "transcribe_local.py")
        module = importlib.util.module_from_spec(spec)
        with patch.dict("sys.modules", {"numpy": numpy, "faster_whisper": whisper}):
            spec.loader.exec_module(module)
        return module

    def test_missing_file(self):
        with self.assertRaises(FileNotFoundError):
            self.load().transcribe("/nonexistent/test-audio")

    def test_empty_file_rejected(self):
        with tempfile.NamedTemporaryFile() as file:
            with self.assertRaises(ValueError):
                self.load().transcribe(file.name)

    def test_bounded_pipe_decode_and_transcript(self):
        module = self.load()
        with tempfile.NamedTemporaryFile() as file:
            file.write(b"synthetic-not-real-audio"); file.flush()
            with patch.object(module.subprocess, "run", return_value=SimpleNamespace(stdout=b"")) as run:
                result = module.transcribe(file.name)
        command = run.call_args.args[0]
        self.assertEqual(command[command.index("-protocol_whitelist") + 1], "pipe")
        self.assertEqual(command[command.index("-i") + 1], "pipe:0")
        self.assertEqual(command[command.index("-t") + 1], "301")
        self.assertEqual(run.call_args.kwargs["timeout"], 30)
        self.assertEqual(result["text"], "test")
        self.assertTrue(result["untrusted_channel_content"])

    def test_overlong_decoded_audio_rejected(self):
        module = self.load(sample_count=300 * 16000 + 1)
        with tempfile.NamedTemporaryFile() as file:
            file.write(b"synthetic"); file.flush()
            with patch.object(module.subprocess, "run", return_value=SimpleNamespace(stdout=b"")):
                with self.assertRaises(ValueError):
                    module.transcribe(file.name)

if __name__ == "__main__":
    unittest.main()
