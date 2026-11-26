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
            url, _ = validate_media_link(url)
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
                        total = 0
                        while chunk := file.file.read(1024*1024):
                            total += len(chunk)
                            if total > 50*1024*1024: raise HTTPException(413, 'Maximum upload: 50 MB.')
                            out.write(chunk)
                else:
                    subprocess.run([os.sys.executable, '-m', 'yt_dlp', '--ignore-config', '--no-playlist', '--no-warnings', '--socket-timeout', '15', '--max-filesize', '50M', '-f', 'bestaudio/best', '--download-sections', '*0-35', '-o', str(root/'source.%(ext)s'), '--', url], check=True, timeout=90, capture_output=True)
                    sources = list(root.glob('source.*'))
                    if len(sources)!=1 or sources[0].stat().st_size > 50*1024*1024: raise HTTPException(422, 'Source unavailable or too large.')
                    source = sources[0]
                results = {}
                analyzed = 0
                for offset in (0, 12, 24):
                    sample = root / 'sample.mp3'
                    sample.unlink(missing_ok=True)
                    subprocess.run(['ffmpeg','-nostdin','-v','error','-protocol_whitelist','file,pipe','-ss',str(offset),'-i',str(source),'-t','12','-vn','-ac','1','-ar','44100','-b:a','96k','-y',str(sample)],check=True,timeout=25,capture_output=True)
                    if not sample.exists() or sample.stat().st_size < 1000: continue
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
                for item in results.values():
                    item['sample_match_percent'] = round(100 * item['matches'] / analyzed) if analyzed else None
                return {'tracks':sorted(results.values(),key=lambda x:-x['matches']), 'samples_analyzed':analyzed}
        except HTTPException: raise
        except (subprocess.SubprocessError, OSError, httpx.HTTPError, ValueError): raise HTTPException(422,'Audio extraction or recognition failed. Try uploading a short audio file.')
        finally: _gate.release()
