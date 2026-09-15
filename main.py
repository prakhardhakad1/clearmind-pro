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
import html
from typing import List, Optional, Dict, Any, Literal

import urllib.parse
import sqlite3
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, Request, Response, BackgroundTasks, Depends
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

# --- Allowed browser origins for CORS (comma-separated) ---------------------
# Never use "*" together with allow_credentials=True: Starlette echoes the
# request Origin back, which lets ANY site make credentialed cross-origin calls.
_raw_origins = os.getenv("ALLOWED_ORIGINS", "").strip()
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in _raw_origins.split(",") if o.strip()]
if not ALLOWED_ORIGINS:
    ALLOWED_ORIGINS = [
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:8000", "http://127.0.0.1:8000",
        "http://localhost:5500", "http://127.0.0.1:5500",
    ]

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
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Admin-Token"],
)

@app.middleware("http")
async def add_no_cache_header(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    # Baseline hardening. A strict CSP is deliberately NOT set here: the pages
    # rely on inline <script> blocks and would break without nonce plumbing.
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(self), camera=()"
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

def clean_speech_text(text: str, language: str = "hinglish") -> str:
    """Turn display markup and nested math into plain, speakable text, never SSML."""
    if not text:
        return ""
    hindi = (language or "hinglish").lower().strip() == "hi"
    words = {
        "divide": "भाग" if hindi else "divided by",
        "square": "का वर्ग" if hindi else "squared",
        "cube": "का घन" if hindi else "cubed",
        "power": "की घात" if hindi else "to the power of",
        "root": "वर्गमूल" if hindi else "square root of",
        "group": "राशि" if hindi else "the quantity",
        "end": "राशि समाप्त" if hindi else "end quantity",
    }
    numbers = (
        ["शून्य", "एक", "दो", "तीन", "चार", "पांच", "छह", "सात", "आठ", "नौ"]
        if hindi else ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
    )
    text = re.sub(r"```.*?(?:```|$)", " ", text, flags=re.DOTALL)
    text = html.unescape(text)
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.DOTALL)
    # Tags require a name directly after '<'; the comparison 'x < y' survives.
    text = re.sub(r"</?[A-Za-z][\w:-]*(?:\s+[^<>]*?)?\s*/?>", " ", text)
    text = re.sub(r"!?\[([^\]]+)\]\([^\)]+\)", r"\1", text)
    text = re.sub(r"(?<!\w)_{1,2}(.+?)_{1,2}(?!\w)", r"\1", text)
    text = re.sub(r"(?m)^\s*(?:[-*+]\s+|>\s+)", "", text)
    # Remove complete keycaps and emoji components, including flags and joiners.
    text = re.sub(r"[0-9#*]\ufe0f?\u20e3", " ", text)
    text = re.sub(
        r"[\U0001f000-\U0001faff\U000e0020-\U000e007f\u2600-\u27bf"
        r"\u2300-\u23ff\u2b50\u2b55\ufe0e\ufe0f\u200d\u20e3]", " ", text
    )
    text = re.sub(r"[*#`~]", "", text)
    supers = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿ", "0123456789+-=()n")
    subs = str.maketrans("₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎", "0123456789+-=()")
    text = re.sub(r"[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿ]+", lambda m: "^{" + m[0].translate(supers) + "}", text)
    text = re.sub(r"[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]+", lambda m: "_{" + m[0].translate(subs) + "}", text)
    greek = {
        "alpha": "alpha", "beta": "beta", "gamma": "gamma", "delta": "delta",
        "epsilon": "epsilon", "theta": "theta", "lambda": "lambda", "mu": "mu",
        "pi": "pi", "rho": "rho", "sigma": "sigma", "tau": "tau", "phi": "phi",
        "omega": "omega", "eta": "eta", "nu": "nu", "xi": "xi", "psi": "psi",
    }
    commands = dict(greek, log="log", ln="natural log", sin="sine", cos="cosine", tan="tangent",
                    times="×", cdot="×", div="÷", le="≤", leq="≤", ge="≥", geq="≥",
                    ne="≠", neq="≠", approx="≈", pm="±", infty="∞", to="→",
                    rightarrow="→", sum="summation", int="integral", partial="partial")
    formatting = {"text", "textrm", "textbf", "mathrm", "mathbf", "mathit", "mathcal", "operatorname", "emph"}

    def atom(source, pos):
        while pos < len(source) and source[pos].isspace():
            pos += 1
        if pos == len(source):
            return "", pos
        if source[pos] == "{":
            start, depth = pos + 1, 1
            pos += 1
            while pos < len(source) and depth:
                depth += (source[pos] == "{") - (source[pos] == "}")
                pos += 1
            return source[start:pos - 1 if depth == 0 else pos], pos
        if source[pos] == "\\":
            match = re.match(r"\\[A-Za-z]+", source[pos:])
            if match:
                return match[0], pos + len(match[0])
        return source[pos], pos + 1

    def grouped(value):
        value = value.strip()
        if re.search(r"\s|[+−=<>/×÷-]", value):
            return f"{words['group']} {value} {words['end']}"
        return value

    def parse(source, depth=0):
        # A bounded recursive descent handles nested braces without evaluating input.
        if depth >= 40:
            return re.sub(r"[{}\\]", " ", source)
        result, pos = [], 0
        while pos < len(source):
            char = source[pos]
            if char == "\\":
                match = re.match(r"\\([A-Za-z]+)", source[pos:])
                if not match:
                    pos += 1
                    if pos < len(source) and source[pos] in "()[],$;! ":
                        pos += 1
                    continue
                name = match[1]
                pos += len(match[0])
                if name in {"frac", "dfrac", "tfrac"}:
                    top, pos = atom(source, pos)
                    bottom, pos = atom(source, pos)
                    result.append(f" {grouped(parse(top, depth + 1))} {words['divide']} {grouped(parse(bottom, depth + 1))} ")
                elif name == "sqrt":
                    index = ""
                    if pos < len(source) and source[pos] == "[":
                        end = source.find("]", pos + 1)
                        if end >= 0:
                            index, pos = source[pos + 1:end], end + 1
                    value, pos = atom(source, pos)
                    root = (f"{index} की मूल" if hindi else f"root of order {index} of") if index else words["root"]
                    result.append(f" {root} {grouped(parse(value, depth + 1))} ")
                elif name in formatting:
                    value, pos = atom(source, pos)
                    result.append(" " + parse(value, depth + 1) + " ")
                elif name not in {"left", "right", "quad", "qquad", "displaystyle"}:
                    result.append(" " + commands.get(name, name) + " ")
                continue
            if char == "{":
                value, pos = atom(source, pos)
                result.append(" " + parse(value, depth + 1) + " ")
                continue
            if char in "^_" and pos + 1 < len(source):
                value, pos = atom(source, pos + 1)
                value = parse(value, depth + 1).strip()
                if char == "^":
                    suffix = words["square"] if value == "2" else words["cube"] if value == "3" else words["power"] + " " + grouped(value)
                else:
                    suffix = " ".join(numbers[int(c)] for c in value) if value.isascii() and value.isdigit() else value
                result.append(" " + suffix + " ")
                continue
            if char not in "}$":
                result.append(char)
            pos += 1
        return "".join(result)

    text = parse(text)
    # Balanced scanning avoids cutting O(n log(n)) off at its inner parenthesis.
    def big_o(source):
        result, pos = [], 0
        pattern = re.compile(r"\b(?:Big\s+)?O\s*\(")
        while True:
            match = pattern.search(source, pos)
            if not match:
                result.append(source[pos:])
                break
            end, depth = match.end(), 1
            while end < len(source) and depth:
                depth += (source[end] == "(") - (source[end] == ")")
                end += 1
            if depth:
                result.append(source[pos:])
                break
            result.append(source[pos:match.start()])
            inside = source[match.end():end - 1]
            inside = re.sub(r"\b(log|natural log)\s*\(([^()]+)\)", r"\1 \2", inside)
            result.append(("बिग ओ " if hindi else "Big O of ") + inside)
            pos = end
        return "".join(result)

    text = big_o(text)
    for char, name in zip("αβγδεθλμπρστφωηνξψ", ["alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu", "pi", "rho", "sigma", "tau", "phi", "omega", "eta", "nu", "xi", "psi"]):
        text = text.replace(char, " " + name + " ")
    operators = {
        "<=": ("से छोटा या बराबर", "less than or equal to"), "≤": ("से छोटा या बराबर", "less than or equal to"),
        ">=": ("से बड़ा या बराबर", "greater than or equal to"), "≥": ("से बड़ा या बराबर", "greater than or equal to"),
        "!=": ("के बराबर नहीं", "not equal to"), "≠": ("के बराबर नहीं", "not equal to"),
        "≈": ("लगभग बराबर", "approximately equals"), "=": ("बराबर", "equals"),
        "+": ("जोड़", "plus"), "−": ("घटा", "minus"), "±": ("जोड़ या घटा", "plus or minus"),
        "×": ("गुणा", "times"), "÷": ("भाग", "divided by"),
        "<": ("से छोटा", "less than"), ">": ("से बड़ा", "greater than"),
        "∞": ("अनंत", "infinity"), "→": ("की ओर", "tends to"), "√": ("वर्गमूल", "square root of"),
    }
    text = re.sub("|".join(re.escape(op) for op in operators), lambda m: " " + operators[m[0]][0 if hindi else 1] + " ", text)
    text = re.sub(r"(?<=\w)\s*/\s*(?=\w)", " " + words["divide"] + " ", text)
    text = re.sub(r"\b([A-Za-z])-(?=[A-Za-z]\b)", r"\1 घटा " if hindi else r"\1 minus ", text)
    text = re.sub(r"-(?=\d)|(?<=\w)\s+-\s+(?=\w)|(?<=\d)-(?=\w)", " घटा " if hindi else " minus ", text)
    text = text.replace("_", " ")
    # Keep paragraph boundaries available to the thought chunker.
    paragraphs = [re.sub(r"\s+", " ", paragraph).strip() for paragraph in re.split(r"\n\s*\n", text)]
    return "\n\n".join(paragraph for paragraph in paragraphs if paragraph)

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

VOICE_CANDIDATES = {
    "hinglish": {
        "female": ["en-IN-NeerjaExpressiveNeural", "en-IN-NeerjaNeural", "en-IN-PrabhatNeural"],
        "male": ["en-IN-PrabhatNeural", "hi-IN-MadhurNeural", "en-US-AndrewMultilingualNeural"],
    },
    "hi": {
        "female": ["hi-IN-SwaraNeural", "en-US-AvaMultilingualNeural"],
        "male": ["hi-IN-MadhurNeural", "en-IN-PrabhatNeural", "en-US-AndrewMultilingualNeural"],
    },
    "en": {
        "female": ["en-US-AvaMultilingualNeural", "en-US-JennyNeural"],
        "male": ["en-US-AndrewMultilingualNeural", "en-US-GuyNeural", "en-IN-PrabhatNeural"],
    },
}
MALE_NEURAL_VOICES = {
    "es": "es-ES-AlvaroNeural", "fr": "fr-FR-HenriNeural", "de": "de-DE-ConradNeural",
    "ja": "ja-JP-KeitaNeural", "zh": "zh-CN-YunxiNeural",
}
TTS_ATTEMPT_TIMEOUT = 12.0
TTS_TOTAL_TIMEOUT = 45.0
_TTS_SEMAPHORE = asyncio.Semaphore(3)


def speech_voice_candidates(language: str, voice_gender: str = "female") -> List[str]:
    lang = (language or "hinglish").lower().strip()
    if lang not in NEURAL_VOICES:
        lang = "hinglish"
    if lang in VOICE_CANDIDATES:
        return list(VOICE_CANDIDATES[lang][voice_gender])
    primary = MALE_NEURAL_VOICES[lang] if voice_gender == "male" else NEURAL_VOICES[lang]
    fallback = "en-US-AndrewMultilingualNeural" if voice_gender == "male" else "en-US-AvaMultilingualNeural"
    return [primary, fallback]


def split_speech_thoughts(text: str, max_chars: int = 700) -> List[str]:
    """Split already-verbalized math at thoughts, never at decimals or raw LaTeX."""
    chunks, current = [], ""
    for paragraph in re.split(r"\n\s*\n", text):
        sentences = re.split(r"(?<=[.!?।])\s+", paragraph.strip())
        for sentence in sentences:
            if not sentence:
                continue
            # Only an oversized sentence needs a clause/word boundary fallback.
            pieces = []
            while len(sentence) > max_chars:
                prefix = sentence[:max_chars + 1]
                boundaries = [m.end() for m in re.finditer(r"[,;:]\s+", prefix)]
                cut = boundaries[-1] if boundaries and boundaries[-1] >= max_chars // 2 else prefix.rfind(" ")
                if cut <= 0:
                    cut = max_chars
                pieces.append(sentence[:cut].strip())
                sentence = sentence[cut:].strip()
            if sentence:
                pieces.append(sentence)
            for piece in pieces:
                if current and len(current) + len(piece) + 1 > max_chars:
                    chunks.append(current)
                    current = ""
                current = (current + " " + piece).strip()
                if len(current) >= 260 or (len(current) >= 120 and current.endswith("?")):
                    chunks.append(current)
                    current = ""
        if current and len(current) >= 120:
            chunks.append(current)
            current = ""
    if current:
        chunks.append(current)
    return chunks


def speech_prosody(text: str, expressive: bool = True):
    # edge-tts accepts plain text plus rate/pitch, not custom break/emphasis SSML.
    if expressive and text.rstrip().endswith("?"):
        return "+2%", "+3Hz"
    if expressive and re.search(r"\b(remember|key (?:idea|concept)|important|dhyan|yaad)\b|याद|महत्वपूर्ण", text, re.IGNORECASE):
        return "-1%", "+1Hz"
    if expressive and (":" in text or "the quantity" in text or "राशि" in text):
        return "+0%", "+0Hz"
    return "+3%", "+1Hz"


async def _synthesize_voice_chunk(text: str, voice: str, expressive: bool) -> bytes:
    async def collect():
        rate, pitch = speech_prosody(text, expressive)
        communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        audio = io.BytesIO()
        async for event in communicate.stream():
            if event["type"] == "audio":
                audio.write(event["data"])
        data = audio.getvalue()
        if not data:
            raise ValueError("Empty speech audio")
        return data

    async with _TTS_SEMAPHORE:
        return await asyncio.wait_for(collect(), timeout=TTS_ATTEMPT_TIMEOUT)


async def synthesize_speech(text: str, language: str = "hinglish", voice_gender: str = "female", chunks: bool = False):
    """Generate a complete narration with one consistent voice and a bounded deadline."""
    clean = clean_speech_text(text, language)
    if not clean or not any(char.isalnum() for char in clean):
        raise ValueError("No speakable text")
    thoughts = split_speech_thoughts(clean) if chunks else [clean]

    async def try_voices():
        timed_out = False
        for voice in speech_voice_candidates(language, voice_gender):
            tasks = [asyncio.create_task(_synthesize_voice_chunk(thought, voice, chunks)) for thought in thoughts]
            try:
                audio = await asyncio.gather(*tasks)
                actual_gender = "male" if voice in {
                    "en-IN-PrabhatNeural", "hi-IN-MadhurNeural", "en-US-AndrewMultilingualNeural", "en-US-GuyNeural",
                    *MALE_NEURAL_VOICES.values(),
                } else "female"
                return {
                    "chunks": [
                        {"audio_base64": base64.b64encode(data).decode("ascii"),
                         "pause_after_ms": 220 if index < len(audio) - 1 else 0, "voice": voice}
                        for index, data in enumerate(audio)
                    ],
                    "speech_text": clean,
                    "voice_gender": actual_gender,
                }
            except asyncio.TimeoutError:
                timed_out = True
                logger.info("Speech provider attempt timed out for voice %s", voice)
            except Exception as exc:
                logger.info("Speech provider attempt failed for voice %s (%s)", voice, type(exc).__name__)
            finally:
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
        if timed_out:
            raise asyncio.TimeoutError("Speech provider timed out")
        raise RuntimeError("Speech provider unavailable")

    return await asyncio.wait_for(try_voices(), timeout=TTS_TOTAL_TIMEOUT)


async def synthesize_edge_audio_base64(text: str, language: str = "hinglish", voice_gender: str = "female") -> Optional[str]:
    """Use the same full-text voice selection and limits for legacy chat audio."""
    try:
        narration = await synthesize_speech(text, language, voice_gender)
        return narration["chunks"][0]["audio_base64"]
    except Exception as exc:
        logger.info("Chat speech unavailable (%s)", type(exc).__name__)
        return None

class AnalogyCard(BaseModel):
    title: str = Field(description="Vivid real-world analogy title")
    description: str = Field(description="Clear explanation of the concept using everyday physical metaphor")

class ChatTeachRequest(BaseModel):
    # Every field is bounded: these endpoints proxy straight into a paid LLM API.
    topic: str = Field("", max_length=200)
    message: str = Field(..., max_length=4000)
    conversation_history: List[Dict[str, str]] = []
    language: str = Field("hinglish", max_length=16)
    student_name: str = Field("Student", max_length=60)
    level: str = Field("College / University", max_length=60)
    mode: str = Field("direct", max_length=16) # "direct" or "socratic"
    persona: Optional[str] = Field("mentor", max_length=32)
    image_base64: Optional[str] = Field(None, max_length=3500000)  # ~2.5 MB of binary
    include_audio: bool = True
    voice_gender: Literal["female", "male"] = "female"

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

# Dynamic Curriculum Auto-Set Models
class CurriculumAutoSetRequest(BaseModel):
    user_id: Optional[str] = "CMP-STUDENT"
    name: Optional[str] = ""
    identity: str = "school"
    level: str = "Class 12"
    board: str = "CBSE"
    stream: Optional[str] = None
    subjects: List[Any] = []
    persona: str = "mentor"
    target_goal: Optional[str] = ""
    sub_details: Optional[Dict[str, Any]] = None

class ConceptNode(BaseModel):
    id: str
    name: str
    category: str
    strength: float = 0.5
    stability: int = 1
    lastReview: int = 0
    reviews: int = 0
    color: str = "#a78bfa"
    connections: List[str] = []

class SyllabusChapter(BaseModel):
    id: str
    subject: str
    name: str
    topics: List[str] = []
    status: str = "todo"

class CurriculumAutoSetResponse(BaseModel):
    ok: bool = True
    active_topic: str
    chapters: List[SyllabusChapter]
    concepts: List[ConceptNode]
    summary: str

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
    topic: str = Field("Introduction to Python", max_length=200)
    language: str = Field("hinglish", max_length=16)
    level: str = Field("College / University", max_length=60)

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
    topic: str = Field("Introduction to Python", max_length=200)
    language: str = Field("hinglish", max_length=16)
    num_questions: int = Field(8, ge=1, le=30)
    time_limit_seconds: int = Field(60, ge=10, le=3600)
    difficulty: str = Field("Standard", max_length=32)

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
    topic: str = Field("Introduction to Python", max_length=200)
    language: str = Field("hinglish", max_length=16)
    count: int = Field(6, ge=1, le=40)

class FlashcardsResponse(BaseModel):
    topic: str
    cards: List[FlashcardItem]

class TTSRequest(BaseModel):
    text: str = Field(..., max_length=5000)
    language: str = Field("hinglish", max_length=16)
    voice_gender: Literal["female", "male"] = "female"
    response_format: Literal["mp3", "chunks"] = "mp3"



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
        # Seed or update default admin credentials.
        #
        # SECURITY: the admin password used to be a hardcoded literal here, which
        # means it lives in git history and must be treated as compromised.
        # Rotate it by setting ADMIN_PASSWORD in the environment. When it is not
        # set we leave any existing admin hash untouched rather than restoring a
        # publicly-known value; if no admin exists yet we mint a random one.
        now = datetime.now(timezone.utc).isoformat()
        admin_password = os.getenv("ADMIN_PASSWORD", "").strip()
        cursor.execute("SELECT id FROM users WHERE email = 'admin@clearmind.ai' OR user_id = 'CMP-ADMIN'")
        existing_admin = cursor.fetchone()
        if not admin_password and existing_admin:
            logger.info("ADMIN_PASSWORD not set - leaving existing admin credentials unchanged.")
            conn.commit()
            conn.close()
            return
        if not admin_password:
            admin_password = secrets.token_urlsafe(16)
            logger.warning(
                "ADMIN_PASSWORD not set - generated a random admin password for this "
                "boot. Set ADMIN_PASSWORD in the environment to make it permanent."
            )
        admin_pwd_hash = hash_password(admin_password)
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

# NOTE: init_db() is invoked at the bottom of this file. It depends on
# hash_password(), which is defined further down, so calling it here would
# raise NameError at import time.

# Turso Cloud (LibSQL) Cloud Resilience Tier (AWS AP South Mumbai)
TURSO_DB_URL = os.getenv("TURSO_DB_URL", "https://clearmind-db-prakhardhakad1.aws-ap-south-1.turso.io")
# SECURITY: a Turso auth token used to be hardcoded here as an os.getenv fallback.
# It is committed in git history, so it must be treated as compromised:
#   1. Rotate the token in the Turso dashboard.
#   2. Put the new one in .env / Render as TURSO_AUTH_TOKEN.
# Never re-add a credential literal to this file.
TURSO_AUTH_TOKEN = os.getenv("TURSO_AUTH_TOKEN", "").strip()
if not TURSO_AUTH_TOKEN:
    logger.error(
        "TURSO_AUTH_TOKEN is not set - durable sync to Turso is DISABLED. "
        "Accounts created now will be lost on restart."
    )

def turso_sync_records(statements: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Background task to sync database records permanently to Turso Cloud in Mumbai."""
    try:
        if not TURSO_DB_URL or not TURSO_AUTH_TOKEN:
            return None
        pipeline_url = TURSO_DB_URL.strip().replace("libsql://", "https://").rstrip("/") + "/v2/pipeline"
        reqs = []
        for stmt in statements:
            sql = stmt["sql"]
            args = stmt.get("args", [])
            typed_args = []
            for a in args:
                if a is None:
                    typed_args.append({"type": "null"})
                elif isinstance(a, int):
                    typed_args.append({"type": "integer", "value": str(a)})
                elif isinstance(a, float):
                    typed_args.append({"type": "float", "value": a})
                else:
                    typed_args.append({"type": "text", "value": str(a)})
            reqs.append({"type": "execute", "stmt": {"sql": sql, "args": typed_args}})
        
        body = json.dumps({"requests": reqs}).encode("utf-8")
        req = urllib.request.Request(pipeline_url, data=body, headers={
            "Authorization": f"Bearer {TURSO_AUTH_TOKEN}",
            "Content-Type": "application/json"
        })
        with urllib.request.urlopen(req, timeout=4) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as he:
        try:
            err_msg = he.read().decode("utf-8")
        except Exception:
            err_msg = str(he)
        logger.warning(f"Turso HTTPError {he.code}: {err_msg}")
        return {"error": f"HTTP {he.code}: {err_msg}"}
    except Exception as e:
        logger.warning(f"Turso sync notice: {e}")
        return {"error": str(e)}

def fetch_user_from_turso(login_id: str) -> Optional[Dict[str, Any]]:
    """Fetches user and persona from Turso Cloud on cold-start and caches into local SQLite."""
    try:
        if not TURSO_DB_URL or not TURSO_AUTH_TOKEN:
            return None
        pipeline_url = TURSO_DB_URL.strip().replace("libsql://", "https://").rstrip("/") + "/v2/pipeline"
        body = json.dumps({
            "requests": [
                {
                    "type": "execute",
                    "stmt": {
                        "sql": "SELECT user_id, name, email, password_hash, role, created_at FROM users WHERE lower(email) = ? OR upper(user_id) = ?",
                        "args": [{"type": "text", "value": login_id.lower()}, {"type": "text", "value": login_id.upper()}]
                    }
                },
                {
                    "type": "execute",
                    "stmt": {
                        "sql": "SELECT persona, identity, level, board, daily_rhythm, target_goal, subjects, sub_details, learning_styles, updated_at FROM user_profiles WHERE user_id = (SELECT user_id FROM users WHERE lower(email) = ? OR upper(user_id) = ?)",
                        "args": [{"type": "text", "value": login_id.lower()}, {"type": "text", "value": login_id.upper()}]
                    }
                }
            ]
        }).encode("utf-8")
        req = urllib.request.Request(pipeline_url, data=body, headers={
            "Authorization": f"Bearer {TURSO_AUTH_TOKEN}",
            "Content-Type": "application/json"
        })
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            results = data.get("results", [])
            if len(results) >= 2:
                u_res = results[0].get("response", {}).get("result", {})
                p_res = results[1].get("response", {}).get("result", {})
                u_rows = u_res.get("rows", [])
                p_rows = p_res.get("rows", [])
                if u_rows:
                    u_vals = [c.get("value") for c in u_rows[0]]
                    p_vals = [c.get("value") for c in p_rows[0]] if p_rows else None
                    # Cache in local SQLite
                    try:
                        conn = sqlite3.connect(get_db_path())
                        cursor = conn.cursor()
                        cursor.execute("""
                            INSERT OR REPLACE INTO users (user_id, name, email, password_hash, role, created_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                        """, tuple(u_vals))
                        if p_vals:
                            cursor.execute("""
                                INSERT OR REPLACE INTO user_profiles (user_id, persona, identity, level, board, daily_rhythm, target_goal, subjects, sub_details, learning_styles, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """, (u_vals[0], *p_vals))
                        conn.commit()
                        conn.close()
                    except Exception as cache_err:
                        logger.warning(f"Cache write error: {cache_err}")
                    return {"user": u_vals, "profile": p_vals}
        return None
    except Exception as e:
        logger.warning(f"Turso fetch error: {e}")
        return None

def sync_turso_to_local_cache():
    """Sync all users from Turso Cloud into local cache for admin reporting."""
    try:
        if not TURSO_DB_URL or not TURSO_AUTH_TOKEN:
            return
        pipeline_url = TURSO_DB_URL.strip().replace("libsql://", "https://").rstrip("/") + "/v2/pipeline"
        body = json.dumps({
            "requests": [
                {
                    "type": "execute",
                    "stmt": {
                        "sql": "SELECT u.user_id, u.name, u.email, u.password_hash, u.role, u.created_at, p.persona, p.identity, p.level, p.board, p.daily_rhythm, p.target_goal, p.subjects, p.sub_details, p.learning_styles, p.updated_at FROM users u LEFT JOIN user_profiles p ON u.user_id = p.user_id"
                    }
                }
            ]
        }).encode("utf-8")
        req = urllib.request.Request(pipeline_url, data=body, headers={
            "Authorization": f"Bearer {TURSO_AUTH_TOKEN}",
            "Content-Type": "application/json"
        })
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            rows = data.get("results", [])[0].get("response", {}).get("result", {}).get("rows", [])
            if not rows:
                return
            conn = sqlite3.connect(get_db_path())
            cursor = conn.cursor()
            turso_uids = []
            for r in rows:
                v = [c.get("value") for c in r]
                turso_uids.append(v[0])
                cursor.execute("""
                    INSERT OR REPLACE INTO users (user_id, name, email, password_hash, role, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (v[0], v[1], v[2], v[3], v[4], v[5]))
                if v[6] is not None:
                    cursor.execute("""
                        INSERT OR REPLACE INTO user_profiles (user_id, persona, identity, level, board, daily_rhythm, target_goal, subjects, sub_details, learning_styles, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (v[0], v[6] or "mentor", v[7] or "school", v[8] or "Class 12", v[9] or "CBSE", v[10] or "45 mins / day", v[11] or "", v[12] or "[]", v[13] or "{}", v[14] or "[]", v[15] or ""))
            
            # If records were deleted from Turso, delete them from local cache as well.
            # Guard: a partial or truncated remote response must never be able to
            # wipe the local cache, so sanity-check the row count before pruning.
            if turso_uids:
                cursor.execute("SELECT COUNT(*) FROM users")
                local_count = cursor.fetchone()[0] or 0
                if local_count and len(turso_uids) < local_count * 0.5:
                    logger.warning(
                        "Refusing to prune local cache: Turso returned %d users but %d exist "
                        "locally. Skipping destructive sync.", len(turso_uids), local_count
                    )
                else:
                    placeholders = ",".join(["?"] * len(turso_uids))
                    cursor.execute(f"DELETE FROM users WHERE user_id NOT IN ({placeholders})", turso_uids)
                    cursor.execute(f"DELETE FROM user_profiles WHERE user_id NOT IN ({placeholders})", turso_uids)
            conn.commit()
            conn.close()
    except Exception as e:
        logger.warning(f"Turso cache sync notice: {e}")

# Password hashing: PBKDF2-HMAC-SHA256 with a per-password random salt.
# Legacy unsalted SHA-256 hashes are still accepted once and then transparently
# upgraded to the new format on first successful login (see verify_password).
PBKDF2_ITERATIONS = 200000

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return "pbkdf2_sha256${}${}${}".format(
        PBKDF2_ITERATIONS,
        base64.b64encode(salt).decode("utf-8"),
        base64.b64encode(dk).decode("utf-8"),
    )

def _legacy_sha256(password: str) -> str:
    return hashlib.sha256(password.strip().encode("utf-8")).hexdigest()

def verify_password(password: str, stored: str) -> bool:
    """Constant-time check against either the new PBKDF2 or the legacy SHA-256 format."""
    if not stored:
        return False
    if stored.startswith("pbkdf2_sha256$"):
        try:
            _, iters, salt_b64, dk_b64 = stored.split("$")
            dk = hashlib.pbkdf2_hmac(
                "sha256", password.encode("utf-8"), base64.b64decode(salt_b64), int(iters)
            )
            return hmac.compare_digest(base64.b64encode(dk).decode("utf-8"), dk_b64)
        except Exception:
            return False
    return hmac.compare_digest(stored, _legacy_sha256(password))

def needs_password_upgrade(stored: str) -> bool:
    return not (stored or "").startswith("pbkdf2_sha256$")

def upgrade_user_password(user_id: str, password: str) -> None:
    """Re-hash a legacy SHA-256 password into PBKDF2 in the local cache and Turso."""
    try:
        new_hash = hash_password(password)
        conn = sqlite3.connect(get_db_path())
        conn.execute("UPDATE users SET password_hash = ? WHERE user_id = ?", (new_hash, user_id))
        conn.commit()
        conn.close()
        turso_sync_records([{
            "sql": "UPDATE users SET password_hash = ? WHERE user_id = ?",
            "args": [new_hash, user_id],
        }])
    except Exception as e:
        logger.warning(f"Password upgrade skipped for {user_id}: {e}")

def generate_user_id() -> str:
    num = secrets.randbelow(90000) + 10000
    return f"CMP-{num}"

EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$')

def is_valid_email(email: str) -> bool:
    if not email or len(email) > 254:
        return False
    if not EMAIL_REGEX.match(email):
        return False
    parts = email.split('@')
    if len(parts) != 2:
        return False
    domain = parts[1]
    if '.' not in domain or domain.startswith('.') or domain.endswith('.'):
        return False
    tld = domain.split('.')[-1]
    if len(tld) < 2 or not tld.isalpha():
        return False
    return True

class UserRegisterRequest(BaseModel):
    name: str = Field(..., max_length=80)
    email: str = Field(..., max_length=254)
    password: str = Field(..., min_length=6, max_length=200)
    persona: Optional[str] = Field("mentor", max_length=32)
    level: Optional[str] = Field("Class 12", max_length=40)

class UserLoginRequest(BaseModel):
    email: str = Field(..., max_length=254)
    password: str = Field(..., max_length=200)

class AdminLoginRequest(BaseModel):
    user_id: str = Field(..., max_length=64)
    password: str = Field(..., max_length=200)

ADMIN_SESSION_SECRET = os.getenv("ADMIN_SESSION_SECRET", "").strip()
if not ADMIN_SESSION_SECRET:
    # Fail closed. Never fall back to a publicly-known constant: a random
    # per-process secret means old tokens simply stop validating on restart.
    ADMIN_SESSION_SECRET = secrets.token_urlsafe(48)
    logger.warning(
        "ADMIN_SESSION_SECRET is not set - generated an ephemeral one. "
        "Admin sessions will not survive a restart. Set it in .env / Render."
    )

ADMIN_TOKEN_TTL_SECONDS = int(os.getenv("ADMIN_TOKEN_TTL_SECONDS", "28800"))  # 8 hours
ADMIN_UIDS = ("CMP-ADMIN", "admin@clearmind.ai")

def _sign(payload: str, secret: Optional[str] = None) -> str:
    return hmac.new(
        (secret or ADMIN_SESSION_SECRET).encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

def _b64e(raw: str) -> str:
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8").rstrip("=")

def _b64d(raw: str) -> str:
    return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode("utf-8")

def make_admin_token(admin_uid: str) -> str:
    """Signed, expiring admin token: base64(uid:expires_at).hmac_sha256"""
    payload = f"{admin_uid}:{int(time.time()) + ADMIN_TOKEN_TTL_SECONDS}"
    return f"{_b64e(payload)}.{_sign(payload)}"

def verify_admin_token(token: str) -> bool:
    if not token or "." not in token:
        return False
    raw, _, sig = token.rpartition(".")
    try:
        payload = _b64d(raw)
        uid, expires_at = payload.rsplit(":", 1)
    except Exception:
        return False
    if not hmac.compare_digest(sig, _sign(payload)):
        return False
    if int(expires_at) < int(time.time()):
        return False
    return uid in ADMIN_UIDS

def verify_admin_auth(request: Request) -> bool:
    auth_header = request.headers.get("authorization", "")
    token = ""
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    elif request.headers.get("x-admin-token"):
        token = request.headers.get("x-admin-token").strip()
    return verify_admin_token(token)

class SyncProfileRequest(BaseModel):
    user_id: str = Field(..., max_length=64)
    name: Optional[str] = Field(None, max_length=80)
    persona: Optional[str] = Field("mentor", max_length=32)
    identity: Optional[str] = "school"
    level: Optional[str] = "Class 12"
    board: Optional[str] = "CBSE"
    daily_rhythm: Optional[str] = "45 mins / day"
    target_goal: Optional[str] = ""
    subjects: Optional[List[Any]] = []
    sub_details: Optional[Dict[str, Any]] = {}
    learning_styles: Optional[List[str]] = []

class GoogleAuthSyncRequest(BaseModel):
    # `credential` is the Google ID token. It is REQUIRED: identity is taken from
    # the verified token, never from these client-supplied fields.
    credential: Optional[str] = Field(None, max_length=4096)
    name: str = Field(..., max_length=80)
    email: str = Field(..., max_length=254)
    avatar: Optional[str] = Field("", max_length=500)
    sub: Optional[str] = Field("", max_length=100)

# ---------------------------------------------------------------------------
# Session tokens & rate limiting
# ---------------------------------------------------------------------------
STUDENT_SESSION_SECRET = os.getenv("STUDENT_SESSION_SECRET", "").strip() or ADMIN_SESSION_SECRET
STUDENT_TOKEN_TTL_SECONDS = int(os.getenv("STUDENT_TOKEN_TTL_SECONDS", "2592000"))  # 30 days
GUEST_TOKEN_TTL_SECONDS = int(os.getenv("GUEST_TOKEN_TTL_SECONDS", "3600"))         # 1 hour

def make_session_token(user_id: str, ttl: int = None) -> str:
    payload = "s:{}:{}".format(user_id, int(time.time()) + (ttl or STUDENT_TOKEN_TTL_SECONDS))
    return "{}.{}".format(_b64e(payload), _sign(payload, STUDENT_SESSION_SECRET))

def get_session_user_id(token: str) -> Optional[str]:
    if not token or "." not in token:
        return None
    raw, _, sig = token.rpartition(".")
    try:
        payload = _b64d(raw)
        kind, user_id, expires_at = payload.split(":", 2)
    except Exception:
        return None
    if kind != "s" or not hmac.compare_digest(sig, _sign(payload, STUDENT_SESSION_SECRET)):
        return None
    if int(expires_at) < int(time.time()):
        return None
    return user_id

def get_bearer_token(request: Request) -> str:
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:].strip()
    return (request.headers.get("x-session-token") or "").strip()

async def require_session(request: Request) -> str:
    """Dependency: reject unless the call carries a valid (student or guest) session token."""
    uid = get_session_user_id(get_bearer_token(request))
    if not uid:
        raise HTTPException(
            status_code=401,
            detail="session_expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return uid

# --- Sliding-window rate limiter -------------------------------------------
# In-memory / per-process: correct for a single-instance deploy. If you ever run
# more than one instance, move this to Redis (or Turso) so limits are shared.
_RATE_BUCKETS: Dict[str, List[float]] = {}
_RATE_LOCK = asyncio.Lock()

async def rate_limit(request: Request, key: str, limit: int, window: float = 60.0) -> None:
    client = request.client.host if request.client else "unknown"
    bucket_key = "{}:{}".format(key, client)
    now = time.monotonic()
    async with _RATE_LOCK:
        hits = [t for t in _RATE_BUCKETS.get(bucket_key, []) if now - t < window]
        if len(hits) >= limit:
            _RATE_BUCKETS[bucket_key] = hits
            raise HTTPException(status_code=429, detail="Too many requests. Please slow down.")
        hits.append(now)
        _RATE_BUCKETS[bucket_key] = hits
        if len(_RATE_BUCKETS) > 10000:  # bound memory: drop fully-expired buckets
            for k in [k for k, v in _RATE_BUCKETS.items() if not v or now - v[-1] > window]:
                _RATE_BUCKETS.pop(k, None)

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
async def auth_register(req: UserRegisterRequest, background_tasks: BackgroundTasks, request: Request):
    await rate_limit(request, "register", limit=5, window=3600.0)
    # sqlite3 is blocking; run it in a worker so it cannot stall the event loop
    return await asyncio.to_thread(_auth_register_sync, req)


def _auth_register_sync(req: UserRegisterRequest):
    email_clean = req.email.strip().lower()
    name_clean = req.name.strip()
    if not email_clean or not req.password:
        raise HTTPException(status_code=400, detail="Email and password are required.")
    
    if not is_valid_email(email_clean):
        raise HTTPException(status_code=400, detail="Please enter a valid email address (e.g. name@domain.com).")
        
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long.")
    
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT user_id FROM users WHERE lower(email) = ?", (email_clean,))
    existing = cursor.fetchone()
    if not existing:
        turso_data = fetch_user_from_turso(email_clean)
        if turso_data and turso_data.get("user"):
            existing = turso_data["user"]
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
    now = datetime.now(timezone.utc).isoformat()
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
    
    # Permanent sync to Turso Cloud (AWS Mumbai)
    sync_result = turso_sync_records([
        {
            "sql": "INSERT OR REPLACE INTO users (user_id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'student', ?)",
            "args": [user_id, name_clean or email_clean.split('@')[0], email_clean, pwd_hash, now]
        },
        {
            "sql": "INSERT OR REPLACE INTO user_profiles (user_id, persona, identity, level, board, daily_rhythm, target_goal, subjects, updated_at) VALUES (?, ?, 'school', ?, 'CBSE', '45 mins / day', 'Board & Entrance Exams', ?, ?)",
            "args": [user_id, req.persona or "mentor", req.level or "Class 12", default_subjects, now]
        }
    ])

    # Turso is the durable store and the local DB is an ephemeral cache. If the
    # durable write fails the account would silently vanish on the next cold
    # start, so surface it instead of reporting success.
    if sync_result and sync_result.get("error"):
        logger.error(f"Durable sync failed for {user_id}: {sync_result['error']}")
        raise HTTPException(
            status_code=503,
            detail="Could not save your account to the cloud database. Please try again.",
        )

    return {
        "status": "success",
        "session_token": make_session_token(user_id),
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
async def auth_login(req: UserLoginRequest, request: Request):
    await rate_limit(request, "login", limit=10, window=300.0)
    return await asyncio.to_thread(_auth_login_sync, req)


def _auth_login_sync(req: UserLoginRequest):
    login_id_clean = req.email.strip()
    if not login_id_clean or not req.password:
        raise HTTPException(status_code=400, detail="Email/User ID and password are required.")
    
    is_email = is_valid_email(login_id_clean.lower())
    is_uid = bool(re.match(r'^CMP-[A-Za-z0-9]+$', login_id_clean))
    
    if not is_email and not is_uid:
        raise HTTPException(status_code=400, detail="Please enter a valid email address or User ID.")
        
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT user_id, name, email, password_hash, role, created_at
        FROM users WHERE lower(email) = ? OR upper(user_id) = ?
    """, (login_id_clean.lower(), login_id_clean.upper()))
    user_row = cursor.fetchone()
    
    # Cold-start resilience: If not in local /tmp SQLite, check Turso Cloud (Mumbai)
    turso_data = None
    if not user_row:
        turso_data = fetch_user_from_turso(login_id_clean)
        if turso_data and turso_data.get("user"):
            user_row = tuple(turso_data["user"])
    
    if not user_row or not verify_password(req.password, user_row[3]):
        conn.close()
        raise HTTPException(status_code=401, detail="Invalid email/ID or password.")
    
    user_id = user_row[0]
    # Transparently upgrade legacy unsalted SHA-256 hashes on first successful login
    if needs_password_upgrade(user_row[3]):
        upgrade_user_password(user_id, req.password)
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
        "session_token": make_session_token(user_id),
        "user": {
            "user_id": user_id,
            "name": user_row[1],
            "email": user_row[2],
            "role": user_row[4],
            "created_at": user_row[5]
        },
        "profile": profile_data
    }

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()

async def verify_google_id_token(credential: Optional[str]) -> Dict[str, Any]:
    """Verify a Google ID token server-side.

    Without this, /api/auth/google trusts a client-supplied email and hands out
    a session for ANY account - a complete authentication bypass.
    """
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=503,
            detail="Google sign-in is not configured on this server (GOOGLE_CLIENT_ID missing).",
        )
    if not credential:
        raise HTTPException(status_code=401, detail="Missing Google credential.")
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"id_token": credential},
            )
    except Exception as e:
        logger.warning(f"Google token verification request failed: {e}")
        raise HTTPException(status_code=503, detail="Could not verify Google credential.")
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google credential.")
    claims = resp.json()
    if claims.get("aud") != GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=401, detail="Google credential audience mismatch.")
    if str(claims.get("email_verified", "false")).lower() not in ("true", "1"):
        raise HTTPException(status_code=401, detail="Google email is not verified.")
    if not claims.get("email"):
        raise HTTPException(status_code=401, detail="Google credential has no email.")
    return claims

@app.post("/api/auth/google")
@app.post("/auth/google")
async def auth_google(req: GoogleAuthSyncRequest, background_tasks: BackgroundTasks, request: Request):
    await rate_limit(request, "google", limit=10, window=300.0)
    claims = await verify_google_id_token(req.credential)
    return await asyncio.to_thread(_auth_google_sync, req, claims)


def _auth_google_sync(req: GoogleAuthSyncRequest, claims: Dict[str, Any]):
    # Identity comes from the verified token, never from the request body.
    email_clean = (claims.get("email") or "").strip().lower()
    name_clean = (claims.get("name") or req.name or email_clean.split('@')[0]).strip()

    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT user_id, name, email, role, created_at
        FROM users WHERE lower(email) = ?
    """, (email_clean,))
    user_row = cursor.fetchone()
    
    # Cold-start resilience: if not in local /tmp SQLite, check Turso Cloud (Mumbai)
    if not user_row:
        turso_data = fetch_user_from_turso(email_clean)
        if turso_data and turso_data.get("user"):
            u_vals = turso_data["user"]
            user_row = (u_vals[0], u_vals[1], u_vals[2], u_vals[4], u_vals[5])
    
    now = datetime.now(timezone.utc).isoformat()
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
        
        # Permanent sync to Turso Cloud (AWS Mumbai)
        turso_sync_records([
            {
                "sql": "INSERT OR REPLACE INTO users (user_id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'student', ?)",
                "args": [user_id, name_clean, email_clean, pwd_hash, now]
            },
            {
                "sql": "INSERT OR REPLACE INTO user_profiles (user_id, persona, identity, level, board, daily_rhythm, target_goal, subjects, updated_at) VALUES (?, 'mentor', 'school', 'Class 12', 'CBSE', '45 mins / day', 'Board & Entrance Exams', ?, ?)",
                "args": [user_id, default_subjects, now]
            }
        ])
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
        "session_token": make_session_token(user_id),
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

@app.post("/api/auth/sync-profile", dependencies=[Depends(require_session)])
@app.post("/auth/sync-profile", dependencies=[Depends(require_session)])
async def sync_profile(
    req: SyncProfileRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    uid: str = Depends(require_session),
):
    if not req.user_id:
        raise HTTPException(status_code=400, detail="User ID is required.")

    # user_id is client-supplied. Without this check anyone could overwrite
    # another account's profile (and previously mint a session for it).
    if uid != req.user_id and not verify_admin_auth(request):
        raise HTTPException(status_code=403, detail="Not authorized to modify this profile.")
    return await asyncio.to_thread(_sync_profile_sync, req)


def _sync_profile_sync(req: SyncProfileRequest):
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    now = datetime.now(timezone.utc).isoformat()
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
    
    # Sync persona & profile updates to Turso Cloud (Mumbai) permanently in background
    turso_stmts = []
    if req.name:
        turso_stmts.append({
            "sql": "UPDATE users SET name = ? WHERE user_id = ?",
            "args": [req.name.strip(), req.user_id]
        })
    turso_stmts.append({
        "sql": """INSERT INTO user_profiles (user_id, persona, identity, level, board, daily_rhythm, target_goal, subjects, sub_details, learning_styles, updated_at)
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
                      updated_at = excluded.updated_at""",
        "args": [
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
        ]
    })
    turso_sync_records(turso_stmts)
    
    # NOTE: no session_token here. Issuing one for a client-supplied user_id was
    # an account-takeover path; sessions are only minted by the login routes.
    return {"status": "success", "user_id": req.user_id, "updated_at": now}

@app.post("/api/auth/guest")
@app.post("/auth/guest")
async def auth_guest(request: Request):
    """Short-lived anonymous session for the public landing-page demo.

    Keeps /api/chat-teach authenticated without shipping a static token to the
    browser: the guest id is random and the token expires in an hour.
    """
    await rate_limit(request, "guest", limit=20, window=3600.0)
    guest_id = "GUEST-" + secrets.token_hex(8)
    return {
        "status": "success",
        "session_token": make_session_token(guest_id, ttl=GUEST_TOKEN_TTL_SECONDS),
        "user_id": guest_id,
    }

def build_fallback_curriculum(identity: str, level: str, board: str, stream: Optional[str], subjects: List[str]) -> Dict[str, Any]:
    """Generates clean curriculum syllabus and 2D prerequisite tree based on academic taxonomy."""
    palette = ["#a78bfa", "#f0abfc", "#22d3ee", "#34d399", "#fbbf24", "#fb7185", "#60a5fa"]
    lower_subs = [s.lower() for s in subjects]
    
    is_class_10 = "10" in level or "secondary" in level.lower()
    is_college_cse = any(x in s for s in lower_subs for x in ["computer", "data structure", "algorithm", "operating system", "python", "software"])
    is_pcb = any("bio" in s for s in lower_subs) or "pcb" in (stream or "").lower()
    
    chapters = []
    concepts = []
    
    if is_class_10:
        chapters = [
            {"id": "ch-1", "subject": "Mathematics", "name": "Real Numbers & Polynomials", "topics": ["Fundamental Theorem of Arithmetic", "Zeroes of Polynomials", "Quadratic Equations"], "status": "todo"},
            {"id": "ch-2", "subject": "Mathematics", "name": "Triangles & Trigonometry", "topics": ["Similarity Theorems", "Trigonometric Ratios", "Trigonometric Identities"], "status": "todo"},
            {"id": "ch-3", "subject": "Science", "name": "Chemical Reactions & Equations", "topics": ["Types of Chemical Reactions", "Oxidation & Reduction", "Acids, Bases & Salts"], "status": "todo"},
            {"id": "ch-4", "subject": "Science", "name": "Light & Electricity", "topics": ["Reflection & Refraction", "Lens Formula & Power", "Ohm's Law & Circuit Analysis"], "status": "todo"}
        ]
        raw_concepts = [
            ("real_numbers", "Real Numbers & Primes", "Mathematics", []),
            ("polynomials", "Polynomials & Roots", "Mathematics", ["real_numbers"]),
            ("quadratics", "Quadratic Equations", "Mathematics", ["polynomials"]),
            ("trig_ratios", "Trigonometric Ratios", "Mathematics", ["quadratics"]),
            ("chemical_eqs", "Chemical Equations & Balancing", "Science", []),
            ("acids_bases", "Acids, Bases & Salts", "Science", ["chemical_eqs"]),
            ("light_optics", "Light Reflection & Refraction", "Science", []),
            ("electricity_ohm", "Ohm's Law & Circuits", "Science", ["light_optics"])
        ]
    elif is_college_cse:
        chapters = [
            {"id": "ch-1", "subject": "Data Structures", "name": "Linear Data Structures & Complexity", "topics": ["Asymptotic Big-O Analysis", "Arrays & Memory Alignment", "Singly & Doubly Linked Lists"], "status": "todo"},
            {"id": "ch-2", "subject": "Algorithms", "name": "Recursion, Trees & Graphs", "topics": ["Divide & Conquer", "Binary Search Trees & AVL", "Graph Traversals (BFS/DFS)"], "status": "todo"},
            {"id": "ch-3", "subject": "Operating Systems", "name": "Process Management & Concurrency", "topics": ["Process Lifecycle & PCB", "CPU Scheduling Algorithms", "Mutexes, Semaphores & Deadlocks"], "status": "todo"},
            {"id": "ch-4", "subject": "Databases & Networks", "name": "Relational Modeling & Protocols", "topics": ["ER Models & Normalization", "Indexing & Transactions", "TCP/IP & Sockets"], "status": "todo"}
        ]
        raw_concepts = [
            ("memory_pointers", "Memory Pointers & References", "Data Structures", []),
            ("arrays_lists", "Arrays & Linked Lists", "Data Structures", ["memory_pointers"]),
            ("stacks_queues", "Stacks & Queues", "Data Structures", ["arrays_lists"]),
            ("recursion_dsa", "Recursion & Call Stacks", "Algorithms", ["stacks_queues"]),
            ("trees_bst", "Binary Search Trees & Balancing", "Algorithms", ["recursion_dsa"]),
            ("graphs_algo", "Graph Algorithms (BFS/DFS)", "Algorithms", ["trees_bst"]),
            ("processes_threads", "Processes & Multithreading", "Operating Systems", ["memory_pointers"]),
            ("sync_deadlocks", "Semaphores & Deadlock Prevention", "Operating Systems", ["processes_threads"])
        ]
    elif is_pcb:
        chapters = [
            {"id": "ch-1", "subject": "Biology / NEET", "name": "Cell Biology & Biomolecules", "topics": ["Cell Structure & Organelles", "Cell Cycle & Mitosis", "Proteins, Enzymes & Lipids"], "status": "todo"},
            {"id": "ch-2", "subject": "Biology / NEET", "name": "Genetics & Molecular Biology", "topics": ["Mendelian Inheritance", "DNA Replication & Transcription", "Genetic Code & Translation"], "status": "todo"},
            {"id": "ch-3", "subject": "Physics", "name": "Mechanics & Fluid Statics", "topics": ["Kinematics & Vectors", "Newton's Laws & Friction", "Viscosity & Bernoulli's Principle"], "status": "todo"},
            {"id": "ch-4", "subject": "Chemistry", "name": "Structure of Atom & Chemical Bonding", "topics": ["Quantum Numbers & Orbitals", "Hybridization & VSEPR Theory", "Thermodynamics & Equilibrium"], "status": "todo"}
        ]
        raw_concepts = [
            ("cell_structure", "Cell Organelles & Membranes", "Biology", []),
            ("cell_cycle", "Mitosis & Meiosis", "Biology", ["cell_structure"]),
            ("dna_transcription", "DNA Replication & Transcription", "Biology", ["cell_cycle"]),
            ("mendel_genetics", "Mendelian Inheritance", "Biology", ["dna_transcription"]),
            ("atomic_orbitals", "Atomic Orbitals & Quantum Numbers", "Chemistry", []),
            ("chemical_bonds", "Chemical Bonding & VSEPR", "Chemistry", ["atomic_orbitals"]),
            ("vectors_physics", "Vectors & Motion in 1D", "Physics", []),
            ("newton_mechanics", "Newton's Laws & Momentum", "Physics", ["vectors_physics"])
        ]
    else: # Standard PCM / General STEM
        s0 = subjects[0] if subjects else "Physics"
        s1 = subjects[1] if len(subjects) > 1 else "Mathematics"
        s2 = subjects[2] if len(subjects) > 2 else "Chemistry"
        chapters = [
            {"id": "ch-1", "subject": s0, "name": "Kinematics & Newton's Laws", "topics": ["Vectors & Coordinate Systems", "Equations of Motion", "Free-Body Diagrams & Friction"], "status": "todo"},
            {"id": "ch-2", "subject": s1, "name": "Calculus & Limits", "topics": ["Intuitive Limits & Continuity", "Derivatives & Chain Rule", "Maxima & Minima Optimization"], "status": "todo"},
            {"id": "ch-3", "subject": s2, "name": "Chemical Bonding & Structure", "topics": ["Lewis Structures & Formal Charge", "Hybridization & Molecular Geometry", "Intermolecular Forces"], "status": "todo"},
            {"id": "ch-4", "subject": s0, "name": "Energy, Momentum & Collisions", "topics": ["Work-Energy Theorem", "Conservation of Linear Momentum", "Elastic & Inelastic Collisions"], "status": "todo"}
        ]
        raw_concepts = [
            ("algebra_coords", "Algebra & Coordinate Systems", s1, []),
            ("trig_foundations", "Trigonometric Identities", s1, ["algebra_coords"]),
            ("limits_continuity", "Limits & Continuity", s1, ["trig_foundations"]),
            ("derivatives_diff", "Derivatives & Rate of Change", s1, ["limits_continuity"]),
            ("integrals_calc", "Definite & Indefinite Integrals", s1, ["derivatives_diff"]),
            ("vectors_scalars", "Vectors & Vector Addition", s0, ["algebra_coords"]),
            ("kinematics_1d", "1D & 2D Kinematics", s0, ["vectors_scalars"]),
            ("newton_forces", "Newton's Laws & Free-Body Forces", s0, ["kinematics_1d"]),
            ("work_energy_thm", "Work-Energy Theorem & Power", s0, ["newton_forces"]),
            ("atomic_orbitals_gen", "Electronic Configurations & Orbitals", s2, []),
            ("covalent_bonding", "Covalent Bonding & Hybridization", s2, ["atomic_orbitals_gen"])
        ]
    
    for idx, (cid, cname, ccat, cconns) in enumerate(raw_concepts):
        concepts.append({
            "id": cid,
            "name": cname,
            "category": ccat,
            "strength": 0.5,
            "stability": 1,
            "lastReview": 0,
            "reviews": 0,
            "color": palette[idx % len(palette)],
            "connections": cconns
        })
        
    active_topic = chapters[0]["topics"][0] if chapters and chapters[0].get("topics") else (chapters[0]["name"] if chapters else "Foundations")
    return {
        "ok": True,
        "active_topic": active_topic,
        "chapters": chapters,
        "concepts": concepts,
        "summary": f"Curriculum calibrated for {level} ({board}) with {len(subjects)} subjects."
    }

@app.post("/api/curriculum/auto-set", response_model=CurriculumAutoSetResponse, dependencies=[Depends(require_session)])
@app.post("/curriculum/auto-set", response_model=CurriculumAutoSetResponse, dependencies=[Depends(require_session)])
async def auto_set_curriculum(req: CurriculumAutoSetRequest, background_tasks: BackgroundTasks, request: Request):
    await rate_limit(request, "curriculum", limit=20, window=60.0)
    """
    Intelligently auto-sets syllabus chapters, starting topic, and 2D prerequisite tree
    tailored to the student's exact academic tier, grade, board, and selected subjects.
    """
    clean_subjects: List[str] = []
    for s in (req.subjects or []):
        if isinstance(s, str) and s.strip():
            clean_subjects.append(s.strip())
        elif isinstance(s, dict) and s.get("name"):
            clean_subjects.append(str(s["name"]).strip())
            
    if not clean_subjects:
        if req.stream and "pcm" in req.stream.lower():
            clean_subjects = ["Physics", "Chemistry", "Mathematics"]
        elif req.stream and "pcb" in req.stream.lower():
            clean_subjects = ["Physics", "Chemistry", "Biology"]
        elif "10" in req.level:
            clean_subjects = ["Mathematics", "Science"]
        else:
            clean_subjects = ["Core Concepts", "Foundational Principles"]

    curriculum_data = None
    
    # Try fast Dual-Engine AI race (Gemini 3.6 Flash / GLM-4 failover)
    sys_prompt = f"""You are the ClearMind Pro Curriculum Engine.
Generate an accurate, high-yield academic syllabus roadmap and a 2D prerequisite dependency tree for this student.
Student Level: {req.level}
Board/University: {req.board}
Identity: {req.identity}
Stream/Specialization: {req.stream or 'Standard'}
Tracked Subjects: {', '.join(clean_subjects)}
Target Milestone: {req.target_goal or 'Exams'}

Return strictly a valid JSON object matching this schema:
{{
  "active_topic": "Specific starting topic name (e.g. 'Vectors & 1D Kinematics' or 'Limits & Continuity')",
  "chapters": [
    {{
      "id": "ch-1",
      "subject": "Subject Name",
      "name": "Chapter Title",
      "topics": ["Subtopic 1", "Subtopic 2", "Subtopic 3"],
      "status": "todo"
    }}
  ],
  "concepts": [
    {{
      "id": "slug_id",
      "name": "Topic Name",
      "category": "Subject Name",
      "strength": 0.5,
      "stability": 1,
      "lastReview": 0,
      "reviews": 0,
      "color": "#a78bfa",
      "connections": ["prerequisite_slug_id"]
    }}
  ],
  "summary": "1-sentence summary of calibrated curriculum"
}}
CRITICAL RULES:
1. 'concepts' MUST contain 8 to 14 foundational topics across the student's tracked subjects.
2. 'connections' must represent genuine PREREQUISITES (e.g. 'derivatives' requires 'limits').
3. Keep colors from ['#a78bfa', '#f0abfc', '#22d3ee', '#34d399', '#fbbf24', '#fb7185', '#60a5fa'].
4. Strictly return JSON only."""

    try:
        user_prompt = f"Calibrate complete syllabus and prerequisite graph for {req.level} {req.board} ({', '.join(clean_subjects)})."
        ai_resp = await asyncio.wait_for(execute_dual_ai_completion(sys_prompt, user_prompt, max_tokens=1800), timeout=5.5)
        if ai_resp:
            parsed = safe_parse_json(ai_resp)
            if parsed and isinstance(parsed, dict) and parsed.get("chapters") and parsed.get("concepts"):
                curriculum_data = {
                    "ok": True,
                    "active_topic": str(parsed.get("active_topic") or clean_subjects[0]),
                    "chapters": parsed.get("chapters") or [],
                    "concepts": parsed.get("concepts") or [],
                    "summary": str(parsed.get("summary") or f"Calibrated for {req.level}")
                }
    except Exception as e:
        logger.info(f"AI curriculum auto-set fallback triggered: {e}")

    if not curriculum_data:
        curriculum_data = build_fallback_curriculum(req.identity, req.level, req.board, req.stream, clean_subjects)

    # Persist updated profile in SQLite & Turso Cloud
    if req.user_id:
        try:
            now = datetime.now(timezone.utc).isoformat()
            db_path = get_db_path()
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            if req.name and req.name.strip():
                cursor.execute("UPDATE users SET name = ? WHERE user_id = ?", (req.name.strip(), req.user_id))
            
            subjects_json = json.dumps(clean_subjects)
            sub_details_json = json.dumps(req.sub_details or {})
            cursor.execute("""
                INSERT INTO user_profiles (user_id, persona, identity, level, board, daily_rhythm, target_goal, subjects, sub_details, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    persona = excluded.persona,
                    identity = excluded.identity,
                    level = excluded.level,
                    board = excluded.board,
                    daily_rhythm = excluded.daily_rhythm,
                    target_goal = excluded.target_goal,
                    subjects = excluded.subjects,
                    sub_details = excluded.sub_details,
                    updated_at = excluded.updated_at
            """, (
                req.user_id,
                req.persona or "mentor",
                req.identity or "school",
                req.level or "Class 12",
                req.board or "CBSE",
                "45 mins / day",
                req.target_goal or "Exams",
                subjects_json,
                sub_details_json,
                now
            ))
            conn.commit()
            conn.close()
            
            turso_stmts = [{
                "sql": """INSERT INTO user_profiles (user_id, persona, identity, level, board, daily_rhythm, target_goal, subjects, sub_details, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                          ON CONFLICT(user_id) DO UPDATE SET
                              persona = excluded.persona,
                              identity = excluded.identity,
                              level = excluded.level,
                              board = excluded.board,
                              daily_rhythm = excluded.daily_rhythm,
                              target_goal = excluded.target_goal,
                              subjects = excluded.subjects,
                              sub_details = excluded.sub_details,
                              updated_at = excluded.updated_at""",
                "args": [
                    req.user_id,
                    req.persona or "mentor",
                    req.identity or "school",
                    req.level or "Class 12",
                    req.board or "CBSE",
                    "45 mins / day",
                    req.target_goal or "Exams",
                    subjects_json,
                    sub_details_json,
                    now
                ]
            }]
            turso_sync_records(turso_stmts)
        except Exception as err:
            logger.warning(f"Error persisting auto-set profile: {err}")

    return CurriculumAutoSetResponse(**curriculum_data)

@app.post("/api/admin/login")
@app.post("/admin/login")
async def admin_login(req: AdminLoginRequest, request: Request):
    await rate_limit(request, "admin_login", limit=5, window=300.0)
    return await asyncio.to_thread(_admin_login_sync, req)


def _admin_login_sync(req: AdminLoginRequest):
    uid_clean = req.user_id.strip()
    
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
    
    if not row or not verify_password(req.password, row[3]):
        raise HTTPException(status_code=401, detail="Invalid Admin User ID or Password.")
    
    if needs_password_upgrade(row[3]):
        upgrade_user_password(row[0], req.password)
    
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
    return await asyncio.to_thread(_admin_metrics_sync)


def _admin_metrics_sync():
    # Aggregate fresh records from Turso Cloud
    sync_turso_to_local_cache()
    
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
        "database_location": f"Turso LibSQL (AWS Mumbai) + Local Cache ({db_path})"
    }

@app.get("/api/admin/users")
@app.get("/admin/users")
async def admin_users(request: Request):
    if not verify_admin_auth(request):
        raise HTTPException(status_code=401, detail="Unauthorized. Admin authentication required.")
    return await asyncio.to_thread(_admin_users_sync)


def _admin_users_sync():
    # Aggregate fresh records from Turso Cloud
    sync_turso_to_local_cache()
    
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

@app.post("/api/chat-teach", response_model=ChatTeachResponse, dependencies=[Depends(require_session)])
@app.post("/chat-teach", response_model=ChatTeachResponse, dependencies=[Depends(require_session)])
async def chat_teach(req: ChatTeachRequest, request: Request):
    await rate_limit(request, "chat", limit=30, window=60.0)
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
            speech = clean_speech_text(d.get("speech_text") or reply, req.language)
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

            audio = await synthesize_edge_audio_base64(speech, req.language, req.voice_gender) if req.include_audio else None

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
            speech = clean_speech_text(f"Namaste {req.student_name}! Aaj aap kaunsa topic seekhna chahte hain?", req.language)
        elif lang == "hi":
            dyn_reply = f"नमस्ते **{req.student_name}**! 🌸 मैं हूँ **लूना**, आपकी एआई शिक्षिका। आज आप कौन सा विषय या अध्याय पढ़ना चाहते हैं?"
            speech = clean_speech_text(f"नमस्ते {req.student_name}! आज आप कौन सा विषय पढ़ना चाहते हैं?", req.language)
        else:
            dyn_reply = f"Hello **{req.student_name}**! 🌸 I am **Luna**, your AI personal tutor. What subject or chapter would you like to master today? For example: **Relations & Functions**, **Calculus**, or **Thermodynamics**?"
            speech = clean_speech_text(f"Hello {req.student_name}! What topic would you like to master today?", req.language)
        display_topic = ""
        suggested = ["Maths: Relations & Functions 📐", "Physics: Newton's Laws ⚛️", "Chemistry: Thermodynamics 🧪"]
        card = None
    elif is_broad_subject:
        if lang == "hinglish":
            dyn_reply = f"Wah! **{clean_msg.title()}** ek bohot hi interesting aur important subject hai. Lekin isme kaafi chapters hain — aap specific kaunsa chapter ya topic seekhna chahte hain? Jaise:\n- **Relations and Functions**\n- **Calculus & Derivatives**\n- **Matrices & Determinants**\n- **Trigonometry**\n\nMujhe specific topic batayein aur hum turant shuru karte hain!"
            speech = clean_speech_text(f"Wah! {clean_msg.title()} mein aap specific kaunsa topic seekhna chahte hain?", req.language)
        else:
            dyn_reply = f"Great choice! **{clean_msg.title()}** is a vast and fascinating subject. Which specific topic or chapter would you like to focus on? For example:\n- **Relations & Functions**\n- **Calculus & Derivatives**\n- **Core Laws & Axioms**\n\nTell me the specific topic and we'll dive right in!"
            speech = clean_speech_text(f"Great! Which specific topic in {clean_msg.title()} would you like to study?", req.language)
        display_topic = ""
        suggested = ["Relations & Functions 📐", "Calculus Derivatives 📈", "Matrices & Vectors 🔢"]
        card = None
    elif dyn_topic:
        if lang == "hinglish":
            dyn_reply = f"Bohot badhiya sawaal hai **{req.student_name}**! Chalo **{dyn_topic}** ko bilkul aasan aur interesting tarike se master karte hain.\n\nIs concept mein core principles mathematically aur physically real-world systems se connect hote hain. Hum isko 4 key milestones mein cover karenge: Foundations, Core Mechanisms, Practical Application, aur Examiner Traps!"
            speech = clean_speech_text(f"Bohot badhiya sawaal {req.student_name}! Chalo {dyn_topic} ko samajhte hain.", req.language)
            card_title = f"💡 {dyn_topic} ki Real-Life Intuition"
            card_desc = f"{dyn_topic} ko ek automated system ki tarah socho jahan har input ka ek exact, predictable output hota hai."
            suggested = [f"Explain {dyn_topic} formulas", f"{dyn_topic} ka everyday analogy 💡", "Start 60s Blitz ⏱️"]
        else:
            dyn_reply = f"Awesome question **{req.student_name}**! Let's master **{dyn_topic}** together. We will explore core principles, key mechanisms, and real-world intuition step-by-step!"
            speech = clean_speech_text(f"Awesome question {req.student_name}! Let's master {dyn_topic} together.", req.language)
            card_title = f"💡 {dyn_topic} Intuition"
            card_desc = f"Think of {dyn_topic} like an automated system where fundamental rules produce predictable, elegant outcomes."
            suggested = [f"Explain {dyn_topic} formulas", f"Give an everyday {dyn_topic} analogy 💡", "Start 60s Blitz ⏱️"]
        display_topic = dyn_topic
        card = {"title": card_title, "description": card_desc}
    else:
        dyn_reply = f"Bohot badhiya **{req.student_name}**! Chalo is concept ko bilkul aasan real-world analogies aur step-by-step logic se master karte hain."
        speech = clean_speech_text(f"Bohot badhiya {req.student_name}! Chalo ise step-by-step samajhte hain.", req.language)
        display_topic = ""
        suggested = ["Give an everyday analogy 💡", "Step-by-step derivation 📐", "Test me with Blitz ⏱️"]
        card = None

    audio = await synthesize_edge_audio_base64(speech, req.language, req.voice_gender) if req.include_audio else None
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

@app.post("/api/exam-cheat-sheet", response_model=ExamCheatSheetResponse, dependencies=[Depends(require_session)])
@app.post("/exam-cheat-sheet", response_model=ExamCheatSheetResponse, dependencies=[Depends(require_session)])
async def get_exam_cheat_sheet(req: ExamCheatSheetRequest, request: Request):
    await rate_limit(request, "cheatsheet", limit=20, window=60.0)
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

@app.post("/api/blitz-quiz", response_model=BlitzQuizResponse, dependencies=[Depends(require_session)])
@app.post("/blitz-quiz", response_model=BlitzQuizResponse, dependencies=[Depends(require_session)])
async def get_blitz_quiz(req: BlitzQuizRequest, request: Request):
    await rate_limit(request, "blitz", limit=20, window=60.0)
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

@app.post("/api/flashcards", response_model=FlashcardsResponse, dependencies=[Depends(require_session)])
@app.post("/flashcards", response_model=FlashcardsResponse, dependencies=[Depends(require_session)])
async def get_flashcards(req: FlashcardsRequest, request: Request):
    await rate_limit(request, "flashcards", limit=20, window=60.0)
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

@app.post("/api/tts", dependencies=[Depends(require_session)])
@app.post("/tts", dependencies=[Depends(require_session)])
async def generate_tts(req: TTSRequest, request: Request):
    await rate_limit(request, "tts", limit=30, window=60.0)
    try:
        narration = await synthesize_speech(req.text, req.language, req.voice_gender, req.response_format == "chunks")
        if req.response_format == "chunks":
            return narration
        return PlainResponse(
            content=base64.b64decode(narration["chunks"][0]["audio_base64"]), media_type="audio/mpeg",
            headers={"X-Voice-Name": narration["chunks"][0]["voice"], "X-Voice-Gender": narration["voice_gender"]},
        )
    except ValueError:
        raise HTTPException(status_code=422, detail="No speakable text") from None
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Voice synthesis timed out. Please try again.") from None
    except Exception as exc:
        logger.warning("TTS endpoint unavailable (%s)", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Voice synthesis unavailable. Please try again.") from None

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
@app.get("/motion")
@app.get("/studio")
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

@app.get("/polish.css")
async def get_polish_css():
    return FileResponse(os.path.join(STATIC_DIR, "polish.css"), media_type="text/css")

@app.get("/polish.js")
async def get_polish_js():
    return FileResponse(os.path.join(STATIC_DIR, "polish.js"), media_type="application/javascript")

@app.get("/manifest.json")
async def get_manifest():
    return FileResponse(os.path.join(STATIC_DIR, "manifest.json"), media_type="application/json")

# Mount /static directory
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static_dir")

# Create tables and seed the admin account. Runs last because it needs the
# password-hashing helpers defined above.
init_db()


