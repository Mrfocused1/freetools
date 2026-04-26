"""
Video analysis server — Qwen2.5-VL-7B + faster-whisper-large-v3.

POST /analyze
  multipart: file=<video>     (or)  url=<remote video url, incl. youtube/tiktok)
  optional:  prompt=<custom prompt overriding default narration prompt>
  header:    Authorization: Bearer <API_TOKEN>

Returns JSON: { "visual": "...narration...", "transcript": [{start,end,text}, ...] }
"""

import os
import subprocess
import tempfile
from pathlib import Path

import torch
import yt_dlp
from faster_whisper import WhisperModel
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from qwen_vl_utils import process_vision_info
from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration

API_TOKEN = os.environ["API_TOKEN"]
MODEL_ID = "Qwen/Qwen2.5-VL-7B-Instruct"

DEFAULT_PROMPT = (
    "Describe this video in extensive detail, segment by segment. "
    "For each meaningful moment or shot include: an approximate timestamp, what is "
    "visible (people, objects, setting, actions, expressions, on-screen text, "
    "graphics, camera movement), and how it transitions to the next segment. "
    "Be exhaustive — narrate as if explaining to someone (an LLM) who cannot see "
    "the video. Do not summarize; describe sequentially."
)

app = FastAPI()

print("Loading Qwen2.5-VL-7B-Instruct...", flush=True)
vlm = Qwen2_5_VLForConditionalGeneration.from_pretrained(
    MODEL_ID,
    torch_dtype=torch.bfloat16,
    device_map="auto",
    attn_implementation="sdpa",
)
processor = AutoProcessor.from_pretrained(MODEL_ID)

print("Loading Whisper large-v3...", flush=True)
whisper = WhisperModel("large-v3", device="cuda", compute_type="float16")

print("Ready.", flush=True)


def _check_auth(authorization: str):
    if authorization != f"Bearer {API_TOKEN}":
        raise HTTPException(status_code=401, detail="invalid token")


def _download(url: str, dest: str):
    opts = {
        "format": "best[ext=mp4][height<=720]/best[height<=720]/best",
        "outtmpl": dest,
        "quiet": True,
        "no_warnings": True,
        "merge_output_format": "mp4",
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])


def _extract_audio(video: str, audio: str):
    subprocess.run(
        ["ffmpeg", "-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000",
         "-acodec", "pcm_s16le", audio],
        check=True, capture_output=True,
    )


def _transcribe(audio: str):
    segs, _ = whisper.transcribe(audio, beam_size=5, vad_filter=True)
    return [
        {"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
        for s in segs
    ]


def _analyze_visual(video: str, prompt: str) -> str:
    messages = [{
        "role": "user",
        "content": [
            {"type": "video", "video": video, "max_pixels": 360 * 420, "fps": 1.0},
            {"type": "text", "text": prompt},
        ],
    }]
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    image_inputs, video_inputs = process_vision_info(messages)
    inputs = processor(
        text=[text],
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        return_tensors="pt",
    ).to("cuda")
    out = vlm.generate(**inputs, max_new_tokens=4096, do_sample=False)
    trimmed = [o[len(i):] for i, o in zip(inputs.input_ids, out)]
    return processor.batch_decode(trimmed, skip_special_tokens=True)[0]


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID}


@app.post("/analyze")
async def analyze(
    authorization: str = Header(...),
    file: UploadFile | None = File(None),
    url: str | None = Form(None),
    prompt: str | None = Form(None),
):
    _check_auth(authorization)
    if not file and not url:
        raise HTTPException(status_code=400, detail="provide file or url")

    with tempfile.TemporaryDirectory() as tmp:
        video_path = str(Path(tmp) / "video.mp4")
        audio_path = str(Path(tmp) / "audio.wav")

        if file:
            data = await file.read()
            Path(video_path).write_bytes(data)
        else:
            _download(url, video_path)

        transcript: list[dict] = []
        try:
            _extract_audio(video_path, audio_path)
            transcript = _transcribe(audio_path)
        except Exception as e:
            print(f"transcription skipped: {e}", flush=True)

        visual = _analyze_visual(video_path, prompt or DEFAULT_PROMPT)

        return {"visual": visual, "transcript": transcript}
