import os, re, json, uuid, shutil, subprocess, threading, time, secrets, hmac, traceback
from queue import Queue
from contextlib import asynccontextmanager
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
@asynccontextmanager
async def lifespan(application):
    start_worker_pools()
    yield

app=FastAPI(title='ClipStudio generator API', docs_url=None, redoc_url=None,
            openapi_url=None, lifespan=lifespan)
ORIGINS=[x.strip() for x in os.getenv('ALLOWED_ORIGINS','http://localhost:5173,http://127.0.0.1:5173').split(',') if x.strip()]
app.add_middleware(CORSMiddleware,allow_origins=ORIGINS,allow_methods=['GET','POST'],allow_headers=['Authorization','Content-Type'])
jobs={}
lock=threading.Lock()
# Count outstanding jobs per user (queued + running); do not exclude other users.
active_users={}
reserved_uploads=0
shorts_queue=Queue()
downloads_queue=Queue()
waiting_jobs={'shorts':[], 'downloads':[]}
worker_pools_started=False
usage={}
MAX_DAILY=max(0,min(100,int(os.getenv('MAX_JOBS_PER_DAY','20'))))
MAX_DOWNLOADS_DAILY=max(0,min(100,int(os.getenv('MAX_DOWNLOADS_PER_DAY','10'))))
# Keep actual heavy processing bounded for a home PC; accept more people via queues.
MAX_CONCURRENT_SHORTS=max(1,min(4,int(os.getenv('MAX_CONCURRENT_SHORTS','4'))))
MAX_CONCURRENT_DOWNLOADS=max(1,min(6,int(os.getenv('MAX_CONCURRENT_DOWNLOADS','4'))))
MAX_ACCEPTED_JOBS=max(4,min(200,int(os.getenv('MAX_ACCEPTED_JOBS','100'))))
MAX_JOBS_PER_USER=max(1,min(5,int(os.getenv('MAX_JOBS_PER_USER','2'))))
MAX_LOCAL_UPLOADS=max(1,min(4,int(os.getenv('MAX_LOCAL_UPLOADS','2'))))
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
        expired=[key for key,job in jobs.items() if job['status'] in ('done','error') and now-job.get('finished_at',job['created'])>JOB_TTL]
        for key in expired:jobs.pop(key,None)
        for key in list(usage):
            if key[1]!=datetime.now(timezone.utc).date().isoformat():usage.pop(key,None)
    for key in expired:shutil.rmtree(WORK/key,ignore_errors=True)

def utc_day():
    return datetime.now(timezone.utc).date().isoformat()

def daily_reset_utc():
    return (datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)).isoformat().replace('+00:00','Z')

def reserve_work(uid, kind, is_upload=False):
    """Reserve quota and a place in the shared bounded queue.

    Users see a queue position rather than a generic 'server busy' error.
    Jobs count toward a daily quota only once successful; errors are refunded.
    """
    global reserved_uploads
    limit = MAX_DAILY if kind == 'shorts' else MAX_DOWNLOADS_DAILY
    date = utc_day()
    key = (uid, date, kind)
    with lock:
        if active_users.get(uid, 0) >= MAX_JOBS_PER_USER:
            raise HTTPException(429, f'You already have {MAX_JOBS_PER_USER} requests queued or running. Check their progress before submitting more.')
        if sum(active_users.values()) >= MAX_ACCEPTED_JOBS:
            raise HTTPException(503, 'The queue is full. Please try again when some requests finish.')
        if is_upload and reserved_uploads >= MAX_LOCAL_UPLOADS:
            raise HTTPException(503, 'The large-file upload queue is full. Try a YouTube URL or wait until another upload finishes.')
        if limit and usage.get(key, 0) >= limit:
            raise HTTPException(429, f'Daily {kind} limit reached ({limit}). Resets at 00:00 UTC: {daily_reset_utc()}')
        active_users[uid] = active_users.get(uid, 0) + 1
        if is_upload:
            reserved_uploads += 1
        usage[key] = usage.get(key, 0) + 1
    return date

def refund_work(uid, date, kind):
    with lock:
        key = (uid, date, kind)
        usage[key] = max(0, usage.get(key, 0) - 1)

def finish_user(uid, is_upload=False):
    global reserved_uploads
    with lock:
        if uid in active_users:
            remaining = active_users[uid] - 1
            if remaining <= 0:
                active_users.pop(uid, None)
            else:
                active_users[uid] = remaining
        if is_upload:
            reserved_uploads = max(0, reserved_uploads - 1)

def enqueue_job(job_id, kind, args):
    """Submit the already-created job; the dedicated worker pool processes it."""
    target_queue = shorts_queue if kind == 'shorts' else downloads_queue
    with lock:
        waiting_jobs[kind].append(job_id)
        jobs[job_id]['kind'] = kind
        jobs[job_id]['status'] = 'queued'
        jobs[job_id]['progress'] = 'Waiting for an available processing slot'
    target_queue.put((job_id, args))

def worker_loop(kind):
    target_queue = shorts_queue if kind == 'shorts' else downloads_queue
    while True:
        job_id, args = target_queue.get()
        with lock:
            if job_id in waiting_jobs[kind]:
                waiting_jobs[kind].remove(job_id)
            if job_id in jobs:
                jobs[job_id].update(status='starting', progress='Processing your request')
        try:
            if kind == 'shorts':
                generate(*args)
            else:
                run_media_download(*args)
        except Exception as exc:
            traceback.print_exc()
            with lock:
                job = jobs.get(job_id)
                if job:
                    job.update(status='error', progress=f'Unexpected worker failure: {str(exc)[:200]}',finished_at=time.time())
                    quota_day=job['quota_day']
                    owner=job['owner']
                    is_upload=job.get('is_upload', False)
                else:
                    quota_day=owner=is_upload=None
            if owner:
                refund_work(owner, quota_day, kind)
                finish_user(owner, is_upload=bool(is_upload))
        finally:
            target_queue.task_done()

def start_worker_pools():
    global worker_pools_started
    if worker_pools_started:
        return
    worker_pools_started=True
    for kind, count in (('shorts',MAX_CONCURRENT_SHORTS),('downloads',MAX_CONCURRENT_DOWNLOADS)):
        for index in range(count):
            threading.Thread(target=worker_loop,args=(kind,),daemon=True,
                             name=f'clipstudio-{kind}-{index+1}').start()
    print(f'ClipStudio queues ready: {MAX_CONCURRENT_SHORTS} Shorts workers, '
          f'{MAX_CONCURRENT_DOWNLOADS} download workers; {MAX_ACCEPTED_JOBS} jobs accepted in total.')

@app.get('/limits')
def limits(uid:str=Depends(current_user)):
    cleanup()
    day=utc_day()
    with lock:
        shorts_used=usage.get((uid,day,'shorts'),0)
        downloads_used=usage.get((uid,day,'downloads'),0)
        processing=active_users.get(uid,0)>0
        my_jobs=active_users.get(uid,0)
        shorts_waiting=len(waiting_jobs['shorts'])
        downloads_waiting=len(waiting_jobs['downloads'])
        accepted=sum(active_users.values())
    return {
        'shorts':{'used':shorts_used,'limit':MAX_DAILY,'remaining':max(0,MAX_DAILY-shorts_used) if MAX_DAILY else None},
        'downloads':{'used':downloads_used,'limit':MAX_DOWNLOADS_DAILY,'remaining':max(0,MAX_DOWNLOADS_DAILY-downloads_used) if MAX_DOWNLOADS_DAILY else None},
        'reset_utc':daily_reset_utc(), 'processing':processing,
        'my_active_jobs':my_jobs, 'queue':{'shorts_waiting':shorts_waiting,
        'downloads_waiting':downloads_waiting,'accepted':accepted,'max_accepted':MAX_ACCEPTED_JOBS,
        'shorts_workers':MAX_CONCURRENT_SHORTS,'download_workers':MAX_CONCURRENT_DOWNLOADS}
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

# Separate, measurable stages for the automatic Shorts generator.
SHORTS_STAGES = ('download', 'transcription', 'selection', 'render')

def set_stage_percentage(job_id, stage, percentage):
    """Never publish a stage as completed before the actual work finishes."""
    if stage not in SHORTS_STAGES:
        return
    value = max(0, min(100, int(percentage)))
    with lock:
        job = jobs.get(job_id)
        if not job:
            return
        stages = job.setdefault('stage_percentages', {name: 0 for name in SHORTS_STAGES})
        stages[stage] = max(stages.get(stage, 0), value)
        job['stage'] = stage

def set_clip_percentage(job_id, index, percentage):
    value = max(0, min(100, int(percentage)))
    with lock:
        job = jobs.get(job_id)
        if not job:
            return
        clips = job.setdefault('percentages', [0, 0, 0, 0])
        clips[index] = max(clips[index], value)
        stages = job.setdefault('stage_percentages', {name: 0 for name in SHORTS_STAGES})
        stages['render'] = max(stages.get('render', 0), sum(clips) // 4)
        job['stage'] = 'render'

def shorts_download_hook(job_id, count):
    """Report received bytes for each requested media stream; never fake progress."""
    streams = {}
    expected_count = count
    def callback(event):
        if event.get('status') not in ('downloading', 'finished'):
            return
        key = str(event.get('filename') or event.get('tmpfilename') or 'stream')
        size = event.get('total_bytes') or event.get('total_bytes_estimate')
        received = event.get('downloaded_bytes', 0)
        if event.get('status') == 'finished' and size:
            received = size
        if not size or size <= 0:
            # No denominator available: retain 0% until download actually finishes.
            return
        streams[key] = max(0.0, min(1.0, float(received) / float(size)))
        expected = max(1, expected_count() if callable(expected_count) else expected_count)
        set_stage_percentage(job_id, 'download', min(99, int(99 * sum(streams.values()) / expected)))
    return callback

def transcribe(path, on_progress=None, total_duration=None):
    try:
        from faster_whisper import WhisperModel
        model=WhisperModel('base',device='cpu',compute_type='int8')
        segments,_=model.transcribe(str(path),word_timestamps=True,vad_filter=True)
        words=[]
        last_progress=-1
        for segment in segments:
            words.extend({'word':w.word,'start':w.start,'end':w.end}
                         for w in (segment.words or []) if w.start is not None and w.end is not None)
            # This is audio-timeline coverage, not a predicted remaining time.
            if on_progress and total_duration and total_duration>0:
                new_progress=max(0,min(99,int(100*float(segment.end)/total_duration)))
                if new_progress>last_progress:
                    on_progress(new_progress)
                    last_progress=new_progress
        return words
    except ImportError:
        raise RuntimeError('Install transcription dependency: pip install faster-whisper')

def generate(job,source,seconds,uid,is_upload=False):
    folder=WORK/job;folder.mkdir(exist_ok=True)
    try:
        jobs[job].update(status='downloading',stage='download',progress='Downloading source video',
                         percentages=[0,0,0,0],stage_percentages={name:0 for name in SHORTS_STAGES})
        if source.startswith('https://'):
            host=(urlparse(source).hostname or '').lower()
            if host not in {'youtube.com','www.youtube.com','m.youtube.com','youtu.be'}:
                raise RuntimeError('Only public YouTube URLs are accepted')
            transfer={'count':1}
            opts={'format':'bv*[height<=720]+ba/b[height<=720]/b',
                  'outtmpl':str(folder/'source.%(ext)s'),'noplaylist':True,
                  'max_filesize':MAX_VIDEO_FILE_BYTES,'quiet':True,
                  'merge_output_format':'mp4','restrictfilenames':True,'socket_timeout':30,
                  'progress_hooks':[shorts_download_hook(job,lambda:transfer['count'])]}
            with YoutubeDL(opts) as ydl:
                info=ydl.extract_info(source,download=False)
                if info.get('duration',0)>MAX_VIDEO_SECONDS:
                    raise RuntimeError('Video longer than 5 hours is not supported')
                requested=info.get('requested_formats') or []
                transfer['count']=len(requested) if requested else 1
                ydl.download([source])
            candidates=[p for p in folder.glob('source.*') if p.is_file()]
            if not candidates:raise RuntimeError('YouTube did not provide a downloadable video')
            video=max(candidates,key=lambda f:f.stat().st_size)
        else:
            video=Path(source)
        total=duration(video)
        if total<12:raise RuntimeError('Video must be at least 12 seconds')
        if total>MAX_VIDEO_SECONDS:raise RuntimeError('Video longer than 5 hours is not supported')
        set_stage_percentage(job,'download',100)

        jobs[job].update(status='transcribing',stage='transcription',
                         progress='Transcribing speech (speech model may download on first run)')
        words=transcribe(video,
                         on_progress=lambda pct:set_stage_percentage(job,'transcription',pct),
                         total_duration=total)
        set_stage_percentage(job,'transcription',100)

        jobs[job].update(status='selecting',stage='selection',progress='Selecting the four best speech-rich windows')
        clip_len=min(seconds,max(3,total/4-0.5))
        starts=[i*max(1,(total-clip_len)/24) for i in range(25)]
        ranked=sorted(starts,key=lambda s:sum(1 for w in words if s<=w['start']<s+clip_len),reverse=True)
        chosen=[]
        for index,s in enumerate(ranked):
            if all(abs(s-other)>=clip_len for other in chosen):chosen.append(s)
            set_stage_percentage(job,'selection',min(99,int(100*(index+1)/len(ranked))))
            if len(chosen)==4:break
        if len(chosen)<4:
            chosen=[i*(total-clip_len)/3 for i in range(4)]
        chosen.sort()
        set_stage_percentage(job,'selection',100)

        outputs=[]
        for i,start in enumerate(chosen,1):
            jobs[job].update(status='rendering',stage='render',progress=f'Rendering clip {i}/4')
            subtitle=folder/f'clip{i}.ass';captions(words,start,start+clip_len,subtitle)
            output=folder/f'clip{i}.mp4'
            vf=f'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,ass=clip{i}.ass'
            cmd=['ffmpeg','-hide_banner','-loglevel','error','-nostats',
                 '-progress','pipe:1','-y','-ss',str(start),'-i',str(video),'-t',str(clip_len),
                 '-vf',vf,'-r','25','-c:v','libx264','-preset','veryfast','-crf','25',
                 '-c:a','aac','-b:a','128k',str(output)]
            with subprocess.Popen(cmd,cwd=str(folder),stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE,text=True,encoding='utf-8',errors='replace') as proc:
                for line in proc.stdout:
                    key,sep,value=line.strip().partition('=')
                    if sep and key in ('out_time_us','out_time_ms','out_time'):
                        try:
                            if key=='out_time':
                                hh,mm,ss=value.split(':');elapsed=int(hh)*3600+int(mm)*60+float(ss)
                            else:elapsed=int(value)/1000000
                            pct=max(0,min(99,int(100*elapsed/clip_len)))
                            set_clip_percentage(job,i-1,pct)
                        except (ValueError,ZeroDivisionError):pass
                err=proc.stderr.read()
                if proc.wait()!=0:raise RuntimeError(err[-1300:] or 'FFmpeg rendering failed')
            if not output.is_file() or output.stat().st_size==0:
                raise RuntimeError(f'Short {i} did not produce an MP4 file')
            set_clip_percentage(job,i-1,100)
            outputs.append({'url':f'/files/{job}/clip{i}.mp4',
                            'start':round(start,1),'duration':round(clip_len,1)})
        set_stage_percentage(job,'render',100)
        jobs[job].update(status='done',progress='Finished',clips=outputs,finished_at=time.time())
    except Exception as e:
        traceback.print_exc()
        jobs[job].update(status='error',progress=str(e)[:500],finished_at=time.time())
        refund_work(uid, jobs[job]['quota_day'], 'shorts')
    finally:
        finish_user(uid, is_upload)

@app.get('/health')
def health():
    with lock:
        accepted=sum(active_users.values())
        queued=sum(len(queue) for queue in waiting_jobs.values())
    return {'ok':True,'ffmpeg':bool(shutil.which('ffmpeg')),
            'ffprobe':bool(shutil.which('ffprobe')), 'queue_waiting':queued,
            'jobs_outstanding':accepted, 'queue_capacity':MAX_ACCEPTED_JOBS,
            'shorts_workers':MAX_CONCURRENT_SHORTS, 'download_workers':MAX_CONCURRENT_DOWNLOADS}

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
    reserved_day=reserve_work(uid,'shorts',is_upload=bool(file))
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
        finish_user(uid, is_upload=bool(file))
        shutil.rmtree(folder,ignore_errors=True)
        raise
    jobs[job]={'owner':uid,'created':time.time(),'quota_day':reserved_day,'status':'queued','progress':'Waiting',
               'is_upload':bool(file),'clips':[],'percentages':[0,0,0,0],
               'stage':'queued','stage_percentages':{name:0 for name in SHORTS_STAGES}}
    enqueue_job(job,'shorts',(job,source,seconds,uid,bool(file)))
    return {'job_id':job}

@app.get('/jobs/{job}')
def status(job:str,uid:str=Depends(current_user)):
    cleanup()
    with lock:
        data=jobs.get(job)
        if not data or data['owner']!=uid:
            raise HTTPException(404,'Job not found')
        view={key:value for key,value in data.items() if key not in
              ('owner','created','quota_day','is_upload','finished_at','download_file','download_token','token_expiry')}
        # Return snapshots so the browser never sees half-updated percentages.
        if 'stage_percentages' in view:
            view['stage_percentages']=dict(view['stage_percentages'])
        if 'percentages' in view:
            view['percentages']=list(view['percentages'])
        if data['status']=='queued':
            waiting=waiting_jobs.get(data.get('kind','shorts'),[])
            position=waiting.index(job)+1 if job in waiting else 1
            view.update(queue_position=position, queue_waiting=len(waiting),
                        progress=f'Waiting in queue: position {position}')
    return view

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
# Media preview and download: authorized public videos only.
# Sites are allowlisted to prevent arbitrary URL fetches from the internet.
# ---------------------------------------------
VIDEO_QUALITIES={430,720,1080,2160,4320}
ALLOWED_MEDIA_DOMAINS={
    'youtube': {'youtube.com','www.youtube.com','m.youtube.com','youtu.be'},
    'instagram': {'instagram.com','www.instagram.com','m.instagram.com','instagr.am','www.instagr.am'},
    'tiktok': {'tiktok.com','www.tiktok.com','m.tiktok.com','vm.tiktok.com','vt.tiktok.com'},
    'facebook': {'facebook.com','www.facebook.com','m.facebook.com','web.facebook.com','fb.watch','www.fb.watch','fb.com','www.fb.com'},
}
THUMBNAIL_DOMAINS={
    'ytimg.com','youtube.com','cdninstagram.com','fbcdn.net','instagram.com',
    'tiktokcdn.com','tiktokcdn-us.com','tiktokcdn-eu.com','tiktokcdn-in.com',
    'tiktokv.com','byteimg.com','muscdn.com','tikcdn.com',
}
FFMPEG_DOWNLOAD_THREADS=max(1,min(16,int(os.getenv('DOWNLOAD_FFMPEG_THREADS','2'))))

def validate_media_link(raw: str):
    value=raw.strip()
    if not value or len(value)>2048:
        raise HTTPException(400,'Enter a valid video URL')
    try:
        parsed=urlparse(value)
        if (parsed.scheme!='https' or not parsed.hostname or parsed.username is not None
                or parsed.password is not None or parsed.port not in (None,443)):
            raise ValueError('Invalid URL')
        hostname=parsed.hostname.lower().rstrip('.')
        for platform,hosts in ALLOWED_MEDIA_DOMAINS.items():
            if hostname in hosts:
                return value,platform
    except ValueError:
        pass
    raise HTTPException(400,'Only HTTPS links from YouTube, Instagram, TikTok or Facebook are accepted')

def safe_thumbnail(info):
    image=info.get('thumbnail') or ''
    if not isinstance(image,str) or len(image)>3000:
        return ''
    try:
        parsed=urlparse(image)
        hostname=(parsed.hostname or '').lower().rstrip('.')
        if (parsed.scheme=='https' and parsed.username is None and parsed.password is None
                and parsed.port in (None,443) and any(
                    hostname==domain or hostname.endswith('.'+domain)
                    for domain in THUMBNAIL_DOMAINS)):
            return image
    except ValueError:
        pass
    return ''

def media_information(url):
    opts={'quiet':True,'no_warnings':True,'noplaylist':True,'skip_download':True,
          'socket_timeout':30,'extract_flat':False}
    with YoutubeDL(opts) as ydl:
        info=ydl.extract_info(url,download=False)
    if not isinstance(info,dict) or info.get('is_live') or info.get('live_status')=='is_live':
        raise ValueError('Live streams are not supported while they are live')
    if (info.get('duration') or 0)>MAX_VIDEO_SECONDS:
        raise ValueError('Video longer than 5 hours is not supported')
    if info.get('_type') in ('playlist','multi_video'):
        raise ValueError('Choose a direct link to one video, not a playlist or gallery')
    return info

@app.post('/media/info')
def media_info(url:str=Form(...),uid:str=Depends(current_user)):
    link,platform=validate_media_link(url)
    try:
        info=media_information(link)
    except Exception as e:
        raise HTTPException(422,'Cannot access this public video. Private posts, login-required links or unsupported videos may fail.') from e
    heights=sorted(set(int(f['height']) for f in info.get('formats',[]) if
                       isinstance(f,dict) and isinstance(f.get('height'),int)
                       and f['height']>0 and f.get('vcodec') not in ('none',None)))
    if not heights and isinstance(info.get('height'),int):
        heights=[info['height']]
    return {'platform':platform,'title':str(info.get('title') or 'Video')[:200],
            'thumbnail':safe_thumbnail(info),'duration':info.get('duration'),
            'channel':str(info.get('uploader') or info.get('channel') or '')[:100],
            'heights':heights,
            'has_audio':any(f.get('acodec') not in ('none',None)
                            for f in info.get('formats',[]) if isinstance(f,dict))}

def inspect_media_streams(path):
    info=json.loads(run(['ffprobe','-v','error','-show_entries',
                         'stream=index,codec_type,codec_name,width,height,pix_fmt:format=duration',
                         '-of','json',str(path)]))
    streams=info.get('streams') or []
    video=next((stream for stream in streams if stream.get('codec_type')=='video'),None)
    audio=next((stream for stream in streams if stream.get('codec_type')=='audio'),None)
    return info,video,audio

def normalize_download_mp4(source: Path, output: Path, quality: int, on_progress):
    """Produce a real H.264/AAC MP4, not just rename/remux an incompatible codec.

    A previous yt-dlp configuration could return audio-only files or MP4 with
    AV1/VP9 video that some phones cannot display. Verify streams before/after.
    """
    info,video,audio=inspect_media_streams(source)
    if video is None:
        raise RuntimeError('This source has audio but no video track. Cannot make a video MP4.')
    height=int(video.get('height') or 0)
    width=int(video.get('width') or 0)
    if height<=0 or width<=0:
        raise RuntimeError('Could not detect video dimensions')
    needs_video_encoding=(video.get('codec_name')!='h264' or
                          video.get('pix_fmt')!='yuv420p' or
                          height>quality or bool(height%2 or width%2))
    needs_audio_encoding=(audio is not None and audio.get('codec_name')!='aac')
    cmd=['ffmpeg','-hide_banner','-loglevel','error','-nostats',
         '-progress','pipe:1','-y','-i',str(source),
         '-map',f"0:{video['index']}"]
    if audio is not None:
        cmd+=['-map',f"0:{audio['index']}"]
    cmd+=['-sn','-dn']
    if needs_video_encoding:
        vf=(f'scale=-2:{quality}' if height>quality else
            'pad=ceil(iw/2)*2:ceil(ih/2)*2')
        cmd+=['-vf',vf,'-c:v','libx264','-preset','veryfast','-crf','23',
              '-pix_fmt','yuv420p','-threads',str(FFMPEG_DOWNLOAD_THREADS)]
    else:
        cmd+=['-c:v','copy']
    if audio is not None:
        cmd+=['-c:a','aac','-b:a','192k'] if needs_audio_encoding else ['-c:a','copy']
    cmd+=['-movflags','+faststart','-f','mp4',str(output)]
    logfile=output.with_suffix('.ffmpeg.log')
    try:
        with logfile.open('w',encoding='utf-8') as errors:
            with subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=errors,
                                  text=True,encoding='utf-8',errors='replace') as proc:
                total=float((info.get('format') or {}).get('duration') or 0)
                for line in proc.stdout:
                    key,sep,value=line.strip().partition('=')
                    if not sep or key not in ('out_time_us','out_time_ms','out_time'):
                        continue
                    try:
                        if key=='out_time':
                            hh,mm,ss=value.split(':')
                            elapsed=int(hh)*3600+int(mm)*60+float(ss)
                        else:
                            elapsed=int(value)/1_000_000
                        if total>0:
                            on_progress(min(98,70+int(28*elapsed/total)))
                    except (ValueError,ZeroDivisionError):
                        continue
                rc=proc.wait()
        if rc:
            raise RuntimeError('MP4 conversion failed: '+logfile.read_text(encoding='utf-8',errors='replace')[-1400:])
        if not output.exists() or not output.stat().st_size:
            raise RuntimeError('MP4 conversion produced no file')
        _,final_video,final_audio=inspect_media_streams(output)
        if final_video is None or final_video.get('codec_name')!='h264':
            raise RuntimeError('MP4 video track is missing or not H.264')
        if audio is not None and (final_audio is None or final_audio.get('codec_name')!='aac'):
            raise RuntimeError('MP4 audio track is missing or not AAC')
    finally:
        logfile.unlink(missing_ok=True)

def run_media_download(job,url,media_format,quality,uid):
    folder=WORK/job
    try:
        _,platform=validate_media_link(url)
        jobs[job].update(status='downloading',progress=f'Connecting to {platform.title()}',percent=0)
        def hook(update):
            if update.get('status')=='downloading':
                total=update.get('total_bytes') or update.get('total_bytes_estimate')
                so_far=update.get('downloaded_bytes',0)
                if total:
                    pct=int(65*so_far/total)
                    jobs[job]['percent']=max(jobs[job]['percent'],min(65,pct))
                jobs[job]['progress']='Downloading source media'
            elif update.get('status')=='finished':
                jobs[job].update(progress='Merging source media',percent=max(jobs[job]['percent'],65))
        opts={'outtmpl':str(folder/'source.%(ext)s'),'quiet':True,'noplaylist':True,
              'restrictfilenames':True,'socket_timeout':30,'max_filesize':MAX_VIDEO_FILE_BYTES,
              'progress_hooks':[hook],'overwrites':True}
        if media_format=='mp3':
            opts['format']='bestaudio/best'
            opts['postprocessors']=[{'key':'FFmpegExtractAudio','preferredcodec':'mp3',
                                      'preferredquality':'192'}]
        else:
            # Do not use bv* here: only video formats are eligible for MP4.
            # Some social sites have one combined MP4 stream, others separate audio/video.
            opts['format']=(f'bv[height<={quality}]+ba/b[height<={quality}]/'
                            f'bv+ba/b')
            # MKV safely holds a temporary combination of VP9/AV1/Opus/etc.
            # The final downloaded MP4 is always checked and normalized below.
            opts['merge_output_format']='mkv'
        with YoutubeDL(opts) as ydl:
            info=ydl.extract_info(url,download=False)
            if (not isinstance(info,dict) or info.get('is_live') or
                    info.get('live_status')=='is_live'):
                raise RuntimeError('Live streams are not supported while they are live')
            if (info.get('duration') or 0)>MAX_VIDEO_SECONDS:
                raise RuntimeError('Video longer than 5 hours is not supported')
            if info.get('_type') in ('playlist','multi_video'):
                raise RuntimeError('Provide one video link, not a playlist or gallery')
            ydl.download([url])
        if media_format=='mp3':
            outputs=[p for p in folder.glob('source.mp3') if p.is_file()]
            if not outputs:
                raise RuntimeError('Could not extract MP3 from this link')
            output=outputs[0]
        else:
            source_candidates=[p for p in folder.glob('source.*')
                               if p.is_file() and p.suffix.lower() in
                               {'.mp4','.webm','.mkv','.mov','.flv','.ts','.m4v'}]
            if not source_candidates:
                raise RuntimeError('No video track was downloaded. This source may offer audio only.')
            source=max(source_candidates,key=lambda p:p.stat().st_size)
            output=folder/'download.mp4'
            jobs[job].update(status='processing',progress='Encoding compatible MP4 video (H.264 + AAC)',percent=70)
            normalize_download_mp4(source,output,quality,
                                   lambda pct: jobs[job].update(percent=max(jobs[job]['percent'],pct)))
            source.unlink(missing_ok=True)
        if output.stat().st_size>MAX_VIDEO_FILE_BYTES:
            raise RuntimeError('File larger than 5 GiB. Choose a lower quality.')
        token=secrets.token_urlsafe(24)
        ext='mp3' if media_format=='mp3' else 'mp4'
        name=f'clipstudio-{platform}-{(str(quality)+"p-") if ext=="mp4" else ""}video.{ext}' if ext=='mp4' else f'clipstudio-{platform}-audio.mp3'
        jobs[job].update(status='done',progress='Ready to download',percent=100,
                         download_file=output.name,download_token=token,
                         token_expiry=time.time()+1800,finished_at=time.time(),
                         platform=platform,url=f'/media/file/{job}/{token}',filename=name,
                         size_bytes=output.stat().st_size)
    except Exception as e:
        traceback.print_exc()
        refund_work(uid,jobs[job]['quota_day'],'downloads')
        jobs[job].update(status='error',progress=str(e)[:400],finished_at=time.time())
    finally:
        finish_user(uid)

@app.post('/media/download')
def media_download(url:str=Form(...),format:str=Form('mp4'),quality:int=Form(720),
                   rights_confirmed:bool=Form(False),uid:str=Depends(current_user)):
    if not rights_confirmed:
        raise HTTPException(400,'Confirm you own or have permission to download this video')
    link,platform=validate_media_link(url)
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
        jobs[job]={'owner':uid,'created':time.time(),'quota_day':day,'platform':platform,
                   'status':'queued','progress':'Waiting','percent':0}
        enqueue_job(job,'downloads',(job,link,format,quality,uid))
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
