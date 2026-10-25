"""Private POSIX stdio supervisor: one warm ASR process, one request at a time.

No HTTP listener, downloads, automatic retry, or conversation model. The caller
owns input files and must delete them in finally, including errors/timeouts.
"""
import argparse
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time

MAX_REQUEST_BYTES = 4096
MAX_RESPONSE_BYTES = 131072


def validate_request(request):
    if not isinstance(request, dict) or set(request) - {'path', 'language'}:
        raise ValueError('Invalid request')
    path, language = request.get('path'), request.get('language')
    if not isinstance(path, str) or not path or len(path) > 2048 or '\0' in path:
        raise ValueError('Invalid path')
    if language is not None and (not isinstance(language, str) or not language.isascii() or not language.isalpha() or len(language) > 8):
        raise ValueError('Invalid language')
    return {'path': path, 'language': language}


class ResidentTranscriber:
    def __init__(self, timeout_seconds=90, command=None):
        if not 0 < timeout_seconds <= 300:
            raise ValueError('Timeout must be in 0..300 seconds')
        self.timeout_seconds = timeout_seconds
        self.command = command or [sys.executable, '-u', str(Path(__file__).resolve()), '--child']
        self.process = None
        self.buffer = b''

    def _read(self, deadline):
        with selectors.DefaultSelector() as selector:
            selector.register(self.process.stdout, selectors.EVENT_READ)
            while b'\n' not in self.buffer:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not selector.select(remaining):
                    raise TimeoutError('Transcription deadline exceeded')
                chunk = os.read(self.process.stdout.fileno(), 4096)
                if not chunk:
                    raise RuntimeError('Transcription process stopped')
                self.buffer += chunk
                if len(self.buffer) > MAX_RESPONSE_BYTES:
                    raise ValueError('Response too large')
            line, self.buffer = self.buffer.split(b'\n', 1)
            return json.loads(line)

    def transcribe(self, request):
        request = validate_request(request)
        payload = json.dumps(request, ensure_ascii=False).encode() + b'\n'
        if len(payload) > MAX_REQUEST_BYTES:
            raise ValueError('Request too large')
        started = time.monotonic()
        deadline = started + self.timeout_seconds
        reused = self.process is not None
        try:
            if self.process is None:
                self.process = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                                stderr=subprocess.DEVNULL, start_new_session=True)
                if self._read(deadline) != {'ready': True}:
                    raise RuntimeError('Transcription process not ready')
            self.process.stdin.write(payload)
            self.process.stdin.flush()
            response = self._read(deadline)
            if not isinstance(response, dict) or response.get('ok') is not True:
                raise RuntimeError('Transcription failed')
            result = response.get('result')
            if not isinstance(result, dict) or not isinstance(result.get('text'), str) or not 0 < len(result['text']) <= 16000 or result.get('untrusted_channel_content') is not True:
                raise ValueError('Invalid transcription result')
            return {**result, 'worker_reused': reused,
                    'total_elapsed_seconds': round(time.monotonic() - started, 2)}
        except BaseException:
            # Kill the whole process group, including an in-flight ffmpeg decoder.
            # The next explicit request starts a new model; this job is never retried.
            self.close()
            raise

    def close(self):
        if self.process is not None:
            process, self.process = self.process, None
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except PermissionError:
                # Some POSIX hosts reject signaling a group whose leader already
                # exited. Reap it; if still alive, at least terminate our child.
                if process.poll() is None:
                    process.kill()
            process.wait()
            for stream in (process.stdin, process.stdout):
                try:
                    stream.close()
                except OSError:
                    pass
            self.buffer = b''


def emit(output, value):
    output.write(json.dumps(value, ensure_ascii=False) + '\n')
    output.flush()


def serve(source, output, worker):
    try:
        while True:
            line = source.readline(MAX_REQUEST_BYTES + 1)
            if not line:
                break
            if len(line) > MAX_REQUEST_BYTES:
                while line and not line.endswith(b'\n'):
                    line = source.readline(MAX_REQUEST_BYTES + 1)
                emit(output, {'ok': False, 'error': 'invalid_request'})
                continue
            try:
                request = validate_request(json.loads(line))
            except (ValueError, TypeError, UnicodeError):
                emit(output, {'ok': False, 'error': 'invalid_request'})
                continue
            try:
                emit(output, {'ok': True, 'result': worker.transcribe(request)})
            except TimeoutError:
                emit(output, {'ok': False, 'error': 'transcription_timeout'})
            except Exception:
                # Never echo paths, audio, transcripts or upstream exception text.
                emit(output, {'ok': False, 'error': 'transcription_failed'})
    finally:
        worker.close()


def child():
    from transcribe_local import load_model, transcribe
    model = load_model()
    emit(sys.stdout, {'ready': True})
    for line in sys.stdin.buffer:
        try:
            request = validate_request(json.loads(line))
            result = transcribe(request['path'], request['language'], model=model)
            emit(sys.stdout, {'ok': True, 'result': result})
        except Exception:
            emit(sys.stdout, {'ok': False, 'error': 'transcription_failed'})


def stop_requested(signum, frame):
    raise KeyboardInterrupt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timeout-seconds', type=int, default=90)
    parser.add_argument('--child', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if os.name != 'posix':
        parser.error('Resident mode requires a POSIX process supervisor')
    if not 1 <= args.timeout_seconds <= 300:
        parser.error('Timeout must be 1..300 seconds')
    if args.child:
        child()
    else:
        previous = signal.signal(signal.SIGTERM, stop_requested)
        try:
            serve(sys.stdin.buffer, sys.stdout, ResidentTranscriber(args.timeout_seconds))
        except KeyboardInterrupt:
            pass
        finally:
            signal.signal(signal.SIGTERM, previous)


if __name__ == '__main__':
    main()
