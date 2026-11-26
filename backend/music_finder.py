import os, tempfile, subprocess, threading, time
from pathlib import Path
from urllib.parse import urlencode
import httpx
from fastapi import Depends, File, Form, UploadFile, HTTPException

_gate = threading.BoundedSemaphore(1)
_last = {}

def install_music_finder(app, current_user, validate_media_link):
    @app.post('/music/identify')
    def identify(url: str = Form(''), file: UploadFile | None = File(None), rights: bool = Form(False), uid: str = Depends(current_user)):
        if not rights or bool(url.strip()) == bool(file):
            raise HTTPException(400, 'Choose one source and confirm permission.')
        token = os.getenv('AUDD_API_TOKEN', '').strip()
        if not token:
            raise HTTPException(503, 'Music recognition service is not configured.')
        if url:
            url, platform = validate_media_link(url)
            from urllib.parse import urlparse
            if urlparse(url).path.rstrip('/') == '/playlist':
                raise HTTPException(400, 'Choose a single video, not a playlist.')
        if not _gate.acquire(blocking=False):
            raise HTTPException(429, 'Music Finder is busy. Try again shortly.')
        try:
            now = time.monotonic()
            for key in list(_last):
                if now - _last[key] > 60: del _last[key]
            if uid in _last: raise HTTPException(429, 'Wait one minute between requests.')
            _last[uid] = now
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                if file:
                    source = root / 'upload.media'
                    with source.open('wb') as out:
                        while chunk := file.file.read(1024*1024):
                            out.write(chunk)
                else:
                    source = None
                base = [os.sys.executable, '-m', 'yt_dlp', '--ignore-config', '--no-playlist', '--no-warnings', '--socket-timeout', '15', '--retries', '1']
                def download_local():
                    # Single local download; FFmpeg samples the local file.
                    for old in root.glob('fallback.*'): old.unlink()
                    subprocess.run(base+['--no-part','-f','bestaudio[protocol=https]/best[protocol=https]/bestaudio/best','-o',str(root/'fallback.%(ext)s'),'--',url],check=True,timeout=7200,capture_output=True)
                    files = [p for p in root.glob('fallback.*') if p.is_file()]
                    if len(files)!=1 or not 0 < files[0].stat().st_size:
                        raise ValueError('Invalid downloaded media')
                    return files[0]
                if not source and platform != 'youtube':
                    try:
                        source = download_local()
                    except (subprocess.SubprocessError,OSError,ValueError) as exc:
                        print('Music Finder: platform download failed:',platform,type(exc).__name__,flush=True)
                        raise HTTPException(422,'Could not download this public video. Try its full link or upload the audio/video.') from exc
                if source:
                    duration = float(subprocess.check_output(['ffprobe','-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(source)],timeout=15).strip())
                else:
                    import json
                    info = json.loads(subprocess.check_output(base+['--skip-download','--dump-single-json','--',url],timeout=45))
                    if info.get('is_live') or info.get('_type') in ('playlist','multi_video'):
                        raise HTTPException(400,'Choose a single recorded video.')
                    duration = float(info.get('duration') or 0)
                import math
                if not math.isfinite(duration) or duration <= 0:
                    raise HTTPException(422,'Could not determine audio duration.')
                count = min(5, max(1, math.ceil(duration / 12)))
                offsets = sorted(set(round(max(0,duration-12)*i/max(1,count-1),2) for i in range(count)))
                results = {}
                analyzed = 0
                failed = 0
                for offset in offsets:
                    sample = root / 'sample.mp3'
                    sample.unlink(missing_ok=True)
                    try:
                        if source:
                            clip = source
                            seek = offset
                        else:
                            for old in root.glob('section.*'): old.unlink()
                            subprocess.run(base+['-f','bestaudio/best','--download-sections',f'*{offset}-{min(duration,offset+12)}','-o',str(root/'section.%(ext)s'),'--',url],check=True,timeout=45,capture_output=True)
                            clips = list(root.glob('section.*'))
                            if len(clips)!=1 or clips[0].stat().st_size == 0: raise ValueError('Invalid section')
                            clip = clips[0]
                            seek = 0
                        subprocess.run(['ffmpeg','-nostdin','-v','error','-protocol_whitelist','file,pipe','-ss',str(seek),'-i',str(clip),'-t','12','-vn','-ac','1','-ar','44100','-b:a','96k','-y',str(sample)],check=True,timeout=20,capture_output=True)
                        if not sample.exists() or sample.stat().st_size < 1000: raise ValueError('Empty audio')
                    except (subprocess.SubprocessError,OSError,ValueError) as exc:
                        print('Music Finder: sample extraction failed:',type(exc).__name__,flush=True)
                        failed += 1
                        continue
                    with sample.open('rb') as audio:
                        response = httpx.post('https://api.audd.io/',data={'api_token':token},files={'file':('sample.mp3',audio,'audio/mpeg')},timeout=25)
                    response.raise_for_status(); payload=response.json()
                    if payload.get('status') != 'success': raise HTTPException(502,'Recognition provider rejected the request.')
                    analyzed += 1
                    hit=payload.get('result')
                    if not isinstance(hit,dict): continue
                    title=str(hit.get('title') or '')[:200]; artist=str(hit.get('artist') or '')[:200]
                    if not title: continue
                    key=(title.casefold(),artist.casefold())
                    item=results.setdefault(key,{'title':title,'artist':artist,'matches':0,'youtube':'https://www.youtube.com/results?'+urlencode({'search_query':artist+' '+title}),'spotify':'https://open.spotify.com/search/'+__import__('urllib.parse',fromlist=['quote']).quote(artist+' '+title,safe='')})
                    item['matches']+=1
                    item.setdefault('timestamps',[]).append(offset)
                if not analyzed: raise HTTPException(422,'Could not extract any audio samples. Try a direct video link or upload audio.')
                for item in results.values():
                    item['sample_match_percent'] = round(100 * item['matches'] / analyzed) if analyzed else None
                return {'tracks':sorted(results.values(),key=lambda x:-x['matches']), 'samples_analyzed':analyzed,'samples_planned':len(offsets),'samples_failed':failed,'duration_seconds':duration}
        except HTTPException: raise
        except (subprocess.SubprocessError, OSError, httpx.HTTPError, ValueError): raise HTTPException(422,'Audio extraction or recognition failed. Try uploading an audio or video file.')
        finally: _gate.release()
