import os, re, json, uuid, shutil, subprocess, threading, time, secrets, hmac, traceback
from datetime import datetime, timezone, timedelta
import httpx
from dotenv import load_dotenv
from pathlib import Path
from urllib.parse import urlparse
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from yt_dlp import YoutubeDL

ROOT=Path(__file__).resolve().parent
# Local-only configuration file, never upload to GitHub.
load_dotenv(ROOT / '.env.local')
WORK=ROOT/'work'; WORK.mkdir(exist_ok=True)
app=FastAPI(title='ClipStudio generator API', docs_url=None, redoc_url=None, openapi_url=None)
ORIGINS=[x.strip() for x in os.getenv('ALLOWED_ORIGINS','http://localhost:5173,http://127.0.0.1:5173').split(',') if x.strip()]
app.add_middleware(CORSMiddleware,allow_origins=ORIGINS,allow_methods=['GET','POST'],allow_headers=['Authorization','Content-Type'])
jobs={}
lock=threading.Lock()
active_users=set()
usage={}
MAX_DAILY=max(0,min(100,int(os.getenv('MAX_JOBS_PER_DAY','20'))))
MAX_DOWNLOADS_DAILY=max(0,min(100,int(os.getenv('MAX_DOWNLOADS_PER_DAY','10'))))
MAX_ACTIVE=max(1,min(2,int(os.getenv('MAX_ACTIVE_JOBS','1'))))
JOB_TTL=max(600,min(86400,int(os.getenv('JOB_TTL_SECONDS','3600'))))
# Allow source videos up to five hours; keep a bounded download/upload size.
MAX_VIDEO_SECONDS = 5 * 60 * 60
MAX_VIDEO_FILE_BYTES = 5 * 1024 * 1024 * 1024  # 5 GiB
SUPABASE_URL=os.getenv('SUPABASE_URL','').rstrip('/')
SUPABASE_PUBLISHABLE_KEY=os.getenv('SUPABASE_PUBLISHABLE_KEY','')
if not SUPABASE_URL or not SUPABASE_PUBLISHABLE_KEY:
    print('WARNING: Supabase authentication not configured. /generate will reject requests.')

def current_user(authorization: str|None=Header(None)):
    if not SUPABASE_URL or not SUPABASE_PUBLISHABLE_KEY:
        raise HTTPException(503,'Server authentication is not configured')
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401,'Sign in to generate videos')
    token=authorization[7:].strip()
    if len(token)>8192 or not token:
        raise HTTPException(401,'Invalid session')
    try:
        response=httpx.get(SUPABASE_URL+'/auth/v1/user',headers={'apikey':SUPABASE_PUBLISHABLE_KEY,'Authorization':'Bearer '+token},timeout=8)
        if response.status_code!=200:raise HTTPException(401,'Session expired. Sign in again')
        uid=response.json().get('id')
        if not isinstance(uid,str) or not uid:raise HTTPException(401,'Invalid account')
        return uid
    except (httpx.RequestError, ValueError):
        raise HTTPException(503,'Authentication service unavailable')

def cleanup():
    now=time.time()
    with lock:
        expired=[key for key,job in jobs.items() if job['status'] in ('done','error') and now-job['created']>JOB_TTL]
        for key in expired:jobs.pop(key,None)
        for key in list(usage):
            if key[1]!=datetime.now(timezone.utc).date().isoformat():usage.pop(key,None)
    for key in expired:shutil.rmtree(WORK/key,ignore_errors=True)

def utc_day():
    return datetime.now(timezone.utc).date().isoformat()

def daily_reset_utc():
    return (datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)).isoformat().replace('+00:00','Z')

def reserve_work(uid, kind):
    # A failed job will be refunded; successful jobs count for that UTC day.
    limit = MAX_DAILY if kind == 'shorts' else MAX_DOWNLOADS_DAILY
    date = utc_day()
    key = (uid, date, kind)
    with lock:
        if uid in active_users:
            raise HTTPException(429, 'You already have a processing job in progress on this account')
        if len(active_users) >= MAX_ACTIVE:
            raise HTTPException(503, 'Generator is busy. Please retry later')
        if limit and usage.get(key, 0) >= limit:
            raise HTTPException(429, f'Daily {kind} limit reached ({limit}). Resets at 00:00 UTC: {daily_reset_utc()}')
        active_users.add(uid)
        usage[key] = usage.get(key, 0) + 1
    return date

def refund_work(uid, date, kind):
    with lock:
        key = (uid, date, kind)
        usage[key] = max(0, usage.get(key, 0) - 1)

def finish_user(uid):
    with lock:active_users.discard(uid)

@app.get('/limits')
def limits(uid:str=Depends(current_user)):
    cleanup()
    day=utc_day()
    with lock:
        shorts_used=usage.get((uid,day,'shorts'),0)
        downloads_used=usage.get((uid,day,'downloads'),0)
        processing=uid in active_users
    return {
        'shorts':{'used':shorts_used,'limit':MAX_DAILY,'remaining':max(0,MAX_DAILY-shorts_used) if MAX_DAILY else None},
        'downloads':{'used':downloads_used,'limit':MAX_DOWNLOADS_DAILY,'remaining':max(0,MAX_DOWNLOADS_DAILY-downloads_used) if MAX_DOWNLOADS_DAILY else None},
        'reset_utc':daily_reset_utc(), 'processing':processing
    }

def run(args,cwd=None):
    p=subprocess.run(args,cwd=cwd,capture_output=True,text=True,encoding='utf-8',errors='replace')
    if p.returncode: raise RuntimeError((p.stderr or p.stdout)[-1300:])
    return p.stdout

def duration(path):
    info=json.loads(run(['ffprobe','-v','error','-show_format','-of','json',str(path)]))
    return float(info['format']['duration'])

def ass_time(sec):
    cs=round(sec*100);return f'{cs//360000}:{(cs//6000)%60:02}:{(cs//100)%60:02}.{cs%100:02}'

def captions(words, start, end, path, color='#FFE34D'):
    # ASS BGR hexadecimal; highlighted word on each spoken interval
    bgr='&H00'+color[5:7]+color[3:5]+color[1:3]
    header='''[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nWrapStyle: 2\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Pop,Arial,40,'''+bgr+''',&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,3,1,2,30,30,150,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n'''
    events=[]
    for w in words:
        a=max(start,float(w['start']));b=min(end,float(w['end']))
        if b<=a:continue
        txt=re.sub(r'[{}\\]','',str(w['word'])).strip()
        if not txt:continue
        # pop entrance: ASS scale animation for each word
        events.append(f'Dialogue: 0,{ass_time(a-start)},{ass_time(b-start)},Pop,,0,0,0,,{{\\fscx120\\fscy120\\t(0,140,\\fscx100\\fscy100)}}{txt}')
    path.write_text(header+'\n'.join(events),encoding='utf-8-sig')

def transcribe(path):
    try:
        from faster_whisper import WhisperModel
        model=WhisperModel('base',device='cpu',compute_type='int8')
        segments,_=model.transcribe(str(path),word_timestamps=True,vad_filter=True)
        return [{'word':w.word,'start':w.start,'end':w.end} for s in segments for w in (s.words or []) if w.start is not None and w.end is not None]
    except ImportError:
        raise RuntimeError('Install transcription dependency: pip install faster-whisper')

def generate(job,source,seconds,uid):
    folder=WORK/job;folder.mkdir(exist_ok=True)
    try:
        jobs[job].update(status='downloading',progress='Preparing video',percentages=[0,0,0,0])
        if source.startswith('https://'):
            host=(urlparse(source).hostname or '').lower()
            if host not in {'youtube.com','www.youtube.com','m.youtube.com','youtu.be'}:
                raise RuntimeError('Only public YouTube URLs are accepted')
            opts={'format':'bv*[height<=720]+ba/b[height<=720]/b','outtmpl':str(folder/'source.%(ext)s'),'noplaylist':True,'max_filesize':MAX_VIDEO_FILE_BYTES,'quiet':True,'merge_output_format':'mp4','restrictfilenames':True,'socket_timeout':30}
            with YoutubeDL(opts) as ydl:
                info=ydl.extract_info(source,download=False)
                if info.get('duration',0)>MAX_VIDEO_SECONDS:raise RuntimeError('Video longer than 5 hours is not supported')
                ydl.download([source])
            candidates=[p for p in folder.glob('source.*') if p.is_file()]
            if not candidates:raise RuntimeError('YouTube did not provide a downloadable video')
            video=candidates[0]
        else:
            video=Path(source)
        total=duration(video)
        if total<12:raise RuntimeError('Video must be at least 12 seconds')
        if total>MAX_VIDEO_SECONDS:raise RuntimeError('Video longer than 5 hours is not supported')
        jobs[job].update(status='transcribing',progress='Transcribing speech; first run downloads the speech model')
        words=transcribe(video)
        # rank nonoverlapping windows by recognized speech density (not semantic virality)
        clip_len=min(seconds,max(3,total/4-0.5))
        starts=[i*max(1,(total-clip_len)/24) for i in range(25)]
        ranked=sorted(starts,key=lambda s:sum(1 for w in words if s<=w['start']<s+clip_len),reverse=True)
        chosen=[]
        for s in ranked:
            if all(abs(s-other)>=clip_len for other in chosen):chosen.append(s)
            if len(chosen)==4:break
        if len(chosen)<4:
            chosen=[i*(total-clip_len)/3 for i in range(4)]
        chosen.sort()
        outputs=[]
        for i,start in enumerate(chosen,1):
            jobs[job].update(status='rendering',progress=f'Rendering clip {i}/4')
            subtitle=folder/f'clip{i}.ass';captions(words,start,start+clip_len,subtitle)
            output=folder/f'clip{i}.mp4'
            # ASS filter runs in job folder to avoid Windows drive-letter escaping
            vf=f'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,ass=clip{i}.ass'
            cmd=['ffmpeg','-hide_banner','-loglevel','error','-nostats','-progress','pipe:1','-y','-ss',str(start),'-i',str(video),'-t',str(clip_len),'-vf',vf,'-r','25','-c:v','libx264','-preset','veryfast','-crf','25','-c:a','aac','-b:a','128k',str(output)]
            with subprocess.Popen(cmd,cwd=str(folder),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',errors='replace') as proc:
                for line in proc.stdout:
                    key,sep,value=line.strip().partition('=')
                    if sep and key in ('out_time_us','out_time_ms','out_time'):
                        try:
                            if key=='out_time':
                                hh,mm,ss=value.split(':');elapsed=int(hh)*3600+int(mm)*60+float(ss)
                            else:elapsed=int(value)/1000000
                            pct=max(0,min(99,int(100*elapsed/clip_len)))
                            jobs[job]['percentages'][i-1]=max(jobs[job]['percentages'][i-1],pct)
                        except (ValueError,ZeroDivisionError):pass
                err=proc.stderr.read()
                if proc.wait()!=0:raise RuntimeError(err[-1300:] or 'FFmpeg rendering failed')
            jobs[job]['percentages'][i-1]=100
            outputs.append({'url':f'/files/{job}/clip{i}.mp4','start':round(start,1),'duration':round(clip_len,1)})
        jobs[job].update(status='done',progress='Finished',clips=outputs)
    except Exception as e:
        traceback.print_exc()
        jobs[job].update(status='error',progress=str(e)[:500])
        refund_work(uid, jobs[job]['quota_day'], 'shorts')
    finally:
        finish_user(uid)

@app.get('/health')
def health():return {'ok':True,'ffmpeg':bool(shutil.which('ffmpeg')),'ffprobe':bool(shutil.which('ffprobe'))}

def validate_youtube_link(raw: str) -> str:
    value = raw.strip()
    if not value or len(value) > 2048:
        raise HTTPException(400, 'Provide a valid YouTube URL')
    try:
        parsed = urlparse(value)
        allowed = {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'}
        if (parsed.scheme != 'https' or parsed.hostname not in allowed
                or parsed.username is not None or parsed.password is not None
                or parsed.port not in (None, 443)):
            raise ValueError('Invalid YouTube URL')
    except ValueError:
        raise HTTPException(400, 'Only HTTPS YouTube links are accepted')
    return value

@app.post('/generate')
async def start(url:str=Form(''),file:UploadFile|None=File(None),seconds:int=Form(30),uid:str=Depends(current_user)):
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):raise HTTPException(400,'FFmpeg/ffprobe not found in PATH')
    if not file and not url:raise HTTPException(400,'Provide YouTube URL or local file')
    if seconds not in (15,30,45,60):raise HTTPException(400,'Invalid clip duration')
    source_url = validate_youtube_link(url) if not file else ''
    cleanup()
    reserved_day=reserve_work(uid,'shorts')
    job=uuid.uuid4().hex; folder=WORK/job;folder.mkdir(exist_ok=True)
    source=source_url
    try:
      if file:
          ext=Path(file.filename or '').suffix.lower()
          if ext not in {'.mp4','.mov','.mkv','.webm'}:raise HTTPException(400,'Unsupported video format')
          path=folder/('source'+ext)
          size=0
          with path.open('wb') as out:
              while chunk:=await file.read(1024*1024):
                  size+=len(chunk)
                  if size>MAX_VIDEO_FILE_BYTES:
                      path.unlink(missing_ok=True);raise HTTPException(413,'Maximum upload size is 5 GB')
                  out.write(chunk)
          source=str(path)
    except Exception:
        refund_work(uid,reserved_day,'shorts')
        finish_user(uid)
        shutil.rmtree(folder,ignore_errors=True)
        raise
    jobs[job]={'owner':uid,'created':time.time(),'quota_day':reserved_day,'status':'queued','progress':'Waiting','clips':[],'percentages':[0,0,0,0]}
    threading.Thread(target=generate,args=(job,source,seconds,uid),daemon=True).start()
    return {'job_id':job}

@app.get('/jobs/{job}')
def status(job:str,uid:str=Depends(current_user)):
    cleanup()
    data=jobs.get(job)
    if not data or data['owner']!=uid:raise HTTPException(404,'Job not found')
    return {key:value for key,value in data.items() if key not in ('owner','created','quota_day','download_file','download_token','token_expiry')}

@app.get('/files/{job}/{filename}')
def download(job:str,filename:str,uid:str=Depends(current_user)):
    cleanup()
    data=jobs.get(job)
    if not data or data['owner']!=uid:raise HTTPException(404,'File not found')
    if not re.fullmatch(r'clip[1-4]\.mp4',filename):raise HTTPException(404,'File not found')
    path=WORK/job/filename
    if data['status']!='done' or not path.is_file():raise HTTPException(404,'File not ready')
    return FileResponse(path,media_type='video/mp4',filename=filename)



# ---------------------------------------------
# YouTube media preview and download (authorized content only)
# ---------------------------------------------
VIDEO_QUALITIES={430,720,1080,2160,4320}

def safe_thumbnail(info):
    # Only serve YouTube CDN artwork; never pass arbitrary remote URLs to the UI.
    image=info.get('thumbnail') or ''
    try:
        target=urlparse(image)
        if target.scheme=='https' and target.hostname in {'i.ytimg.com','img.youtube.com','i1.ytimg.com','i2.ytimg.com','i3.ytimg.com','i4.ytimg.com'}:
            return image
    except ValueError:
        pass
    return ''

def youtube_information(url):
    opts={'quiet':True,'no_warnings':True,'noplaylist':True,'skip_download':True,'socket_timeout':30,
          'extract_flat':False}
    with YoutubeDL(opts) as ydl:
        info=ydl.extract_info(url,download=False)
    if not isinstance(info,dict) or info.get('is_live') or info.get('live_status')=='is_live':
        raise ValueError('Live streams are not supported while they are live')
    if (info.get('duration') or 0)>MAX_VIDEO_SECONDS:
        raise ValueError('Video longer than 5 hours is not supported')
    return info

@app.post('/media/info')
def media_info(url:str=Form(...),uid:str=Depends(current_user)):
    link=validate_youtube_link(url)
    try:
        info=youtube_information(link)
    except Exception as e:
        raise HTTPException(422,'Could not access the YouTube video. Check that it is public and permitted.') from e
    heights=sorted(set(int(f['height']) for f in info.get('formats',[]) if isinstance(f.get('height'),int) and f['height']>0 and f.get('vcodec')!='none'))
    return {'title':str(info.get('title') or 'YouTube video')[:200],
            'thumbnail':safe_thumbnail(info),
            'duration':info.get('duration'),
            'channel':str(info.get('uploader') or '')[:100],
            'heights':heights,
            'has_audio':any(f.get('acodec') not in ('none',None) for f in info.get('formats',[]))}

def run_media_download(job,url,media_format,quality,uid):
    folder=WORK/job
    try:
        jobs[job].update(status='downloading',progress='Connecting to YouTube',percent=0)
        def hook(update):
            if update.get('status')=='downloading':
                total=update.get('total_bytes') or update.get('total_bytes_estimate')
                so_far=update.get('downloaded_bytes',0)
                if total:
                    pct=int(85*so_far/total)
                    jobs[job]['percent']=max(jobs[job]['percent'],min(85,pct))
                jobs[job]['progress']='Downloading media'
            if update.get('status')=='finished':
                jobs[job].update(progress='Preparing MP4/MP3',percent=90)
        opts={'outtmpl':str(folder/'download.%(ext)s'),'quiet':True,'noplaylist':True,
              'restrictfilenames':True,'socket_timeout':30,'max_filesize':MAX_VIDEO_FILE_BYTES,
              'progress_hooks':[hook],
              'overwrites':True}
        if media_format=='mp3':
            opts['format']='bestaudio/best'
            opts['postprocessors']=[{'key':'FFmpegExtractAudio','preferredcodec':'mp3','preferredquality':'192'}]
        else:
            opts['format']=(f'bv*[height<={quality}][ext=mp4]+ba[ext=m4a]/'
                            f'bv*[height<={quality}]+ba/'
                            f'b[height<={quality}]')
            opts['merge_output_format']='mp4'
            # Convert only if the selected source is not already MP4.
            opts['postprocessors']=[{'key':'FFmpegVideoConvertor','preferedformat':'mp4'}]
        with YoutubeDL(opts) as ydl:
            info=ydl.extract_info(url,download=False)
            if info.get('is_live') or info.get('live_status')=='is_live':
                raise RuntimeError('Live streams are not supported while they are live')
            if (info.get('duration') or 0)>MAX_VIDEO_SECONDS:
                raise RuntimeError('Video longer than 5 hours is not supported')
            ydl.download([url])
        outputs=[p for p in folder.glob('download.*') if p.is_file() and p.suffix.lower()==('.mp3' if media_format=='mp3' else '.mp4')]
        if not outputs:
            raise RuntimeError('Requested format unavailable. Choose a lower quality or MP3.')
        path=outputs[0]
        if path.stat().st_size>MAX_VIDEO_FILE_BYTES:
            raise RuntimeError('File larger than 5 GiB. Choose a lower quality.')
        token=secrets.token_urlsafe(24)
        jobs[job].update(status='done',progress='Ready to download',percent=100,
                         download_file=path.name,download_token=token,token_expiry=time.time()+1800,
                         url=f'/media/file/{job}/{token}',filename=('clipstudio-audio.mp3' if media_format=='mp3' else 'clipstudio-video.mp4'),
                         size_bytes=path.stat().st_size)
    except Exception as e:
        traceback.print_exc()
        refund_work(uid,jobs[job]['quota_day'],'downloads')
        jobs[job].update(status='error',progress=str(e)[:400])
    finally:
        finish_user(uid)

@app.post('/media/download')
def media_download(url:str=Form(...),format:str=Form('mp4'),quality:int=Form(720),
                   rights_confirmed:bool=Form(False),uid:str=Depends(current_user)):
    if not rights_confirmed:
        raise HTTPException(400,'Confirm you own or have permission to download this video')
    link=validate_youtube_link(url)
    if format not in {'mp3','mp4'}:
        raise HTTPException(400,'Choose MP3 or MP4')
    if quality not in VIDEO_QUALITIES:
        raise HTTPException(400,'Unsupported quality')
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        raise HTTPException(503,'FFmpeg and ffprobe are needed on the backend')
    cleanup()
    day=reserve_work(uid,'downloads')
    job=uuid.uuid4().hex
    try:
        (WORK/job).mkdir(exist_ok=True)
        jobs[job]={'owner':uid,'created':time.time(),'quota_day':day,
                   'status':'queued','progress':'Waiting','percent':0}
        threading.Thread(target=run_media_download,args=(job,link,format,quality,uid),daemon=True).start()
        return {'job_id':job}
    except Exception:
        refund_work(uid,day,'downloads')
        finish_user(uid)
        shutil.rmtree(WORK/job,ignore_errors=True)
        raise

@app.get('/media/file/{job}/{token}')
def media_file(job:str,token:str):
    # Temporary capability link avoids loading multi-GB files into browser memory.
    cleanup()
    data=jobs.get(job)
    if not data or data.get('status')!='done' or time.time()>data.get('token_expiry',0):
        raise HTTPException(404,'Link expired or file not ready')
    if not hmac.compare_digest(token,data.get('download_token','')):
        raise HTTPException(404,'Invalid download link')
    path=WORK/job/data['download_file']
    if not path.is_file():
        raise HTTPException(404,'File not found')
    return FileResponse(path,media_type='audio/mpeg' if path.suffix=='.mp3' else 'video/mp4',filename=data['filename'])
