"use strict";
// No audio is generated. Test the actual client controller with a fake audio clock.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const controller = source.slice(source.indexOf("  // One cancellable owner"), source.indexOf("  // 60-SECOND COMPREHENSIVE"));
const auth = source.slice(source.indexOf("  // Read the session token"), source.indexOf("  window.cmOnSessionExpired ="));
function harness(options = {}) {
  const requests = [], notices = [], starts = [], timers = new Map(), frames = new Map(), sources = [];
  const storage = new Map([["clearmind_auth_user", JSON.stringify({ session_token: "test-only" })]]);
  let serial = 0, cancelled = 0;
  const parameter = () => ({ value: 1, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; } });
  class Context {
    constructor() { this.currentTime = 10; this.state = "running"; this.destination = {}; }
    resume() { this.state = "running"; return Promise.resolve(); }
    suspend() { this.state = "suspended"; return Promise.resolve(); }
    decodeAudioData() { return options.decode ? options.decode() : Promise.resolve(buffer()); }
    createGain() { return { gain: parameter(), connect() {}, disconnect() {} }; }
    createAnalyser() { return { frequencyBinCount: 64, connect() {}, disconnect() {}, getByteFrequencyData(data) { data.fill(30); } }; }
    createBufferSource() {
      const item = { connect() {}, disconnect() {}, start(...args) { starts.push(args); }, stop(time) { this.stopped = time; } };
      sources.push(item); return item;
    }
  }
  const sandbox = {
    console, AbortController, Uint8Array, Blob, URL, Headers,
    atob: value => Buffer.from(value, "base64").toString("binary"),
    performance: { now: () => 100 },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    document: { getElementById: () => null, querySelectorAll: () => [] },
    setTimeout: (fn, ms) => { timers.set(++serial, { fn, ms }); return serial; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { frames.set(++serial, fn); return serial; },
    cancelAnimationFrame: id => frames.delete(id),
    AudioContext: Context,
    speechSynthesis: { cancel() { ++cancelled; }, speak() { throw Error("System voice must never be used"); } },
    setAudioWaveformActive: active => { sandbox.waveActive = active; },
    showToast: text => notices.push(text),
    fetch: async (url, init) => {
      requests.push({ url, init });
      return options.fetch ? options.fetch(url, init) : response();
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`let speechContext = null, speechSession = null, speechGeneration = 0, voiceIntentVersion = 0;
    let activeVoiceGender = "female", activeLanguage = "hinglish", soundEnabled = true;
    ${auth}\n${controller}\n
    globalThis.api = { startNeuralSpeech, toggleVoiceAudio, interruptSpeech, pauseOrResumeSpeech, speechPlaybackBounds,
      state: () => ({ session: speechSession, generation: speechGeneration, intent: voiceIntentVersion }),
      male: () => { activeVoiceGender = "male"; } };`, sandbox);
  return { ...sandbox, requests, notices, starts, sources, frames, timers, storage, cancelled: () => cancelled };
}
function buffer() { return { length: 1000, sampleRate: 1000, duration: 1, numberOfChannels: 1, getChannelData: () => new Float32Array(1000).fill(0.1) }; }
function response(status = 200) { return { ok: status === 200, status, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ voice_gender: "female", chunks: [{ audio_base64: "AA==", pause_after_ms: 220 }, { audio_base64: "AA==", pause_after_ms: 0 }] }) }; }
function button() { return { disabled: false, attrs: {}, setAttribute(key, value) { this.attrs[key] = value; } }; }
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

test("female default, auth header, one request, no paid API key", async () => {
  const h = harness();
  await h.api.startNeuralSpeech("x^2 and H_2O", button());
  assert.equal(h.requests.length, 1);
  const req = h.requests[0].init;
  assert.equal(req.headers.get("authorization"), "Bearer test-only");
  assert.equal(req.headers.has("X-Gemini-Key"), false);
  assert.equal(JSON.parse(req.body).voice_gender, "female");
  assert.equal(JSON.parse(req.body).response_format, "chunks");
  assert.equal(JSON.parse(req.body).text, "x^2 and H_2O");
});

test("all chunks are scheduled up front with only the intended 220ms transition", async () => {
  const h = harness();
  await h.api.startNeuralSpeech("First thought. Next thought.", button());
  assert.equal(h.starts.length, 2);
  assert.ok(Math.abs(h.starts[1][0] - h.starts[0][0] - 1.22) < 1e-9);
  assert.equal(h.api.state().session.loading, false);
  h.sources[0].onended();
  assert.ok(h.api.state().session);
  h.sources[1].onended();
  assert.equal(h.api.state().session, null);
  assert.equal(h.frames.size, 0);
});

test("interrupt aborts requests, fades all scheduled sources and clears controls", async () => {
  const h = harness(), btn = button();
  await h.api.startNeuralSpeech("Speech", btn);
  h.api.interruptSpeech();
  assert.equal(h.api.state().session, null);
  assert.equal(h.requests[0].init.signal.aborted, true);
  assert.ok(h.sources.every(item => item.stopped === 10.045));
  assert.equal(btn.textContent, "Listen with voice");
  assert.equal(h.frames.size, 0);
  assert.ok(h.cancelled() >= 2);
});

test("late network completion cannot restart cancelled speech", async () => {
  let resolve;
  const h = harness({ fetch: () => new Promise(done => { resolve = done; }) });
  const pending = h.api.startNeuralSpeech("Old speech", button());
  h.api.interruptSpeech();
  resolve(response()); await pending;
  assert.equal(h.starts.length, 0);
  assert.equal(h.api.state().session, null);
});

test("late audio decoding cannot restart cancelled speech", async () => {
  let resolve;
  const h = harness({ decode: () => new Promise(done => { resolve = done; }) });
  const pending = h.api.startNeuralSpeech("Old speech", button());
  await flush();
  assert.equal(typeof resolve, "function");
  h.api.interruptSpeech(); resolve(buffer()); await pending;
  assert.equal(h.starts.length, 0);
});

test("replaced session ignores old ended callback", async () => {
  const h = harness();
  await h.api.startNeuralSpeech("First", button());
  const oldEnd = h.sources[1].onended;
  await h.api.startNeuralSpeech("Second", button());
  const current = h.api.state().session;
  oldEnd();
  assert.equal(h.api.state().session, current);
});

test("pause and resume preserve clock-scheduled narration", async () => {
  const h = harness(), btn = button();
  await h.api.startNeuralSpeech("Speech", btn);
  const session = h.api.state().session;
  await h.api.pauseOrResumeSpeech(session);
  assert.equal(session.paused, true);
  assert.equal(btn.textContent, "Resume voice");
  await h.api.pauseOrResumeSpeech(session);
  assert.equal(session.paused, false);
  assert.equal(btn.textContent, "Pause voice");
  assert.equal(h.requests.length, 1);
});

for (const status of [401, 429, 422, 503]) test(`HTTP ${status} never triggers system voice or retry storm`, async () => {
  const h = harness({ fetch: async () => response(status) }), btn = button();
  await h.api.startNeuralSpeech("Speech", btn);
  assert.equal(h.api.state().session, null);
  assert.equal(h.requests.length, 1);
  assert.equal(h.starts.length, 0);
  assert.equal(h.notices.length, 1);
  assert.equal(btn.disabled, false);
});

test("male selection propagates to request", async () => {
  const h = harness(); h.api.male();
  await h.api.startNeuralSpeech("Speech", button());
  assert.equal(JSON.parse(h.requests[0].init.body).voice_gender, "male");
});

test("client timeout aborts in-flight work and unlocks UI", async () => {
  const h = harness({ fetch: () => new Promise(() => {}) }), btn = button();
  void h.api.startNeuralSpeech("Speech", btn);
  [...h.timers.values()].find(timer => timer.ms === 50000).fn();
  assert.equal(h.api.state().session, null);
  assert.equal(h.requests[0].init.signal.aborted, true);
  assert.equal(btn.disabled, false);
});

test("empty and oversized passages do not hit provider", async () => {
  const h = harness();
  await h.api.startNeuralSpeech(" ", button());
  await h.api.startNeuralSpeech("a".repeat(5001), button());
  assert.equal(h.requests.length, 0);
});

test("source wiring covers mic, typed interruption, voice selection and stale chat autoplay", () => {
  assert.match(source, /chatInput\.addEventListener\("input", interruptSpeech\)/);
  assert.match(source, /chatMicBtn[\s\S]{0,100}interruptSpeech\(\)/);
  assert.match(source, /include_audio: false/);
  assert.match(source, /appendLunaMessage\(data, autoplayIntent\)/);
  assert.match(source, /autoplayIntent === voiceIntentVersion/);
  assert.match(source, /voiceSelect\.addEventListener\("change"/);
});

test("root/static frontend assets are identical", () => {
  for (const name of ["app.js", "app.html", "style.css"]) {
    assert.deepEqual(fs.readFileSync(path.join(__dirname, "..", name)), fs.readFileSync(path.join(__dirname, "../static", name)), name);
  }
});
