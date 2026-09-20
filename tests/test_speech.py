"""Offline speech regression tests; never import main or initialize its database."""
import ast
import asyncio
import base64
import hashlib
import hmac
import html
import io
import json
import logging
from pathlib import Path
import re
import sys
import time
import types
from typing import Any, Dict, List, Literal, Optional
import unittest
from unittest.mock import AsyncMock, Mock, patch

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import Response as PlainResponse
from pydantic import BaseModel, Field, ValidationError


SOURCE = Path(__file__).resolve().parents[1] / "main.py"


def load_speech_module():
    """Compile allowlisted definitions only: no dotenv, DB, cloud SDK, or startup."""
    definitions = {
        "add_no_cache_header", "clean_speech_text", "speech_voice_candidates",
        "split_speech_thoughts", "speech_prosody", "_synthesize_voice_chunk",
        "synthesize_speech", "synthesize_edge_audio_base64", "TTSRequest",
        "AnalogyCard", "ChatTeachRequest", "ChatTeachResponse", "generate_tts",
        "get_language_directive", "safe_parse_json", "chat_teach", "rate_limit",
        "_sign", "_b64e", "_b64d", "make_session_token", "get_session_user_id",
        "get_bearer_token", "require_session",
    }
    constants = {
        "NEURAL_VOICES", "VOICE_CANDIDATES", "MALE_NEURAL_VOICES",
        "TTS_ATTEMPT_TIMEOUT", "TTS_TOTAL_TIMEOUT", "_TTS_SEMAPHORE", "_RATE_BUCKETS", "_RATE_LOCK",
    }
    parsed = ast.parse(SOURCE.read_text(encoding="utf-8"), filename=str(SOURCE))
    selected = []
    for node in parsed.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name in definitions:
            selected.append(node)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if any(isinstance(target, ast.Name) and target.id in constants for target in targets):
                selected.append(node)
    module = types.ModuleType("clearmind_speech_under_test")
    module.__dict__.update({name: value for name, value in globals().items() if not name.startswith("__")})
    module.__dict__.update(
        app=FastAPI(), logger=logging.getLogger("speech-tests"),
        edge_tts=types.SimpleNamespace(Communicate=Mock(side_effect=AssertionError("Unmocked synthesis"))),
        ADMIN_SESSION_SECRET="test-only-admin-secret", STUDENT_SESSION_SECRET="test-only-session-secret",
        STUDENT_TOKEN_TTL_SECONDS=3600, execute_dual_ai_completion=AsyncMock(return_value=None),
        genai_types=types.SimpleNamespace(),
    )
    sys.modules[module.__name__] = module
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(SOURCE), "exec"), module.__dict__)
    return module


class SpeechParserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend = load_speech_module()

    def clean(self, value, language="hinglish"):
        return self.backend.clean_speech_text(value, language)

    def test_squared_fraction_root_and_greek(self):
        self.assertEqual(self.clean(r"x^2 + \frac{a}{b}"), "x squared plus a divided by b")
        self.assertEqual(self.clean(r"\sqrt{x^2} + \alpha"), "square root of the quantity x squared end quantity plus alpha")
        self.assertIn("to the power of", self.clean("x^{n+1}"))
        self.assertIn("cubed", self.clean("x^3"))

    def test_nested_fractions_preserve_grouping(self):
        result = self.clean(r"\frac{1}{\frac{a+b}{c}}")
        self.assertEqual(result.count("divided by"), 2)
        self.assertIn("the quantity a plus b end quantity", result)
        self.assertIn("1 divided by the quantity", result)
        self.assertNotRegex(result, r"[{}\\]")

    def test_chemistry_subscripts(self):
        for source in ("H_2O", "H_{2}O", "H\u2082O"):
            self.assertEqual(self.clean(source), "H two O")
        self.assertEqual(self.clean("CO\u2082"), "CO two")
        self.assertEqual(self.clean("x\u00b2"), "x squared")

    def test_big_o_and_ordinary_prose(self):
        self.assertEqual(self.clean(r"Big O(n \log n)"), "Big O of n log n")
        self.assertEqual(self.clean(r"O(n \log(n))"), "Big O of n log n")
        text = "An ODE models change. Try a real-world step-by-step example."
        self.assertEqual(self.clean(text), text)

    def test_comparators_negative_and_algebra_subtraction(self):
        self.assertEqual(self.clean("x < y"), "x less than y")
        self.assertEqual(self.clean("x-y"), "x minus y")
        self.assertEqual(self.clean("x >= -3.14"), "x greater than or equal to minus 3.14")
        self.assertEqual(self.clean("a <= b"), "a less than or equal to b")
        self.assertIn("divided by", self.clean("dy/dx"))

    def test_hindi_math_and_hinglish_vocabulary(self):
        result = self.clean(r"x^2 + \frac{a}{b} = -2", "hi")
        for word in ("का वर्ग", "जोड़", "भाग", "बराबर", "घटा"):
            self.assertIn(word, result)
        self.assertIn("squared", self.clean("x^2", "hinglish"))

    def test_markup_and_emoji_components_removed(self):
        value = "<speak>**Key** `x^2`</speak> _idea_ # heading " + "\U0001f1ee\U0001f1f3 \U0001f469\u200d\U0001f4bb 1\ufe0f\u20e3"
        result = self.clean(value)
        self.assertEqual(result, "Key x squared idea heading")
        self.assertEqual(self.clean("<break time='220ms'/>"), "")
        self.assertEqual(self.clean("```python\nprint('hidden')\n```"), "")
        self.assertEqual(self.clean("&lt;emphasis&gt;hello&lt;/emphasis&gt;"), "hello")

    def test_unknown_commands_and_deep_input_are_safe(self):
        self.assertIn("value", self.clean(r"\unknown{value}"))
        self.assertIn("x", self.clean("{" * 100 + "x" + "}" * 100))
        self.assertEqual(self.clean(""), "")

    def test_chunk_boundaries_and_decimal_integrity(self):
        sentence = "A decimal such as 3.14 stays together with the rest of this thoughtful explanation."
        clean = self.clean((sentence + " ") * 30)
        chunks = self.backend.split_speech_thoughts(clean)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= 700 for chunk in chunks))
        self.assertEqual(" ".join(chunks), clean)
        self.assertEqual(sum(chunk.count("3.14") for chunk in chunks), 30)
        self.assertTrue(all(chunk.endswith(".") for chunk in chunks))

    def test_request_defaults_allowlists_and_length(self):
        req = self.backend.TTSRequest(text="Hello")
        self.assertEqual(req.response_format, "mp3")
        self.assertEqual(req.voice_gender, "female")
        self.assertTrue(self.backend.ChatTeachRequest(message="Hello").include_audio)
        for kwargs in ({"voice_gender": "arbitrary-voice"}, {"response_format": "ssml"}, {"text": "x" * 5001}):
            with self.assertRaises(ValidationError):
                self.backend.TTSRequest(**dict({"text": "Hello"}, **kwargs))

    def test_voice_candidates_and_supported_prosody(self):
        for lang in ("hinglish", "hi", "en"):
            self.assertEqual(self.backend.speech_voice_candidates(lang)[0], self.backend.NEURAL_VOICES[lang])
        self.assertEqual(self.backend.speech_voice_candidates("hinglish")[1:], ["en-IN-NeerjaNeural", "en-IN-PrabhatNeural"])
        self.assertEqual(self.backend.speech_voice_candidates("en", "male")[0], "en-US-AndrewMultilingualNeural")
        self.assertEqual(self.backend.speech_voice_candidates("hi", "male")[0], "hi-IN-MadhurNeural")
        self.assertEqual(self.backend.speech_voice_candidates("unknown"), self.backend.speech_voice_candidates("hinglish"))
        self.assertEqual(self.backend.speech_prosody("Hello", False), ("+3%", "+1Hz"))
        self.assertEqual(self.backend.speech_prosody("Why?"), ("+2%", "+3Hz"))
        self.assertEqual(self.backend.speech_prosody("Remember this concept."), ("-1%", "+1Hz"))


class SpeechAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.backend = load_speech_module()
        self.calls = []
        self.active = 0
        self.peak = 0
        self.cancelled = 0
        self.mode = "success"
        outer = self

        class Communicate:
            def __init__(self, text, voice, *, rate, pitch):
                self.text, self.voice = text, voice
                outer.calls.append((text, voice, rate, pitch))

            async def stream(self):
                outer.active += 1
                outer.peak = max(outer.peak, outer.active)
                try:
                    if outer.mode == "reject" or (outer.mode == "first-reject" and self.voice == outer.backend.NEURAL_VOICES["hinglish"]):
                        raise RuntimeError("Provider rejected request containing private text")
                    if outer.mode == "hang":
                        await asyncio.Event().wait()
                    await asyncio.sleep(0.001)
                    if outer.mode == "empty":
                        return
                    yield {"type": "audio", "data": (self.voice + "|" + self.text).encode("utf-8")}
                except asyncio.CancelledError:
                    outer.cancelled += 1
                    raise
                finally:
                    outer.active -= 1

        self.backend.edge_tts.Communicate = Communicate
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.backend.app), base_url="http://test")
        token = self.backend.make_session_token("speech-test")
        self.headers = {"Authorization": "Bearer " + token}

    async def asyncTearDown(self):
        await self.client.aclose()
        self.assertEqual(self.active, 0, "Upstream work leaked after test")

    async def post(self, body, path="/api/tts"):
        return await self.client.post(path, json=body, headers=self.headers)

    async def test_aliases_require_auth(self):
        for path in ("/api/tts", "/tts", "/api/chat-teach", "/chat-teach"):
            response = await self.client.post(path, json={"text": "Hello", "message": "Hello"})
            self.assertEqual(response.status_code, 401)
        self.assertEqual(self.calls, [])

    async def test_default_mp3_does_not_truncate(self):
        text = "A complete explanation needs all of its sentences. " * 30
        response = await self.post({"text": text})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "audio/mpeg")
        self.assertEqual(self.calls[0][0], text.strip())
        self.assertGreater(len(self.calls[0][0]), 500)
        self.assertEqual(self.calls[0][2:], ("+3%", "+1Hz"))
        self.assertEqual(response.headers["x-voice-gender"], "female")
        self.assertEqual(response.headers["x-voice-name"], self.backend.NEURAL_VOICES["hinglish"])

    async def test_chunks_are_complete_ordered_and_bounded(self):
        text = "Think carefully about the decimal 3.14 and its role in this equation. " * 45
        response = await self.post({"text": text, "response_format": "chunks"}, "/tts")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertGreater(len(data["chunks"]), 1)
        self.assertEqual(data["speech_text"], text.strip())
        self.assertEqual(data["voice_gender"], "female")
        voices = {chunk["voice"] for chunk in data["chunks"]}
        self.assertEqual(len(voices), 1)
        decoded = [base64.b64decode(chunk["audio_base64"]).decode().split("|", 1)[1] for chunk in data["chunks"]]
        self.assertEqual(" ".join(decoded), text.strip())
        self.assertTrue(all(chunk["pause_after_ms"] == 220 for chunk in data["chunks"][:-1]))
        self.assertEqual(data["chunks"][-1]["pause_after_ms"], 0)
        self.assertLessEqual(self.peak, 3)
        self.assertEqual(len(next(iter(self.backend._RATE_BUCKETS.values()))), 1)

    async def test_fallback_restarts_with_one_voice(self):
        self.mode = "first-reject"
        response = await self.post({"text": "This is a full thought about educational concepts. " * 35, "response_format": "chunks"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual({chunk["voice"] for chunk in response.json()["chunks"]}, {"en-IN-NeerjaNeural"})
        self.assertEqual(response.json()["voice_gender"], "female")

    async def test_empty_or_failed_provider_returns_503_without_text_logs(self):
        for mode in ("empty", "reject"):
            self.mode = mode
            with self.assertLogs("speech-tests", level="INFO") as logs:
                response = await self.post({"text": "private text"})
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("private text", " ".join(logs.output))

    async def test_timeout_cancels_and_awaits_all_work(self):
        self.mode = "hang"
        self.backend.TTS_ATTEMPT_TIMEOUT = 0.02
        self.backend.TTS_TOTAL_TIMEOUT = 0.04
        response = await self.post({"text": "An explanation needs patient complete sentences. " * 45, "response_format": "chunks"})
        self.assertEqual(response.status_code, 504)
        self.assertGreater(self.cancelled, 0)
        self.assertEqual(self.active, 0)
        self.assertEqual(self.backend._TTS_SEMAPHORE._value, 3)

    async def test_global_concurrency_across_requests(self):
        text = "A sentence with enough context to make the learner think carefully. " * 30
        first, second = await asyncio.gather(self.post({"text": text, "response_format": "chunks"}), self.post({"text": text, "response_format": "chunks"}))
        self.assertEqual((first.status_code, second.status_code), (200, 200))
        self.assertLessEqual(self.peak, 3)

    async def test_empty_cleaned_and_invalid_requests(self):
        for body in ({"text": "** ` ` #"}, {"text": "<break/>"}, {"text": "x" * 5001}, {"text": "Hello", "voice_gender": "other"}, {"text": "Hello", "response_format": "wav"}):
            response = await self.post(body)
            self.assertEqual(response.status_code, 422)
        self.assertEqual(self.calls, [])

    async def test_existing_rate_limit_shared_by_aliases(self):
        for index in range(30):
            response = await self.post({"text": "Hello"}, "/tts" if index % 2 else "/api/tts")
            self.assertEqual(response.status_code, 200)
        response = await self.post({"text": "Hello"})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(len(self.calls), 30)

    async def test_legacy_helper_full_text_and_optional_failure(self):
        text = "Explain this concept completely. " * 30
        self.assertIsNotNone(await self.backend.synthesize_edge_audio_base64(text))
        self.assertEqual(self.calls[-1][0], text.strip())
        self.mode = "reject"
        self.assertIsNone(await self.backend.synthesize_edge_audio_base64("Hello"))

    async def test_chat_include_audio_false_and_language(self):
        self.backend.execute_dual_ai_completion = AsyncMock(return_value=json.dumps({"reply_text": "x^2 + 2 = 6", "detected_topic": "Algebra"}))
        response = await self.client.post("/api/chat-teach", json={"message": "Explain algebra", "language": "hi", "include_audio": False}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["audio_base64"])
        self.assertIn("का वर्ग", response.json()["speech_text"])
        self.assertEqual(self.calls, [])
        self.backend.execute_dual_ai_completion = AsyncMock(return_value=None)
        response = await self.client.post("/chat-teach", json={"message": "Hello", "include_audio": False}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.calls, [])

    async def test_chat_default_full_reply_and_male_voice(self):
        text = "A thorough explanation includes every sentence. " * 15
        self.backend.execute_dual_ai_completion = AsyncMock(return_value=json.dumps({"reply_text": text, "detected_topic": "Algebra"}))
        response = await self.client.post("/api/chat-teach", json={"message": "Explain algebra", "voice_gender": "male"}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["speech_text"], text.strip())
        self.assertEqual(self.calls[0][0], text.strip())
        self.assertEqual(self.calls[0][1], "en-IN-PrabhatNeural")

    async def test_chat_truncated_speech_text_prefers_full_reply(self):
        teaser = "Awesome! Let's start from zero."
        full_lesson = "Relations and functions are fundamental. " * 10
        self.backend.execute_dual_ai_completion = AsyncMock(return_value=json.dumps({
            "reply_text": full_lesson,
            "speech_text": teaser,
            "detected_topic": "Relations and Functions"
        }))
        response = await self.client.post("/api/chat-teach", json={"message": "Relations and Functions", "include_audio": False}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["speech_text"], full_lesson.strip())

    async def test_microphone_is_same_origin_only(self):
        response = await self.post({"text": "Hello"})
        self.assertEqual(response.headers["permissions-policy"], "geolocation=(), microphone=(self), camera=()")


if __name__ == "__main__":
    unittest.main()
