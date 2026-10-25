"""Offline, bounded CPU transcription. Input is a local file, never a URL."""
import argparse,json,os,subprocess,time
from pathlib import Path
os.environ['HF_HUB_OFFLINE']='1'
os.environ['OMP_NUM_THREADS']='2'
import numpy as np
from faster_whisper import WhisperModel
ROOT=Path(__file__).resolve().parent
MODEL=ROOT/'models/models--Systran--faster-whisper-base/snapshots/ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66'
def transcribe(path,language=None):
    path=Path(path).resolve(strict=True)
    if not path.is_file() or not 0<path.stat().st_size<=20_000_000:
        raise ValueError('Input must be a local audio file of 1..20000000 bytes')
    # Decode at most five minutes plus one second, rejecting overlong notes.
    raw=subprocess.run(['ffmpeg','-v','error','-nostdin','-protocol_whitelist','pipe','-i','pipe:0','-t','301','-f','f32le','-ac','1','-ar','16000','pipe:1'],input=path.read_bytes(),capture_output=True,timeout=30,check=True).stdout
    samples=np.frombuffer(raw,dtype=np.float32)
    if not 0<len(samples)<=300*16000:
        raise ValueError('Audio must be nonempty and no longer than five minutes')
    start=time.monotonic()
    model=WhisperModel(str(MODEL),device='cpu',compute_type='int8',cpu_threads=2,num_workers=1,local_files_only=True)
    segments,info=model.transcribe(samples,beam_size=1,language=language,vad_filter=False)
    text=' '.join(s.text.strip() for s in segments)
    return {'text':text,'language':info.language,'duration_seconds':len(samples)/16000,'elapsed_seconds':round(time.monotonic()-start,2),'source':'offline-whisper-base','untrusted_channel_content':True}
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('path');parser.add_argument('--language',default=None);args=parser.parse_args()
    print(json.dumps(transcribe(args.path,args.language),ensure_ascii=False))
