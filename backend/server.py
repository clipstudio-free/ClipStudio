import os, re, json, uuid, shutil, subprocess, threading, time, secrets, hmac, traceback, zipfile, asyncio
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
from starlette.background import BackgroundTask
from yt_dlp import YoutubeDL

ROOT=Path(__file__).resolve().parent
# Local-only configuration file, never upload to GitHub.
load_dotenv(ROOT / '.env.local')
WORK=ROOT/'work'; WORK.mkdir(exist_ok=True)
@asynccontextmanager
async def lifespan(application):
    start_worker_pools()
    threading.Thread(target=abandoned_job_monitor,daemon=True,name='clipstudio-abandoned-monitor').start()
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
MAX_CONCURRENT_SHORTS=max(1,min(4,int(os.getenv('MAX_CONCURRENT_SHORTS','1'))))
MAX_CONCURRENT_DOWNLOADS=max(1,min(6,int(os.getenv('MAX_CONCURRENT_DOWNLOADS','1'))))
MAX_ACCEPTED_JOBS=max(4,min(1000,int(os.getenv('MAX_ACCEPTED_JOBS','1000'))))
MAX_JOBS_PER_USER=max(1,min(5,int(os.getenv('MAX_JOBS_PER_USER','1'))))
MAX_LOCAL_UPLOADS=max(1,min(4,int(os.getenv('MAX_LOCAL_UPLOADS','2'))))
JOB_TTL=max(600,min(86400,int(os.getenv('JOB_TTL_SECONDS','3600'))))
# Allow source videos up to five hours; keep a bounded download/upload size.
MAX_VIDEO_SECONDS = 5 * 60 * 60
MAX_VIDEO_FILE_BYTES = 5 * 1024 * 1024 * 1024  # 5 GiB
# Stop abandoned work after the browser stops reporting status.
JOB_HEARTBEAT_TIMEOUT=max(30,min(600,int(os.getenv('JOB_HEARTBEAT_TIMEOUT','90'))))
FAST_TRANSCRIPTION_MODEL=os.getenv('FAST_TRANSCRIPTION_MODEL','tiny')
TRANSCRIPTION_SAMPLE_SECONDS=max(30,min(180,int(os.getenv('TRANSCRIPTION_SAMPLE_SECONDS','75'))))
_whisper_model=None
_whisper_lock=threading.Lock()
class CancelledJob(Exception):
    pass

def check_cancel(job_id):
    job=jobs.get(job_id)
    if not job or job.get('cancel_requested'):
        raise CancelledJob('Job cancelled')
    if job.get('status') not in ('done','error','cancelled') and time.time()-job.get('last_seen',job['created'])>JOB_HEARTBEAT_TIMEOUT:
        job['cancel_requested']=True
        raise CancelledJob('Browser disconnected; job stopped')

def get_whisper():
    global _whisper_model
    with _whisper_lock:
        if _whisper_model is None:
            from faster_whisper import WhisperModel
            _whisper_model=WhisperModel(FAST_TRANSCRIPTION_MODEL,device='cpu',compute_type='int8',num_workers=1)
        return _whisper_model

def cancelled_job(job_id,uid,kind,is_upload=False):
    job=jobs.get(job_id)
    if job and job.get('status')!='cancelled':
        job.update(status='cancelled',progress='Cancelled; resources released',finished_at=time.time())
        refund_work(uid,job['quota_day'],kind)
    finish_user(uid,is_upload)
    shutil.rmtree(WORK/job_id,ignore_errors=True)

def ffmpeg_with_cancel(cmd,job_id,cwd=None,on_line=None):
    import tempfile
    with tempfile.TemporaryFile(mode='w+t',encoding='utf-8') as errors:
        proc=subprocess.Popen(cmd,cwd=cwd,stdout=subprocess.PIPE,stderr=errors,text=True,encoding='utf-8',errors='replace')
        stop=threading.Event()
        def watch():
            while not stop.wait(0.5):
                try: check_cancel(job_id)
                except CancelledJob:
                    if proc.poll() is None:proc.terminate()
                    return
        watcher=threading.Thread(target=watch,daemon=True);watcher.start()
        try:
            for line in proc.stdout:
                if on_line:on_line(line)
            rc=proc.wait()
            check_cancel(job_id)
            if rc:
                errors.seek(0)
                raise RuntimeError('FFmpeg failed: '+errors.read()[-1200:])
        finally:
            stop.set()
            if proc.poll() is None:
                proc.terminate()
                try:proc.wait(timeout=3)
                except subprocess.TimeoutExpired:proc.kill();proc.wait()
            watcher.join(timeout=1)

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
        expired=[key for key,job in jobs.items() if job['status'] in ('done','error','cancelled') and now-job.get('finished_at',job['created'])>JOB_TTL]
        for key in expired:jobs.pop(key,None)
        for key in list(usage):
            if key[1]!=datetime.now(timezone.utc).date().isoformat():usage.pop(key,None)
    for key in expired:shutil.rmtree(WORK/key,ignore_errors=True)

def abandoned_job_monitor():
    while True:
        time.sleep(10)
        now=time.time()
        expired_queued=[]
        with lock:
            for job_id,data in list(jobs.items()):
                if data.get('status') in ('done','error','cancelled'):continue
                if now-data.get('last_seen',data['created'])<=JOB_HEARTBEAT_TIMEOUT:continue
                data['cancel_requested']=True
                if data['status']=='queued':
                    data.update(status='cancelled',progress='Browser disconnected',finished_at=now)
                    kind=data.get('kind','shorts')
                    if job_id in waiting_jobs[kind]:waiting_jobs[kind].remove(job_id)
                    expired_queued.append((job_id,data['owner'],data['quota_day'],kind,data.get('is_upload',False)))
        for job_id,uid,day,kind,is_upload in expired_queued:
            refund_work(uid,day,kind)
            finish_user(uid,is_upload)
            shutil.rmtree(WORK/job_id,ignore_errors=True)
        cleanup()

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
            skip=jobs.get(job_id,{}).get('status')=='cancelled'
            if job_id in jobs and not skip:
                jobs[job_id].update(status='starting', progress='Processing your request')
        if skip:
            target_queue.task_done()
            continue
        try:
            if kind == 'shorts':
                generate(*args)
            else:
                run_media_download(*args)
        except CancelledJob:
            data=jobs.get(job_id)
            if data:cancelled_job(job_id,data['owner'],kind,data.get('is_upload',False))
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

def captions(words, start, end, path, color='#FFE34D', size=40, font='Arial', position='bottom', style='clean', animation='pop'):
    # ASS BGR hexadecimal; highlighted word on each spoken interval
    bgr='&H00'+color[5:7]+color[3:5]+color[1:3]
    alignment={'bottom':2,'center':5,'top':8}.get(position,2)
    border=3 if style=='boxed' else 1
    header='''[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nWrapStyle: 2\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Pop,'''+font+''','''+str(size)+''','''+bgr+''',&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,'''+str(border)+''',1,'''+str(alignment)+''',30,30,150,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n'''
    events=[]
    for w in words:
        a=max(start,float(w['start']));b=min(end,float(w['end']))
        if b<=a:continue
        txt=re.sub(r'[{}\\]','',str(w['word'])).strip()
        if not txt:continue
        # pop entrance: ASS scale animation for each word
        events.append(f'Dialogue: 0,{ass_time(a-start)},{ass_time(b-start)},Pop,,0,0,0,,{txt}')
    path.write_text(header+'\n'.join(events),encoding='utf-8-sig')

# Separate, measurable stages for the automatic Shorts generator.
SHORTS_STAGES = ('download', 'transcription', 'selection', 'render')
SHORTS_COUNT = 8

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
        check_cancel(job_id)
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

def transcribe(path, on_progress=None, total_duration=None, job_id=None):
    """Fast, bounded transcription: sample evenly across long videos.

    4 x 75s of mono 16 kHz audio by default; timestamps are translated to
    original timeline. A reusable tiny Whisper model trades some accuracy for speed.
    """
    total=float(total_duration or duration(path))
    count=4
    segment=min(TRANSCRIPTION_SAMPLE_SECONDS,max(5,total/count))
    starts=[max(0,i*max(0,total-segment)/(count-1)) for i in range(count)]
    starts=sorted(set(round(x,2) for x in starts))
    model=get_whisper()
    words=[]
    for idx,offset in enumerate(starts):
        if job_id:check_cancel(job_id)
        audio=WORK/job_id/f'transcribe_{idx}.wav' if job_id else Path(path).with_suffix(f'.transcribe_{idx}.wav')
        cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',str(offset),'-i',str(path),'-t',str(segment),'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',str(audio)]
        try:
            if job_id:ffmpeg_with_cancel(cmd,job_id)
            else:run(cmd)
            if audio.exists() and audio.stat().st_size>1024:
                segments,_=model.transcribe(str(audio),word_timestamps=True,vad_filter=True,beam_size=1,best_of=1,condition_on_previous_text=False)
                for part in segments:
                    if job_id:check_cancel(job_id)
                    for w in part.words or []:
                        if w.start is not None and w.end is not None:
                            words.append({'word':w.word,'start':offset+w.start,'end':offset+w.end})
        finally:
            audio.unlink(missing_ok=True)
        if on_progress:on_progress(int(100*(idx+1)/len(starts)))
    return words

def detect_face_center(video, start, length, job_id):
    """Sample frames throughout a clip and locate the dominant face (optional OpenCV).

    Returns normalized horizontal center. A face-free or missing-OpenCV clip
    safely falls back to center crop; no remote face recognition is used.
    """
    if os.getenv('AUTO_FACE_TRACKING','1') != '1':return None
    try:
        import cv2
        cascade=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
        if cascade.empty():return None
        cap=cv2.VideoCapture(str(video))
        if not cap.isOpened():return None
        centers=[]
        try:
            for k in range(9):
                check_cancel(job_id)
                cap.set(cv2.CAP_PROP_POS_MSEC,1000*(start+length*(k+0.5)/9))
                ok,frame=cap.read()
                if not ok:continue
                height,width=frame.shape[:2]
                ratio=min(1,480/max(1,width)); small=cv2.resize(frame,(max(1,int(width*ratio)),max(1,int(height*ratio))))
                gray=cv2.cvtColor(small,cv2.COLOR_BGR2GRAY)
                faces=cascade.detectMultiScale(gray,scaleFactor=1.12,minNeighbors=5,minSize=(24,24))
                if len(faces):
                    x,y,w,h=max(faces,key=lambda f:f[2]*f[3]);centers.append((x+w/2)/small.shape[1])
        finally:cap.release()
        if not centers:return None
        centers.sort();return max(0.05,min(0.95,centers[len(centers)//2]))
    except CancelledJob:raise
    except Exception:return None

def detect_streamer_facecam(video, start, length, job_id):
    """Heuristic webcam-region detector, not person identification.

    Look across the full frame at multiple timestamps. Prefer a spatially stable
    face in a small corner/edge overlay over large moving gameplay faces.
    Return normalized crop (x,y,w,h), or None when evidence is weak.
    """
    if os.getenv('AUTO_FACE_TRACKING','1') != '1':return None
    try:
        import cv2
        import numpy as np
        cascade=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
        if cascade.empty():return None
        cap=cv2.VideoCapture(str(video))
        if not cap.isOpened():return None
        detections=[]
        try:
            for k in range(16):
                check_cancel(job_id)
                cap.set(cv2.CAP_PROP_POS_MSEC,1000*(start+length*(k+0.5)/16))
                ok,frame=cap.read()
                if not ok:continue
                h,w=frame.shape[:2]
                scale=min(1,720/max(w,h))
                small=cv2.resize(frame,(max(1,int(w*scale)),max(1,int(h*scale))))
                gray=cv2.cvtColor(small,cv2.COLOR_BGR2GRAY)
                faces=cascade.detectMultiScale(gray,scaleFactor=1.09,minNeighbors=4,minSize=(18,18))
                for x,y,fw,fh in faces:
                    cx=(x+fw/2)/small.shape[1];cy=(y+fh/2)/small.shape[0]
                    rw=fw/small.shape[1];rh=fh/small.shape[0]
                    if .012<=rw<=.28 and .018<=rh<=.40:
                        detections.append((k,cx,cy,rw,rh))
        finally:cap.release()
        if not detections:return None
        clusters=[]
        for d in detections:
            cluster=next((c for c in clusters if abs(c['x']-d[1])<.075 and abs(c['y']-d[2])<.09),None)
            if cluster is None:
                cluster={'x':d[1],'y':d[2],'items':[]};clusters.append(cluster)
            cluster['items'].append(d)
            cluster['x']=sum(t[1] for t in cluster['items'])/len(cluster['items'])
            cluster['y']=sum(t[2] for t in cluster['items'])/len(cluster['items'])
        def score(c):
            items=c['items'];frames=len({d[0] for d in items})
            edge=min(c['x'],1-c['x'],c['y'],1-c['y'])
            size=sum(d[3]*d[4] for d in items)/len(items)
            return frames + (2 if edge<.22 else 0) - (2 if size>.055 else 0)
        best=max(clusters,key=score)
        if len({d[0] for d in best['items']})<max(3,min(5,len(detections)//3)):
            return None
        items=best['items']
        fw=float(np.median([d[3] for d in items]));fh=float(np.median([d[4] for d in items]))
        # Enlarge around the face to include the presenter's webcam background.
        cw=min(.48,max(.20,fw*3.3));ch=min(.48,max(.20,fh*3.0))
        cx=best['x'];cy=best['y']
        x=max(0,min(1-cw,cx-cw/2));y=max(0,min(1-ch,cy-ch*.43))
        return (x,y,cw,ch)
    except CancelledJob:raise
    except Exception:
        traceback.print_exc();return None

def short_layout_filter(layout, face, subtitle=True):
    """Create a 720x1280 vertical render with optional webcam + gameplay."""
    layout=layout if layout in {'auto','face_top','face_center','face_bottom','face_left','gameplay'} else 'auto'
    if layout=='gameplay' or not face:
        base='[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280'
        return base+(',ass=clip%d.ass' % subtitle if isinstance(subtitle,int) and subtitle else '')+'[vout]'
    x,y,w,h=face
    # Crop a stable webcam rectangle; scale it independently from the gameplay.
    crop=f'crop=w=iw*{w:.5f}:h=ih*{h:.5f}:x=iw*{x:.5f}:y=ih*{y:.5f}'
    game='[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280[game]'
    if layout=='face_left':
        cam=f'[0:v]{crop},scale=360:1280:force_original_aspect_ratio=increase,crop=360:1280[cam]'
        composite='[game][cam]overlay=0:0'
    else:
        cam=f'[0:v]{crop},scale=720:520:force_original_aspect_ratio=increase,crop=720:520[cam]'
        ypos={'face_top':0,'face_center':380,'face_bottom':760,'auto':0}[layout]
        composite=f'[game][cam]overlay=0:{ypos}'
    return ';'.join([game,cam,composite+(',ass=clip%d.ass' % subtitle if isinstance(subtitle,int) and subtitle else '')+'[vout]'])

def branded_short_graph(graph, folder):
    # Use the same original icon as the website; no remote download at render time.
    logo = next((p for p in (ROOT/'favicon.png', ROOT.parent/'public'/'favicon.png', ROOT.parent/'favicon.png') if p.is_file()), None)
    if logo is None:
        raise RuntimeError('ClipStudio logo missing: copy public/favicon.png to backend/favicon.png')
    ass = folder/'clipstudio_brand.ass'
    ass.write_text(r"""[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Brand,Arial,38,&H00FFFFFF,&H00FFFFFF,&H80000000,&H80000000,-1,0,0,0,100,100,0,0,1,1,0,4,0,0,0,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.35,0:00:02.70,Brand,,0,0,0,,{\move(480,56,505,56,0,450)\clip(505,16,700,96)\fad(180,450)}ClipStudio
""", encoding='utf-8')
    x="if(lt(t,0.35),W-w-24,if(lt(t,0.8),W-w-24-205*(t-0.35)/0.45,if(lt(t,2.7),W-w-24-205,if(lt(t,3.1),W-w-24-205+205*(t-2.7)/0.4,W-w-24))))"
    graph=graph.replace('[vout]','[base]')
    graph += ";[base]ass=clipstudio_brand.ass[brandtext];[1:v]scale=64:64:force_original_aspect_ratio=decrease,pad=64:64:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,colorchannelmixer=aa=0.55[brandlogo];[brandtext][brandlogo]overlay=x='"+x+"':y=24:shortest=1[vout]"
    return graph, str(logo)

def generate(job,source,seconds,uid,is_upload=False,caption_config=None,layout="auto"):
    folder=WORK/job;folder.mkdir(exist_ok=True)
    try:
        check_cancel(job)
        jobs[job].update(status='downloading',stage='download',progress='Downloading source video',
                         percentages=[0]*SHORTS_COUNT,stage_percentages={name:0 for name in SHORTS_STAGES})
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
        check_cancel(job)
        total=duration(video)
        if total<12:raise RuntimeError('Video must be at least 12 seconds')
        if total>MAX_VIDEO_SECONDS:raise RuntimeError('Video longer than 5 hours is not supported')
        set_stage_percentage(job,'download',100)

        jobs[job].update(status='transcribing',stage='transcription',
                         progress='Transcribing speech (speech model may download on first run)')
        words=transcribe(video,
                         on_progress=lambda pct:set_stage_percentage(job,'transcription',pct),
                         total_duration=total,job_id=job)
        set_stage_percentage(job,'transcription',100)

        jobs[job].update(status='selecting',stage='selection',progress='Selecting eight speech-rich windows')
        clip_len=min(seconds,max(3,total/SHORTS_COUNT-0.5))
        starts=[i*max(1,(total-clip_len)/24) for i in range(25)]
        ranked=sorted(starts,key=lambda s:sum(1 for w in words if s<=w['start']<s+clip_len),reverse=True)
        chosen=[]
        for index,s in enumerate(ranked):
            if all(abs(s-other)>=clip_len for other in chosen):chosen.append(s)
            set_stage_percentage(job,'selection',min(99,int(100*(index+1)/len(ranked))))
            if len(chosen)==SHORTS_COUNT:break
        if len(chosen)<SHORTS_COUNT:
            chosen=[i*(total-clip_len)/(SHORTS_COUNT-1) for i in range(SHORTS_COUNT)]
        chosen.sort()
        set_stage_percentage(job,'selection',100)

        outputs=[]
        for i,start in enumerate(chosen,1):
            check_cancel(job)
            jobs[job].update(status='rendering',stage='render',progress=f'Rendering clip {i}/{SHORTS_COUNT}')
            subtitle=folder/f'clip{i}.ass';captions(words,start,start+clip_len,subtitle,**(caption_config or {}))
            output=folder/f'clip{i}.mp4'
            face=detect_streamer_facecam(video,start,clip_len,job) if layout!='gameplay' else None
            graph, brand_logo=branded_short_graph(short_layout_filter(layout,face,subtitle=i),folder)
            cmd=['ffmpeg','-hide_banner','-loglevel','error','-nostats',
                 '-progress','pipe:1','-y','-ss',str(start),'-i',str(video),'-loop','1','-framerate','25','-i',brand_logo,'-t',str(clip_len),
                 '-filter_complex',graph,'-map','[vout]','-map','0:a:0?',
                 '-r','25','-c:v','libx264','-preset','veryfast','-crf','25',
                 '-c:a','aac','-b:a','128k',str(output)]
            def on_render_line(line):
                key,sep,value=line.strip().partition('=')
                if sep and key in ('out_time_us','out_time_ms','out_time'):
                    try:
                        if key=='out_time':
                            hh,mm,ss=value.split(':');elapsed=int(hh)*3600+int(mm)*60+float(ss)
                        else:elapsed=int(value)/1000000
                        set_clip_percentage(job,i-1,max(0,min(99,int(100*elapsed/clip_len))))
                    except (ValueError,ZeroDivisionError):pass
            ffmpeg_with_cancel(cmd,job,cwd=str(folder),on_line=on_render_line)
            if not output.is_file() or output.stat().st_size==0:
                raise RuntimeError(f'Short {i} did not produce an MP4 file')
            # Keep an uncaptioned version for later text editing; the standard clip remains captioned.
            clean=folder/f'clip{i}.clean.mp4'
            clean_graph, brand_logo=branded_short_graph(short_layout_filter(layout,face,subtitle=False),folder)
            clean_cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',str(start),'-i',str(video),'-loop','1','-framerate','25','-i',brand_logo,'-t',str(clip_len),
                       '-filter_complex',clean_graph,'-map','[vout]','-map','0:a:0?',
                       '-r','25','-c:v','libx264','-preset','veryfast','-crf','25','-c:a','aac','-b:a','128k',str(clean)]
            ffmpeg_with_cancel(clean_cmd,job,cwd=str(folder))
            cue_data=[{'start':round(max(0,float(w['start'])-start),2),'end':round(min(clip_len,float(w['end'])-start),2),
                       'text':str(w['word']).strip()[:200]} for w in words if start<=float(w['start'])<start+clip_len and float(w['end'])>float(w['start'])]
            cue_data=[c for c in cue_data if c['end']>c['start']]
            set_clip_percentage(job,i-1,100)
            outputs.append({'cues':cue_data,'clean_url':f'/files/{job}/clip{i}.clean.mp4','url':f'/files/{job}/clip{i}.mp4',
                            'start':round(start,1),'duration':round(clip_len,1), 'face_tracking':face is not None, 'facecam_detected':face is not None, 'layout_used':layout if face else 'gameplay', 'speech_score':round(min(100,100*sum(1 for w in words if start<=w['start']<start+clip_len)/max(1,clip_len*2)),1)})
        set_stage_percentage(job,'render',100)
        jobs[job].update(status='done',progress='Finished',clips=outputs,finished_at=time.time())
    except CancelledJob:
        cancelled_job(job,uid,'shorts',is_upload)
        return
    except Exception as e:
        if jobs.get(job,{}).get('cancel_requested'):
            cancelled_job(job,uid,'shorts',is_upload)
            return
        traceback.print_exc()
        jobs[job].update(status='error',progress=str(e)[:500],finished_at=time.time())
        refund_work(uid, jobs[job]['quota_day'], 'shorts')
    finally:
        if jobs.get(job,{}).get('status')!='cancelled':finish_user(uid, is_upload)

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
async def start(url:str=Form(''),file:UploadFile|None=File(None),seconds:int=Form(30),caption_font:str=Form('Arial'),caption_size:int=Form(40),caption_color:str=Form('#FFE34D'),caption_position:str=Form('bottom'),caption_style:str=Form('clean'),caption_animation:str=Form('pop'),layout:str=Form('auto'),uid:str=Depends(current_user)):
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):raise HTTPException(400,'FFmpeg/ffprobe not found in PATH')
    if not file and not url:raise HTTPException(400,'Provide YouTube URL or local file')
    if seconds not in (15,30,45,60):raise HTTPException(400,'Invalid clip duration')
    if caption_font not in {'Arial Black','Arial','Impact','Georgia'} or not 18<=caption_size<=400 or not re.fullmatch(r'#[0-9a-fA-F]{6}',caption_color) or caption_position not in {'top','center','bottom'} or caption_style not in {'clean','boxed'} or caption_animation not in {'none','pop'}:raise HTTPException(400,'Invalid caption settings')
    if layout not in {'auto','face_top','face_center','face_bottom','face_left','gameplay'}:raise HTTPException(400,'Invalid video layout')
    caption_config={'font':caption_font,'size':caption_size,'color':caption_color,'position':caption_position,'style':caption_style,'animation':caption_animation}
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
    jobs[job]={'owner':uid,'created':time.time(),'quota_day':reserved_day,'status':'queued','progress':'Waiting','last_seen':time.time(),
               'is_upload':bool(file),'clips':[],'percentages':[0]*SHORTS_COUNT,
               'stage':'queued','stage_percentages':{name:0 for name in SHORTS_STAGES}}
    enqueue_job(job,'shorts',(job,source,seconds,uid,bool(file),caption_config,layout))
    return {'job_id':job}

@app.get('/jobs/{job}')
def status(job:str,uid:str=Depends(current_user)):
    cleanup()
    with lock:
        data=jobs.get(job)
        if not data or data['owner']!=uid:
            raise HTTPException(404,'Job not found')
        if data['status'] not in ('done','error','cancelled'):
            data['last_seen']=time.time()
        view={key:value for key,value in data.items() if key not in
              ('owner','created','quota_day','is_upload','finished_at','download_file','download_token','token_expiry','last_seen','cancel_requested')}
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

@app.post('/jobs/{job}/cancel')
def cancel_job(job:str,uid:str=Depends(current_user)):
    with lock:
        data=jobs.get(job)
        if not data or data['owner']!=uid:raise HTTPException(404,'Job not found')
        if data['status'] in ('done','error','cancelled'):
            return {'status':data['status']}
        data['cancel_requested']=True
        queued=data['status']=='queued'
        if queued:
            kind=data.get('kind','shorts')
            if job in waiting_jobs[kind]:waiting_jobs[kind].remove(job)
            data.update(status='cancelled',progress='Cancelled before processing',finished_at=time.time())
    if queued:
        refund_work(uid,data['quota_day'],kind)
        finish_user(uid,data.get('is_upload',False))
        shutil.rmtree(WORK/job,ignore_errors=True)
    return {'status':'cancelled' if queued else 'cancelling'}

@app.get('/files/{job}/all.zip')
def download_all_shorts(job:str,uid:str=Depends(current_user)):
    cleanup()
    data=jobs.get(job)
    if not data or data.get('owner')!=uid or data.get('status')!='done':
        raise HTTPException(404,'Job not ready')
    folder=WORK/job
    paths=[folder/f'clip{i}.mp4' for i in range(1,SHORTS_COUNT+1)]
    if not all(path.is_file() for path in paths):
        raise HTTPException(404,'Shorts not available')
    archive=folder/'clipstudio-shorts.zip'
    if not archive.is_file():
        with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_STORED) as z:
            for path in paths:z.write(path,arcname=path.name)
    return FileResponse(archive,media_type='application/zip',filename='clipstudio-shorts.zip')

@app.get('/files/{job}/{filename}')
def download(job:str,filename:str,uid:str=Depends(current_user)):
    cleanup()
    data=jobs.get(job)
    if not data or data['owner']!=uid:raise HTTPException(404,'File not found')
    if not re.fullmatch(r'clip[1-8](?:\.clean)?\.mp4',filename):raise HTTPException(404,'File not found')
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


@app.post('/media/playlist')
def playlist_preview(url:str=Form(...),uid:str=Depends(current_user)):
    link,platform=validate_media_link(url)
    if platform!='youtube':raise HTTPException(400,'YouTube playlists only')
    try:
        with YoutubeDL({'extract_flat':'in_playlist','skip_download':True,'quiet':True,'lazy_playlist':False,'socket_timeout':15,'ignoreerrors':True}) as ydl:
            info=ydl.extract_info(link,download=False)
    except Exception as exc:raise HTTPException(422,'Playlist unavailable') from exc
    if not isinstance(info,dict) or info.get('_type')!='playlist':raise HTTPException(400,'Provide a playlist URL')
    entries=[]
    for item in info.get('entries') or []:
        if not isinstance(item,dict):continue
        video_id=str(item.get('id') or '')
        if not re.fullmatch(r'[A-Za-z0-9_-]{11}',video_id):continue
        entries.append({'id':video_id,'title':str(item.get('title') or 'Video')[:180],'url':'https://www.youtube.com/watch?v='+video_id,'thumbnail':'https://i.ytimg.com/vi/'+video_id+'/mqdefault.jpg'})
    return {'title':str(info.get('title') or 'Playlist')[:180],'entries':entries}

def admin_user(uid:str=Depends(current_user)):
    allowed={x.strip() for x in os.getenv('ADMIN_USER_IDS','').split(',') if x.strip()}
    if not allowed or uid not in allowed:raise HTTPException(403,'Admin access denied')
    return uid

@app.get('/admin/overview')
def admin_overview(uid:str=Depends(admin_user)):
    with lock:
        counts={status:sum(1 for job in jobs.values() if job.get('status')==status)
                for status in ('queued','downloading','transcribing','selecting','rendering','done','cancelled','error')}
        return {'jobs':counts,'active_users':len(active_users),
                'waiting_shorts':len(waiting_jobs['shorts']),
                'waiting_downloads':len(waiting_jobs['downloads']),
                'shorts_workers':MAX_CONCURRENT_SHORTS,
                'downloads_workers':MAX_CONCURRENT_DOWNLOADS}

@app.post('/admin/jobs/{job}/cancel')
def admin_cancel_job(job:str,uid:str=Depends(admin_user)):
    with lock:
        item=jobs.get(job)
        if not item:raise HTTPException(404,'Job not found')
        if item.get('status') in ('done','cancelled','error'):return {'status':item['status']}
        item['cancel_requested']=True
    return {'status':'cancelling'}

@app.post('/media/playlist/download')
def playlist_batch(url:str=Form(...),quality:int=Form(720),
                   rights_confirmed:bool=Form(False),video_ids:str=Form('[]'),
                   uid:str=Depends(current_user)):
    if not rights_confirmed:raise HTTPException(400,'Confirm rights to every selected video')
    if quality not in VIDEO_QUALITIES:raise HTTPException(400,'Unsupported quality')
    try:ids=json.loads(video_ids)
    except (ValueError,TypeError):raise HTTPException(400,'Invalid video selection')
    if not isinstance(ids,list) or not ids or len(ids)>25 or any(not isinstance(x,str) or not re.fullmatch(r'[A-Za-z0-9_-]{11}',x) for x in ids):
        raise HTTPException(400,'Select 1–25 video IDs per queue request')
    info=playlist_preview(url,uid)
    by_id={item['id']:item for item in info['entries']}
    accepted=[];failures=[]
    for vid in dict.fromkeys(ids):
        item=by_id.get(vid)
        if not item:
            failures.append({'title':vid,'reason':'Video is not in this playlist or is unavailable'})
            continue
        try:
            result=media_download(url=item['url'],format='mp4',quality=quality,
                                  rights_confirmed=True,uid=uid)
            accepted.append({'title':item['title'],'job_id':result['job_id']})
        except HTTPException as exc:
            failures.append({'title':item['title'],'reason':str(exc.detail)})
            if exc.status_code in (429,503):break
    return {'accepted':accepted,'failures':failures}

@app.get('/my/jobs')
def my_jobs(uid:str=Depends(current_user)):
    with lock:
        own=[{'id':key,'kind':v.get('kind','shorts'),'status':v.get('status'),'created':v.get('created'),'progress':v.get('progress')} for key,v in jobs.items() if v.get('owner')==uid]
    return {'jobs':sorted(own,key=lambda x:x['created'] or 0,reverse=True)[:50]}

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

def normalize_download_mp4(source: Path, output: Path, quality: int, on_progress, job_id):
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
    total=float((info.get('format') or {}).get('duration') or 0)
    def on_encode_line(line):
        key,sep,value=line.strip().partition('=')
        if not sep or key not in ('out_time_us','out_time_ms','out_time'):return
        try:
            if key=='out_time':
                hh,mm,ss=value.split(':');elapsed=int(hh)*3600+int(mm)*60+float(ss)
            else:elapsed=int(value)/1_000_000
            if total>0:on_progress(min(98,70+int(28*elapsed/total)))
        except (ValueError,ZeroDivisionError):pass
    ffmpeg_with_cancel(cmd,job_id,on_line=on_encode_line)
    if not output.exists() or not output.stat().st_size:
        raise RuntimeError('MP4 conversion produced no file')
    _,final_video,final_audio=inspect_media_streams(output)
    if final_video is None or final_video.get('codec_name')!='h264':
        raise RuntimeError('MP4 video track is missing or not H.264')
    if audio is not None and (final_audio is None or final_audio.get('codec_name')!='aac'):
        raise RuntimeError('MP4 audio track is missing or not AAC')

def run_media_download(job,url,media_format,quality,uid):
    folder=WORK/job
    try:
        check_cancel(job)
        _,platform=validate_media_link(url)
        jobs[job].update(status='downloading',progress=f'Connecting to {platform.title()}',percent=0)
        def hook(update):
            check_cancel(job)
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
        if media_format in ('mp3','wav'):
            opts['format']='bestaudio/best'
            opts['postprocessors']=[{'key':'FFmpegExtractAudio','preferredcodec':media_format,
                                      'preferredquality':'192'}]
        else:
            # Do not use bv* here: only video formats are eligible for MP4.
            # Some social sites have one combined MP4 stream, others separate audio/video.
            opts['format']=(f'bv[vcodec^=avc1][height<={quality}]+ba[acodec^=mp4a]/'
                            f'b[ext=mp4][height<={quality}]/'
                            f'bv[height<={quality}]+ba/b[height<={quality}]/'
                            f'bv[height<={quality}]+ba/b[height<={quality}]')
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
        check_cancel(job)
        if media_format in ('mp3','wav'):
            outputs=[p for p in folder.glob('source.'+media_format) if p.is_file()]
            if not outputs:
                raise RuntimeError('Could not extract audio from this link')
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
                                   lambda pct: jobs[job].update(percent=max(jobs[job]['percent'],pct)),job)
            source.unlink(missing_ok=True)
        if output.stat().st_size>MAX_VIDEO_FILE_BYTES:
            raise RuntimeError('File larger than 5 GiB. Choose a lower quality.')
        token=secrets.token_urlsafe(24)
        ext=media_format if media_format in ('mp3','wav') else 'mp4'
        name=f'clipstudio-{platform}-{(str(quality)+"p-") if ext=="mp4" else ""}video.{ext}' if ext=='mp4' else f'clipstudio-{platform}-audio.{ext}'
        jobs[job].update(status='done',progress='Ready to download',percent=100,
                         download_file=output.name,download_token=token,
                         token_expiry=time.time()+1800,finished_at=time.time(),
                         platform=platform,url=f'/media/file/{job}/{token}',filename=name,
                         size_bytes=output.stat().st_size)
    except CancelledJob:
        cancelled_job(job,uid,'downloads')
        return
    except Exception as e:
        if jobs.get(job,{}).get('cancel_requested'):
            cancelled_job(job,uid,'downloads')
            return
        traceback.print_exc()
        refund_work(uid,jobs[job]['quota_day'],'downloads')
        jobs[job].update(status='error',progress=str(e)[:400],finished_at=time.time())
    finally:
        if jobs.get(job,{}).get('status')!='cancelled':finish_user(uid)

@app.post('/media/download')
def media_download(url:str=Form(...),format:str=Form('mp4'),quality:int=Form(720),
                   rights_confirmed:bool=Form(False),uid:str=Depends(current_user)):
    if not rights_confirmed:
        raise HTTPException(400,'Confirm you own or have permission to download this video')
    link,platform=validate_media_link(url)
    if format not in {'mp3','wav','mp4'}:
        raise HTTPException(400,'Choose MP3, WAV or MP4')
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
                   'status':'queued','progress':'Waiting','percent':0,'last_seen':time.time()}
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
    return FileResponse(path,media_type=('audio/mpeg' if path.suffix=='.mp3' else 'audio/wav' if path.suffix=='.wav' else 'video/mp4'),filename=data['filename'])

# V13 caption studio: isolated upload, full-video timed transcription, styled burn-in.
# A single CPU task at a time protects the Windows backend.
caption_semaphore=threading.BoundedSemaphore(1)
CAPTION_MAX_BYTES=250*1024*1024
CAPTION_MAX_SECONDS=15*60

async def caption_upload(file:UploadFile):
    ext=Path(file.filename or '').suffix.lower()
    if ext not in {'.mp4','.mov','.mkv','.webm'}:
        raise HTTPException(400,'Upload MP4, MOV, MKV or WEBM')
    folder=WORK/('captions_'+uuid.uuid4().hex)
    folder.mkdir(parents=True,exist_ok=False)
    source=folder/('source'+ext)
    size=0
    try:
        with source.open('wb') as output:
            while chunk:=await file.read(1024*1024):
                size+=len(chunk)
                if size>CAPTION_MAX_BYTES:
                    raise HTTPException(413,'Caption editor supports files up to 250 MB')
                output.write(chunk)
        if size==0:raise HTTPException(400,'Empty video')
        length=await asyncio.to_thread(duration,source)
        if not 0<length<=CAPTION_MAX_SECONDS:
            raise HTTPException(400,'Caption editor supports videos up to 15 minutes')
        return folder,source,length
    except Exception:
        shutil.rmtree(folder,ignore_errors=True)
        raise

def caption_transcription(source,length):
    if not caption_semaphore.acquire(blocking=False):
        raise HTTPException(429,'Caption processing busy; try again shortly')
    try:
        folder=source.parent
        audio=folder/'audio.wav'
        run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(source),
             '-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',str(audio)])
        model=get_whisper()
        segments,_=model.transcribe(str(audio),word_timestamps=True,vad_filter=True,
                                     beam_size=1,best_of=1,condition_on_previous_text=False)
        cues=[]
        for seg in segments:
            for word in seg.words or []:
                if word.start is not None and word.end is not None and word.end>word.start:
                    cues.append({'start':round(float(word.start),2),'end':round(float(word.end),2),
                                 'text':str(word.word).strip()[:200]})
                    if len(cues)>=1500:break
            if len(cues)>=1500:break
        return cues
    finally:
        caption_semaphore.release()

@app.post('/captions/transcribe')
async def caption_transcribe_endpoint(file:UploadFile=File(...),uid:str=Depends(current_user)):
    folder,source,length=await caption_upload(file)
    try:
        cues=await asyncio.to_thread(caption_transcription,source,length)
        return {'cues':cues,'duration':round(length,2)}
    finally:
        shutil.rmtree(folder,ignore_errors=True)

def ass_safe(text):
    return ''.join(ch for ch in text if ch not in '{}\\\r\n' and ord(ch)>=32)[:200]

def render_caption_file(source,cues,style):
    if not caption_semaphore.acquire(blocking=False):
        raise HTTPException(429,'Caption processing busy; try again shortly')
    try:
        folder=source.parent
        color=style['color']
        bgr='&H00'+color[5:7]+color[3:5]+color[1:3]
        font={'Arial Black':'Arial','Arial':'Arial','Impact':'Impact','Georgia':'Georgia'}[style['font']]
        alignment={'bottom':2,'center':5,'top':8}[style['position']]
        border=3 if style['style']=='boxed' else 1
        header=(
          '[Script Info]\\nScriptType: v4.00+\\nPlayResX: 720\\nPlayResY: 1280\\nWrapStyle: 2\\n'
          '[V4+ Styles]\\n'
          'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\\n'
          f'Style: Caption,{font},{style["size"]},{bgr},&H00FFFFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,{border},3,1,{alignment},25,25,120,1\\n'
          '[Events]\\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\\n'
        )
        events=[]
        for cue in cues:
            a=float(cue['start']);b=float(cue['end'])
            if not (0<=a<b<=CAPTION_MAX_SECONDS):continue
            txt=ass_safe(str(cue['text']))
            if txt:events.append(f'Dialogue: 0,{ass_time(a)},{ass_time(b)},Caption,,0,0,0,,{txt}')
        (folder/'captions.ass').write_text(header+'\\n'.join(events),encoding='utf-8-sig')
        output=folder/'captioned.mp4'
        # The source is scaled before subtitles, so 400px has real 400px ASS sizing.
        vf='scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,subtitles=captions.ass'
        run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(source),'-vf',vf,
             '-c:v','libx264','-preset','veryfast','-crf','24','-c:a','aac','-b:a','128k',
             '-movflags','+faststart',str(output)],cwd=folder)
        return output
    finally:
        caption_semaphore.release()

@app.post('/captions/render')
async def caption_render_endpoint(file:UploadFile=File(...),cues:str=Form(...),
                                 size:int=Form(40),font:str=Form('Arial'),
                                 color:str=Form('#FFE34D'),position:str=Form('bottom'),
                                 style:str=Form('clean'),uid:str=Depends(current_user)):
    if not 18<=size<=400:raise HTTPException(400,'Caption size must be 18 to 400')
    if font not in {'Arial Black','Arial','Impact','Georgia'}:raise HTTPException(400,'Invalid font')
    if not re.fullmatch(r'#[0-9a-fA-F]{6}',color):raise HTTPException(400,'Invalid color')
    if position not in {'top','center','bottom'} or style not in {'clean','boxed'}:
        raise HTTPException(400,'Invalid caption style')
    try: parsed=json.loads(cues)
    except (ValueError,TypeError):raise HTTPException(400,'Invalid captions JSON')
    if not isinstance(parsed,list) or not 0<len(parsed)<=1500 or any(
        not isinstance(c,dict) or not isinstance(c.get('text'),str) or
        len(c['text'])>200 or not isinstance(c.get('start'),(int,float)) or
        not isinstance(c.get('end'),(int,float)) for c in parsed):
        raise HTTPException(400,'Invalid timed captions')
    folder,source,length=await caption_upload(file)
    try:
        if any(not (0<=c['start']<c['end']<=length+0.5) for c in parsed):
            raise HTTPException(400,'Caption times exceed video duration')
        output=await asyncio.to_thread(render_caption_file,source,parsed,
                      {'size':size,'font':font,'color':color,'position':position,'style':style})
        return FileResponse(output,media_type='video/mp4',filename='clipstudio_captioned.mp4',
                            background=BackgroundTask(shutil.rmtree,folder,ignore_errors=True))
    except Exception:
        shutil.rmtree(folder,ignore_errors=True)
        raise


# Register Music Finder AI routes.
from music_finder import install_music_finder
install_music_finder(app, current_user, validate_media_link)
