"use strict";
// Browser smoke test: local source only, stubbed provider + audio (no synthesis).
// Run with Playwright available through NODE_PATH.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || "msedge" });
  try {
    const page = await browser.newPage();
    const errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.dismiss());
    await page.addInitScript(() => {
      localStorage.setItem("clearmind_sound", "false");
      localStorage.setItem("clearmind_setup_completed", "true");
      localStorage.setItem("clearmind_v20_clean_slate", "true");
      localStorage.setItem("clearmind_auth_user", JSON.stringify({ user_id: "test", name: "Test", session_token: "test-only" }));
      window.testSources = [];
      const param = () => ({ value: 1, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; }, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
      window.AudioContext = class {
        constructor() { this.state = "running"; this.currentTime = 1; this.destination = {}; }
        resume() { this.state = "running"; return Promise.resolve(); }
        suspend() { this.state = "suspended"; return Promise.resolve(); }
        decodeAudioData() { return Promise.resolve({ duration: 1, length: 1000, sampleRate: 1000, numberOfChannels: 1, getChannelData() { return new Float32Array(1000).fill(0.1); } }); }
        createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
        createAnalyser() { return { frequencyBinCount: 64, connect() {}, disconnect() {}, getByteFrequencyData(a) { a.fill(50); } }; }
        createOscillator() { return { frequency: param(), connect() {}, start() {}, stop() {} }; }
        createBufferSource() {
          const node = { connect() {}, disconnect() {}, start(at) { this.started = at; }, stop() { this.stopped = true; } };
          window.testSources.push(node); return node;
        }
      };
      window.SpeechRecognition = class { start() {} stop() {} };
    });
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== "https://clearmind.test") {
        return route.fulfill({ contentType: "application/javascript", body: url.hostname.includes("tailwind") ? "window.tailwind = {};" : "" });
      }
      if (url.pathname === "/api/tts") {
        requests.push({ body: route.request().postDataJSON(), headers: route.request().headers() });
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ voice_gender: requests.at(-1).body.voice_gender, chunks: [{ audio_base64: "AA==", pause_after_ms: 220 }, { audio_base64: "AA==", pause_after_ms: 0 }] }) });
      }
      if (url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: "{}" });
      const relative = url.pathname === "/classroom" ? "app.html" : url.pathname.replace(/^\//, "");
      const file = path.join(root, relative);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: file });
    });
    await page.goto("https://clearmind.test/classroom?preview=1", { waitUntil: "domcontentloaded" });
    const listen = page.locator(".chat-listen-btn").first();
    await listen.waitFor();
    assert.equal(await page.locator("#voiceGenderSelect").inputValue(), "female");
    await listen.dispatchEvent("click"); // Offline CDN stubs omit layout utilities; test event wiring.
    await page.waitForFunction(() => document.querySelector(".chat-listen-btn")?.textContent === "Pause voice");
    assert.equal(requests[0].body.voice_gender, "female");
    assert.equal(requests[0].headers.authorization, "Bearer test-only");
    assert.equal(await page.evaluate(() => window.testSources.length), 2);
    await listen.dispatchEvent("click"); // Offline CDN stubs omit layout utilities; test event wiring.
    await page.waitForFunction(() => document.querySelector(".chat-listen-btn")?.textContent === "Resume voice");
    await listen.dispatchEvent("click"); // Offline CDN stubs omit layout utilities; test event wiring.
    await page.waitForFunction(() => document.querySelector(".chat-listen-btn")?.textContent === "Pause voice");
    await page.locator("#chatMessageInput").fill("Another question");
    assert.equal(await listen.textContent(), "Listen with voice");
    assert.equal(await page.evaluate(() => window.testSources.every(node => node.stopped)), true);
    await page.locator("#voiceGenderSelect").selectOption("male");
    await listen.dispatchEvent("click"); // Offline CDN stubs omit layout utilities; test event wiring.
    await page.waitForFunction(() => document.querySelector(".chat-listen-btn")?.textContent === "Pause voice");
    assert.equal(requests.at(-1).body.voice_gender, "male");
    await page.locator("#chatMicBtn").dispatchEvent("click");
    assert.equal(await listen.textContent(), "Listen with voice");
    assert.equal(await page.evaluate(() => window.testSources.every(node => node.stopped)), true);
    assert.deepEqual(errors, []);
    console.log("Browser smoke PASS: full app bootstrap, auth, female default, male toggle, pause/resume, typed interruption, mic interruption; no page errors.");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
