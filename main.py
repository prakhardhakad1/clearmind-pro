"""
ClearMind Pro — Multi-Modal AI Educational Ecosystem
Backend Entrypoint (FastAPI)
Powered by Google Gemini 3.6 Flash + Zhipu GLM-4 Failover + Microsoft Edge Neural Voice
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

import urllib.parse
import sqlite3
import hashlib
import secrets
from datetime import datetime
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

class VercelRouteMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http":
            qs = scope.get("query_string", b"").decode("latin1")
            new_qs_parts = []
            route = None
            if qs:
                for part in qs.split("&"):
                    if part.startswith("_route="):
                        route = urllib.parse.unquote(part.split("=", 1)[1])
                    elif part:
                        new_qs_parts.append(part)
                scope["query_string"] = "&".join(new_qs_parts).encode("latin1")

            if route:
                if not route.startswith("/"):
                    route = "/" + route
                target = f"/api{route}"
                scope["path"] = target
                scope["raw_path"] = target.encode("latin1")
            elif scope.get("path", "").endswith(".py"):
                # Fallback if accessed as /api/index.py
                headers = dict(scope.get("headers", []))
                matched = headers.get(b"x-matched-path", b"").decode("latin1")
                if matched and not matched.endswith(".py"):
                    scope["path"] = matched
                    scope["raw_path"] = matched.encode("latin1")

        await self.app(scope, receive, send)

app.add_middleware(VercelRouteMiddleware)

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
    "hinglish": "Hinglish (Conversational Hindi + English blend)",
    "en": "English",
    "hi": "Hindi (हिन्दी)",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "ja": "Japanese",
    "zh": "Chinese",
}

def get_language_directive(language_code: str) -> str:
    lang = (language_code or "hinglish").lower().strip()
    if lang == "hinglish":
        return (
            "CRITICAL MANDATORY LANGUAGE REQUIREMENT: You MUST communicate and explain STRICTLY in natural, engaging HINGLISH "
            "(conversational Hindi written in standard English/Latin alphabet, blended naturally with English technical terms). "
            "Examples: 'Arre wah! Yeh concept bohot hi aasan aur interesting hai. Socho agar aap...', 'Bilkul simple hai, dhyan se samjho!', 'Iska basic rule yeh hai...'. "
            "NEVER reply in pure English! Keep formulas, code, and scientific terms in English (e.g. 'dy/dx', 'velocity', 'def function():'), "
            "but all conversation, questions, explanations, analogies, and speech MUST be in natural, vibrant Hinglish."
        )
    elif lang == "hi":
        return (
            "CRITICAL MANDATORY LANGUAGE REQUIREMENT: You MUST communicate and explain STRICTLY in pure, standard HINDI (हिन्दी - मानक देवनागरी लिपि). "
            "Examples: 'नमस्ते! चलिए इस विषय को बहुत ही सरल और रोचक तरीके से समझते हैं।', 'इसका मूल सिद्धांत यह है...'. "
            "Keep mathematical formulas and symbols clear and intact, but ALL explanations, notes, analogies, and spoken script MUST be in pure Hindi (Devanagari). "
            "NEVER default to English!"
        )
    elif lang == "es":
        return "CRITICAL MANDATORY: You MUST write all explanations, analogies, and speech strictly in Spanish (Español). NEVER reply in English!"
    elif lang == "fr":
        return "CRITICAL MANDATORY: You MUST write all explanations, analogies, and speech strictly in French (Français). NEVER reply in English!"
    elif lang == "de":
        return "CRITICAL MANDATORY: You MUST write all explanations, analogies, and speech strictly in German (Deutsch). NEVER reply in English!"
    elif lang == "ja":
        return "CRITICAL MANDATORY: You MUST write all explanations, analogies, and speech strictly in Japanese (日本語). NEVER reply in English!"
    elif lang == "zh":
        return "CRITICAL MANDATORY: You MUST write all explanations, analogies, and speech strictly in Simplified Chinese (简体中文). NEVER reply in English!"
    else:
        return "CRITICAL MANDATORY: You MUST communicate in clear, natural, high-yield English."

def clean_speech_text(text: str) -> str:
    """Strip markdown symbols, emojis, and code formatting so voice sounds 100% human-natural."""
    if not text: return ""
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
            title = re.sub(r'\s*\([^\)]*\)', '', raw_title).strip()
            if len(title) > 2:
                steps.append({
                    "step_number": num or (len(steps) + 1),
                    "title": title[:40],
                    "status": "done" if len(steps) == 0 else "active" if len(steps) == 1 else "todo",
                    "description": raw_title[:60]
                })
    return steps[:6]

def get_gemini_client(custom_key: Optional[str] = None):
    api_key = custom_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return None
    try:
        os.environ["GEMINI_API_KEY"] = api_key
        os.environ["GOOGLE_API_KEY"] = api_key
        return genai.Client(api_key=api_key)
    except Exception as e:
        logger.error(f"Failed to create Gemini client: {e}")
        return None

async def execute_dual_ai_completion(
    sys_prompt: str,
    user_prompt: str,
    content_items: Optional[List[Any]] = None,
    custom_key: Optional[str] = None,
    max_tokens: int = 1000
) -> Optional[str]:
    """
    Races Gemini 3.5 Flash and Zhipu GLM-4 Flash concurrently.
    Returns the fastest valid response in under 2 seconds.
    """
    has_image = bool(content_items and any(isinstance(x, genai_types.Part) for x in content_items))
    client = get_gemini_client(custom_key)

    async def _call_gemini() -> Optional[str]:
        if not client: return None
        loop = asyncio.get_running_loop()
        def _sync_gemini():
            primary_model = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
            candidate_models = [primary_model]
            if primary_model != "gemini-3.6-flash":
                candidate_models.append("gemini-3.6-flash")
            if "gemini-3.5-flash-lite" not in candidate_models:
                candidate_models.append("gemini-3.5-flash-lite")

            cfg = genai_types.GenerateContentConfig(
                system_instruction=sys_prompt,
                response_mime_type="application/json",
                temperature=0.6,
                max_output_tokens=max_tokens,
                thinking_config=genai_types.ThinkingConfig(thinking_level="low")
            )
            for m in candidate_models:
                try:
                    r = client.models.generate_content(
                        model=m,
                        contents=content_items if (content_items and len(content_items) > 0) else user_prompt,
                        config=cfg
                    )
                    if r and r.text and r.text.strip():
                        return r.text
                except Exception as e:
                    logger.info(f"Gemini candidate {m} error ({e}), trying next model...")
            return None
        try:
            return await asyncio.wait_for(loop.run_in_executor(None, _sync_gemini), timeout=14.0)
        except Exception as e:
            logger.info(f"Gemini attempt timed out or failed: {e or type(e).__name__}")
            return None

    async def _call_glm() -> Optional[str]:
        if has_image: return None
        glm_key = os.getenv("GLM_API_KEY")
        if not glm_key: return None
        url = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
        headers = {"Authorization": f"Bearer {glm_key}", "Content-Type": "application/json"}
        payload = {
            "model": "glm-4-flash",
            "messages": [
                {"role": "system", "content": sys_prompt + "\n\nCRITICAL: Return strictly a valid JSON object without markdown fences."},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.6,
            "max_tokens": max_tokens
        }
        try:
            async with httpx.AsyncClient(timeout=6.5) as http_client:
                resp = await http_client.post(url, headers=headers, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    return data["choices"][0]["message"]["content"]
                else:
                    logger.info(f"GLM status error: {resp.status_code} {resp.text[:200]}")
        except Exception as e:
            logger.info(f"GLM attempt failed: {e or type(e).__name__}")
        return None

    if has_image:
        return await _call_gemini()

    tasks = [asyncio.create_task(_call_gemini()), asyncio.create_task(_call_glm())]
    for fut in asyncio.as_completed(tasks):
        try:
            res = await fut
            if res and safe_parse_json(res):
                for t in tasks:
                    if not t.done(): t.cancel()
                return res
        except Exception:
            pass

    for t in tasks:
        if not t.done() and not t.cancelled():
            try:
                res = await t
                if res and safe_parse_json(res):
                    return res
            except Exception:
                pass
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
        async def _synth():
            communicate = edge_tts.Communicate(clean[:140], voice)
            audio_stream = io.BytesIO()
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_stream.write(chunk["data"])
            return audio_stream.getvalue()

        audio_bytes = await asyncio.wait_for(_synth(), timeout=3.0)
        if audio_bytes:
            return base64.b64encode(audio_bytes).decode("utf-8")
    except Exception as e:
        logger.info(f"Edge TTS synthesis skipped or timed out: {e}")
    return None

class AnalogyCard(BaseModel):
    title: str = Field(description="Vivid real-world analogy title")
    description: str = Field(description="Clear explanation of the concept using everyday physical metaphor")

class ChatTeachRequest(BaseModel):
    topic: str = "Introduction to Python"
    message: str
    conversation_history: List[Dict[str, str]] = []
    language: str = "hinglish"
    student_name: str = "Prakhar"
    level: str = "College / University"
    mode: str = "direct" # "direct" or "socratic"
    persona: Optional[str] = "mentor"
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

# Real Comprehensive Exam Cheat Sheet
class FormulaCard(BaseModel):
    name: str
    latex: str
    variables: str
    importance: str

class ExaminerTrap(BaseModel):
    trap: str
    fix: str
    exam_type: str = "High-Yield"

class MnemonicItem(BaseModel):
    acronym: str
    expansion: str
    tip: str

class MustKnowQuestion(BaseModel):
    question: str
    marks: int = 5
    solution_steps: List[str]

class ExamCheatSheetRequest(BaseModel):
    topic: str = "Introduction to Python"
    language: str = "hinglish"
    level: str = "College / University"

class ExamCheatSheetResponse(BaseModel):
    topic: str
    synopsis: str = ""
    formula_cards: List[FormulaCard] = []
    examiner_traps: List[ExaminerTrap] = []
    mnemonics: List[MnemonicItem] = []
    must_know_questions: List[MustKnowQuestion] = []
    golden_rules: List[str] = []
    # Backwards compatibility fields
    formulas_and_definitions: List[str] = []
    examiner_trap_warning: str = ""
    rapid_memory_mnemonic: str = ""
    must_know_5mark_question: str = ""

# Blitz Battle Arena 2.0
class BlitzQuestion(BaseModel):
    id: int
    question: str
    options: List[str]
    correct_index: int
    explanation: str

class BlitzQuizRequest(BaseModel):
    topic: str = "Introduction to Python"
    language: str = "hinglish"
    num_questions: int = 8
    time_limit_seconds: int = 60
    difficulty: str = "Standard"

class BlitzQuizResponse(BaseModel):
    topic: str
    questions: List[BlitzQuestion]
    time_limit_seconds: int = 60

# 3D Spaced-Repetition Flashcards
class FlashcardItem(BaseModel):
    id: int
    front: str
    back: str
    category: str
    hint: Optional[str] = None

class FlashcardsRequest(BaseModel):
    topic: str = "Introduction to Python"
    language: str = "hinglish"
    count: int = 6

class FlashcardsResponse(BaseModel):
    topic: str
    cards: List[FlashcardItem]

class TTSRequest(BaseModel):
    text: str
    language: str = "hinglish"



# ---------------------------------------------------------------------------
# Database & Authentication Architecture (SQLite & User Session Engine)
# ---------------------------------------------------------------------------
def get_db_path() -> str:
    if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        return "/tmp/clearmind.db"
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "clearmind.db")

def init_db():
    try:
        db_path = get_db_path()
        os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT DEFAULT 'student',
                created_at TEXT NOT NULL
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_profiles (
                user_id TEXT PRIMARY KEY,
                persona TEXT DEFAULT 'mentor',
                identity TEXT DEFAULT 'school',
                level TEXT DEFAULT 'Class 12',
                board TEXT DEFAULT 'CBSE',
                daily_rhythm TEXT DEFAULT '45 mins / day',
                target_goal TEXT DEFAULT 'Board & Entrance Exams',
                subjects TEXT DEFAULT '[]',
                sub_details TEXT DEFAULT '{}',
                learning_styles TEXT DEFAULT '[]',
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )
        """)
        # Seed or update default admin credentials with requested password
        now = datetime.utcnow().isoformat()
        admin_pwd_hash = hashlib.sha256("@PrakharDhakad1234543211".encode("utf-8")).hexdigest()
        cursor.execute("SELECT id FROM users WHERE email = 'admin@clearmind.ai' OR user_id = 'CMP-ADMIN'")
        existing_admin = cursor.fetchone()
        if not existing_admin:
            cursor.execute("""
                INSERT INTO users (user_id, name, email, password_hash, role, created_at)
                VALUES (?, ?, ?, ?, 'admin', ?)
            """, (
                "CMP-ADMIN",
                "ClearMind Admin",
                "admin@clearmind.ai",
                admin_pwd_hash,
                now
            ))
            cursor.execute("""
                INSERT OR REPLACE INTO user_profiles (user_id, persona, identity, level, board, daily_rhythm, target_goal, subjects, updated_at)
                VALUES (?, 'polymath', 'college', 'College / B.Tech CSE', 'Autonomous', '60m', 'System Architecture & Research', ?, ?)
            """, (
                "CMP-ADMIN",
                json.dumps(["AI & Machine Learning", "Operating Systems", "Advanced Mathematics"]),
                now
            ))
        else:
            cursor.execute("UPDATE users SET password_hash = ? WHERE user_id = 'CMP-ADMIN' OR email = 'admin@clearmind.ai'", (admin_pwd_hash,))
        conn.commit()
        conn.close()
        logger.info(f"Initialized SQLite database at {db_path} with updated admin credentials")
    except Exception as err:
        logger.error(f"Failed to initialize SQLite DB: {err}")

init_db()

def hash_password(password: str) -> str:
    return hashlib.sha256(password.strip().encode("utf-8")).hexdigest()

def generate_user_id() -> str:
    num = secrets.randbelow(90000) + 10000
    return f"CMP-{num}"

class UserRegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    persona: Optional[str] = "mentor"
    level: Optional[str] = "Class 12"

class UserLoginRequest(BaseModel):
    email: str
    password: str

class AdminLoginRequest(BaseModel):
    user_id: str
    password: str

ADMIN_SESSION_SECRET = os.getenv("ADMIN_SESSION_SECRET", "clearmind_secure_admin_2026_vault_key")

def make_admin_token(admin_uid: str) -> str:
    raw = f"{admin_uid}:{ADMIN_SESSION_SECRET}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def verify_admin_auth(request: Request) -> bool:
    auth_header = request.headers.get("authorization", "")
    token = ""
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    elif request.headers.get("x-admin-token"):
        token = request.headers.get("x-admin-token").strip()
    
    if token and (token == make_admin_token("CMP-ADMIN") or token == make_admin_token("admin@clearmind.ai")):
        return True
    return False

class SyncProfileRequest(BaseModel):
    user_id: str
    name: Optional[str] = None
    persona: Optional[str] = "mentor"
    identity: Optional[str] = "school"
    level: Optional[str] = "Class 12"
    board: Optional[str] = "CBSE"
    daily_rhythm: Optional[str] = "45 mins / day"
    target_goal: Optional[str] = ""
    subjects: Optional[List[Any]] = []
    sub_details: Optional[Dict[str, Any]] = {}
    learning_styles: Optional[List[str]] = []

class GoogleAuthSyncRequest(BaseModel):
    name: str
    email: str
    avatar: Optional[str] = ""
    sub: Optional[str] = ""

# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------
@app.get("/api/status")
@app.get("/status")
async def get_status():
    return {
        "status": "online",
        "gemini_active": bool(os.getenv("GEMINI_API_KEY")),
        "glm4_active": bool(os.getenv("GLM_API_KEY")),
        "engine": "Dual-Engine (Gemini 3.5 Flash + GLM-4 Flash Fast Race)",
        "voice": "Microsoft Edge Neural Voice"
    }

@app.post("/api/auth/register")
@app.post("/auth/register")
async def auth_register(req: UserRegisterRequest):
    email_clean = req.email.strip().lower()
    name_clean = req.name.strip()
    if not email_clean or not req.password:
        raise HTTPException(status_code=400, detail="Email and password are required.")
    
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT user_id FROM users WHERE lower(email) = ?", (email_clean,))
    existing = cursor.fetchone()
    if existing:
        conn.close()
        raise HTTPException(status_code=400, detail="An account with this email already exists. Please sign in.")
    
    user_id = generate_user_id()
    while True:
        cursor.execute("SELECT id FROM users WHERE user_id = ?", (user_id,))
        if not cursor.fetchone():
            break
        user_id = generate_user_id()
    
    pwd_hash = hash_password(req.password)
    now = datetime.utcnow().isoformat()
    cursor.execute("""
        INSERT INTO users (user_id, name, email, password_hash, role, created_at)
        VALUES (?, ?, ?, ?, 'student', ?)
    """, (user_id, name_clean or email_clean.split('@')[0], email_clean, pwd_hash, now))
    
    default_subjects = json.dumps(["Physics", "Chemistry", "Mathematics"])
    cursor.execute("""
        INSERT INTO user_profiles (user_id, persona, identity, level, board, daily_rhythm, target_goal, subjects, updated_at)
        VALUES (?, ?, 'school', ?, 'CBSE', '45 mins / day', 'Board & Entrance Exams', ?, ?)
    """, (user_id, req.persona or "mentor", req.level or "Class 12", default_subjects, now))
    
    conn.commit()
    conn.close()
    
    return {
        "status": "success",
        "user": {
            "user_id": user_id,
            "name": name_clean or email_clean.split('@')[0],
            "email": email_clean,
            "role": "student"
        },
        "profile": {
            "persona": req.persona or "mentor",
            "identity": "school",
            "level": req.level or "Class 12",
            "board": "CBSE",
            "daily_rhythm": "45 mins / day",
            "target_goal": "Board & Entrance Exams",
            "subjects": ["Physics", "Chemistry", "Mathematics"],
            "updated_at": now
        },
        "isNew": True
    }

@app.post("/api/auth/login")
@app.post("/auth/login")
async def auth_login(req: UserLoginRequest):
    email_clean = req.email.strip().lower()
    pwd_hash = hash_password(req.password)
    
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT user_id, name, email, password_hash, role, created_at
        FROM users WHERE lower(email) = ?
    """, (email_clean,))
    user_row = cursor.fetchone()
    
    if not user_row or user_row[3] != pwd_hash:
        conn.close()
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    
    user_id = user_row[0]
    cursor.execute("""
        SELECT persona, identity, level, board, daily_rhythm, target_goal, subjects, sub_details, learning_styles, updated_at
        FROM user_profiles WHERE user_id = ?
    """, (user_id,))
    prof_row = cursor.fetchone()
    conn.close()
    
    profile_data = {
        "persona": prof_row[0] if prof_row else "mentor",
        "identity": prof_row[1] if prof_row else "school",
        "level": prof_row[2] if prof_row else "Class 12",
        "board": prof_row[3] if prof_row else "CBSE",
        "daily_rhythm": prof_row[4] if prof_row else "45 mins / day",
        "target_goal": prof_row[5] if prof_row else "",
        "subjects": json.loads(prof_row[6]) if prof_row and prof_row[6] else ["Physics", "Chemistry", "Mathematics"],
        "sub_details": json.loads(prof_row[7]) if prof_row and len(prof_row) > 7 and prof_row[7] else {},
        "learning_styles": json.loads(prof_row[8]) if prof_row and len(prof_row) > 8 and prof_row[8] else ["visual", "socratic"],
        "updated_at": prof_row[9] if prof_row and len(prof_row) > 9 else ""
    }
    
    return {
        "status": "success",
        "user": {
            "user_id": user_id,
            "name": user_row[1],
            "email": user_row[2],
            "role": user_row[4],
            "created_at": user_row[5]
        },
        "profile": profile_data
    }

@app.post("/api/auth/google")
@app.post("/auth/google")
async def auth_google(req: GoogleAuthSyncRequest):
    email_clean = req.email.strip().lower()
    name_clean = req.name.strip() or email_clean.split('@')[0]
    
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT user_id, name, email, role, created_at
        FROM users WHERE lower(email) = ?
    """, (email_clean,))
    user_row = cursor.fetchone()
    
    now = datetime.utcnow().isoformat()
    is_new = False
    if not user_row:
        is_new = True
        user_id = generate_user_id()
        while True:
            cursor.execute("SELECT id FROM users WHERE user_id = ?", (user_id,))
            if not cursor.fetchone():
                break
            user_id = generate_user_id()
        
        pwd_hash = hash_password(secrets.token_hex(16))
        cursor.execute("""
            INSERT INTO users (user_id, name, email, password_hash, role, created_at)
            VALUES (?, ?, ?, ?, 'student', ?)
        """, (user_id, name_clean, email_clean, pwd_hash, now))
        
        default_subjects = json.dumps(["Physics", "Chemistry", "Mathematics"])
        cursor.execute("""
            INSERT INTO user_profiles (user_id, persona, identity, level, board, daily_rhythm, target_goal, subjects, updated_at)
            VALUES (?, 'mentor', 'school', 'Class 12', 'CBSE', '45 mins / day', 'Board & Entrance Exams', ?, ?)
        """, (user_id, default_subjects, now))
        conn.commit()
    else:
        user_id = user_row[0]
        name_clean = user_row[1]
    
    cursor.execute("""
        SELECT persona, identity, level, board, daily_rhythm, target_goal, subjects, sub_details, learning_styles, updated_at
        FROM user_profiles WHERE user_id = ?
    """, (user_id,))
    prof_row = cursor.fetchone()
    conn.close()
    
    profile_data = {
        "persona": prof_row[0] if prof_row else "mentor",
        "identity": prof_row[1] if prof_row else "school",
        "level": prof_row[2] if prof_row else "Class 12",
        "board": prof_row[3] if prof_row else "CBSE",
        "daily_rhythm": prof_row[4] if prof_row else "45 mins / day",
        "target_goal": prof_row[5] if prof_row else "",
        "subjects": json.loads(prof_row[6]) if prof_row and prof_row[6] else ["Physics", "Chemistry", "Mathematics"],
        "sub_details": json.loads(prof_row[7]) if prof_row and len(prof_row) > 7 and prof_row[7] else {},
        "learning_styles": json.loads(prof_row[8]) if prof_row and len(prof_row) > 8 and prof_row[8] else ["visual", "socratic"],
        "updated_at": prof_row[9] if prof_row and len(prof_row) > 9 else ""
    }
    
    return {
        "status": "success",
        "user": {
            "user_id": user_id,
            "name": name_clean,
            "email": email_clean,
            "role": user_row[3] if user_row else "student",
            "avatar": req.avatar
        },
        "profile": profile_data,
        "isNew": is_new
    }

@app.post("/api/auth/sync-profile")
@app.post("/auth/sync-profile")
async def sync_profile(req: SyncProfileRequest):
    if not req.user_id:
        raise HTTPException(status_code=400, detail="User ID is required.")
    
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    now = datetime.utcnow().isoformat()
    if req.name:
        cursor.execute("UPDATE users SET name = ? WHERE user_id = ?", (req.name.strip(), req.user_id))
    
    subjects_json = json.dumps(req.subjects or [])
    sub_details_json = json.dumps(req.sub_details or {})
    learning_styles_json = json.dumps(req.learning_styles or [])
    
    cursor.execute("""
        INSERT INTO user_profiles (user_id, persona, identity, level, board, daily_rhythm, target_goal, subjects, sub_details, learning_styles, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            persona = excluded.persona,
            identity = excluded.identity,
            level = excluded.level,
            board = excluded.board,
            daily_rhythm = excluded.daily_rhythm,
            target_goal = excluded.target_goal,
            subjects = excluded.subjects,
            sub_details = excluded.sub_details,
            learning_styles = excluded.learning_styles,
            updated_at = excluded.updated_at
    """, (
        req.user_id,
        req.persona or "mentor",
        req.identity or "school",
        req.level or "Class 12",
        req.board or "CBSE",
        req.daily_rhythm or "45 mins / day",
        req.target_goal or "",
        subjects_json,
        sub_details_json,
        learning_styles_json,
        now
    ))
    conn.commit()
    conn.close()
    
    return {"status": "success", "user_id": req.user_id, "updated_at": now}

@app.post("/api/admin/login")
@app.post("/admin/login")
async def admin_login(req: AdminLoginRequest):
    uid_clean = req.user_id.strip()
    pwd_hash = hash_password(req.password)
    
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT user_id, name, email, password_hash, role
        FROM users
        WHERE (user_id = ? OR lower(email) = ?) AND role = 'admin'
    """, (uid_clean, uid_clean.lower()))
    row = cursor.fetchone()
    conn.close()
    
    if not row or row[3] != pwd_hash:
        raise HTTPException(status_code=401, detail="Invalid Admin User ID or Password.")
    
    token = make_admin_token(row[0])
    return {
        "status": "success",
        "token": token,
        "admin": {
            "user_id": row[0],
            "name": row[1],
            "email": row[2],
            "role": "admin"
        }
    }

@app.get("/api/admin/metrics")
@app.get("/admin/metrics")
async def admin_metrics(request: Request):
    if not verify_admin_auth(request):
        raise HTTPException(status_code=401, detail="Unauthorized. Admin authentication required.")
        
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM users")
    total_users = cursor.fetchone()[0]
    
    cursor.execute("SELECT persona, COUNT(*) FROM user_profiles GROUP BY persona")
    persona_counts = {row[0]: row[1] for row in cursor.fetchall()}
    
    cursor.execute("SELECT level, COUNT(*) FROM user_profiles GROUP BY level")
    level_counts = {row[0]: row[1] for row in cursor.fetchall()}
    
    cursor.execute("SELECT user_id, name, email, created_at FROM users ORDER BY id DESC LIMIT 5")
    recent_users = [
        {"user_id": r[0], "name": r[1], "email": r[2], "created_at": r[3]}
        for r in cursor.fetchall()
    ]
    conn.close()
    
    return {
        "status": "success",
        "total_users": total_users,
        "persona_counts": persona_counts,
        "level_counts": level_counts,
        "recent_users": recent_users,
        "database_location": db_path
    }

@app.get("/api/admin/users")
@app.get("/admin/users")
async def admin_users(request: Request):
    if not verify_admin_auth(request):
        raise HTTPException(status_code=401, detail="Unauthorized. Admin authentication required.")
        
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT u.user_id, u.name, u.email, u.role, u.created_at,
               p.persona, p.identity, p.level, p.board, p.daily_rhythm, p.target_goal, p.subjects, p.updated_at
        FROM users u
        LEFT JOIN user_profiles p ON u.user_id = p.user_id
        ORDER BY u.id DESC
    """)
    rows = cursor.fetchall()
    conn.close()
    
    users_list = []
    for r in rows:
        subjects = []
        try:
            if r[11]: subjects = json.loads(r[11])
        except Exception:
            pass
        users_list.append({
            "user_id": r[0],
            "name": r[1],
            "email": r[2],
            "role": r[3],
            "created_at": r[4],
            "profile": {
                "persona": r[5] or "mentor",
                "identity": r[6] or "school",
                "level": r[7] or "Class 12",
                "board": r[8] or "CBSE",
                "daily_rhythm": r[9] or "45 mins / day",
                "target_goal": r[10] or "",
                "subjects": subjects,
                "updated_at": r[12] or r[4]
            }
        })
    
    return {"status": "success", "count": len(users_list), "users": users_list}

@app.post("/api/chat-teach", response_model=ChatTeachResponse)
@app.post("/chat-teach", response_model=ChatTeachResponse)
async def chat_teach(req: ChatTeachRequest, request: Request):
    user_msg = req.message.strip()
    raw_topic = req.topic.strip()
    if any(p in raw_topic.lower() for p in ["general science", "problem solving", "choose any topic", "what would you like to learn"]):
        topic = ""
    else:
        topic = raw_topic
    lang_directive = get_language_directive(req.language)

    teaching_style = (
        "TEACHING STYLE: Socratic Method. Guide the student step-by-step with intuitive prompts, finishing your answer with an insightful question that encourages them to think!"
        if req.mode == "socratic" else
        "TEACHING STYLE: Direct Master Educator. Provide deep, crystal-clear conceptual explanations, step-by-step math derivations, and real physical analogies."
    )

    persona_directives = {
        "strict": "ACTIVE PERSONA: Strict Examiner (⚡). Be razor-sharp, analytical, and rigorous. Do not spoon-feed. Challenge weak logic, identify subtle exam traps, and demand precise scientific/mathematical answers for top marks.",
        "socratic": "ACTIVE PERSONA: Socratic Guide (💡). Do not provide flat answers directly. Ask probing, progressive questions that empower the student to deduce the solution themselves.",
        "polymath": "ACTIVE PERSONA: First-Principles Polymath (🔬). Derive governing formulas and concepts from foundational axioms, laws of nature, and mathematical proofs using LaTeX/KaTeX.",
        "hacker": "ACTIVE PERSONA: Blitz Exam Hacker (🚀). Focus on high-yield shortcuts, mental tricks, mnemonics, pattern recognition, and speed problem solving for competitive exams.",
        "feynman": "ACTIVE PERSONA: Feynman ELI5 Explainer (🧠). Strip away all textbook jargon. Explain complex principles using intuitive, vivid analogies that anyone can immediately visualize.",
        "mentor": "ACTIVE PERSONA: Encouraging Mentor (🎓). Be patient, warm, inspiring, and supportive. Build student confidence through step-by-step guidance and relatable analogies."
    }
    persona_text = persona_directives.get(req.persona or "mentor", persona_directives["mentor"])

    sys_prompt = f"""You are Luna, an elite world-class AI Master Teacher for ClearMind Pro.
You teach students with warmth, high enthusiasm, deep pedagogical clarity, and vivid everyday real-world analogies.

{lang_directive}

{teaching_style}

{persona_text}

Student Name: {req.student_name}
Target Academic Level: {req.level}

Student's active topic (if specified): '{topic or "None decided yet"}'

TOPIC DETECTION & DISAMBIGUATION RULES (CRITICAL):
1. GREETINGS & CASUAL CHAT:
   - If the student message is a greeting, pleasantry, or casual chitchat (e.g. 'hello', 'hi', 'hey', 'namaste', 'kaise ho', 'ok', 'thanks', 'thank you', 'bye'):
   - Greet them warmly and enthusiastically in the designated language! Ask what subject or chapter they want to learn today.
   - You MUST set "detected_topic": "" (empty string). DO NOT invent or assume any topic!
   - Set "analogy_card": null, and set "canvas_node_title": "".

2. BROAD GENERAL SUBJECTS REQUIRING CLARIFICATION:
   - If the student mentions ONLY a broad subject or general discipline without a specific topic or chapter (e.g. 'math', 'maths', 'mathematics', 'physics', 'chemistry', 'biology', 'science', 'coding', 'computer science', 'history', 'economics'):
   - Acknowledge the subject with excitement!
   - Explicitly ask the student to clarify WHICH specific chapter or topic within that subject they want to study. Give them 3 to 4 specific popular chapter suggestions (for example, if they say 'maths', suggest: 'Relations & Functions', 'Calculus Derivatives', 'Matrices & Determinants', or 'Trigonometry').
   - You MUST set "detected_topic": "" (empty string). DO NOT set the broad subject as the topic!

3. CONCRETE KNOWLEDGE / STUDY TOPIC:
   - Only when the student specifies a concrete educational topic, chapter, or concept (e.g. 'Relations and Functions', 'Quadratic Equations', 'Calculus Derivatives', 'Newton\'s Second Law', 'Photosynthesis', 'Chemical Bonding', 'Merge Sort', 'Thermodynamics Heat Engine'):
   - Immediately teach that topic with full depth, clarity, real-world analogies, and step-by-step logic!
   - Set "detected_topic": "The exact specific topic name" (e.g. 'Relations and Functions').

You MUST respond strictly with a valid JSON object matching this schema:
{{
  "reply_text": "Engaging conversational explanation formatted in clear markdown with bullet points and code/formula snippets",
  "speech_text": "Punchy 1-2 sentence conversational voice script without markdown or symbols",
  "analogy_card": {{
    "title": "Vivid Analogy Title (e.g. 🏍️ The Bike Speedometer or 📦 The Recipe Box)",
    "description": "Clear 1-2 sentence real-world metaphor breaking down the concept"
  }} or null,
  "suggested_replies": ["Specific follow-up question 1", "Analogy expansion question 2", "Option 3"],
  "canvas_node_title": "Key Concept Title or empty string",
  "canvas_node_summary": "1-sentence summary of the unlocked concept or empty string",
  "detected_topic": "The exact specific topic if identified, or empty string if greeting/broad subject",
  "roadmap_steps": [
    {{"step_number": 1, "title": "Step 1 Milestone Title", "status": "done", "description": "Key concept covered"}},
    {{"step_number": 2, "title": "Step 2 Milestone Title", "status": "active", "description": "Currently learning"}},
    {{"step_number": 3, "title": "Step 3 Milestone Title", "status": "todo", "description": "Next milestone"}},
    {{"step_number": 4, "title": "Step 4 Milestone Title", "status": "todo", "description": "Advanced application"}}
  ] or null
}}

CRITICAL: Every single text field (reply_text, speech_text, analogy_card, suggested_replies, canvas_node_summary) MUST strictly obey the language directive!"""

    user_prompt = f"Student ({req.student_name}) says: '{user_msg}'. History: {req.conversation_history[-3:] if req.conversation_history else 'First turn'}. [MANDATORY: Follow language directive strictly]"

    content_items = []
    if req.image_base64 and req.image_base64.strip():
        try:
            raw_b64 = req.image_base64.strip()
            mime_type = "image/jpeg"
            if "," in raw_b64:
                header, raw_b64 = raw_b64.split(",", 1)
                if "image/png" in header: mime_type = "image/png"
                elif "image/webp" in header: mime_type = "image/webp"
            img_bytes = base64.b64decode(raw_b64)
            content_items.append(genai_types.Part.from_bytes(data=img_bytes, mime_type=mime_type))
            content_items.append(f"The student uploaded an educational image or textbook photo. {user_prompt}")
        except Exception as e:
            logger.warning(f"Error parsing image_base64: {e}")
            content_items.append(user_prompt)
    else:
        content_items.append(user_prompt)

    clean_msg = user_msg.lower().strip()
    is_greeting = any(
        clean_msg == g or clean_msg.startswith(g + " ") or clean_msg.startswith(g + "!") or clean_msg.startswith(g + ",") or clean_msg.startswith(g + ".")
        for g in ["hello", "hi", "hey", "hola", "namaste", "kaise ho", "sup", "yo", "good morning", "good evening", "good afternoon"]
    )
    is_chitchat = is_greeting or any(
        clean_msg == c or clean_msg.startswith(c + " ")
        for c in ["thanks", "thank you", "ok", "okay", "bye", "goodbye", "shukriya", "dhanyawad", "theek hai", "haan", "nahin", "no", "yes", "cool", "nice"]
    )

    broad_subjects = {
        "math", "maths", "mathematics", "physics", "chemistry", "biology",
        "science", "coding", "programming", "computer science", "history", "economics"
    }
    is_broad_subject = clean_msg in broad_subjects or any(
        clean_msg in [f"i want to learn {s}", f"teach me {s}", f"teach {s}", f"{s} seekhna hai", f"{s} padhna hai"]
        for s in broad_subjects
    )

    raw_json = await execute_dual_ai_completion(
        sys_prompt=sys_prompt,
        user_prompt=user_prompt,
        content_items=content_items,
        custom_key=request.headers.get("x-gemini-key"),
        max_tokens=900
    )

    if raw_json:
        d = safe_parse_json(raw_json)
        if d:
            reply = d.get("reply_text") or d.get("explanation") or d.get("content") or d.get("message") or ""
            speech = clean_speech_text(d.get("speech_text") or reply[:120])
            raw_det = (d.get("detected_topic") or "").strip()

            invalid_topic_tokens = [
                "greeting", "greetings", "chitchat", "hello", "hi", "general", "conversation",
                "general science", "problem solving", "foundational concepts", "ready to learn",
                "core topic", "core fundamentals", "arena", "choose any topic", "awaiting topic",
                "none", "none decided yet", "unspecified", "math", "maths", "physics", "chemistry", "biology", "science"
            ]

            if is_chitchat or is_broad_subject or not raw_det or raw_det.lower() in invalid_topic_tokens or any(raw_det.lower().startswith(p) for p in ["greeting", "hello", "general science", "problem solving"]):
                det_topic = ""
            else:
                det_topic = raw_det

            # Fast non-blocking TTS check
            audio = await synthesize_edge_audio_base64(speech[:100], req.language)

            r_steps = d.get("roadmap_steps") if det_topic else None
            card = None if (is_chitchat or is_broad_subject or not det_topic) else d.get("analogy_card")

            fallback_replies = (
                ["Relations & Functions 📐", "Calculus Derivatives 📈", "Newton's Laws ⚛️"] if is_broad_subject else
                ["Explain with everyday analogy 💡", "Give a step-by-step example 📝", "Start 60s Blitz Quiz ⏱️"]
            )

            return ChatTeachResponse(
                reply_text=reply,
                speech_text=speech,
                analogy_card=card,
                suggested_replies=d.get("suggested_replies") or fallback_replies,
                canvas_node_title=d.get("canvas_node_title") if det_topic else "",
                canvas_node_summary=d.get("canvas_node_summary") if det_topic else "",
                detected_topic=det_topic,
                audio_base64=audio,
                roadmap_steps=r_steps if (r_steps and isinstance(r_steps, list) and len(r_steps) > 0) else None
            )

    # Intelligent Localized Fallback
    dyn_topic = ""
    if not is_chitchat and not is_broad_subject:
        if any(kw in clean_msg for kw in ["relation", "function"]):
            dyn_topic = "Relations & Functions"
        elif any(kw in clean_msg for kw in ["calculus", "derivative", "differentiat"]):
            dyn_topic = "Calculus & Derivatives"
        elif any(kw in clean_msg for kw in ["integration", "integral"]):
            dyn_topic = "Integration"
        elif any(kw in clean_msg for kw in ["photosynthesis"]):
            dyn_topic = "Photosynthesis"
        elif any(kw in clean_msg for kw in ["thermodynamic"]):
            dyn_topic = "Thermodynamics"
        elif any(kw in clean_msg for kw in ["quantum"]):
            dyn_topic = "Quantum Physics"
        elif any(kw in clean_msg for kw in ["newton", "laws of motion"]):
            dyn_topic = "Newton's Laws of Motion"
        elif any(kw in clean_msg for kw in ["matrix", "matrices", "determinant"]):
            dyn_topic = "Matrices & Determinants"
        elif any(kw in clean_msg for kw in ["trigonometr"]):
            dyn_topic = "Trigonometry"
        elif any(kw in clean_msg for kw in ["genetics", "dna", "heredity"]):
            dyn_topic = "Genetics & Heredity"
        else:
            stripped = clean_msg
            for prefix in ["teach me about", "teach me", "explain", "what is", "tell me about", "let's learn", "i want to learn", "i want to study", "padhna hai", "seekhna hai", "maths", "math", "physics", "chemistry", "biology", "science"]:
                stripped = stripped.replace(prefix, "").strip()
            stripped = re.sub(r"[^\w\s]", "", stripped).strip()
            if stripped and len(stripped.split()) <= 4:
                dyn_topic = stripped.title()

        if not dyn_topic and topic and not any(p in topic.lower() for p in ["general science", "problem solving", "foundational", "greeting"]):
            dyn_topic = topic

    lang = req.language.lower().strip()
    if is_chitchat:
        if lang == "hinglish":
            dyn_reply = f"Namaste **{req.student_name}**! 🌸 Main hoon **Luna**, aapki AI personal tutor. Aaj aap kaunsa subject ya topic seekhna chahte hain? Jaise **Relations & Functions**, **Calculus**, ya **Newton's Laws**?"
            speech = clean_speech_text(f"Namaste {req.student_name}! Aaj aap kaunsa topic seekhna chahte hain?")
        elif lang == "hi":
            dyn_reply = f"नमस्ते **{req.student_name}**! 🌸 मैं हूँ **लूना**, आपकी एआई शिक्षिका। आज आप कौन सा विषय या अध्याय पढ़ना चाहते हैं?"
            speech = clean_speech_text(f"नमस्ते {req.student_name}! आज आप कौन सा विषय पढ़ना चाहते हैं?")
        else:
            dyn_reply = f"Hello **{req.student_name}**! 🌸 I am **Luna**, your AI personal tutor. What subject or chapter would you like to master today? For example: **Relations & Functions**, **Calculus**, or **Thermodynamics**?"
            speech = clean_speech_text(f"Hello {req.student_name}! What topic would you like to master today?")
        display_topic = ""
        suggested = ["Maths: Relations & Functions 📐", "Physics: Newton's Laws ⚛️", "Chemistry: Thermodynamics 🧪"]
        card = None
    elif is_broad_subject:
        if lang == "hinglish":
            dyn_reply = f"Wah! **{clean_msg.title()}** ek bohot hi interesting aur important subject hai. Lekin isme kaafi chapters hain — aap specific kaunsa chapter ya topic seekhna chahte hain? Jaise:\n- **Relations and Functions**\n- **Calculus & Derivatives**\n- **Matrices & Determinants**\n- **Trigonometry**\n\nMujhe specific topic batayein aur hum turant shuru karte hain!"
            speech = clean_speech_text(f"Wah! {clean_msg.title()} mein aap specific kaunsa topic seekhna chahte hain?")
        else:
            dyn_reply = f"Great choice! **{clean_msg.title()}** is a vast and fascinating subject. Which specific topic or chapter would you like to focus on? For example:\n- **Relations & Functions**\n- **Calculus & Derivatives**\n- **Core Laws & Axioms**\n\nTell me the specific topic and we'll dive right in!"
            speech = clean_speech_text(f"Great! Which specific topic in {clean_msg.title()} would you like to study?")
        display_topic = ""
        suggested = ["Relations & Functions 📐", "Calculus Derivatives 📈", "Matrices & Vectors 🔢"]
        card = None
    elif dyn_topic:
        if lang == "hinglish":
            dyn_reply = f"Bohot badhiya sawaal hai **{req.student_name}**! Chalo **{dyn_topic}** ko bilkul aasan aur interesting tarike se master karte hain.\n\nIs concept mein core principles mathematically aur physically real-world systems se connect hote hain. Hum isko 4 key milestones mein cover karenge: Foundations, Core Mechanisms, Practical Application, aur Examiner Traps!"
            speech = clean_speech_text(f"Bohot badhiya sawaal {req.student_name}! Chalo {dyn_topic} ko samajhte hain.")
            card_title = f"💡 {dyn_topic} ki Real-Life Intuition"
            card_desc = f"{dyn_topic} ko ek automated system ki tarah socho jahan har input ka ek exact, predictable output hota hai."
            suggested = [f"Explain {dyn_topic} formulas", f"{dyn_topic} ka everyday analogy 💡", "Start 60s Blitz ⏱️"]
        else:
            dyn_reply = f"Awesome question **{req.student_name}**! Let's master **{dyn_topic}** together. We will explore core principles, key mechanisms, and real-world intuition step-by-step!"
            speech = clean_speech_text(f"Awesome question {req.student_name}! Let's master {dyn_topic} together.")
            card_title = f"💡 {dyn_topic} Intuition"
            card_desc = f"Think of {dyn_topic} like an automated system where fundamental rules produce predictable, elegant outcomes."
            suggested = [f"Explain {dyn_topic} formulas", f"Give an everyday {dyn_topic} analogy 💡", "Start 60s Blitz ⏱️"]
        display_topic = dyn_topic
        card = {"title": card_title, "description": card_desc}
    else:
        dyn_reply = f"Bohot badhiya **{req.student_name}**! Chalo is concept ko bilkul aasan real-world analogies aur step-by-step logic se master karte hain."
        speech = clean_speech_text(f"Bohot badhiya {req.student_name}! Chalo ise step-by-step samajhte hain.")
        display_topic = ""
        suggested = ["Give an everyday analogy 💡", "Step-by-step derivation 📐", "Test me with Blitz ⏱️"]
        card = None

    audio = await synthesize_edge_audio_base64(speech[:100], req.language)
    return ChatTeachResponse(
        reply_text=dyn_reply,
        speech_text=speech,
        analogy_card=card,
        suggested_replies=suggested,
        canvas_node_title=display_topic,
        canvas_node_summary=f"Foundations and core mechanisms of {display_topic}." if display_topic else "",
        detected_topic=display_topic,
        audio_base64=audio,
        roadmap_steps=[
            {"step_number": 1, "title": f"{display_topic} Foundations", "status": "done", "description": "Definitions and core terms"},
            {"step_number": 2, "title": "Core Mechanism", "status": "active", "description": "Operating principles and formulas"},
            {"step_number": 3, "title": "Practical Application", "status": "todo", "description": "Real-world problem solving"},
            {"step_number": 4, "title": "Exam Mastery & Traps", "status": "todo", "description": "High-yield scoring rules"}
        ] if display_topic else None
    )

@app.post("/api/exam-cheat-sheet", response_model=ExamCheatSheetResponse)
@app.post("/exam-cheat-sheet", response_model=ExamCheatSheetResponse)
async def get_exam_cheat_sheet(req: ExamCheatSheetRequest, request: Request):
    raw_topic = req.topic.strip()
    if not raw_topic or any(p in raw_topic.lower() for p in ["general science", "problem solving", "choose any topic", "what would you like to learn"]):
        topic = "Core Fundamentals & Key Formulas"
    else:
        topic = raw_topic
    lang_directive = get_language_directive(req.language)

    sys_prompt = f"""You are an elite competitive exam paper setter creating a real, comprehensive, high-yield Exam Revision Cheat Sheet for: '{topic}'.
Target Academic Level: {req.level}

{lang_directive}

Return strictly a valid JSON object matching this schema:
{{
  "topic": "{topic}",
  "synopsis": "Crisp 2-sentence executive summary defining the core law and exam relevance",
  "formula_cards": [
    {{
      "name": "Formula Name 1",
      "latex": "KaTeX / LaTeX string (e.g. \\\\frac{{dy}}{{dx}} = \\\\lim_{{\\\\Delta x \\\\to 0}} \\\\frac{{\\\\Delta y}}{{\\\\Delta x}})",
      "variables": "What each variable represents and standard SI units",
      "importance": "Where this formula must be applied in exams"
    }},
    {{
      "name": "Formula Name 2",
      "latex": "LaTeX formula 2",
      "variables": "Variable definitions",
      "importance": "Application context"
    }},
    {{
      "name": "Formula Name 3",
      "latex": "LaTeX formula 3",
      "variables": "Variable definitions",
      "importance": "Application context"
    }}
  ],
  "examiner_traps": [
    {{
      "trap": "Common pitfall where 70% of students lose marks",
      "fix": "Exact rule and check to avoid the mistake",
      "exam_type": "Numerical / Conceptual"
    }},
    {{
      "trap": "Secondary pitfall (sign conventions, units, domain limits)",
      "fix": "How to verify in final step",
      "exam_type": "Derivation"
    }}
  ],
  "mnemonics": [
    {{
      "acronym": "S.P.A.R.K",
      "expansion": "Step 1 -> Step 2 -> Step 3 -> Step 4 -> Step 5",
      "tip": "Catchy memory anchor for instant recall during timed exams"
    }}
  ],
  "must_know_questions": [
    {{
      "question": "Most expected 5-mark conceptual derivation or high-yield problem",
      "marks": 5,
      "solution_steps": [
        "Step 1: State assumptions and base laws",
        "Step 2: Mathematical derivation with standard substitutions",
        "Step 3: Final boundary evaluation and SI units statement"
      ]
    }}
  ],
  "golden_rules": [
    "Golden Rule 1: Key invariant or conservation condition",
    "Golden Rule 2: Sign convention rule",
    "Golden Rule 3: Examiner scoring checklist criteria"
  ]
}}"""

    user_prompt = f"Generate complete high-yield exam cheat sheet for '{topic}'. [MANDATORY: Follow language directive strictly]"
    raw_json = await execute_dual_ai_completion(
        sys_prompt=sys_prompt,
        user_prompt=user_prompt,
        custom_key=request.headers.get("x-gemini-key"),
        max_tokens=1200
    )

    if raw_json:
        d = safe_parse_json(raw_json)
        if d:
            formulas = [f"{f.get('name', 'Rule')}: {f.get('latex', '')} ({f.get('variables', '')})" for f in d.get("formula_cards", [])]
            traps = d.get("examiner_traps", [])
            trap_text = f"{traps[0].get('trap', '')} -> {traps[0].get('fix', '')}" if traps else "Check boundary conditions and signs!"
            mnems = d.get("mnemonics", [])
            mnem_text = f"{mnems[0].get('acronym', 'S.P.A.R.K')}: {mnems[0].get('expansion', '')}" if mnems else "S.P.A.R.K Method"
            qs = d.get("must_know_questions", [])
            q_text = qs[0].get("question", f"Derive the fundamental relationship for {topic}.") if qs else f"Derive key theorem in {topic}."

            d["formulas_and_definitions"] = formulas or [f"Core formula for {topic}"]
            d["examiner_trap_warning"] = trap_text
            d["rapid_memory_mnemonic"] = mnem_text
            d["must_know_5mark_question"] = q_text
            return ExamCheatSheetResponse(**d)

    is_hi = req.language.lower().strip() == "hi"
    return ExamCheatSheetResponse(
        topic=topic,
        synopsis=f"{topic} ke mukhya siddhant aur formulas competitive exams ke liye bohot high-yield hain." if not is_hi else f"{topic} के मुख्य सिद्धांत और सूत्र परीक्षाओं के लिए अत्यंत महत्वपूर्ण हैं।",
        formula_cards=[
            FormulaCard(name="Fundamental Law", latex=r"E = mc^2 \quad \text{or} \quad \frac{dy}{dx} = f'(x)", variables="Primary rate/state variables in SI standard units", importance="Core equation tested across multiple choice and derivations"),
            FormulaCard(name="Conservation Condition", latex=r"\sum F = 0 \quad \text{or} \quad \int u \, dv = uv - \int v \, du", variables="Boundary flux and equilibrium coordinates", importance="Applied in equilibrium and boundary condition evaluation"),
            FormulaCard(name="Rate Relationship", latex=r"\Delta Q = m \cdot c \cdot \Delta T", variables="Q = Quantity, c = Coefficient, T = Parameter", importance="Essential for 3-mark and 5-mark numerical problems")
        ],
        examiner_traps=[
            ExaminerTrap(trap=f"Beware of unit mismatch and boundary shifts in {topic} questions!", fix="Always convert to standard SI units before applying formulas.", exam_type="Numerical"),
            ExaminerTrap(trap="Neglecting initial conditions or constant of integration.", fix="Double check boundary constants before finalizing answer.", exam_type="Derivation")
        ],
        mnemonics=[
            MnemonicItem(acronym="S.P.A.R.K", expansion="State -> Parameterize -> Apply Formula -> Resolve -> Keep SI Units", tip="Execute these 5 steps on every exam question for zero lost marks.")
        ],
        must_know_questions=[
            MustKnowQuestion(question=f"Derive the fundamental rate relationship for {topic} and verify with a standard example.", marks=5, solution_steps=["State fundamental conservation axioms", "Apply mathematical substitution and limits", "Conclude with dimensional verification"])
        ],
        golden_rules=[
            "Never skip dimensional check in the final answer step.",
            "Write the governing law by name before substituting numerical values.",
            "Box your final answer with proper SI units."
        ],
        formulas_and_definitions=[f"Fundamental Law: Base equation governing {topic}", "Conservation Rule: Invariance under standard operations"],
        examiner_trap_warning=f"Beware of boundary condition shifts and sign errors in {topic} questions!",
        rapid_memory_mnemonic="S.P.A.R.K: State -> Parameterize -> Apply -> Resolve -> Keep Units",
        must_know_5mark_question=f"Derive the fundamental rate relationship for {topic} with a step-by-step example."
    )

@app.post("/api/blitz-quiz", response_model=BlitzQuizResponse)
@app.post("/blitz-quiz", response_model=BlitzQuizResponse)
async def get_blitz_quiz(req: BlitzQuizRequest, request: Request):
    raw_topic = req.topic.strip()
    if not raw_topic or any(p in raw_topic.lower() for p in ["general science", "problem solving", "choose any topic", "what would you like to learn"]):
        topic = "Core Fundamentals & Applied Concepts"
    else:
        topic = raw_topic
    lang_directive = get_language_directive(req.language)
    q_count = max(4, min(15, req.num_questions))

    sys_prompt = f"""You are a master quiz arena creator designing an intense rapid-fire quiz on: '{topic}'.
Number of Questions: {q_count}
Difficulty: {req.difficulty}
Time Limit: {req.time_limit_seconds} seconds

{lang_directive}

Generate exactly {q_count} multiple-choice questions (3 options each: Option A, B, C).
Return strictly a valid JSON object:
{{
  "topic": "{topic}",
  "questions": [
    {{
      "id": 1,
      "question": "Sharp conceptual question 1?",
      "options": ["Option A", "Option B", "Option C"],
      "correct_index": 0,
      "explanation": "Quick 1-sentence punchy explanation"
    }}
  ],
  "time_limit_seconds": {req.time_limit_seconds}
}}"""

    user_prompt = f"Generate {q_count} rapid-fire quiz questions for '{topic}'. [MANDATORY: Follow language directive strictly]"
    raw_json = await execute_dual_ai_completion(
        sys_prompt=sys_prompt,
        user_prompt=user_prompt,
        custom_key=request.headers.get("x-gemini-key"),
        max_tokens=1100
    )

    if raw_json:
        d = safe_parse_json(raw_json)
        if d and d.get("questions"):
            d["time_limit_seconds"] = req.time_limit_seconds
            return BlitzQuizResponse(**d)

    is_hi = req.language.lower().strip() == "hi"
    is_hinglish = req.language.lower().strip() == "hinglish"
    if is_hinglish:
        q_list = [
            BlitzQuestion(id=1, question=f"Kya {topic} mein conservation laws strictly apply hote hain?", options=["Haan, bilkul", "Nahi, kabhi nahi", "Sirf space mein"], correct_index=0, explanation="Fundamental physics/math laws hamesha apply hote hain!"),
            BlitzQuestion(id=2, question=f"{topic} mein agar primary rate of change zero ho toh kya hoga?", options=["Accelerate karega", "Steady state / Constant rahega", "Collapse ho jayega"], correct_index=1, explanation="Zero rate of change matlab value constant hai."),
            BlitzQuestion(id=3, question=f"{topic} ke calculations mein kaunse units standard hote hain?", options=["SI Base Units", "Arbitrary units", "No units"], correct_index=0, explanation="Hamesha standard SI units use karna chahiye."),
            BlitzQuestion(id=4, question=f"Kya {topic} mein dynamic equilibrium possible hai?", options=["Haan, balanced rates ke saath", "Nahi, sirf static", "Sirf absolute zero par"], correct_index=0, explanation="Opposing rates balance hone par dynamic equilibrium banta hai.")
        ]
    elif is_hi:
        q_list = [
            BlitzQuestion(id=1, question=f"क्या {topic} में संरक्षण के नियम लागू होते हैं?", options=["हाँ, सदैव", "नहीं, कभी नहीं", "केवल अंतरिक्ष में"], correct_index=0, explanation="मूलभूत नियम हमेशा लागू होते हैं!"),
            BlitzQuestion(id=2, question=f"{topic} में परिवर्तन की दर शून्य होने पर क्या स्थिति होती है?", options=["त्वरण", "स्थिर अवस्था / अपरिवर्तित", "पतन"], correct_index=1, explanation="शून्य दर का अर्थ है मान स्थिर है।"),
            BlitzQuestion(id=3, question=f"{topic} में मानक मात्रक कौन से हैं?", options=["SI मानक मात्रक", "कोई भी मात्रक", "मात्रकहीन"], correct_index=0, explanation="हमेशा मानक SI मात्रक का उपयोग करें।"),
            BlitzQuestion(id=4, question=f"क्या {topic} में गतिक साम्यावस्था संभव है?", options=["हाँ, संतुलित दरों के साथ", "नहीं, केवल स्थैतिक", "शून्य तापमान पर"], correct_index=0, explanation="विपरीत प्रक्रियाएं संतुलित होने पर गतिक साम्यावस्था बनती है।")
        ]
    else:
        q_list = [
            BlitzQuestion(id=1, question=f"Is {topic} governed by strict conservation laws?", options=["Yes, always", "No, never", "Only in space"], correct_index=0, explanation="Fundamental laws always apply!"),
            BlitzQuestion(id=2, question=f"What happens if the primary rate of change is zero in {topic}?", options=["Accelerates", "Steady state / Constant", "Collapses"], correct_index=1, explanation="Zero rate of change represents a constant state."),
            BlitzQuestion(id=3, question=f"Which units are standard in {topic}?", options=["SI Base Units", "Arbitrary units", "No units"], correct_index=0, explanation="Always use standard SI units."),
            BlitzQuestion(id=4, question=f"Can dynamic equilibrium be maintained in {topic}?", options=["Yes, with balanced flux", "No, static only", "Only at absolute zero"], correct_index=0, explanation="Dynamic equilibrium balances opposing rates.")
        ]

    return BlitzQuizResponse(topic=topic, questions=q_list[:q_count], time_limit_seconds=req.time_limit_seconds)

@app.post("/api/flashcards", response_model=FlashcardsResponse)
@app.post("/flashcards", response_model=FlashcardsResponse)
async def get_flashcards(req: FlashcardsRequest, request: Request):
    raw_topic = req.topic.strip()
    if not raw_topic or any(p in raw_topic.lower() for p in ["general science", "problem solving", "choose any topic", "what would you like to learn"]):
        topic = "Core Fundamentals & Key Concepts"
    else:
        topic = raw_topic
    lang_directive = get_language_directive(req.language)
    card_count = max(4, min(12, req.count))

    sys_prompt = f"""You are an expert cognitive scientist designing spaced-repetition active-recall flashcards for: '{topic}'.
Total Cards: {card_count}

{lang_directive}

Each flashcard must have:
- front: A sharp question, mystery formula, or conceptual challenge
- back: The concise explanation, key insight, and an intuitive analogy
- category: e.g. "Formula", "Core Rule", "Exam Trap", "Application"
- hint: A 1-line mnemonic or hint

Return strictly a valid JSON object:
{{
  "topic": "{topic}",
  "cards": [
    {{
      "id": 1,
      "front": "What does the derivative represent physically?",
      "back": "The instantaneous rate of change (like a bike speedometer measuring your speed at an exact millisecond).",
      "category": "Core Rule",
      "hint": "Think of speedometer vs average journey time"
    }}
  ]
}}"""

    user_prompt = f"Generate {card_count} high-yield flashcards for '{topic}'. [MANDATORY: Follow language directive strictly]"
    raw_json = await execute_dual_ai_completion(
        sys_prompt=sys_prompt,
        user_prompt=user_prompt,
        custom_key=request.headers.get("x-gemini-key"),
        max_tokens=1000
    )

    if raw_json:
        d = safe_parse_json(raw_json)
        if d and d.get("cards"):
            return FlashcardsResponse(**d)

    is_hi = req.language.lower().strip() == "hi"
    is_hinglish = req.language.lower().strip() == "hinglish"
    if is_hinglish:
        cards = [
            FlashcardItem(id=1, front=f"{topic} ka sabse core concept kya hai?", back="Yeh input aur output ke beech ka predictable mathematical/physical relationship explain karta hai.", category="Core Rule", hint="Socho cause and effect"),
            FlashcardItem(id=2, front=f"{topic} mein sabse badi galti jo students karte hain?", back="Units convert na karna aur boundary limits bhool jana.", category="Exam Trap", hint="SI units check karo"),
            FlashcardItem(id=3, front=f"{topic} ka real-life practical use kya hai?", back="Engineering systems aur real-time decision models ko optimize karne ke liye.", category="Application", hint="Real world engineering"),
            FlashcardItem(id=4, front=f"{topic} ko yaad rakhne ka golden formula?", back="S.P.A.R.K rule: Scope -> Parameters -> Arguments -> Return -> Keep SI Units.", category="Mnemonic", hint="5 letters")
        ]
    elif is_hi:
        cards = [
            FlashcardItem(id=1, front=f"{topic} की मूल अवधारणा क्या है?", back="यह इनपुट और आउटपुट के बीच के गणितीय और भौतिक संबंधों को स्पष्ट करता है।", category="मूल नियम", hint="कारण और परिणाम"),
            FlashcardItem(id=2, front=f"{topic} में छात्र सबसे बड़ी गलती क्या करते हैं?", back="मात्रकों को न बदलना और सीमा सीमाओं की अनदेखी करना।", category="परीक्षा चेतावनी", hint="SI मात्रक जांचें"),
            FlashcardItem(id=3, front=f"{topic} का व्यावहारिक अनुप्रयोग क्या है?", back="इंजीनियरिंग प्रणालियों और अनुकूलन प्रक्रियाओं में।", category="अनुप्रयोग", hint="वास्तविक दुनिया"),
            FlashcardItem(id=4, front=f"{topic} का स्मरण सूत्र क्या है?", back="S.P.A.R.K नियम द्वारा चरणों में समाधान करें।", category="स्मरण सूत्र", hint="5 चरण")
        ]
    else:
        cards = [
            FlashcardItem(id=1, front=f"What is the foundational principle of {topic}?", back="It governs how inputs deterministically map to physical and mathematical outputs.", category="Core Rule", hint="Think cause and effect"),
            FlashcardItem(id=2, front=f"What is the #1 mistake students make in {topic}?", back="Neglecting boundary conditions and unit conversions before calculation.", category="Exam Trap", hint="Check standard SI units"),
            FlashcardItem(id=3, front=f"Where is {topic} applied in real-world systems?", back="Optimizing automated pipelines, control loops, and physical simulators.", category="Application", hint="Modern engineering"),
            FlashcardItem(id=4, front=f"What is the golden exam verification mnemonic for {topic}?", back="S.P.A.R.K: Scope -> Parameters -> Apply -> Resolve -> Keep Units.", category="Mnemonic", hint="5-step checklist")
        ]

    return FlashcardsResponse(topic=topic, cards=cards[:card_count])

@app.post("/api/tts")
@app.post("/tts")
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
# Static Web App Mounts & Dynamic Routing
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

# Root Landing Page
@app.get("/")
@app.get("/index.html")
async def get_landing_page():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"), headers={
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0"
    })

# ClearMind Pro Classroom Cockpit & Workspaces
@app.get("/app")
@app.get("/classroom")
@app.get("/app.html")
@app.get("/cheatsheet")
@app.get("/blitz")
@app.get("/flashcards")
@app.get("/analytics")
@app.get("/galaxy")
@app.get("/graph")
async def get_classroom_page():
    return FileResponse(os.path.join(STATIC_DIR, "app.html"), headers={
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0"
    })

# ClearMind Pro Admin Dashboard
@app.get("/admin")
@app.get("/admin.html")
async def get_admin_page():
    return FileResponse(os.path.join(STATIC_DIR, "admin.html"), headers={
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0"
    })

# Scripts & Styles
@app.get("/landing.css")
async def get_landing_css():
    return FileResponse(os.path.join(STATIC_DIR, "landing.css"), media_type="text/css")

@app.get("/landing.js")
async def get_landing_js():
    return FileResponse(os.path.join(STATIC_DIR, "landing.js"), media_type="application/javascript")

@app.get("/onboarding.js")
async def get_onboarding_js():
    return FileResponse(os.path.join(STATIC_DIR, "onboarding.js"), media_type="application/javascript")

@app.get("/auth.js")
async def get_auth_js():
    return FileResponse(os.path.join(STATIC_DIR, "auth.js"), media_type="application/javascript")

@app.get("/academic_db.json")
async def get_academic_db():
    return FileResponse(os.path.join(STATIC_DIR, "academic_db.json"), media_type="application/json")

@app.get("/app.js")
async def get_app_js():
    return FileResponse(os.path.join(STATIC_DIR, "app.js"), media_type="application/javascript", headers={
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache", "Expires": "0"
    })

@app.get("/style.css")
async def get_style_css():
    return FileResponse(os.path.join(STATIC_DIR, "style.css"), media_type="text/css", headers={
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache", "Expires": "0"
    })

@app.get("/sw.js")
async def get_sw_js():
    return FileResponse(os.path.join(STATIC_DIR, "sw.js"), media_type="application/javascript")

@app.get("/manifest.json")
async def get_manifest():
    return FileResponse(os.path.join(STATIC_DIR, "manifest.json"), media_type="application/json")

# Mount /static directory
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static_dir")


