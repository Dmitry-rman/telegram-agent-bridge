"""Exercise a real subprocess supervisor without Whisper, audio or network."""
import importlib.util
import io
import json
import os
import signal
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('resident', Path(__file__).resolve().parents[1] / 'resident.py')
resident = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resident)

FAKE_CHILD = '''
import json,sys,time
print(json.dumps({'ready': True}), flush=True)
count = 0
for line in sys.stdin:
    job = json.loads(line)
    if job['path'] == 'timeout':
        time.sleep(30)
    if job['path'] == 'crash':
        sys.exit(1)
    if job['path'] == 'oversize':
        print('x' * 140000, flush=True)
        continue
    if job['path'] == 'invalid':
        print(json.dumps({'ok': True, 'result': {'text': 'missing trust marker'}}), flush=True)
        continue
    count += 1
    print(json.dumps({'ok': True, 'result': {'text': 'synthetic', 'untrusted_channel_content': True, 'count': count}}), flush=True)
'''


@unittest.skipUnless(os.name == 'posix', 'POSIX supervisor')
class ResidentTests(unittest.TestCase):
    def worker(self, timeout=5):
        worker = resident.ResidentTranscriber(timeout, [sys.executable, '-u', '-c', FAKE_CHILD])
        self.addCleanup(worker.close)
        return worker

    def test_two_jobs_reuse_process_then_close_reaps_it(self):
        worker = self.worker()
        first = worker.transcribe({'path': 'one'})
        self.assertEqual(first['count'], 1)
        self.assertFalse(first['worker_reused'])
        self.assertGreaterEqual(first['total_elapsed_seconds'], 0)
        process = worker.process
        second = worker.transcribe({'path': 'two', 'language': 'ru'})
        self.assertEqual(second['count'], 2)
        self.assertTrue(second['worker_reused'])
        self.assertIs(worker.process, process)
        worker.close()
        self.assertIsNotNone(process.returncode)
        self.assertIsNone(worker.process)

    def test_timeout_does_not_retry_and_next_explicit_job_restarts(self):
        worker = self.worker(timeout=0.5)
        with self.assertRaises(TimeoutError):
            worker.transcribe({'path': 'timeout'})
        self.assertIsNone(worker.process)
        worker.timeout_seconds = 5
        self.assertEqual(worker.transcribe({'path': 'next'})['count'], 1)

    def test_crash_oversize_and_invalid_result_stop_worker(self):
        for path in ['crash', 'oversize', 'invalid']:
            worker = self.worker()
            with self.assertRaises((RuntimeError, ValueError)):
                worker.transcribe({'path': path})
            self.assertIsNone(worker.process)

    def test_startup_is_covered_by_same_deadline(self):
        worker = resident.ResidentTranscriber(0.5, [sys.executable, '-u', '-c', 'import time; time.sleep(30)'])
        self.addCleanup(worker.close)
        with self.assertRaises(TimeoutError):
            worker.transcribe({'path': 'synthetic'})
        self.assertIsNone(worker.process)

    def test_timeout_stops_descendant_decoder_as_well_as_model(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'synthetic-marker'
            descendant = "import time; from pathlib import Path; time.sleep(1); Path(" + repr(str(marker)) + ").write_text('synthetic')"
            command = "import json,subprocess,sys,time; print(json.dumps({'ready':True}),flush=True); sys.stdin.readline(); subprocess.Popen([sys.executable,'-c'," + repr(descendant) + "]); time.sleep(30)"
            worker = resident.ResidentTranscriber(0.5, [sys.executable, '-u', '-c', command])
            self.addCleanup(worker.close)
            with self.assertRaises(TimeoutError):
                worker.transcribe({'path': 'synthetic'})
            time.sleep(1.1)
            self.assertFalse(marker.exists())

    def test_invalid_request_does_not_start_process(self):
        worker = self.worker()
        for request in [None, {}, {'path': 'x', 'command': 'forbidden'}, {'path': 'x', 'language': '../ru'}, {'path': 'x' * 2049}]:
            with self.assertRaises(ValueError):
                worker.transcribe(request)
        self.assertIsNone(worker.process)

    def test_protocol_bounds_errors_and_eof_cleanup(self):
        worker = self.worker()
        source = io.BytesIO(b'x' * 5000 + b'\n' + b'{invalid}\n' + b'{"path":"valid"}\n')
        output = io.StringIO()
        resident.serve(source, output, worker)
        responses = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([response.get('error') for response in responses[:2]], ['invalid_request', 'invalid_request'])
        self.assertTrue(responses[2]['ok'])
        self.assertIsNone(worker.process)

    def test_protocol_error_never_echoes_exception_or_input_path(self):
        for error, code in [(TimeoutError('private/path'), 'transcription_timeout'), (RuntimeError('private/path'), 'transcription_failed')]:
            worker = SimpleNamespace(transcribe=Mock(side_effect=error), close=Mock())
            output = io.StringIO()
            resident.serve(io.BytesIO(b'{"path":"private/path"}\n'), output, worker)
            self.assertEqual(json.loads(output.getvalue()), {'ok': False, 'error': code})
            worker.close.assert_called_once()

    def test_model_child_loads_once_for_multiple_requests(self):
        model = object()
        load = Mock(return_value=model)
        transcribe = Mock(return_value={'text': 'synthetic', 'untrusted_channel_content': True})
        source = SimpleNamespace(buffer=io.BytesIO(b'{"path":"one"}\n{"path":"two","language":"ru"}\n'))
        output = io.StringIO()
        with patch.dict(sys.modules, {'transcribe_local': SimpleNamespace(load_model=load, transcribe=transcribe)}), patch.object(sys, 'stdin', source), patch.object(sys, 'stdout', output):
            resident.child()
        load.assert_called_once()
        self.assertEqual(transcribe.call_count, 2)
        for call in transcribe.call_args_list:
            self.assertIs(call.kwargs['model'], model)
        self.assertEqual(json.loads(output.getvalue().splitlines()[0]), {'ready': True})

    def test_parent_sigterm_runs_worker_cleanup_and_restores_handler(self):
        previous = signal.getsignal(signal.SIGTERM)
        worker = SimpleNamespace(transcribe=Mock(side_effect=lambda request: os.kill(os.getpid(), signal.SIGTERM)), close=Mock())
        source = SimpleNamespace(buffer=io.BytesIO(b'{"path":"synthetic"}\n'))
        with patch.object(sys, 'argv', ['resident.py']), patch.object(sys, 'stdin', source), patch.object(sys, 'stdout', io.StringIO()), patch.object(resident, 'ResidentTranscriber', return_value=worker):
            resident.main()
        worker.close.assert_called_once()
        self.assertEqual(signal.getsignal(signal.SIGTERM), previous)


if __name__ == '__main__':
    unittest.main()
