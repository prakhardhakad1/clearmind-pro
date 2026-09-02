"""
ClearMind Pro — Multi-Modal AI Educational Ecosystem
Backend Entrypoint (FastAPI)
Powered by Google Gemini 3.6 Flash + Zhipu GLM-4 (19M+ Token Pool) + Microsoft Edge Neural Voice
"""

import sys
if hasattr(sys.stdout, "reconfigure"):
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass
if hasattr(sys.stderr, "reconfigure"):
    try: sys.stderr.reconfigure(encoding="utf-8")
    except Exception: pass

import os
import io
import re
import json
import base64
import logging
import asyncio
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response as PlainResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from dotenv import load_dotenv
import httpx

# Google GenAI SDK (Official v2.21+)
from google import genai
from google.genai import types as genai_types

# Edge Neural Voice TTS
import edge_tts

# ---------------------------------------------------------------------------
# Configuration & Environment
# ---------------------------------------------------------------------------
ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path=ENV_PATH)

app = FastAPI(title="ClearMind Pro", version="5.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_no_cache_header(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("clearmind")

# Supported Neural Voices
NEURAL_VOICES = {
    "hinglish": "en-IN-NeerjaExpressiveNeural",
    "en": "en-US-AvaMultilingualNeural",
    "hi": "hi-IN-SwaraNeural",
    "es": "es-ES-ElviraNeural",
    "fr": "fr-FR-DeniseNeural",
    "de": "de-DE-KatjaNeural",
    "ja": "ja-JP-NanamiNeural",
    "zh": "zh-CN-XiaoxiaoNeural",
}

LANGUAGES_MAP = {
    "hinglish": "Hinglish (Hindi + English natural conversational blend)",
    "en": "English",
    "hi": "Hindi",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "ja": "Japanese",
    "zh": "Chinese",
}

def clean_speech_text(text: str) -> str:
    """Strip markdown symbols, emojis, and code formatting so voice sounds 100% human-natural."""
    text = re.sub(r'```.*?```', '', text, flags=re.DOTALL)
    text = re.sub(r'\\[a-zA-Z]+', ' ', text)
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    text = re.sub(r'[*_#`~>\-]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def safe_parse_json(raw: str) -> Optional[Dict[str, Any]]:
    """Robustly parse LLM JSON responses, handling markdown code fences and LaTeX backslashes."""
    if not raw:
        return None
    clean = raw.strip()
    if clean.startswith("```"):
        lines = clean.splitlines()
        if lines[0].startswith("```"): lines = lines[1:]
        if lines and lines[-1].startswith("```"): lines = lines[:-1]
        clean = "\n".join(lines).strip()
    
    try:
        return json.loads(clean, strict=False)
    except Exception:
        pass
        
    try:
        fixed = re.sub(r'\\(?![/"\\bfnrtu]|u[0-9a-fA-F]{4})', r'\\\\', clean)
        return json.loads(fixed, strict=False)
    except Exception:
        pass
        
    m = re.search(r'\{.*\}', clean, re.DOTALL)
    if m:
        try:
            fixed = re.sub(r'\\(?![/"\\bfnrtu]|u[0-9a-fA-F]{4})', r'\\\\', m.group(0))
            return json.loads(fixed, strict=False)
        except Exception:
            pass
    return None


def extract_roadmap_steps_from_text(text: str) -> List[Dict[str, Any]]:
    steps = []
    lines = text.splitlines()
    for line in lines:
        m = re.search(r'(?:(?:Step\s*(\d+)|\b(\d+)\.))\s*[:\-–]\s*([^\n\r]+)', line, re.IGNORECASE)
        if m:
            num = int(m.group(1) or m.group(2))
            raw_title = m.group(3).strip()
            raw_title = re.sub(r'[\*\#\_`]', '', raw_title)
            # Remove trailing parenthetical note like (The Base)
            title = re.sub(r'\s*\([^\)]*\)', '', raw_title).strip()
            if len(title) > 2:
                steps.append({
                    "step_number": num or (len(steps) + 1),
                    "title": title[:40],
                    "status": "done" if len(steps) == 0 else "active" if len(steps) == 1 else "todo",
                    "description": raw_title[:60]
                })
    return steps[:6]

def get_gemini_client():
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return None
    try:
        return genai.Client(api_key=api_key)
    except Exception as e:
        logger.error(f"Failed to create Gemini client: {e}")
        return None

async def call_glm_completion(user_prompt: str, sys_prompt: str = "") -> Optional[str]:
    """Zhipu AI GLM-4 Zero-Downtime Failover API."""
    glm_key = os.getenv("GLM_API_KEY")
    if not glm_key:
        return None
    url = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    headers = {"Authorization": f"Bearer {glm_key}", "Content-Type": "application/json"}
    payload = {
        "model": "glm-4-flash",
        "messages": [
            {"role": "system", "content": sys_prompt or "You are an expert AI educator."},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.7,
        "max_tokens": 1500
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code == 200:
                data = resp.json()
                return data["choices"][0]["message"]["content"]
    except Exception as e:
        logger.error(f"GLM failover request error: {e}")
    return None

async def synthesize_edge_audio_base64(text: str, language: str = "hinglish") -> Optional[str]:
    """Synthesizes high-fidelity neural voice using Microsoft Edge TTS and returns base64 MP3."""
    if not text or not text.strip():
        return None
    clean = clean_speech_text(text)
    if not clean:
        return None
    voice = NEURAL_VOICES.get(language, NEURAL_VOICES["hinglish"])
    try:
        communicate = edge_tts.Communicate(clean[:400], voice)
        audio_stream = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_stream.write(chunk["data"])
        audio_bytes = audio_stream.getvalue()
        if audio_bytes:
            return base64.b64encode(audio_bytes).decode("utf-8")
    except Exception as e:
        logger.warning(f"Edge TTS synthesis error: {e}")
    return None


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------
class AnalogyCard(BaseModel):
    title: str = Field(description="Vivid real-world analogy title")
    description: str = Field(description="Clear explanation of the concept using everyday physical metaphor")

class ChatTeachRequest(BaseModel):
    topic: str = "Introduction to Python"
    message: str
    conversation_history: List[Dict[str, str]] = []
    language: str = "hinglish"
    student_name: str = "Sarah J."
    level: str = "High School"
    image_base64: Optional[str] = None

class ChatTeachResponse(BaseModel):
    reply_text: str
    speech_text: str
    analogy_card: Optional[AnalogyCard] = None
    suggested_replies: List[str] = []
    canvas_node_title: str = ""
    canvas_node_summary: str = ""
    detected_topic: str = ""
    audio_base64: Optional[str] = None
    roadmap_steps: Optional[List[Dict[str, Any]]] = None

class ExamCheatSheetRequest(BaseModel):
    topic: str = "Introduction to Python"
    language: str = "hinglish"
    level: str = "High School"

class ExamCheatSheetResponse(BaseModel):
    topic: str
    formulas_and_definitions: List[str]
    examiner_trap_warning: str
    rapid_memory_mnemonic: str
    must_know_5mark_question: str

class BlitzQuestion(BaseModel):
    id: int
    question: str
    options: List[str]
    correct_index: int
    explanation: str

class BlitzQuizRequest(BaseModel):
    topic: str = "Introduction to Python"
    language: str = "hinglish"

class BlitzQuizResponse(BaseModel):
    topic: str
    questions: List[BlitzQuestion]
    time_limit_seconds: int = 60

class TTSRequest(BaseModel):
    text: str
    language: str = "hinglish"


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------
@app.get("/api/status")
async def get_status():
    return {
        "status": "online",
        "gemini_active": bool(os.getenv("GEMINI_API_KEY")),
        "glm4_active": bool(os.getenv("GLM_API_KEY")),
        "engine": "Dual Gemini 3.6 Flash + GLM-4 Zero-Downtime Failover",
        "voice": "Microsoft Edge Neural Voice"
    }

@app.post("/api/chat-teach", response_model=ChatTeachResponse)
async def chat_teach(req: ChatTeachRequest):
    user_msg = req.message.strip()
    topic = req.topic.strip() or "General Science"
    lang_name = LANGUAGES_MAP.get(req.language, "Hinglish")

    sys_prompt = f"""You are Luna, an elite, world-class AI Master Teacher for ClearMind Pro.
You teach students with warmth, high enthusiasm, deep pedagogical clarity, and vivid everyday real-world analogies.
Target Language: {lang_name}
Student Name: {req.student_name}
Target Academic Level: {req.level}

Analyze the student's message: '{user_msg}'.
If the student uploaded an image (such as textbook formulas, diagrams, questions, or notes), carefully read the image via OCR and explain all formulas, solving any question shown with complete pedagogical clarity!
If the student asks about a specific topic (e.g. Calculus, Differentiation, Photosynthesis, Quantum Physics, Mechanics, etc.), immediately teach THAT topic with full mathematical/scientific depth!

You MUST respond strictly with a valid JSON object matching this schema:
{{
  "reply_text": "Engaging conversational explanation with clear markdown formatting, bullet points, and code/formula snippets if applicable",
  "speech_text": "Natural conversational voice script without markdown or symbols, perfect for voice playback",
  "analogy_card": {{
    "title": "Vivid Analogy Title (e.g. 🏍️ The Bike Speedometer or 📦 The Recipe Box)",
    "description": "Clear 1-2 sentence real-world metaphor breaking down the concept"
  }},
  "suggested_replies": ["Specific follow-up question 1", "Analogy expansion question 2", "Test me with Blitz Quiz ⏱️"],
  "canvas_node_title": "Key Concept Title",
  "canvas_node_summary": "1-sentence summary of the unlocked concept",
  "detected_topic": "The active topic being taught (e.g. Relations and Functions)",
  "roadmap_steps": [
    {{"step_number": 1, "title": "Step 1 Milestone Title", "status": "done", "description": "Key concept covered"}},
    {{"step_number": 2, "title": "Step 2 Milestone Title", "status": "active", "description": "Currently learning"}},
    {{"step_number": 3, "title": "Step 3 Milestone Title", "status": "todo", "description": "Next milestone"}},
    {{"step_number": 4, "title": "Step 4 Milestone Title", "status": "todo", "description": "Advanced application"}}
  ]
}}"""

    user_prompt = f"Student says: '{user_msg}'. History: {req.conversation_history[-4:] if req.conversation_history else 'First turn'}."

    content_items = []
    if req.image_base64 and req.image_base64.strip():
        try:
            raw_b64 = req.image_base64.strip()
            mime_type = "image/jpeg"
            if "," in raw_b64:
                header, raw_b64 = raw_b64.split(",", 1)
                if "image/png" in header:
                    mime_type = "image/png"
                elif "image/webp" in header:
                    mime_type = "image/webp"
            img_bytes = base64.b64decode(raw_b64)
            content_items.append(genai_types.Part.from_bytes(data=img_bytes, mime_type=mime_type))
            content_items.append(f"The student uploaded an educational image or textbook photo. {user_prompt}")
        except Exception as e:
            logger.warning(f"Error parsing image_base64: {e}")
            content_items.append(user_prompt)
    else:
        content_items.append(user_prompt)

    raw_json = None
    client = get_gemini_client()
    if client:
        try:
            resp = client.models.generate_content(
                model="gemini-3.6-flash",
                contents=content_items,
                config=genai_types.GenerateContentConfig(
                    system_instruction=sys_prompt,
                    response_mime_type="application/json",
                    temperature=0.7
                )
            )
            if resp.text:
                raw_json = resp.text
        except Exception as e:
            logger.warning(f"Gemini chat_teach error: {e}")

    if not raw_json:
        raw_json = await call_glm_completion(user_prompt, sys_prompt)

    if raw_json:
        d = safe_parse_json(raw_json)
        if d:
            reply = d.get("reply_text") or d.get("explanation") or d.get("content") or d.get("message") or ""
            speech = clean_speech_text(d.get("speech_text") or reply)
            det_topic = d.get("detected_topic") or topic
            audio = await synthesize_edge_audio_base64(speech[:300], req.language)

            r_steps = d.get("roadmap_steps")
            if not r_steps or not isinstance(r_steps, list) or len(r_steps) == 0:
                r_steps = extract_roadmap_steps_from_text(reply)

            return ChatTeachResponse(
                reply_text=reply,
                speech_text=speech,
                analogy_card=d.get("analogy_card") or {"title": f"💡 {det_topic} Insight", "description": "Core physical and mathematical model."},
                suggested_replies=d.get("suggested_replies") or ["Tell me more!", "Give an everyday analogy 💡", "Next concept ➔"],
                canvas_node_title=d.get("canvas_node_title") or det_topic,
                canvas_node_summary=d.get("canvas_node_summary") or "Core concept analyzed.",
                detected_topic=det_topic,
                audio_base64=audio,
                roadmap_steps=r_steps if r_steps else None
            )

    # Intelligent Dynamic Fallback
    dyn_reply = f"Awesome question {req.student_name}! In {topic}, let's understand the core mechanism. Every action causes an immediate measurable change. Think of it like a continuous feedback loop in physical nature!"
    speech = clean_speech_text(dyn_reply)
    audio = await synthesize_edge_audio_base64(speech, req.language)
    return ChatTeachResponse(
        reply_text=dyn_reply,
        speech_text=speech,
        analogy_card={"title": f"💡 {topic} Mechanism", "description": "Directly connects theoretical formulas with physical real-world reactions."},
        suggested_replies=["Show examiner traps ⚠️", "Give a real-world analogy 💡", "Start 60s Blitz ⏱️"],
        canvas_node_title=topic,
        canvas_node_summary="Fundamental principles mapped to live canvas.",
        detected_topic=topic,
        audio_base64=audio
    )

@app.post("/api/exam-cheat-sheet", response_model=ExamCheatSheetResponse)
async def get_exam_cheat_sheet(req: ExamCheatSheetRequest):
    topic = req.topic.strip() or "General Science"
    lang_name = LANGUAGES_MAP.get(req.language, "Hinglish")

    sys_prompt = f"""You are an elite exam examiner creating a high-yield 60-Second Exam Revision Cheat Sheet for: '{topic}'.
Target Language: {lang_name}
Target Level: {req.level}

Return strictly a JSON object matching this schema:
{{
  "topic": "{topic}",
  "formulas_and_definitions": ["Formula/Syntax Rule 1", "Formula/Syntax Rule 2", "Core Definition 3"],
  "examiner_trap_warning": "#1 critical examiner trap that causes students to lose marks in competitive exams",
  "rapid_memory_mnemonic": "S.P.A.R.K acronym or catchy memory trick to never forget this topic",
  "must_know_5mark_question": "Top expected 5-mark conceptual derivation or problem statement"
}}"""

    raw_json = None
    client = get_gemini_client()
    if client:
        try:
            resp = client.models.generate_content(
                model="gemini-3.6-flash",
                contents=f"Generate 60-second exam cheat sheet for '{topic}'.",
                config=genai_types.GenerateContentConfig(
                    system_instruction=sys_prompt,
                    response_mime_type="application/json",
                    temperature=0.6
                )
            )
            if resp.text:
                raw_json = resp.text
        except Exception as e:
            logger.warning(f"Gemini exam sheet error: {e}")

    if not raw_json:
        raw_json = await call_glm_completion(f"Generate 60-second exam cheat sheet for '{topic}'.", sys_prompt)

    if raw_json:
        d = safe_parse_json(raw_json)
        if d:
            return ExamCheatSheetResponse(**d)

    return ExamCheatSheetResponse(
        topic=topic,
        formulas_and_definitions=[
            f"Core Rule: Fundamental law governing {topic}",
            f"Conservation Law: Total input equals total output in {topic}",
            "Standard Unit: SI metric standard calculation format"
        ],
        examiner_trap_warning=f"Beware of boundary condition shifts and sign errors in {topic} questions!",
        rapid_memory_mnemonic=f"S.P.A.R.K: Scope -> Parameters -> Arguments -> Return -> Keep clean units!",
        must_know_5mark_question=f"Derive the fundamental rate relationship for {topic} with a step-by-step example."
    )

@app.post("/api/blitz-quiz", response_model=BlitzQuizResponse)
async def get_blitz_quiz(req: BlitzQuizRequest):
    topic = req.topic.strip() or "General Science"
    lang_name = LANGUAGES_MAP.get(req.language, "Hinglish")

    sys_prompt = f"""You are a master quiz creator for a 60-Second Rapid-Fire Quiz Arena on: '{topic}'.
Target Language: {lang_name}

Generate exactly 8 rapid-fire multiple-choice questions (3 options each).
Return strictly a JSON object:
{{
  "topic": "{topic}",
  "questions": [
    {{
      "id": 1,
      "question": "Fast conceptual question 1?",
      "options": ["Option A", "Option B", "Option C"],
      "correct_index": 0,
      "explanation": "Quick 1-sentence explanation"
    }}
  ],
  "time_limit_seconds": 60
}}"""

    raw_json = None
    client = get_gemini_client()
    if client:
        try:
            resp = client.models.generate_content(
                model="gemini-3.6-flash",
                contents=f"Generate 8 rapid-fire blitz questions for '{topic}'.",
                config=genai_types.GenerateContentConfig(
                    system_instruction=sys_prompt,
                    response_mime_type="application/json",
                    temperature=0.6
                )
            )
            if resp.text:
                raw_json = resp.text
        except Exception as e:
            logger.warning(f"Gemini blitz quiz error: {e}")

    if not raw_json:
        raw_json = await call_glm_completion(f"Generate 8 rapid-fire blitz questions for '{topic}'.", sys_prompt)

    if raw_json:
        d = safe_parse_json(raw_json)
        if d:
            return BlitzQuizResponse(**d)

    return BlitzQuizResponse(
        topic=topic,
        questions=[
            BlitzQuestion(id=1, question=f"Is {topic} governed by strict conservation laws?", options=["Yes, always", "No, never", "Only in space"], correct_index=0, explanation="Fundamental laws always apply!"),
            BlitzQuestion(id=2, question=f"What happens if the primary rate of change is zero in {topic}?", options=["Accelerates", "Steady state / Constant", "Collapses"], correct_index=1, explanation="Zero rate of change represents a constant state."),
            BlitzQuestion(id=3, question=f"Which units are standard in {topic}?", options=["SI Base Units", "Arbitrary units", "No units"], correct_index=0, explanation="Always use standard SI units."),
            BlitzQuestion(id=4, question=f"Can dynamic equilibrium be maintained in {topic}?", options=["Yes, with balanced flux", "No, static only", "Only at absolute zero"], correct_index=0, explanation="Dynamic equilibrium balances continuous opposing rates."),
        ],
        time_limit_seconds=60
    )

@app.post("/api/tts")
async def generate_tts(req: TTSRequest):
    clean = clean_speech_text(req.text)
    voice = NEURAL_VOICES.get(req.language, NEURAL_VOICES["hinglish"])
    try:
        communicate = edge_tts.Communicate(clean[:500], voice)
        audio_stream = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_stream.write(chunk["data"])
        return PlainResponse(content=audio_stream.getvalue(), media_type="audio/mpeg")
    except Exception as e:
        logger.error(f"TTS endpoint error: {e}")
        raise HTTPException(status_code=500, detail="Voice synthesis failed")

# ---------------------------------------------------------------------------
# Static Web App Mounts
# ---------------------------------------------------------------------------
@app.get("/")
@app.get("/index.html")
async def get_index_page():
    return FileResponse("static/index.html", headers={
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
        "Clear-Site-Data": '"cache", "storage"'
    })

@app.get("/app.js")
async def get_app_js():
    return FileResponse("static/app.js", media_type="application/javascript", headers={
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache", "Expires": "0"
    })

@app.get("/style.css")
async def get_style_css():
    return FileResponse("static/style.css", media_type="text/css", headers={
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache", "Expires": "0"
    })

@app.get("/sw.js")
async def get_sw_js():
    return FileResponse("static/sw.js", media_type="application/javascript")

@app.get("/manifest.json")
async def get_manifest():
    return FileResponse("static/manifest.json", media_type="application/json")

# Mount /static directory
app.mount("/static", StaticFiles(directory="static"), name="static_dir")
