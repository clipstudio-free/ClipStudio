import os
import re
import json
import uuid
import shutil
import subprocess
import threading
import time

from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from yt_dlp import YoutubeDL


ROOT = Path(__file__).resolve().parent
WORK = ROOT / "work"
WORK.mkdir(exist_ok=True)

app = FastAPI(title="ClipStudio local generator")

# Autoriser ClipStudio à communiquer avec le serveur Python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://localhost:5177",
        "http://localhost:5185",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:5175",
        "http://127.0.0.1:5176",
        "http://127.0.0.1:5177",
        "http://127.0.0.1:5185",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount(
    "/files",
    StaticFiles(directory=str(WORK)),
    name="files"
)

jobs = {}


def run(args, cwd=None):
    p = subprocess.run(
        args,
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace"
    )

    if p.returncode:
        raise RuntimeError((p.stderr or p.stdout)[-1300:])

    return p.stdout


def duration(path):
    info = json.loads(
        run([
            "ffprobe",
            "-v", "error",
            "-show_format",
            "-of", "json",
            str(path)
        ])
    )

    return float(info["format"]["duration"])


def ass_time(sec):
    cs = round(sec * 100)

    return (
        f"{cs // 360000}:"
        f"{(cs // 6000) % 60:02}:"
        f"{(cs // 100) % 60:02}."
        f"{cs % 100:02}"
    )


def captions(words, start, end, path, color="#FFE34D"):

    bgr = (
        "&H00"
        + color[5:7]
        + color[3:5]
        + color[1:3]
    )

    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 720\n"
        "PlayResY: 1280\n"
        "WrapStyle: 2\n"
        "[V4+ Styles]\n"
        "Format: Name,Fontname,Fontsize,PrimaryColour,"
        "SecondaryColour,OutlineColour,BackColour,"
        "Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,"
        "Spacing,Angle,BorderStyle,Outline,Shadow,"
        "Alignment,MarginL,MarginR,MarginV,Encoding\n"
        "Style: Pop,Arial Black,40,"
        + bgr
        + ",&H00FFFFFF,&H00101010,&H00000000,"
        "-1,0,0,0,100,100,0,0,1,3,1,2,30,30,150,1\n"
        "[Events]\n"
        "Format: Layer,Start,End,Style,Name,"
        "MarginL,MarginR,MarginV,Effect,Text\n"
    )

    events = []

    for w in words:
        a = max(start, float(w["start"]))
        b = min(end, float(w["end"]))

        if b <= a:
            continue

        txt = re.sub(
            r'[{}\\]',
            "",
            str(w["word"])
        ).strip()

        if not txt:
            continue

        animation = (
            r"{\fscx120\fscy120"
            r"\t(0,140,\fscx100\fscy100)}"
        )

        events.append(
            f"Dialogue: 0,"
            f"{ass_time(a-start)},"
            f"{ass_time(b-start)},"
            f"Pop,,0,0,0,,"
            f"{animation}{txt}"
        )

    path.write_text(
        header + "\n".join(events),
        encoding="utf-8-sig"
    )


def transcribe(path):

    try:
        from faster_whisper import WhisperModel

        model = WhisperModel(
            "base",
            device="cpu",
            compute_type="int8"
        )

        segments, _ = model.transcribe(
            str(path),
            word_timestamps=True,
            vad_filter=True
        )

        return [
            {
                "word": w.word,
                "start": w.start,
                "end": w.end
            }
            for s in segments
            for w in (s.words or [])
            if w.start is not None
            and w.end is not None
        ]

    except ImportError:
        raise RuntimeError(
            "Install transcription dependency: "
            "pip install faster-whisper"
        )


def generate(job, source, seconds):

    folder = WORK / job
    folder.mkdir(exist_ok=True)

    try:
        jobs[job].update(
            status="downloading",
            progress="Preparing video"
        )

        if source.startswith("https://"):

            host = (
                urlparse(source).hostname or ""
            ).lower()

            if host not in {
                "youtube.com",
                "www.youtube.com",
                "m.youtube.com",
                "youtu.be"
            }:
                raise RuntimeError(
                    "Only public YouTube URLs are accepted"
                )

            opts = {
                "format": "136+140/bv*[height<=720]+ba/b",
                "merge_output_format": "mp4",
                "outtmpl": str(
                    folder / "source.%(ext)s"
                ),
                "noplaylist": True,
                "max_filesize": 500 * 1024 * 1024,
                "quiet": True,
                "restrictfilenames": True,
                "socket_timeout": 30
            }

            with YoutubeDL(opts) as ydl:
                info = ydl.extract_info(
                    source,
                    download=True
                )

                if info.get("duration", 0) > 7200:
                    raise RuntimeError(
                        "Video longer than 2 hours "
                        "is not supported"
                    )

            candidates = [
                p for p in folder.glob("source.*")
                if p.is_file()
            ]

            if not candidates:
                raise RuntimeError(
                    "YouTube did not provide "
                    "a downloadable video"
                )

            video = candidates[0]

        else:
            video = Path(source)

        total = duration(video)

        if total < 12:
            raise RuntimeError(
                "Video must be at least 12 seconds"
            )

        jobs[job].update(
            status="transcribing",
            progress=(
                "Transcribing speech; first run "
                "downloads the speech model"
            )
        )

        words = transcribe(video)

        clip_len = min(
            seconds,
            max(3, total / 4 - 0.5)
        )

        starts = [
            i * max(1, (total - clip_len) / 24)
            for i in range(25)
        ]

        ranked = sorted(
            starts,
            key=lambda s: sum(
                1 for w in words
                if s <= w["start"] < s + clip_len
            ),
            reverse=True
        )

        chosen = []

        for s in ranked:
            if all(
                abs(s - other) >= clip_len
                for other in chosen
            ):
                chosen.append(s)

            if len(chosen) == 4:
                break

        if len(chosen) < 4:
            chosen = [
                i * (total - clip_len) / 3
                for i in range(4)
            ]

        chosen.sort()

        outputs = []

        for i, start in enumerate(chosen, 1):

            jobs[job].update(
                status="rendering",
                progress=f"Rendering clip {i}/4"
            )

            subtitle = folder / f"clip{i}.ass"

            captions(
                words,
                start,
                start + clip_len,
                subtitle
            )

            output = folder / f"clip{i}.mp4"

            vf = (
                "scale=720:1280:"
                "force_original_aspect_ratio=increase,"
                "crop=720:1280,"
                f"ass=clip{i}.ass"
            )

            run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel", "error",
                    "-y",
                    "-ss", str(start),
                    "-i", str(video),
                    "-t", str(clip_len),
                    "-vf", vf,
                    "-r", "25",
                    "-c:v", "libx264",
                    "-preset", "veryfast",
                    "-crf", "25",
                    "-c:a", "aac",
                    "-b:a", "128k",
                    str(output)
                ],
                cwd=str(folder)
            )

            outputs.append({
                "url": (
                    f"http://127.0.0.1:8765/"
                    f"files/{job}/clip{i}.mp4"
                ),
                "start": round(start, 1),
                "duration": round(clip_len, 1)
            })

        jobs[job].update(
            status="done",
            progress="Finished",
            clips=outputs
        )

    except Exception as e:
        jobs[job].update(
            status="error",
            progress=str(e)
        )


@app.get("/health")
def health():

    return {
        "ok": True,
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "ffprobe": bool(shutil.which("ffprobe"))
    }


@app.post("/generate")
async def start(
    url: str = Form(""),
    file: UploadFile | None = File(None),
    seconds: int = Form(30)
):

    if (
        not shutil.which("ffmpeg")
        or not shutil.which("ffprobe")
    ):
        raise HTTPException(
            400,
            "FFmpeg/ffprobe not found in PATH"
        )

    if not file and not url:
        raise HTTPException(
            400,
            "Provide YouTube URL or local file"
        )

    if seconds not in (15, 30, 45, 60):
        raise HTTPException(
            400,
            "Invalid clip duration"
        )

    job = uuid.uuid4().hex

    folder = WORK / job
    folder.mkdir(exist_ok=True)

    source = url.strip()

    if file:

        ext = Path(
            file.filename or ""
        ).suffix.lower()

        if ext not in {
            ".mp4",
            ".mov",
            ".mkv",
            ".webm"
        }:
            raise HTTPException(
                400,
                "Unsupported video format"
            )

        path = folder / ("source" + ext)
        size = 0

        with path.open("wb") as out:

            while chunk := await file.read(
                1024 * 1024
            ):

                size += len(chunk)

                if size > 500 * 1024 * 1024:
                    path.unlink(missing_ok=True)

                    raise HTTPException(
                        413,
                        "Max 500 MB"
                    )

                out.write(chunk)

        source = str(path)

    jobs[job] = {
        "status": "queued",
        "progress": "Waiting",
        "clips": []
    }

    threading.Thread(
        target=generate,
        args=(job, source, seconds),
        daemon=True
    ).start()

    return {
        "job_id": job
    }


@app.get("/jobs/{job}")
def status(job: str):

    if job not in jobs:
        raise HTTPException(
            404,
            "Job not found"
        )

    return jobs[job]