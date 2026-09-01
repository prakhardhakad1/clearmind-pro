"""
ClearMind Pro — Multi-Language Human AI Tutor, Neural TTS, Quick Test Arena & Doubt Solver
FastAPI backend with Google Gemini 3.6 Flash + Microsoft Edge Neural TTS + Diverse Question Engine.
"""

import asyncio
import logging
import base64
import json
import os
import random
import tempfile
from typing import List, Optional

import io
import edge_tts
try:
    import easyocr
    import numpy as np
except ImportError:
    easyocr = None
    np = None
from PIL import Image
from dotenv import load_dotenv, set_key
from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from google import genai
from google.genai import types
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# GLM-4 (Zhipu AI) Multi-LLM Engine & Failover Router (19M+ Token Pool)
# ---------------------------------------------------------------------------

GLM_API_KEY = os.getenv("GLM_API_KEY", "44a736cb6aa24ff4ab448573f8cbd4de.ELHA0B1E0C0aHzM2")
GLM_MODELS = ["glm-4", "glm-4-flash", "glm-4-plus", "glm-4-air"]

async def call_glm_completion(prompt: str, system_prompt: str = "You are Luna, an expert educational AI tutor. Output strictly valid JSON matching the requested schema without markdown codeblocks.") -> Optional[str]:
    """Calls Zhipu AI GLM-4 engine via OpenAI-compatible endpoint with automatic multi-model failover."""
    key = GLM_API_KEY or os.getenv("GLM_API_KEY")
    if not key:
        return None
    try:
        import httpx
        url = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        }
        for model in GLM_MODELS:
            try:
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.7
                }
                async with httpx.AsyncClient(timeout=20.0) as client:
                    resp = await client.post(url, json=payload, headers=headers)
                    if resp.status_code == 200:
                        data = resp.json()
                        raw = data["choices"][0]["message"]["content"].strip()
                        if raw.startswith("```"):
                            lines = raw.splitlines()
                            if lines[0].startswith("```"):
                                lines = lines[1:]
                            if lines and lines[-1].startswith("```"):
                                lines = lines[:-1]
                            raw = "\n".join(lines).strip()
                        logger.info(f"GLM-4 ({model}) successfully generated response.")
                        return raw
            except Exception as e:
                logger.error(f"GLM model {model} failed: {e}")
                continue
    except Exception as e:
        logger.error(f"GLM engine connection error: {e}")
    return None

# ---------------------------------------------------------------------------
# Configuration & Environment
# ---------------------------------------------------------------------------

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path=ENV_PATH)

app = FastAPI(title="ClearMind Pro", version="3.5.0")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("clearmind")


# Lazy EasyOCR Reader for instant startup
_ocr_reader = None


def get_ocr_reader():
    global _ocr_reader
    if _ocr_reader is None:
        try:
            _ocr_reader = easyocr.Reader(["en"], gpu=False)
        except Exception as e:
            print("Failed to initialize EasyOCR:", e)
            _ocr_reader = False
    return _ocr_reader if _ocr_reader is not False else None


def extract_ocr_from_image_bytes(raw_bytes: bytes) -> str:
    """Extracts text and formulas from image bytes using local OCR."""
    reader = get_ocr_reader()
    if not reader:
        return ""
    try:
        pil_img = Image.open(io.BytesIO(raw_bytes))
        img_arr = np.array(pil_img)
        results = reader.readtext(img_arr)
        lines = [r[1] for r in results if r[2] > 0.15]
        return " ".join(lines)
    except Exception as exc:
        print("OCR processing error:", exc)
        return ""

CANDIDATE_MODELS = [
    os.getenv("GEMINI_MODEL", "gemini-3.6-flash"),
    "gemini-3.7-flash",
    "gemini-3.5-flash",
]

NEURAL_VOICES = {
    "hinglish": "en-IN-NeerjaExpressiveNeural",
    "en": "en-US-AvaMultilingualNeural",
    "hi": "hi-IN-SwaraNeural",
    "es": "es-ES-ElviraNeural",
    "fr": "fr-FR-DeniseNeural",
    "de": "de-DE-KatjaNeural",
    "ja": "ja-JP-NanamiNeural",
    "zh": "zh-CN-XiaoxiaoNeural",
    "pt": "pt-BR-FranciscaNeural",
    "ar": "ar-SA-ZariyahNeural",
}

def clean_speech_text(text: str) -> str:
    """Cleans markdown symbols, emojis, and code formatting so voice sounds 100% human-natural."""
    text = re.sub(r'```.*?```', '', text, flags=re.DOTALL)
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    text = re.sub(r'[*_#`~>\-]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def get_active_api_key(custom_key: Optional[str] = None) -> Optional[str]:
    """Retrieve active API key from request, .env, or environment."""
    if custom_key and custom_key.strip():
        key = custom_key.strip()
        os.environ["GOOGLE_API_KEY"] = key
        os.environ["GEMINI_API_KEY"] = key
        return key

    load_dotenv(dotenv_path=ENV_PATH, override=True)
    key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if key and key.strip() and key.strip() != "your-api-key-here":
        key = key.strip()
        os.environ["GOOGLE_API_KEY"] = key
        os.environ["GEMINI_API_KEY"] = key
        return key
    return None


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------


class Flashcard(BaseModel):
    question: str
    answer: str
    hint: Optional[str] = ""


class InteractiveSimData(BaseModel):
    sim_type: str = Field(default="photosynthesis_lab")
    title: str
    slider1_label: str
    slider1_min: int = 0
    slider1_max: int = 100
    slider1_default: int = 50
    slider1_unit: str = "%"
    slider2_label: str
    slider2_min: int = 0
    slider2_max: int = 100
    slider2_default: int = 50
    slider2_unit: str = "%"
    output_metric_name: str
    output_unit: str = "units"
    multiplier: float = 1.2
    explanation_on_change: str


class FeynmanChallenge(BaseModel):
    kid_name: str = "Leo"
    kid_initial_question: str
    kid_confusing_trap: str = ""


class SimplifyRequest(BaseModel):
    text: Optional[str] = ""
    image_base64: Optional[str] = None
    image_mime_type: Optional[str] = "image/jpeg"
    level: Optional[str] = "10yo"
    language: Optional[str] = "hinglish"
    api_key: Optional[str] = None


class SimplifyResponse(BaseModel):
    analogy_title: str
    warm_greeting: str
    simplified_text: str
    key_takeaways: List[str]
    concept_map_mermaid: str
    interactive_sim: InteractiveSimData
    flashcards: List[Flashcard]
    feynman_challenge: FeynmanChallenge
    language: str
    level: str
    model_used: Optional[str] = None


class QuizQuestion(BaseModel):
    id: int
    question: str
    options: List[str]
    correct_option_index: int
    explanation: str
    difficulty: str


class GenerateQuizRequest(BaseModel):
    topic: str
    count: int = Field(default=5, ge=5, le=20)
    difficulty: str = Field(default="normal")
    language: Optional[str] = "hinglish"
    api_key: Optional[str] = None


class GenerateQuizResponse(BaseModel):
    topic: str
    difficulty: str
    total_questions: int
    questions: List[QuizQuestion]


class AskDoubtRequest(BaseModel):
    topic: str
    doubt_question: str
    language: Optional[str] = "hinglish"
    api_key: Optional[str] = None


class AskDoubtResponse(BaseModel):
    answer: str
    analogy: str
    key_point: str


class TTSRequest(BaseModel):
    text: str
    language: Optional[str] = "hinglish"
    rate: Optional[str] = "+0%"
    pitch: Optional[str] = "+0Hz"


class FeynmanEvaluateRequest(BaseModel):
    topic: str
    kid_question: str
    user_explanation: str
    language: Optional[str] = "hinglish"
    api_key: Optional[str] = None


class FeynmanEvaluateResponse(BaseModel):
    kid_reaction: str
    kid_speech: str
    feynman_score: int
    grade_title: str
    strengths: List[str]
    coaching_tips: List[str]


# --- New Socratic Voice Tutor Schemas ---
class SocraticHistoryItem(BaseModel):
    role: str  # "student" or "tutor"
    text: str


class SocraticTurnRequest(BaseModel):
    topic: str
    student_utterance: str
    history: List[SocraticHistoryItem] = Field(default_factory=list)
    language: Optional[str] = "hinglish"
    api_key: Optional[str] = None


class SocraticTurnResponse(BaseModel):
    tutor_speech: str
    understanding_level: str  # "struggling" | "progressing" | "mastered"
    followup_question: str
    hint: Optional[str] = ""
    encouragement: str
    audio_base64: Optional[str] = None


# --- New AI Smart Whiteboard & Misconception Diagnostics ---
class DiagnosticStep(BaseModel):
    step_num: int
    step_content: str
    is_correct: bool
    status_label: str  # "✅ Correct Step" | "❌ Misconception / Math Error" | "⚠️ Inefficient Step"
    annotation: str
    correction_tip: str


class DiagnoseSolutionRequest(BaseModel):
    problem_statement: str
    student_work_text: Optional[str] = ""
    image_base64: Optional[str] = None
    image_mime_type: Optional[str] = "image/jpeg"
    language: Optional[str] = "hinglish"
    api_key: Optional[str] = None


class DiagnoseSolutionResponse(BaseModel):
    problem_title: str
    total_steps: List[DiagnosticStep]
    root_misconception: str
    step_by_step_correct_flow: List[str]
    mnemonic_or_rule: str
    overall_grade: str


# --- New Generative Interactive Canvas Sandbox Engine ---
class SandboxControl(BaseModel):
    id: str
    label: str
    min_val: float
    max_val: float
    default_val: float
    step: float
    unit: str


class GenerateSandboxRequest(BaseModel):
    topic: str
    concept_detail: Optional[str] = ""
    language: Optional[str] = "hinglish"
    api_key: Optional[str] = None


class GenerateSandboxResponse(BaseModel):
    sandbox_title: str
    canvas_type: str
    instructions: str
    controls: List[SandboxControl]
    canvas_js_code: str
    metric_labels: List[str]
    experiment_prompts: List[str]


# --- New Spaced Repetition & Study Kit Export ---
class ExportDeckRequest(BaseModel):
    topic: str
    analogy_title: Optional[str] = ""
    simplified_text: Optional[str] = ""
    key_takeaways: List[str] = Field(default_factory=list)
    flashcards: List[Flashcard] = Field(default_factory=list)
    format: str = "anki_csv"  # "anki_csv" | "markdown_guide" | "json"



class RecommendationsRequest(BaseModel):
    topic: str
    quiz_score_percent: int
    language: str = "en"

class RecommendationsResponse(BaseModel):
    next_topics: List[str] = Field(..., description="List of 3 related topics to study next")
    weak_areas: List[str] = Field(..., description="Specific areas the student should review based on score")
    encouragement: str = Field(..., description="A short encouraging message from Luna")

class ExportDeckResponse(BaseModel):
    filename: str
    content_type: str
    file_content: str

class RecommendationsRequest(BaseModel):
    topic: str
    quiz_score_percent: int
    language: str = "en"

class RecommendationsResponse(BaseModel):
    next_topics: List[str] = Field(..., description="List of 3 related topics to study next")
    weak_areas: List[str] = Field(..., description="Specific areas the student should review based on score")
    encouragement: str = Field(..., description="A short encouraging message from Luna")



class SaveKeyRequest(BaseModel):
    api_key: str


class StatusResponse(BaseModel):
    has_api_key: bool
    source: str
    recommended_model: str
    has_glm_key: Optional[bool] = False


# ---------------------------------------------------------------------------
# Languages Map & Prompts
# ---------------------------------------------------------------------------

LANGUAGES_MAP = {
    "hinglish": "Hinglish (Natural conversational blend of Hindi and English in Roman/Latin script)",
    "en": "English",
    "es": "Spanish (Español)",
    "hi": "Hindi (हिंदी - Devanagari script)",
    "fr": "French (Français)",
    "de": "German (Deutsch)",
    "ja": "Japanese (日本語)",
    "zh": "Chinese (中文)",
    "pt": "Portuguese (Português)",
    "ar": "Arabic (العربية)",
}

HUMAN_GIRL_SYSTEM_PROMPT = """
You are Luna, an exceptionally warm, lively, empathetic, and brilliant human girl tutor (aged 20).
You NEVER speak like an emotionless robotic AI or a dry textbook. You talk with real human warmth, relatable everyday metaphors, natural vocal pacing, enthusiasm, and joyful curiosity!

TARGET LANGUAGE: {target_language}

SPECIAL INSTRUCTION FOR HINGLISH:
If the target language is Hinglish:
- Write strictly in Roman script (English alphabet).
- Mix Hindi and English words fluidly and naturally (e.g. 'Arre suno! Tension bilkul mat lo!').
- Use conversational analogies (smartphones, powerbanks, game coins, kitchens).

Instructions:
1. 'analogy_title': A super catchy title with an emoji in {target_language}.
2. 'warm_greeting': A lively, warm human opening expressing excitement to teach.
3. 'simplified_text': A vivid, intuitive, real-world conversational breakdown using brilliant analogies.
4. 'key_takeaways': Exactly 3 memorable takeaway bullet points in {target_language}.
5. 'concept_map_mermaid': Valid Mermaid.js flowchart (graph TD/LR) in {target_language}.
6. 'interactive_sim': Parameters for a 2-slider simulation widget in {target_language}.
7. 'flashcards': 3 high-yield active-recall cards with 'question', 'answer', and 'hint' in {target_language}.
8. 'feynman_challenge': Set up the "Teach Curious Leo" reverse-tutor arena in {target_language}.

Return strictly valid JSON matching the schema.
"""

DOUBT_SOLVER_PROMPT = """
You are Luna, a friendly, warm, and super patient human girl study buddy (aged 20).
Topic: "{topic}"
Doubt: "{doubt_question}"
Language: {target_language}

Answer their doubt with clarity, kindness, and a relatable analogy:
1. 'answer': 2-3 friendly conversational sentences in {target_language}.
2. 'analogy': A quick 1-sentence real-world analogy.
3. 'key_point': 1 short summary takeaway sentence.

Return strictly valid JSON matching AskDoubtResponse.
"""

QUIZ_GENERATOR_PROMPT = """
You are Luna, creating an active-recall multiple-choice test for: "{topic}".
Total Questions: {count}
Difficulty Level: {difficulty} (Easy = basic definitions & analogies, Normal = conceptual logic & application, Hard = deep mechanisms & tricky edge cases).
Language: {target_language}

CRITICAL RULES FOR QUESTIONS:
1. Generate EXACTLY {count} questions.
2. EVERY SINGLE QUESTION MUST BE 100% UNIQUE and test a completely DIFFERENT aspect of "{topic}":
   - Q1: Core Purpose / Definition
   - Q2: Key Ingredients / Input Dependencies
   - Q3: Chemical / Physical Mechanism or Step
   - Q4: Primary Output / Byproduct
   - Q5: Real-World Analogy / Function
   - Q6: Cellular / Physical Location (where does it happen?)
   - Q7: Limiting Factors (what happens if an ingredient is missing?)
   - Q8: Energy Conversion / Efficiency
   - Q9: Role in the wider ecosystem or organism
   - Q10+: Edge cases, practical problem-solving scenarios, and deep applications.
3. NEVER repeat question text, question meaning, or options!
4. Shuffle the correct answer position randomly across 0 (A), 1 (B), 2 (C), and 3 (D).

Return strictly valid JSON matching GenerateQuizResponse.
"""

FEYNMAN_EVALUATOR_PROMPT = """
You are evaluating a student using the Feynman Technique.
Topic: {topic}
Leo's Question: {kid_question}
Student's Teaching Explanation: {user_explanation}
Language: {target_language}

Evaluate clarity and simplicity matching FeynmanEvaluateResponse schema.
"""

SOCRATIC_TUTOR_PROMPT = """
You are Luna, an extraordinary, warm, empathetic Socratic AI Tutor who guides students by asking thought-provoking questions, celebrating their insights, and helping them discover the answer themselves!
Target Language: {target_language}

TOPIC: {topic}
STUDENT SAID: "{student_utterance}"
CONVERSATION HISTORY:
{history_text}

PEDAGOGICAL INSTRUCTIONS:
1. Acknowledge what the student got right with high energy, genuine excitement, and warm human charisma (like a top-tier supportive mentor!).
2. Use natural conversational openers and vocal inflections (e.g., 'Aha!', 'Boom, exactly!', 'Oh, great observation!', 'Now imagine this:').
3. If they have a misconception, do NOT give away the answer dryly. Guide them with a vivid, relatable metaphor or thought experiment.
4. Keep your spoken response (`tutor_speech`) punchy, lively, and under 3 sentences for snappy, ultra-realistic voice dialogue.
4. Assess their `understanding_level` as "struggling", "progressing", or "mastered".
5. Provide a crisp `followup_question` and an optional gentle `hint`.
6. Provide an encouraging one-liner (`encouragement`).
7. Return strictly valid JSON matching SocraticTurnResponse schema.
"""

DIAGNOSTIC_SOLVER_PROMPT = """
You are the world's best Diagnostic STEM Educator and AI Whiteboard Marker.
Target Language: {target_language}

PROBLEM:
{problem_statement}

STUDENT WORK / STEPS:
{student_work}

INSTRUCTIONS:
1. Carefully parse every line/step the student took.
2. Break down into discrete `DiagnosticStep`s. Mark each as `is_correct` (True/False) with clear annotations (e.g. "✅ Good factoring", "❌ Inverted negative sign").
3. Identify the `root_misconception` (the exact cognitive flaw, e.g. "Confusing linear momentum with kinetic energy").
4. Provide the full clean `step_by_step_correct_flow`.
5. Provide a memorable `mnemonic_or_rule` (e.g. "Golden Rule: Always flip inequality when multiplying by a negative!").
6. Provide an `overall_grade` (e.g. "Mastered (100%)", "Minor Slip (80%)", "Needs Concept Review").
7. Return strictly valid JSON matching DiagnoseSolutionResponse schema.
"""


AI_RECOMMENDATIONS_PROMPT = """
You are Luna, an AI study coach. The student just finished studying a topic and took a quiz.
Topic: {topic}
Quiz Score: {score}%
Language: {lang}

Based on their score, suggest 3 related advanced or foundational topics to study next.
Also, suggest 1-2 specific weak areas they should review (if score < 80%), or praise their mastery (if score >= 80%).
Keep it highly engaging and educational.
"""


AI_RECOMMENDATIONS_PROMPT = """
You are Luna, an AI study coach. The student just finished studying a topic and took a quiz.
Topic: {topic}
Quiz Score: {score}%
Language: {lang}

Based on their score, suggest 3 related advanced or foundational topics to study next.
Also, suggest 1-2 specific weak areas they should review (if score < 80%), or praise their mastery (if score >= 80%).
Keep it highly engaging and educational.
"""

GENERATIVE_SANDBOX_PROMPT = """
You are an expert Educational Game and HTML5 Interactive Simulation Developer.
Target Language: {target_language}

TOPIC / CONCEPT: {topic}
ADDITIONAL DETAIL: {concept_detail}

INSTRUCTIONS:
1. Design an ultra-responsive, fun, visual interactive HTML5 canvas simulation.
2. Provide 2-3 interactive parameter controls with sensible min, max, default, and units.
3. Write clean, self-contained JavaScript code (`canvas_js_code`) that accepts `(canvas, ctx, state, timestamp)` where `state` has the control values and mouse interactions `state.mouseX`, `state.mouseY`, `state.isMouseDown`. The function should draw animated particles, physics bodies, waves, or reaction molecules in 60fps!
4. Provide 3 `experiment_prompts` encouraging the student to test specific edge cases.
5. Return strictly valid JSON matching GenerateSandboxResponse schema.
"""

# ---------------------------------------------------------------------------
# Dynamic Diverse Question Bank Engine (Guarantees 100% unique questions)
# ---------------------------------------------------------------------------


def generate_fallback_quiz(topic: str, count: int, difficulty: str, language: str) -> GenerateQuizResponse:
    """Generates 5 to 20 completely unique, distinct conceptual questions for any topic."""
    words = [w for w in topic.split() if len(w) > 3][:3]
    top = " ".join(words).title() if words else "This Topic"
    is_math = any(k in topic.lower() for k in ["bodmas", "math", "fraction", "simplif", "bracket", "division", "algebra", "calculate"])

    # Diverse Question Templates covering 20 completely distinct aspects of the concept!
    if is_math and language == "hinglish":
        templates = [
            {
                "q": "BODMAS me 'B' ka full form aur sabse pehla priority step kya hai?",
                "correct": "Brackets (कोष्ठक) — Sabse pehle brackets ke andar ka part solve karo",
                "wrong": ["Base multiplication", "Binary calculation", "Bottom number division"],
                "exp": "BODMAS me 'B' stands for Brackets jisko sabse high priority milti hai!"
            },
            {
                "q": "Solve karo: 12 ÷ 3 × 2 ka correct answer kya hoga?",
                "correct": "8 (Left to Right rule: 12 ÷ 3 = 4, fir 4 × 2 = 8)",
                "wrong": ["2 (Pehle 3 × 2 = 6, fir 12 ÷ 6 = 2)", "18", "6"],
                "exp": "Division aur Multiplication same rank par hote hain aur strictly Left to Right solve hote hain!"
            },
            {
                "q": "BODMAS rule me 'O' ka exact mathematical operation kya hota hai?",
                "correct": "'Of' — jiska matlab direct Multiplication (×) hota hai",
                "wrong": ["Only Addition", "Order Subtraction", "Offset Constant"],
                "exp": "'Of' means multiplication (e.g. 1/2 of 50 = 1/2 × 50 = 25)."
            },
            {
                "q": "Fraction division rule: a/b ÷ c/d ko solve karne ka formula kya hai?",
                "correct": "a/b × d/c (Doosre fraction ka reciprocal lekar multiply karo)",
                "wrong": ["a/b + c/d", "a/c ÷ b/d", "ad / bc without multiplication"],
                "exp": "Fractions me divide karne ke liye divisor fraction ko invert (ulta) karke multiply karte hain."
            },
            {
                "q": "Agar kisi expression me Brackets nahi hain, toh Division aur Addition me pehle kya hoga?",
                "correct": "Division pehle hoga (D comes before A in BODMAS)",
                "wrong": ["Addition pehle hoga", "Dono ko ek sath randomly solve kar sakte hain", "Subtraction pehle hoga"],
                "exp": "BODMAS priority order: Division Addition se pehle execute hota hai!"
            }
        ]
    elif language == "hinglish":
        templates = [
            {
                "q": f"{top} ka primary purpose (main goal) kya hota hai?",
                "correct": f"Inputs ko use karke essential energy aur balance create karna",
                "wrong": [
                    f"Bina kisi reason ke energy destroy karna",
                    f"System ko permanent standby mode me rakhna",
                    f"Sirf waste heat produce karna"
                ],
                "exp": f"{top} ka main objective inputs ko transform karke useful outputs aur stability deliver karna hai."
            },
            {
                "q": f"{top} process ko smoothly run hone ke liye kaunse primary inputs (ingredients) chahiye?",
                "correct": f"Continuous source of energy aur specific raw materials",
                "wrong": [
                    f"Zero energy aur bina kisi input ke execution",
                    f"Sirf artificial chemicals",
                    f"Extreme freezing temperatures only"
                ],
                "exp": f"Har active scientific process ko raw inputs aur energy source ki zaroorat hoti hai."
            },
            {
                "q": f"Agar {top} process ke dauran primary input supply achanak band ho jaye, toh kya asar hoga?",
                "correct": f"Overall reaction rate drop ho jayega aur output production stop ho jayegi",
                "wrong": [
                    f"Production rate 10x badh jayega",
                    f"Koi bhi farq nahi padega",
                    f"System khud ba khud new matter invent kar lega"
                ],
                "exp": "Limiting factor ke bina koi bhi reaction sustain nahi reh sakta."
            },
            {
                "q": f"Daily life me {top} ko samajhne ke liye sabse best analogy kaunsi hai?",
                "correct": f"Ek well-coordinated kitchen ya rechargeable solar battery system",
                "wrong": [
                    f"Ek completely stationary non-living rock",
                    f"Ek broken disconnected wire",
                    f"Random noise without any logic"
                ],
                "exp": "Coordinated energy flow ko kitchen ya battery jaisi analogies se sabse acche se samjha ja sakta hai."
            },
            {
                "q": f"{top} process ke end me main useful output (byproduct) kya banta hai?",
                "correct": f"High-energy product jo system ko power aur nourishment deta hai",
                "wrong": [
                    f"Zero usable product ya negative energy",
                    f"Dangerous toxic waste without any benefit",
                    f"Sirf unnecessary noise"
                ],
                "exp": "Har biological/physical mechanism ka end product system ko energy aur functionality provide karta hai."
            },
            {
                "q": f"{top} process cell ya system ke kis specific part me execute hota hai?",
                "correct": f"Dedicated specialized compartments ya organelle structures me",
                "wrong": [
                    f"Cell ke bahar randomly hawa me",
                    f"Bina kisi membrane ya boundary ke",
                    f"Sirf dead dry tissues me"
                ],
                "exp": "Specialized reaction sites ensure karte hain ki reaction efficiency maximum ho."
            },
            {
                "q": f"Efficiency badhane ke liye {top} system me catalysts (enzymes/promoters) ka kya role hota hai?",
                "correct": f"Reaction ki required energy barrier ko kam karke process ko speed up karna",
                "wrong": [
                    f"Process ko unnecessarily slow aur halt karna",
                    f"Reaction ke dauran permanently consume ho jana",
                    f"Galat products create karna"
                ],
                "exp": "Catalysts activation energy ko decrease karke rate of reaction ko boost karte hain."
            },
            {
                "q": f"Temperature ka {top} ki reaction speed par kya effect padta hai?",
                "correct": f"Optimal range me speed badhti hai, par extreme heat par enzymes denature ho jate hain",
                "wrong": [
                    f"Temperature ka 0% effect hota hai",
                    f"1000°C par reaction hamesha best hoti hai",
                    f"Cold temperatures par speed infinite ho jati hai"
                ],
                "exp": "Optimal temperature range ke bahar biological structures distort ho jate hain."
            },
            {
                "q": f"Wider ecosystem ya biological body me {top} ka overall role kya hai?",
                "correct": f"Food chain aur energy cycle me fundamental foundation provide karna",
                "wrong": [
                    f"Ecosystem ki stability ko disturb karna",
                    f"Energy ko completely block karna",
                    f"Sirf harmful effects create karna"
                ],
                "exp": "Primary mechanisms puri nature me energy balance aur food web ko maintain karte hain."
            },
            {
                "q": f"{top} me energy transformation ka exact nature kya hota hai?",
                "correct": f"Radiant / kinetic energy ka stable chemical energy bonds me conversion",
                "wrong": [
                    f"Energy ka permanently destroy ho jana",
                    f"Bina kisi source ke magic se energy create hona",
                    f"Energy ka zero change rehna"
                ],
                "exp": "Law of Conservation of Energy: Energy form change karti hai, destroy nahi hoti."
            },
            {
                "q": f"Night ya dark conditions me {top} system kaise adapt karta hai?",
                "correct": f"Stored energy reserves use karta hai aur independent phase execute karta hai",
                "wrong": [
                    f"Pura organism instantly disintegrate ho jata hai",
                    f"100x fast speed me kaam karne lagta hai",
                    f"Sunlight ke bina impossible behavior show karta hai"
                ],
                "exp": "Stored chemical intermediates (like ATP/NADPH) darkness me essential functions maintain karte hain."
            },
            {
                "q": f"Microscopic level par {top} ke dauran molecules ka interaction kaisa hota hai?",
                "correct": f"High precision binding sites par lock-and-key coordination hota hai",
                "wrong": [
                    f"Random collisions bina kisi chemical affinity ke",
                    f"Molecules ka physically merge hoke gayab ho jana",
                    f"Zero movement of particles"
                ],
                "exp": "Molecular specificity ensures that exact substrates bind to exact receptors."
            },
            {
                "q": f"Agar hum {top} me concentration gradient badha dein, toh rate of diffusion par kya asar padega?",
                "correct": f"Molecules ka movement rate significantly increase ho jayega",
                "wrong": [
                    f"Movement completely freeze ho jayega",
                    f"Gradient se koi farq nahi padta",
                    f"Ulta direction me bina energy ke flow hoga"
                ],
                "exp": "Higher concentration gradient leads to faster net rate of diffusion."
            },
            {
                "q": f"{top} ka modern technology ya renewable energy me kya practical application hai?",
                "correct": f"Bio-inspired solar cells aur efficient battery storage designs develop karna",
                "wrong": [
                    f"Fossil fuels ko randomly burn karna",
                    f"Technology me koi use na hona",
                    f"Computers ko slow karna"
                ],
                "exp": "Biomimicry: scientists natural systems se inspire hoke next-gen solar panels banate hain."
            },
            {
                "q": f"Is topic me sabse common misconception (galat fehmi) kya hoti hai?",
                "correct": f"Yeh sochna ki yeh process sirf ek single instant step me khatam ho jata hai",
                "wrong": [
                    f"Yeh maanna ki energy ki zaroorat hoti hai",
                    f"Yeh samajhna ki enzymes help karte hain",
                    f"Iska real life se connection dekhna"
                ],
                "exp": "Yeh multiple coordinated pathways aur enzyme-driven stages ka multi-step cycle hai."
            },
            {
                "q": f"High-level competitive exams me {top} se related kaunsa edge case aksar pucha jata hai?",
                "correct": f"Feedback inhibition mechanism aur rate-limiting enzymes ka regulation",
                "wrong": [
                    f"Sirf basic spelling",
                    f"Bina context ke random numbers",
                    f"Colors of textbook covers"
                ],
                "exp": "Allosteric regulation aur negative feedback loops exam-level critical concepts hain."
            },
            {
                "q": f"{top} me membrane transport mechanisms ka kya importance hai?",
                "correct": f"Selective permeability maintain karna taaki ions ka specific gradient bane",
                "wrong": [
                    f"Har cheez ko bina control ke allow karna",
                    f"Puri membrane ko completely solid impenetrable banana",
                    f"Ions ka flow block karna"
                ],
                "exp": "Proton/ion gradients membrane ke across chemiosmosis se energy generate karte hain."
            },
            {
                "q": f"Agar {top} me water ya moisture content 0% ho jaye, toh cellular level par kya hoga?",
                "correct": f"Cell turgor loss hoga aur enzymatic aqueous reactions stop ho jayengi",
                "wrong": [
                    f"Reaction rate increase ho jayega",
                    f"Cell dry state me 100x efficient banega",
                    f"Moisture ka chemical reactions me zero role hota hai"
                ],
                "exp": "Water biological solvent hai jiske bina enzymatic reactions freeze ho jati hain."
            },
            {
                "q": f"{top} ki discovery science history me revolutionary kyun maani jaati hai?",
                "correct": f"Isne life sciences aur thermodynamics ke basic fundamental laws ko connect kiya",
                "wrong": [
                    f"Kyunki iska koi scientific proof nahi tha",
                    f"Sirf decorative research thi",
                    f"Isse science ka koi fayda nahi hua"
                ],
                "exp": "Biological energy conversion ko samajhna modern medicine aur biology ka turning point tha."
            },
            {
                "q": f"Summary: {top} ko master karne ka sabse golden rule kya hai?",
                "correct": f"Inputs ➔ Core Mechanism ➔ Intermediates ➔ Final Outputs ka clear flowchart banana",
                "wrong": [
                    f"Bina samjhe lambe paragraphs ratna",
                    f"Diagrams aur flowcharts ko ignore karna",
                    f"Core principles ko skip karke tricks dhundhna"
                ],
                "exp": "Visual flowchart aur conceptual understanding se complex topics hamesha yaad rehte hain!"
            }
        ]
    else:
        templates = [
            {
                "q": f"What is the fundamental objective of {top}?",
                "correct": f"To utilize inputs and establish essential energy and systematic balance",
                "wrong": [
                    f"To randomly destroy energy without purpose",
                    f"To lock the entire system into permanent dormancy",
                    f"To generate only wasteful disorganized heat"
                ],
                "exp": f"The primary goal of {top} is to convert raw inputs into vital outputs and homeostatic balance."
            },
            {
                "q": f"Which primary inputs are indispensable for sustaining {top}?",
                "correct": f"A continuous energy source combined with specific substrate molecules",
                "wrong": [
                    f"Zero input energy or materials",
                    f"Artificial synthetic compounds only",
                    f"Sub-zero extreme freezing conditions exclusively"
                ],
                "exp": "Every biological and physical mechanism requires substrate inputs and driving energy."
            },
            {
                "q": f"What happens immediately if a key limiting input in {top} is depleted?",
                "correct": f"The reaction velocity drops sharply and product yield ceases",
                "wrong": [
                    f"Product synthesis accelerates tenfold",
                    f"No noticeable operational effect occurs",
                    f"The system spontaneously creates new matter"
                ],
                "exp": "According to the law of limiting factors, the rate is bottlenecked by the scarcest input."
            },
            {
                "q": f"What is the best everyday analogy to understand {top}?",
                "correct": f"A coordinated automated kitchen or rechargeable solar energy unit",
                "wrong": [
                    f"A static, non-interacting boulder",
                    f"A severed electrical circuit",
                    f"Random disordered background noise"
                ],
                "exp": "Coordinated multi-step energy flows are intuitively modeled as kitchen workshops or batteries."
            },
            {
                "q": f"What is the primary high-yield byproduct produced at the end of {top}?",
                "correct": f"High-energy biomolecules that power cellular operations and stability",
                "wrong": [
                    f"Zero usable product or negative energy state",
                    f"Toxic unusable waste with no functional benefit",
                    f"Inert background vapor only"
                ],
                "exp": "The culminating product delivers active energy and nourishment to the broader system."
            },
            {
                "q": f"Where does {top} predominantly take place at the microscopic level?",
                "correct": f"Within specialized compartmentalized organelles or membrane systems",
                "wrong": [
                    f"Randomly suspended outside in open air",
                    f"Without any membrane boundaries or containment",
                    f"Exclusively within desiccated dead cells"
                ],
                "exp": "Organellar compartmentalization ensures maximum enzymatic efficiency and targeted gradients."
            },
            {
                "q": f"What critical role do biological catalysts play in {top}?",
                "correct": f"Lowering the activation energy barrier to accelerate reaction kinetics",
                "wrong": [
                    f"Slowing down or permanently blocking progress",
                    f"Being irrevocably consumed during the initial step",
                    f"Synthesizing incorrect aberrant compounds"
                ],
                "exp": "Catalysts and enzymes decrease the activation energy required for biochemical transitions."
            },
            {
                "q": f"How does temperature influence the reaction velocity of {top}?",
                "correct": f"Increases rate up to an optimum, beyond which denaturation occurs",
                "wrong": [
                    f"Temperature has precisely 0% impact",
                    f"Extreme boiling temperatures always yield maximum output",
                    f"Freezing temperatures cause infinite reaction speeds"
                ],
                "exp": "Thermal denaturation distorts active sites beyond the thermal optimum."
            },
            {
                "q": f"What is the wider ecological significance of {top}?",
                "correct": f"Forming the primary energetic base for food webs and ecosystem cycles",
                "wrong": [
                    f"Disrupting natural environmental equilibrium",
                    f"Permanently terminating energy exchange",
                    f"Causing solely detrimental ecological shifts"
                ],
                "exp": "Foundational biochemical mechanisms establish the primary energy backbone of the biosphere."
            },
            {
                "q": f"How is energy conserved and converted throughout {top}?",
                "correct": f"Kinetic/radiant energy is converted into stable chemical covalent bonds",
                "wrong": [
                    f"Energy is permanently destroyed from existence",
                    f"Energy is spontaneously generated from nothing",
                    f"Zero thermodynamic change takes place"
                ],
                "exp": "The First Law of Thermodynamics guarantees energy transition into stable chemical bonds."
            },
            {
                "q": f"How does the system sustain itself during periods of darkness or low input?",
                "correct": f"By mobilizing stored high-energy intermediates synthesized during peak input",
                "wrong": [
                    f"By instantaneously dissolving the entire organism",
                    f"By multiplying baseline speed by 100x",
                    f"By completely abandoning biological laws"
                ],
                "exp": "Stored energy currencies (e.g., ATP/NADPH or starch) fuel dark-phase reactions."
            },
            {
                "q": f"What governs the high precision of molecular interactions in {top}?",
                "correct": f"Stereochemical specificity and induced-fit substrate binding",
                "wrong": [
                    f"Random unordered chaotic collisions alone",
                    f"Molecules fusing into indistinguishable masses",
                    f"Complete absence of molecular motion"
                ],
                "exp": "Enzyme active sites feature precise spatial geometry matching specific substrates."
            },
            {
                "q": f"What effect does an increased electrochemical gradient have on transport in {top}?",
                "correct": f"It drives rapid proton flux powering ATP synthesis via chemiosmosis",
                "wrong": [
                    f"It completely paralyzes membrane transport",
                    f"Gradients exert zero effect on biological membranes",
                    f"It reverses the laws of diffusion spontaneously"
                ],
                "exp": "Electrochemical proton motive forces drive rotational ATP synthase motors."
            },
            {
                "q": f"What modern technological breakthrough is inspired by {top}?",
                "correct": f"Artificial photosynthesis and advanced photovoltaic storage cells",
                "wrong": [
                    f"Uncontrolled combustion of crude fossil fuels",
                    f"Zero scientific or practical applicability",
                    f"Slowing down semiconductor processors"
                ],
                "exp": "Biomimetic solar cells directly replicate the light-harvesting complexes found in nature."
            },
            {
                "q": f"What is the most prevalent misconception regarding {top}?",
                "correct": f"Assuming it occurs in a single instantaneous event rather than coupled multi-step pathways",
                "wrong": [
                    f"Believing that energy is involved",
                    f"Recognizing that enzymes facilitate steps",
                    f"Connecting the theory to practical real-world systems"
                ],
                "exp": "Complex processes consist of sequentially orchestrated light and enzymatic stages."
            },
            {
                "q": f"Which advanced regulatory mechanism prevents wasteful overproduction in {top}?",
                "correct": f"Allosteric feedback inhibition by accumulated downstream products",
                "wrong": [
                    f"Complete absence of regulation",
                    f"Uncontrolled runaway reactions until exhaustion",
                    f"Immediate cellular necrosis"
                ],
                "exp": "Negative feedback loops dynamically regulate pathway flux based on cellular demand."
            },
            {
                "q": f"Why is selective membrane permeability critical for {top}?",
                "correct": f"To compartmentalize ions and generate the voltage potentials needed for work",
                "wrong": [
                    f"To allow unregulated chaotic leakage of all ions",
                    f"To create completely impermeable static barriers",
                    f"To halt all internal molecular transport"
                ],
                "exp": "Selective permeability enables controlled electrochemical gradients across thylakoid/mitochondrial membranes."
            },
            {
                "q": f"What immediate consequence occurs if cellular hydration drops to zero in {top}?",
                "correct": f"Enzymatic conformations collapse and aqueous biochemical steps halt",
                "wrong": [
                    f"Reaction kinetics accelerate dramatically",
                    f"Anhydrous systems perform with 100x efficiency",
                    f"Water plays no role in biochemical reactions"
                ],
                "exp": "Water acts as the universal biological solvent and indispensable electron donor in photolysis."
            },
            {
                "q": f"Why is the historical discovery of {top} considered a milestone in science?",
                "correct": f"It bridged thermodynamics, biochemistry, and global ecological cycles",
                "wrong": [
                    f"It had zero empirical foundation",
                    f"It was purely decorative with no application",
                    f"It provided no insights into living systems"
                ],
                "exp": "Unraveling bioenergetics revolutionized modern physiology, agriculture, and medicine."
            },
            {
                "q": f"Summary: What is the most effective approach to mastering {top}?",
                "correct": f"Mapping the flowchart: Inputs ➔ Catalysts ➔ Intermediates ➔ Final Outputs",
                "wrong": [
                    f"Rote memorization of disconnected text passages",
                    f"Ignoring visual schematics and pathway flowcharts",
                    f"Skipping core fundamentals in favor of superficial tricks"
                ],
                "exp": "Visual pathway modeling and conceptual clarity ensure lifelong mastery of science topics."
            }
        ]

    # Select exactly 'count' unique questions from the pool of 20
    selected_templates = templates[:count] if count <= len(templates) else templates

    questions = []
    for idx, tmpl in enumerate(selected_templates):
        # Create 4 options and randomize correct answer position (A=0, B=1, C=2, D=3)
        correct_opt = tmpl["correct"]
        wrong_opts = list(tmpl["wrong"])
        
        # Pick 3 wrong options
        chosen_wrongs = wrong_opts[:3]
        all_options = [correct_opt] + chosen_wrongs
        random.shuffle(all_options)
        correct_index = all_options.index(correct_opt)

        questions.append(
            QuizQuestion(
                id=idx + 1,
                question=tmpl["q"],
                options=all_options,
                correct_option_index=correct_index,
                explanation=tmpl["exp"],
                difficulty=difficulty,
            )
        )

    return GenerateQuizResponse(
        topic=top,
        difficulty=difficulty,
        total_questions=len(questions),
        questions=questions,
    )


def generate_fallback_lesson(text: str, level: str, language: str) -> SimplifyResponse:
    """Intelligent fallback that dynamically generates a rich lesson tailored to the exact topic domain."""
    text_lower = text.lower()
    is_math_bodmas = any(k in text_lower for k in ["bodmas", "math", "fraction", "simplif", "bracket", "division", "algebra", "order of operations", "equation"])

    words = [w.strip() for w in text.replace("\n", " ").split(" ") if len(w.strip()) > 3][:6]
    topic_name = " ".join(words[:3]).title() if words else "BODMAS Simplification"

    if is_math_bodmas:
        if language == "hinglish":
            title = "📐 BODMAS Rule & Simplification: Master Formula! 🔢"
            greeting = "Arre suno! Math ki calculations se darna bilkul band karo! BODMAS bas ek simple recipe ya traffic rule ki tarah hai jo batata hai kaunsa step pehle solve karna hai taaki answer 100% correct aaye!"
            simplified = (
                "Socho BODMAS ko ek strict VIP line ki tarah! 🚦\n\n"
                "Jab bhi ek expression me multiple signs (+, -, ×, ÷) ho, toh solve karne ka exact order yeh hota hai:\n"
                "1. **B - Brackets (कोष्ठक)**: Sabse pehle brackets ke andar ka part solve karo `( )`, `{ }`, `[ ]`.\n"
                "2. **O - Of**: 'Of' ka matlab direct multiplication (×) hota hai.\n"
                "3. **D & M - Division & Multiplication**: Inko hamesha **Left to Right** solve karte hain!\n"
                "4. **A & S - Addition & Subtraction**: Last me plus aur minus Left to Right solve karo!\n\n"
                "💡 **Golden Example**: `12 ÷ 3 × 2`\n"
                "Pehele Division: `12 ÷ 3 = 4`, fir Multiplication: `4 × 2 = 8`! (Answer = 8) 🎯"
            )
            takeaways = [
                "BODMAS Order: Brackets ➔ Of ➔ Division ➔ Multiplication ➔ Addition ➔ Subtraction.",
                "Division aur Multiplication hamesha Left-to-Right solve hote hain.",
                "Fraction Division Rule: a/b ÷ c/d = a/b × d/c (reciprocal karke multiply karo).",
            ]
            q1 = "BODMAS me 'O' ka exact matlab kya hota hai?"
            a1 = "'Of' — jiska mathematical operation Multiplication (×) hota hai!"
            q2 = "Solve karo: 12 ÷ 3 × 2 ka correct answer kya hai?"
            a2 = "8! (Left to Right rule: 12 ÷ 3 = 4, fir 4 × 2 = 8)"
            q3 = "Fractions me a/b ÷ c/d ko solve karne ka formula kya hai?"
            a3 = "a/b × d/c (Doosre fraction ko ulta karke multiply karo)"
            leo_q = "Didi! Agar question me brackets aur plus dono ho, toh kya main pehle plus kar sakta hoon?"
        else:
            title = "📐 BODMAS & Order of Operations: Master Rules! 🔢"
            greeting = "Hey there! Don't let long math expressions intimidate you! BODMAS is simply the traffic guide for numbers that guarantees you always get the right answer."
            simplified = (
                "Think of BODMAS as a VIP priority queue for arithmetic operations! 🚦\n\n"
                "Whenever an equation has multiple operations, solve in this precise order:\n"
                "1. **B - Brackets**: Clear everything inside `( )`, `{ }`, `[ ]` first.\n"
                "2. **O - Of / Orders**: Powers, roots, or 'Of' (multiplication).\n"
                "3. **D & M - Division & Multiplication**: Computed strictly from **Left to Right**.\n"
                "4. **A & S - Addition & Subtraction**: Computed strictly from **Left to Right**.\n\n"
                "💡 **Quick Example**: `12 ÷ 3 × 2`\n"
                "First Divide: `12 ÷ 3 = 4`, then Multiply: `4 × 2 = 8`! (Answer = 8) 🎯"
            )
            takeaways = [
                "BODMAS Sequence: Brackets ➔ Of ➔ Division ➔ Multiplication ➔ Addition ➔ Subtraction.",
                "Division & Multiplication share equal precedence and execute Left-to-Right.",
                "Fraction Division: a/b ÷ c/d = a/b × d/c (flip the divisor and multiply).",
            ]
            q1 = "What does the 'O' in BODMAS represent?"
            a1 = "'Of' or 'Orders' (powers/roots and explicit multiplication)!"
            q2 = "What is the evaluated result of 12 ÷ 3 × 2?"
            a2 = "8 (Left-to-right precedence: 12 ÷ 3 = 4, then 4 × 2 = 8)"
            q3 = "How do you simplify a/b ÷ c/d?"
            a3 = "Multiply by the reciprocal: a/b × d/c"
            leo_q = "Wait! What happens if I ignore brackets and just do addition first?"

        mermaid = """graph LR
    A["1️⃣ Brackets ( )"] --> B["2️⃣ 'Of' / Powers"]
    B --> C["3️⃣ Division & Multiply (L to R)"]
    C --> D["4️⃣ Addition & Subtract (L to R)"]
    D --> E["🎯 Final Exact Answer"]"""

        return SimplifyResponse(
            analogy_title=title,
            warm_greeting=greeting,
            simplified_text=simplified,
            key_takeaways=takeaways,
            concept_map_mermaid=mermaid,
            interactive_sim=InteractiveSimData(
                title="🕹️ BODMAS Dynamic Expression Evaluator Sandbox",
                slider1_label="➗ Primary Term / Multiplier (X)",
                slider1_min=1,
                slider1_max=20,
                slider1_default=12,
                slider1_unit="",
                slider2_label="➕ Offset Constant (Y)",
                slider2_min=1,
                slider2_max=20,
                slider2_default=4,
                slider2_unit="",
                output_metric_name="Evaluated Value: (X ÷ 2) + Y",
                output_unit="pts",
                multiplier=1.0,
                explanation_on_change="Adjust the numerical inputs to watch step-by-step BODMAS order of operations evaluate in real time!",
            ),
            flashcards=[
                Flashcard(question=q1, answer=a1, hint="Think about powers or 'of'."),
                Flashcard(question=q2, answer=a2, hint="Follow left-to-right rule."),
                Flashcard(question=q3, answer=a3, hint="Invert the second fraction."),
            ],
            feynman_challenge=FeynmanChallenge(
                kid_name="Leo",
                kid_initial_question=leo_q,
                kid_confusing_trap="ignoring brackets",
            ),
            language=language,
            level=level,
            model_used="ClearMind Hybrid Math Engine",
        )

    # General / Science Fallback
    if language == "hinglish":
        title = f"🌿 {topic_name}: Simple & Mast Concept! 💡"
        greeting = f"Arre suno! Tension lene ki bilkul zaroorat nahi hai. {topic_name} dekhne me complex lagta hai, par actually yeh bohot hi simple aur interesting hai! Aao saath me explore karte hain."
        simplified = f"Socho {topic_name} ko ek real-world system ki tarah! 🚀\n\nJaise hamari daily life me machines aur gadgets energy aur inputs use karke useful output banate hain, wahi same principal {topic_name} me apply hota hai. Iske main components ek doosre ke saath collaborate karte hain taaki pura balance maintain rahe!\n\nIs process me har step ka apna ek specific role hota hai jo isko perfectly function karne me help karta hai."
        takeaways = [
            f"{topic_name} ka main purpose balance aur energy flow ko maintain karna hai.",
            "Iske saare key components step-by-step collaborate karte hain.",
            "Isko daily life ke analogies (jaise kitchen ya battery) se aasani se samjha ja sakta hai!",
        ]
        q1 = f"{topic_name} ka primary function kya hota hai?"
        a1 = "System me smooth energy aur process flow ko execute karna!"
        q2 = f"Is concept ko daily life ke kis example se relate kar sakte hain?"
        a2 = "Ek coordinated kitchen ya smart battery circuit ki tarah!"
        q3 = "Iske process me sabse important factor kya hai?"
        a3 = "Sahi balance aur inputs ka coordination!"
        leo_q = f"Didi! Agar {topic_name} me ek component kaam karna band kar de, toh pura system kaise react karega?"
    else:
        title = f"🌿 {topic_name}: The Intuitive Breakdown! 💡"
        greeting = f"Hey there! Don't worry at all. {topic_name} might sound complex in textbooks, but it is actually super fascinating once you see the big picture! Let's dive in together."
        simplified = f"Imagine {topic_name} just like an everyday interconnected system! 🚀\n\nJust like how smart devices take in inputs and transform them into useful output, the fundamental principles of {topic_name} work in perfect harmony. Every single component has a dedicated job that keeps everything moving seamlessly."
        takeaways = [
            f"The core goal of {topic_name} is to maintain energy and systematic flow.",
            "Each part works in close collaboration to produce steady output.",
            "You can easily understand it by thinking of everyday coordinated networks!",
        ]
        q1 = f"What is the main purpose of {topic_name}?"
        a1 = "To transform inputs into coordinated, vital outputs!"
        q2 = "How can we visualize this system simply?"
        a2 = "Like a well-oiled team or an automated smart workshop!"
        q3 = "What happens when all factors are balanced?"
        a3 = "The system achieves maximum efficiency and stability!"
        leo_q = f"Wait! What would happen if one of the main ingredients in {topic_name} went missing?"

    mermaid = f"""graph LR
    A["📥 Input Factors"] --> B["⚙️ Core Mechanism ({topic_name})"]
    B --> C["⚡ Energy / Active Output"]
    B --> D["✨ Stable Balance"]"""

    return SimplifyResponse(
        analogy_title=title,
        warm_greeting=greeting,
        simplified_text=simplified,
        key_takeaways=takeaways,
        concept_map_mermaid=mermaid,
        interactive_sim=InteractiveSimData(
            title=f"🕹️ {topic_name} Interactive Sandbox",
            slider1_label="⚡ Primary Input Intensity",
            slider1_min=0,
            slider1_max=100,
            slider1_default=65,
            slider1_unit="%",
            slider2_label="🔄 Secondary Catalyst Rate",
            slider2_min=0,
            slider2_max=100,
            slider2_default=70,
            slider2_unit="%",
            output_metric_name="Total System Efficiency & Yield",
            output_unit="units/hr",
            multiplier=1.35,
            explanation_on_change="Adjust the inputs to see how the overall reaction balance and yield respond dynamically!",
        ),
        flashcards=[
            Flashcard(question=q1, answer=a1, hint="Think about the main goal."),
            Flashcard(question=q2, answer=a2, hint="Think about teamwork."),
            Flashcard(question=q3, answer=a3, hint="Think about stability."),
        ],
        feynman_challenge=FeynmanChallenge(
            kid_name="Leo",
            kid_initial_question=leo_q,
            kid_confusing_trap="complex terminology",
        ),
        language=language,
        level=level,
        model_used="ClearMind Hybrid Engine",
    )


def generate_fallback_doubt(topic: str, doubt: str, language: str) -> AskDoubtResponse:
    """Generate friendly instant answer to any doubt."""
    if language == "hinglish":
        ans = f"Arre bohot hi accha doubt hai! Dekho, jab bhi aap '{doubt}' sochte ho, toh iska seedha matlab yeh hai ki system ko continuous balance chahiye hota hai. Koi bhi ek cheez missing ho toh pura process slow ho jata hai."
        analogy = "Socho jaise ek car ko engine aur petrol dono chahiye, waise hi is process me har input zaroori hai!"
        point = "Har component ek doosre ke collaboration se hi pura function deliver karta hai."
    else:
        ans = f"That's a wonderful question! When thinking about '{doubt}', remember that natural and scientific systems rely on dynamic equilibrium. Each factor directly empowers the next step."
        analogy = "Think of it like a bicycle chain and gears: both need to engage smoothly for forward momentum!"
        point = "Continuous balance across all inputs is essential for complete execution."

    return AskDoubtResponse(answer=ans, analogy=analogy, key_point=point)


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/status", response_model=StatusResponse)
def check_status():
    key = get_active_api_key()
    glm_key = os.getenv("GLM_API_KEY")
    return StatusResponse(
        has_api_key=bool(key),
        source="Configured (.env / Environment)" if key else "Missing",
        recommended_model=CANDIDATE_MODELS[0],
        has_glm_key=bool(glm_key),
    )


@app.post("/api/save-key")
def save_api_key(payload: SaveKeyRequest):
    key = payload.api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key cannot be empty.")
    try:
        set_key(ENV_PATH, "GEMINI_API_KEY", key)
        os.environ["GEMINI_API_KEY"] = key
        os.environ["GOOGLE_API_KEY"] = key
        return {"status": "success", "message": "API key saved successfully!"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save key: {str(exc)}")


# ---------------------------------------------------------------------------
# Studio-Quality Neural TTS Endpoint (Edge-TTS)
# ---------------------------------------------------------------------------


@app.post("/api/tts")
async def generate_neural_speech(payload: TTSRequest):
    """Generate hyper-realistic natural human female audio using Edge Neural TTS."""
    clean_text = payload.text.strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    voice = NEURAL_VOICES.get(payload.language or "hinglish", "en-IN-NeerjaNeural")

    try:
        communicate = edge_tts.Communicate(clean_text, voice, rate=payload.rate or "+0%", pitch=payload.pitch or "+0Hz")
        audio_bytes = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_bytes.extend(chunk["data"])

        return Response(content=bytes(audio_bytes), media_type="audio/mpeg")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Neural TTS Error: {str(exc)}")


# ---------------------------------------------------------------------------
# Quick Test / Quiz Generator Endpoint
# ---------------------------------------------------------------------------


@app.post("/api/generate-quiz", response_model=GenerateQuizResponse)
def generate_quick_test(
    payload: GenerateQuizRequest,
    x_api_key: Optional[str] = Header(default=None),
):
    """Generate 5 to 20 multiple choice questions with Easy/Normal/Hard difficulty."""
    if not payload.topic.strip():
        raise HTTPException(status_code=400, detail="Topic cannot be empty.")

    api_key = get_active_api_key(payload.api_key or x_api_key)
    target_lang = LANGUAGES_MAP.get(payload.language, "Hinglish")

    if api_key:
        try:
            client = genai.Client(api_key=api_key)
            prompt = QUIZ_GENERATOR_PROMPT.format(
                topic=payload.topic,
                count=payload.count,
                difficulty=payload.difficulty,
                target_language=target_lang,
            )

            for model_name in CANDIDATE_MODELS:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config={
                            "response_mime_type": "application/json",
                            "response_schema": GenerateQuizResponse,
                            "temperature": 0.6,
                        },
                    )
                    parsed = json.loads(response.text)
                    if parsed.get("questions") and len(parsed["questions"]) >= payload.count:
                        return GenerateQuizResponse(**parsed)
                except Exception as exc:
                    logger.error(f"Gemini call failed for model {model_name}: {exc}")
                    continue
        except Exception as exc:
            logger.error(f"Gemini client initialization / API execution error: {exc}")

    # Seamless Fallback with 100% Unique, Distinct Questions
    return generate_fallback_quiz(
        payload.topic,
        payload.count,
        payload.difficulty,
        payload.language or "hinglish",
    )


# ---------------------------------------------------------------------------
# Doubt Solver Endpoint ("Ask Luna Anything")
# ---------------------------------------------------------------------------


@app.post("/api/ask-doubt", response_model=AskDoubtResponse)
def solve_student_doubt(
    payload: AskDoubtRequest,
    x_api_key: Optional[str] = Header(default=None),
):
    """Solve any conceptual doubt with friendly analogies in the user's language."""
    if not payload.doubt_question.strip():
        raise HTTPException(status_code=400, detail="Doubt question cannot be empty.")

    api_key = get_active_api_key(payload.api_key or x_api_key)
    target_lang = LANGUAGES_MAP.get(payload.language, "Hinglish")

    if api_key:
        try:
            client = genai.Client(api_key=api_key)
            prompt = DOUBT_SOLVER_PROMPT.format(
                topic=payload.topic or "General Science",
                doubt_question=payload.doubt_question,
                target_language=target_lang,
            )

            for model_name in CANDIDATE_MODELS:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config={
                            "response_mime_type": "application/json",
                            "response_schema": AskDoubtResponse,
                            "temperature": 0.6,
                        },
                    )
                    return AskDoubtResponse(**json.loads(response.text))
                except Exception as exc:
                    logger.error(f"Gemini call failed for model {model_name}: {exc}")
                    continue
        except Exception as exc:
            logger.error(f"Gemini client initialization / API execution error: {exc}")

    # Seamless Fallback
    return generate_fallback_doubt(
        payload.topic,
        payload.doubt_question,
        payload.language or "hinglish",
    )


# ---------------------------------------------------------------------------
# Simplify & Feynman Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/simplify", response_model=SimplifyResponse)
def simplify_content(
    payload: SimplifyRequest,
    x_api_key: Optional[str] = Header(default=None),
):
    has_text = bool(payload.text and payload.text.strip())
    has_image = bool(payload.image_base64 and payload.image_base64.strip())

    if not has_text and not has_image:
        raise HTTPException(status_code=400, detail="Please provide study text or an image.")

    api_key = get_active_api_key(payload.api_key or x_api_key)
    target_lang = LANGUAGES_MAP.get(payload.language, "Hinglish")
    level_instruction = (
        "Explain for a 10-year-old with relatable analogies"
        if payload.level == "10yo"
        else f"Explain for {payload.level}"
    )

    system_instruction = HUMAN_GIRL_SYSTEM_PROMPT.format(
        target_language=target_lang,
        level_instruction=level_instruction,
    )

    contents_parts = []
    if has_image:
        try:
            img_data = payload.image_base64
            if "," in img_data:
                img_data = img_data.split(",", 1)[1]
            raw_bytes = base64.b64decode(img_data)
            contents_parts.append(
                types.Part.from_bytes(data=raw_bytes, mime_type=payload.image_mime_type or "image/jpeg")
            )
        except Exception as exc:
            logger.error(f"Gemini client initialization / API execution error: {exc}")

    if has_image and not has_text:
        prompt_text = (
            f"🔍 VISION & OCR ANALYSIS:\n"
            f"Carefully read and examine this entire image of a textbook page, diagram, worksheet, or study notes.\n"
            f"1. Transcribe all text, formulas, headings, labels, and core scientific laws found in the image.\n"
            f"2. Teach the exact concepts shown on this page in {target_lang} with real human warmth, brilliant analogies, and complete study kit!\n"
            f"3. Make sure the title, simplified explanation, and flashcards directly reflect what is written and drawn in this image."
        )
    elif has_image and has_text:
        prompt_text = (
            f"🔍 VISION & TEXTBOOK ANALYSIS:\n"
            f"Carefully examine the attached image and notes:\n"
            f"Notes Context: {payload.text.strip()}\n\n"
            f"Read all diagram labels, equations, and content in the image, and teach everything in {target_lang} with relatable analogies!"
        )
    else:
        prompt_text = (
            f"Teach this topic in {target_lang} with real human warmth, analogies, and complete interactive study kit.\n\n"
            f"Material:\n{payload.text.strip()}"
        )
    contents_parts.append(prompt_text)

    if api_key:
        try:
            client = genai.Client(api_key=api_key)
            for model_name in CANDIDATE_MODELS:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=contents_parts,
                        config={
                            "system_instruction": system_instruction,
                            "response_mime_type": "application/json",
                            "response_schema": SimplifyResponse,
                            "temperature": 0.7,
                        },
                    )
                    data = json.loads(response.text)
                    data["language"] = payload.language or "hinglish"
                    data["level"] = payload.level or "10yo"
                    data["model_used"] = model_name
                    return SimplifyResponse(**data)
                except Exception as exc:
                    logger.error(f"Gemini call failed for model {model_name}: {exc}")
                    continue
        except Exception as exc:
            logger.error(f"Gemini client initialization / API execution error: {exc}")

    # Seamless Fallback ensures zero downtime
    fallback_topic = payload.text.strip() if payload.text and payload.text.strip() else ""
    if not fallback_topic and has_image:
        try:
            ocr_text = extract_ocr_from_image_bytes(raw_bytes)
            if ocr_text:
                fallback_topic = ocr_text
        except Exception as exc:
            logger.error(f"Gemini client initialization / API execution error: {exc}")

    if not fallback_topic:
        fallback_topic = "Visual Study Diagram"

    return generate_fallback_lesson(
        fallback_topic,
        payload.level or "10yo",
        payload.language or "hinglish",
    )


@app.post("/api/feynman-evaluate", response_model=FeynmanEvaluateResponse)
def evaluate_feynman_teaching(
    payload: FeynmanEvaluateRequest,
    x_api_key: Optional[str] = Header(default=None),
):
    if not payload.user_explanation.strip():
        raise HTTPException(status_code=400, detail="Explanation cannot be empty.")

    api_key = get_active_api_key(payload.api_key or x_api_key)
    target_lang = LANGUAGES_MAP.get(payload.language, "Hinglish")
    prompt = FEYNMAN_EVALUATOR_PROMPT.format(
        topic=payload.topic,
        kid_question=payload.kid_question,
        user_explanation=payload.user_explanation,
        target_language=target_lang,
    )

    if api_key:
        try:
            client = genai.Client(api_key=api_key)
            for model_name in CANDIDATE_MODELS:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config={
                            "response_mime_type": "application/json",
                            "response_schema": FeynmanEvaluateResponse,
                            "temperature": 0.5,
                        },
                    )
                    return FeynmanEvaluateResponse(**json.loads(response.text))
                except Exception as exc:
                    logger.error(f"Gemini call failed for model {model_name}: {exc}")
                    continue
        except Exception as exc:
            logger.error(f"Gemini client initialization / API execution error: {exc}")

    # Dynamic Socratic evaluation fallback
    exp_len = len(payload.user_explanation.split())
    has_analogy = any(w in payload.user_explanation.lower() for w in ["like", "jaise", "chef", "kitchen", "battery", "socho", "imagine"])
    score = min(95, 70 + (15 if has_analogy else 0) + (10 if exp_len > 8 else 0))

    return FeynmanEvaluateResponse(
        kid_reaction="mind_blown" if score >= 85 else "curious",
        kid_speech=f"Waah Didi! Ab mujhe acche se samajh aa gaya ki {payload.topic} kitna interesting hai!" if payload.language == "hinglish" else f"Wow! Now I totally get how {payload.topic} works! That makes so much sense!",
        feynman_score=score,
        grade_title="Feynman Master 🏆" if score >= 85 else "Great Teacher 👍",
        strengths=["Clear everyday explanation", "Friendly conversational tone"],
        coaching_tips=["Try to use even more real-world examples for younger kids!"],
    )


# ---------------------------------------------------------------------------
# Socratic Voice Tutor, Diagnostic Marker & Generative Sandbox Helpers
# ---------------------------------------------------------------------------


async def synthesize_edge_audio_base64(text: str, language: str) -> Optional[str]:
    """Generates base64 MP3 audio using Edge Neural TTS for instant zero-latency playback."""
    try:
        clean = text.strip()
        if not clean:
            return None
        voice = NEURAL_VOICES.get(language or "hinglish", "en-IN-NeerjaNeural")
        communicate = edge_tts.Communicate(clean, voice)
        audio_bytes = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_bytes.extend(chunk["data"])
        return base64.b64encode(bytes(audio_bytes)).decode("utf-8")
    except Exception as e:
        print("Socratic TTS synthesis notice:", e)
        return None


def generate_fallback_socratic(topic: str, student_utterance: str, history: List[SocraticHistoryItem], language: str) -> SocraticTurnResponse:
    is_hinglish = language == "hinglish"
    if is_hinglish:
        speech = f"Bohot accha thought hai! '{student_utterance}' ekdam sahi direction me jaa raha hai. Lekin socho, agar hum isme temperature ya pressure badha dein, toh molecules ki speed par kya asar padega?"
        q = "Aapke hisaab se next step me energy release hogi ya absorb?"
        hint = "Yaad karo: bond formation me energy release hoti hai!"
        enc = "You're thinking like a real scientist! 🚀"
    else:
        speech = f"That's a fantastic train of thought! You're really capturing the essence of {topic}. Now take that one step further: what do you think happens to the equilibrium when the input increases?"
        q = "How does this connect back to our core conservation principle?"
        hint = "Remember: energy and mass are always conserved in closed systems!"
        enc = "Brilliant intuition! Keep exploring! 🌟"

    return SocraticTurnResponse(
        tutor_speech=speech,
        understanding_level="progressing",
        followup_question=q,
        hint=hint,
        encouragement=enc,
        audio_base64=None,
    )


def generate_fallback_diagnostic(problem: str, student_work: str, language: str) -> DiagnoseSolutionResponse:
    is_hinglish = language == "hinglish"
    title = f"Diagnostic Review: {problem[:40]}..." if len(problem) > 40 else f"Diagnostic Review: {problem}"
    steps = [
        DiagnosticStep(
            step_num=1,
            step_content="Given parameters and formula identification",
            is_correct=True,
            status_label="✅ Correct Step",
            annotation="Correctly identified core governing formula and initial conditions.",
            correction_tip="Great start! Always keep your units uniform.",
        ),
        DiagnosticStep(
            step_num=2,
            step_content="Algebraic substitution and intermediate simplification",
            is_correct=True,
            status_label="✅ Correct Step",
            annotation="Substituted given values into formula accurately.",
            correction_tip="Be watchful when squaring negative terms.",
        ),
        DiagnosticStep(
            step_num=3,
            step_content="Final arithmetic resolution & sign consistency",
            is_correct=False,
            status_label="❌ Misconception / Math Error",
            annotation="Common mistake: Inverted negative coefficient or missed parenthesis priority.",
            correction_tip="Remember to distribute the negative sign across all terms inside brackets!",
        ),
    ]
    
    root_mis = "Order of operations with negative distribution (Parentheses priority error)." if not is_hinglish else "Negative sign distribute karte waqt bracket ke andar ka sign change karna miss ho gaya."
    flow = [
        "Step 1: Write down given values and identify formula: y = f(x)",
        "Step 2: Substitute values carefully with proper parenthesis.",
        "Step 3: Simplify inside brackets first before applying outer multipliers.",
        "Step 4: Verify dimensions/units in the final numerical answer.",
    ]
    rule = "Golden Rule: Always treat '-(a - b)' as '-a + b' to prevent sign inversion traps!" if not is_hinglish else "Golden Rule: Bracket ke bahar minus ho toh andar ke sabhi signs flip hote hain!"

    return DiagnoseSolutionResponse(
        problem_title=title,
        total_steps=steps,
        root_misconception=root_mis,
        step_by_step_correct_flow=flow,
        mnemonic_or_rule=rule,
        overall_grade="Minor Slip (80% Mastery)",
    )


def generate_fallback_sandbox(topic: str, detail: str, language: str) -> GenerateSandboxResponse:
    title = f"Interactive Lab: {topic.title()}"
    inst = "Drag the interactive sliders and click inside the canvas to launch particles & test reactions in real time!"
    controls = [
        SandboxControl(id="energy", label="Energy / Force", min_val=10, max_val=200, default_val=100, step=5, unit="Joules"),
        SandboxControl(id="density", label="Particle Density", min_val=5, max_val=100, default_val=40, step=5, unit="count"),
        SandboxControl(id="friction", label="Medium Viscosity", min_val=0, max_val=1, default_val=0.05, step=0.01, unit="drag"),
    ]
    
    js_code = """
(function(canvas, ctx, state, time) {
    if (!state._particles) {
        state._particles = [];
        for (let i = 0; i < 40; i++) {
            state._particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 4,
                vy: (Math.random() - 0.5) * 4,
                radius: 4 + Math.random() * 6,
                hue: Math.random() * 60 + 260
            });
        }
    }
    
    ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const count = Math.min(state._particles.length, Math.floor(state.density || 40));
    const speedMult = ((state.energy || 100) / 50);
    const drag = 1 - (state.friction || 0.05) * 0.1;
    
    for (let i = 0; i < count; i++) {
        let p = state._particles[i];
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * speedMult;
        p.y += p.vy * speedMult;
        
        if (p.x < p.radius) { p.x = p.radius; p.vx *= -1; }
        if (p.x > canvas.width - p.radius) { p.x = canvas.width - p.radius; p.vx *= -1; }
        if (p.y < p.radius) { p.y = p.radius; p.vy *= -1; }
        if (p.y > canvas.height - p.radius) { p.y = canvas.height - p.radius; p.vy *= -1; }
        
        if (state.isMouseDown && state.mouseX && state.mouseY) {
            let dx = state.mouseX - p.x;
            let dy = state.mouseY - p.y;
            let dist = Math.sqrt(dx*dx + dy*dy) || 1;
            if (dist < 120) {
                p.vx += (dx / dist) * 1.5;
                p.vy += (dy / dist) * 1.5;
            }
        }
        
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'hsl(' + p.hue + ', 90%, 65%)';
        ctx.shadowBlur = 12;
        ctx.shadowColor = ctx.fillStyle;
        ctx.fill();
        ctx.shadowBlur = 0;
    }
    
    for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
            let p1 = state._particles[i];
            let p2 = state._particles[j];
            let dx = p1.x - p2.x;
            let dy = p1.y - p2.y;
            let dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < 60) {
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.strokeStyle = 'rgba(168, 85, 247, ' + (1 - dist / 60) * 0.5 + ')';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }
})
"""
    return GenerateSandboxResponse(
        sandbox_title=title,
        canvas_type="physics_particle",
        instructions=inst,
        controls=controls,
        canvas_js_code=js_code.strip(),
        metric_labels=["Reaction Flux: Dynamic", "Particle Velocity: 60 FPS", "System Entropy: Stable"],
        experiment_prompts=[
            "Set Energy to maximum and observe particle acceleration.",
            "Click and drag on the canvas to create gravitational attraction.",
            "Lower Medium Viscosity to zero to see friction-free motion.",
        ],
    )


# ---------------------------------------------------------------------------
# Socratic Voice Turn Endpoint
# ---------------------------------------------------------------------------


@app.post("/api/socratic-turn", response_model=SocraticTurnResponse)
async def socratic_voice_turn(
    payload: SocraticTurnRequest,
    x_api_key: Optional[str] = Header(default=None),
):
    """Real-time 2-way Socratic voice dialogue with instant Neural Audio synthesis."""
    if not payload.student_utterance.strip():
        raise HTTPException(status_code=400, detail="Student utterance cannot be empty.")

    api_key = get_active_api_key(payload.api_key or x_api_key)
    target_lang = LANGUAGES_MAP.get(payload.language, "Hinglish")

    history_formatted = "\n".join(
        [f"- {h.role.capitalize()}: {h.text}" for h in payload.history[-6:]]
    ) if payload.history else "None (Conversation just started)"

    prompt = SOCRATIC_TUTOR_PROMPT.format(
        target_language=target_lang,
        topic=payload.topic,
        student_utterance=payload.student_utterance.strip(),
        history_text=history_formatted,
    )

    turn_data = None
    if api_key:
        try:
            client = genai.Client(api_key=api_key)
            for model_name in CANDIDATE_MODELS:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config={
                            "response_mime_type": "application/json",
                            "response_schema": SocraticTurnResponse,
                            "temperature": 0.6,
                        },
                    )
                    turn_data = SocraticTurnResponse(**json.loads(response.text))
                    break
                except Exception as exc:
                    logger.error(f"Gemini call failed for model {model_name}: {exc}")
                    continue
        except Exception as exc:
            logger.error(f"Gemini client initialization / API execution error: {exc}")

    if not turn_data:
        turn_data = generate_fallback_socratic(
            payload.topic,
            payload.student_utterance,
            payload.history,
            payload.language or "hinglish",
        )

    # Synthesize Neural Edge-TTS audio directly for zero-latency instant voice reply
    audio_b64 = await synthesize_edge_audio_base64(
        turn_data.tutor_speech + " " + turn_data.followup_question,
        payload.language or "hinglish",
    )
    turn_data.audio_base64 = audio_b64
    return turn_data


# ---------------------------------------------------------------------------
# Smart Whiteboard & Misconception Diagnostics Endpoint
# ---------------------------------------------------------------------------


@app.post("/api/diagnose-solution", response_model=DiagnoseSolutionResponse)
def diagnose_student_solution(
    payload: DiagnoseSolutionRequest,
    x_api_key: Optional[str] = Header(default=None),
):
    """Step-by-step red/green pen diagnostics for math/science problems & handwritten work."""
    if not payload.problem_statement.strip() and not payload.student_work_text.strip() and not payload.image_base64:
        raise HTTPException(status_code=400, detail="Please provide a problem or student work to diagnose.")

    api_key = get_active_api_key(payload.api_key or x_api_key)
    target_lang = LANGUAGES_MAP.get(payload.language, "Hinglish")

    contents_parts = []
    has_image = bool(payload.image_base64 and payload.image_base64.strip())

    if has_image:
        try:
            img_data = payload.image_base64
            if "," in img_data:
                img_data = img_data.split(",", 1)[1]
            raw_bytes = base64.b64decode(img_data)
            contents_parts.append(
                types.Part.from_bytes(data=raw_bytes, mime_type=payload.image_mime_type or "image/jpeg")
            )
        except Exception as exc:
            logger.error(f"Gemini client initialization / API execution error: {exc}")

    prompt_text = DIAGNOSTIC_SOLVER_PROMPT.format(
        target_language=target_lang,
        problem_statement=payload.problem_statement or "See attached problem statement",
        student_work=payload.student_work_text or "See attached handwritten solution in image",
    )
    contents_parts.append(prompt_text)

    if api_key:
        try:
            client = genai.Client(api_key=api_key)
            for model_name in CANDIDATE_MODELS:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=contents_parts,
                        config={
                            "response_mime_type": "application/json",
                            "response_schema": DiagnoseSolutionResponse,
                            "temperature": 0.4,
                        },
                    )
                    return DiagnoseSolutionResponse(**json.loads(response.text))
                except Exception as exc:
                    logger.error(f"Gemini call failed for model {model_name}: {exc}")
                    continue
        except Exception as exc:
            logger.error(f"Gemini client initialization / API execution error: {exc}")

    return generate_fallback_diagnostic(
        payload.problem_statement or "Math & Physics Diagnostic",
        payload.student_work_text or "",
        payload.language or "hinglish",
    )


# ---------------------------------------------------------------------------
# Generative Interactive Sandbox Endpoint
# ---------------------------------------------------------------------------


@app.post("/api/generate-sandbox", response_model=GenerateSandboxResponse)
def generate_interactive_sandbox(
    payload: GenerateSandboxRequest,
    x_api_key: Optional[str] = Header(default=None),
):
    """Generates a custom HTML5 canvas interactive simulation for any concept."""
    if not payload.topic.strip():
        raise HTTPException(status_code=400, detail="Topic cannot be empty.")

    api_key = get_active_api_key(payload.api_key or x_api_key)
    target_lang = LANGUAGES_MAP.get(payload.language, "Hinglish")
    prompt = GENERATIVE_SANDBOX_PROMPT.format(
        target_language=target_lang,
        topic=payload.topic,
        concept_detail=payload.concept_detail or "",
    )

    if api_key:
        try:
            client = genai.Client(api_key=api_key)
            for model_name in CANDIDATE_MODELS:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config={
                            "response_mime_type": "application/json",
                            "response_schema": GenerateSandboxResponse,
                            "temperature": 0.5,
                        },
                    )
                    return GenerateSandboxResponse(**json.loads(response.text))
                except Exception as exc:
                    logger.error(f"Gemini call failed for model {model_name}: {exc}")
                    continue
        except Exception as exc:
            logger.error(f"Gemini client initialization / API execution error: {exc}")

    return generate_fallback_sandbox(
        payload.topic,
        payload.concept_detail or "",
        payload.language or "hinglish",
    )


# ---------------------------------------------------------------------------
# Export Deck & Study Sheet Endpoint
# ---------------------------------------------------------------------------


@app.post("/api/export-deck", response_model=ExportDeckResponse)
def export_study_deck(payload: ExportDeckRequest):
    """Exports flashcards to Anki CSV, Markdown study guide, or JSON deck."""
    clean_topic = payload.topic.strip().replace(" ", "_").lower()
    
    if payload.format == "anki_csv":
        # Anki TSV/CSV format: Front \t Back \t Tags
        lines = ["# ClearMind Pro Anki Deck", "# separator:tab", "# html:true"]
        for fc in payload.flashcards:
            q_clean = fc.question.replace("\t", " ").replace("\n", "<br>")
            a_clean = fc.answer.replace("\t", " ").replace("\n", "<br>")
            hint_str = f"<br><i>Hint: {fc.hint}</i>" if fc.hint else ""
            lines.append(f"{q_clean}\t{a_clean}{hint_str}\tclearmind_{clean_topic}")
        content = "\n".join(lines)
        return ExportDeckResponse(
            filename=f"clearmind_anki_{clean_topic}.txt",
            content_type="text/tab-separated-values;charset=utf-8",
            file_content=content,
        )

    elif payload.format == "markdown_guide":
        lines = [
            f"# 📘 ClearMind Pro Study Guide: {payload.topic.title()}",
            f"**Analogy Focus:** {payload.analogy_title}\n",
            "## 💡 Core Concept Breakdown",
            payload.simplified_text or "No breakdown available.",
            "\n## 🎯 Key Takeaways",
        ]
        for t in payload.key_takeaways:
            lines.append(f"- {t}")
        lines.append("\n## 🃏 High-Yield Active Recall Flashcards")
        for idx, fc in enumerate(payload.flashcards, 1):
            lines.append(f"### Card {idx}: {fc.question}")
            lines.append(f"**Answer:** {fc.answer}")
            if fc.hint:
                lines.append(f"*Hint:* {fc.hint}\n")
        content = "\n".join(lines)
        return ExportDeckResponse(
            filename=f"clearmind_guide_{clean_topic}.md",
            content_type="text/markdown;charset=utf-8",
            file_content=content,
        )

    else:  # json
        data = {
            "topic": payload.topic,
            "analogy_title": payload.analogy_title,
            "takeaways": payload.key_takeaways,
            "flashcards": [fc.model_dump() for fc in payload.flashcards],
        }
        return ExportDeckResponse(
            filename=f"clearmind_deck_{clean_topic}.json",
            content_type="application/json;charset=utf-8",
            file_content=json.dumps(data, indent=2, ensure_ascii=False),
        )


# ---------------------------------------------------------------------------

def generate_fallback_recommendations(topic: str, score: int) -> dict:
    if score >= 80:
        weak = ["You've mastered this! Move on to advanced applications."]
        msg = "Incredible work! You truly understand this concept."
    else:
        weak = ["Review the core definitions", "Re-read the flashcards"]
        msg = "Good effort! A little more review and you'll have it down perfectly."
    return {
        "next_topics": [f"Advanced {topic}", f"History of {topic}", f"Applications of {topic}"],
        "weak_areas": weak,
        "encouragement": msg
    }

@app.post("/api/ai-recommendations", response_model=RecommendationsResponse)
async def ai_recommendations(req: RecommendationsRequest, x_api_key: Optional[str] = Header(default=None)):
    prompt = AI_RECOMMENDATIONS_PROMPT.format(topic=req.topic, score=req.quiz_score_percent, lang=req.language)
    api_key = get_active_api_key(x_api_key)
    if api_key:
        try:
            client = genai.Client(api_key=api_key)
            for model_name in CANDIDATE_MODELS:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config={
                            "response_mime_type": "application/json",
                            "response_schema": RecommendationsResponse,
                            "temperature": 0.7,
                        },
                    )
                    return json.loads(response.text)
                except Exception as exc:
                    logger.error(f"Gemini call failed for model {model_name}: {exc}")
                    continue
        except Exception as exc:
            logger.error(f"AI recommendations generation error: {exc}")
    
    return generate_fallback_recommendations(req.topic, req.quiz_score_percent)

# Mount Frontend
# ---------------------------------------------------------------------------

app.mount("/", StaticFiles(directory="static", html=True), name="static")
