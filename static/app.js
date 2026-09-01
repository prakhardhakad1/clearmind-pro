/**
 * ClearMind Pro v4.0 — Unified Educational Master Controller
 * Socratic Voice Mode, AI Smart Whiteboard, Generative Labs, 3D Flashcards & Anki Export
 */

(function () {
  "use strict";

  // ------------------------------------------------------------------ State
  let currentLanguage = "hinglish";
  let currentLevel = "10yo";
  let currentImageBase64 = null;
  let currentImageMime = "image/jpeg";
  let activeStudyData = null;


  let totalXP = parseInt(localStorage.getItem('clearmind_xp') || '0');
  let studentProfile = JSON.parse(localStorage.getItem('clearmind_profile') || '{"name":"Alex","avatar":"🧠","grade":"High School","goal":"Master Core Concepts"}');

  let studyHistory = JSON.parse(localStorage.getItem('clearmind_history') || '[]');
  let currentStreak = parseInt(localStorage.getItem('clearmind_streak') || '1');
  let lastStudyDate = localStorage.getItem('clearmind_last_study_date');

  let allFlipped = false;
  let isDarkMode = false;
  let isSfxEnabled = true;

  // Studio Neural Audio State
  let neuralAudio = null;
  let isAudioPlaying = false;
  let highlightInterval = null;

  // Socratic Voice State
  let socraticHistory = [];
  let socraticRecognition = null;
  let isSocraticListening = false;
  let socraticAudio = null;

  // Quick Test State
  let selectedQuizCount = 5;
  let selectedQuizDiff = "easy";
  let quizQuestions = [];
  let currentQuizIndex = 0;
  let currentQuizScore = 0;

  // Whiteboard Canvas State
  let wbCanvas = null;
  let wbCtx = null;
  let wbIsDrawing = false;
  let wbTool = "pen"; // "pen" | "eraser"
  let wbColor = "#4f46e5";
  let wbLineWidth = 3;

  // Dynamic Sandbox State
  let customLabAnimId = null;
  let customLabState = {
    _particles: [],
    mouseX: 0,
    mouseY: 0,
    isMouseDown: false,
  };
  let customLabRenderFn = null;

  // ------------------------------------------------------------------ Audio Synthesizer (SFX)
  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playSfx(type) {
    if (!isSfxEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      if (type === "click") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(400, now + 0.05);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === "flip") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.08);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === "correct") {
        [523.25, 659.25, 783.99].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + i * 0.06);
          gain.gain.setValueAtTime(0.15, now + i * 0.06);
          gain.gain.linearRampToValueAtTime(0.01, now + i * 0.06 + 0.25);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + i * 0.06);
          osc.stop(now + i * 0.06 + 0.25);
        });
      } else if (type === "wrong") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.setValueAtTime(120, now + 0.1);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.22);
      } else if (type === "level_up") {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + i * 0.08);
          gain.gain.setValueAtTime(0.2, now + i * 0.08);
          gain.gain.linearRampToValueAtTime(0.01, now + i * 0.08 + 0.35);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + i * 0.08);
          osc.stop(now + i * 0.08 + 0.35);
        });
      }
    } catch (e) {
      console.warn("SFX synthesis error:", e);
    }
  }

  function addXP(amount) {
    totalXP += amount;
    localStorage.setItem('clearmind_xp', totalXP);
    const xpEl = document.getElementById("xpScore");
    if (xpEl) xpEl.textContent = totalXP;
    updateDashboard();
    initProfileModal();
  }

  function checkStreak() {
    const today = new Date().toISOString().split('T')[0];
    if (lastStudyDate === today) return; // Already studied today
    
    if (lastStudyDate) {
      const lastDate = new Date(lastStudyDate);
      const todayDate = new Date(today);
      const diffTime = Math.abs(todayDate - lastDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
      
      if (diffDays === 1) {
        currentStreak++;
      } else if (diffDays > 1) {
        currentStreak = 1;
      }
    } else {
      currentStreak = 1;
    }
    
    lastStudyDate = today;
    localStorage.setItem('clearmind_streak', currentStreak);
    localStorage.setItem('clearmind_last_study_date', lastStudyDate);
    
    const streakEl = document.getElementById("streakCount");
    if (streakEl) streakEl.textContent = currentStreak;
    updateDashboard();
    initProfileModal();
  }

  function recordStudySession(topic) {
    checkStreak();
    const existing = studyHistory.find(h => h.topic === topic);
    if (!existing) {
      studyHistory.push({ topic: topic, date: new Date().toISOString(), mastery: 0 });
      localStorage.setItem('clearmind_history', JSON.stringify(studyHistory));
      updateDashboard();
    initProfileModal();
    }
  }

  function updateStudyMastery(topic, scorePercent) {
    const session = studyHistory.find(h => h.topic === topic);
    if (session) {
      session.mastery = Math.max(session.mastery, scorePercent);
      localStorage.setItem('clearmind_history', JSON.stringify(studyHistory));
      updateDashboard();
    initProfileModal();
    }
  }

  function updateDashboard() {
    const dashXP = document.getElementById('dashTotalXP');
    const dashStreak = document.getElementById('dashStreak');
    const dashTopics = document.getElementById('dashTopicsCount');
    const dashList = document.getElementById('dashHistoryList');
    
    if (dashXP) dashXP.textContent = totalXP;
    if (dashStreak) dashStreak.textContent = currentStreak;
    if (dashTopics) dashTopics.textContent = studyHistory.length;
    
    if (dashList && studyHistory.length > 0) {
      dashList.innerHTML = studyHistory.slice().reverse().map(h => `
        <div class="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
          <div>
            <p class="text-sm font-bold text-slate-800 dark:text-slate-200">${h.topic}</p>
            <p class="text-[10px] text-slate-500">${new Date(h.date).toLocaleDateString()}</p>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-20 h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
              <div class="h-full bg-emerald-500" style="width: ${h.mastery}%"></div>
            </div>
            <span class="text-xs font-bold text-slate-700 dark:text-slate-300">${h.mastery}%</span>
          </div>
        </div>
      `).join('');
    }
  }


  // ------------------------------------------------------------------ DOM Elements
  const languageSelect      = document.getElementById("languageSelect");
  const sfxToggleBtn        = document.getElementById("sfxToggleBtn");
  const sfxIcon             = document.getElementById("sfxIcon");
  const themeToggleBtn      = document.getElementById("themeToggleBtn");
  const themeIcon           = document.getElementById("themeIcon");
  const navTabs             = document.querySelectorAll(".nav-tab");
  const tabPanes            = document.querySelectorAll(".tab-pane");

  // Study Studio
  const levelPills          = document.querySelectorAll(".level-pill");
  const sampleButtons       = document.querySelectorAll(".sample-btn");
  const inputText           = document.getElementById("inputText");
  const submitBtn           = document.getElementById("submitBtn");
  const demoBtn             = document.getElementById("demoBtn");
  const btnLabel            = document.getElementById("btnLabel");
  const spinner             = document.getElementById("spinner");
  const statusMsg           = document.getElementById("statusMsg");
  const errorBox            = document.getElementById("errorBox");
  const errorMsgText        = document.getElementById("errorMsgText");

  // Vision
  const dropzone            = document.getElementById("dropzone");
  const imageInput          = document.getElementById("imageInput");
  const dropzonePrompt      = document.getElementById("dropzonePrompt");
  const imagePreviewContainer = document.getElementById("imagePreviewContainer");
  const imagePreview        = document.getElementById("imagePreview");
  const clearImageBtn       = document.getElementById("clearImageBtn");

  // Results
  const resultsSection      = document.getElementById("results");
  const analogyTitle        = document.getElementById("analogyTitle");
  const levelBadge          = document.getElementById("levelBadge");
  const lunaGreetingText    = document.getElementById("lunaGreetingText");
  const simplifiedText      = document.getElementById("simplifiedText");
  const keyTakeawaysList    = document.getElementById("keyTakeawaysList");
  const conceptMapContainer = document.getElementById("conceptMapContainer");
  const flashcardsGrid      = document.getElementById("flashcardsGrid");
  const flipAllBtn          = document.getElementById("flipAllBtn");
  const copyBtn             = document.getElementById("copyBtn");
  const copyBtnText         = document.getElementById("copyBtnText");

  // Studio Voice Player
  const speakBtn            = document.getElementById("speakBtn");
  const speakBtnText        = document.getElementById("speakBtnText");
  const speakIcon           = document.getElementById("speakIcon");
  const soundWave           = document.getElementById("soundWave");
  const stopVoiceBtn        = document.getElementById("stopVoiceBtn");

  // Doubt Solver Modal
  const openDoubtBtn        = document.getElementById("openDoubtBtn");
  const doubtModal          = document.getElementById("doubtModal");
  const closeDoubtModal     = document.getElementById("closeDoubtModal");
  const doubtInput          = document.getElementById("doubtInput");
  const doubtMicBtn         = document.getElementById("doubtMicBtn");
  const doubtMicLabel       = document.getElementById("doubtMicLabel");
  const submitDoubtBtn      = document.getElementById("submitDoubtBtn");
  const doubtBtnText        = document.getElementById("doubtBtnText");
  const doubtSpinner        = document.getElementById("doubtSpinner");
  const doubtAnswerContainer= document.getElementById("doubtAnswerContainer");
  const doubtAnswerText     = document.getElementById("doubtAnswerText");
  const doubtAnalogyText    = document.getElementById("doubtAnalogyText");

  // API Key Modal
  const apiKeyBtn           = document.getElementById("apiKeyBtn");
  const apiKeyBtnLabel      = document.getElementById("apiKeyBtnLabel");
  const apiStatusDot        = document.getElementById("apiStatusDot");
  const apiKeyModal         = document.getElementById("apiKeyModal");
  const closeKeyModal       = document.getElementById("closeKeyModal");
  const cancelKeyBtn        = document.getElementById("cancelKeyBtn");
  const saveKeyBtn          = document.getElementById("saveKeyBtn");
  const apiKeyInput         = document.getElementById("apiKeyInput");
  const keySaveStatus       = document.getElementById("keySaveStatus");

  // Quick Test Arena
  const quizCountBtns       = document.querySelectorAll(".quiz-count-btn");
  const quizDiffBtns        = document.querySelectorAll(".quiz-diff-btn");
  const startQuizBtn        = document.getElementById("startQuizBtn");
  const startQuizBtnText    = document.getElementById("startQuizBtnText");
  const quizSpinner         = document.getElementById("quizSpinner");
  const quizConfigBox       = document.getElementById("quizConfigBox");
  const liveQuizContainer   = document.getElementById("liveQuizContainer");
  const currentQNum         = document.getElementById("currentQNum");
  const totalQNum           = document.getElementById("totalQNum");
  const quizScoreTracker    = document.getElementById("quizScoreTracker");
  const quizProgressBar     = document.getElementById("quizProgressBar");
  const quizQuestionText    = document.getElementById("quizQuestionText");
  const quizOptionsGrid     = document.getElementById("quizOptionsGrid");
  const quizInstantFeedback = document.getElementById("quizInstantFeedback");
  const nextQuizQBtn        = document.getElementById("nextQuizQBtn");
  const quizScoreCard       = document.getElementById("quizScoreCard");
  const finalScoreNum       = document.getElementById("finalScoreNum");
  const finalPercentNum     = document.getElementById("finalPercentNum");
  const finalBadge          = document.getElementById("finalBadge");
  const finalComment        = document.getElementById("finalComment");
  const retakeQuizBtn       = document.getElementById("retakeQuizBtn");

  // Feynman Arena
  const leoAvatarReaction   = document.getElementById("leoAvatarReaction");
  const leoQuestionText     = document.getElementById("leoQuestionText");
  const feynmanTeachingInput= document.getElementById("feynmanTeachingInput");
  const feynmanMicBtn       = document.getElementById("feynmanMicBtn");
  const feynmanMicLabel     = document.getElementById("feynmanMicLabel");
  const submitFeynmanBtn    = document.getElementById("submitFeynmanBtn");
  const feynmanBtnText      = document.getElementById("feynmanBtnText");
  const feynmanSpinner      = document.getElementById("feynmanSpinner");
  const feynmanResultContainer = document.getElementById("feynmanResultContainer");
  const feynmanGradeTitle   = document.getElementById("feynmanGradeTitle");
  const feynmanScoreNum     = document.getElementById("feynmanScoreNum");
  const leoSpeechText       = document.getElementById("leoSpeechText");
  const feynmanTipsBox      = document.getElementById("feynmanTipsBox");
  const feynmanTipsList     = document.getElementById("feynmanTipsList");

  // Export Toolbar
  const exportAnkiBtn       = document.getElementById("exportAnkiBtn");
  const exportMarkdownBtn   = document.getElementById("exportMarkdownBtn");
  const printSheetBtn       = document.getElementById("printSheetBtn");

  // Socratic Voice Tab Elements
  const socraticListenBtn   = document.getElementById("socraticListenBtn");
  const socraticListenBtnLabel = document.getElementById("socraticListenBtnLabel");
  const socraticClearHistoryBtn = document.getElementById("socraticClearHistoryBtn");
  const socraticSoundWave   = document.getElementById("socraticSoundWave");
  const socraticChatHistory = document.getElementById("socraticChatHistory");
  const socraticCoachCard   = document.getElementById("socraticCoachCard");
  const socraticFollowupText = document.getElementById("socraticFollowupText");
  const socraticHintBox     = document.getElementById("socraticHintBox");
  const socraticHintText    = document.getElementById("socraticHintText");
  const socraticUnderstandingMeter = document.getElementById("socraticUnderstandingMeter");
  const socraticTextInput   = document.getElementById("socraticTextInput");
  const socraticTextSubmitBtn = document.getElementById("socraticTextSubmitBtn");
  const socraticOrbBtn      = document.getElementById("socraticOrbBtn");
  const socraticOrbStatus   = document.getElementById("socraticOrbStatus");

  // Whiteboard Diagnostics Elements
  const whiteboardCanvas    = document.getElementById("whiteboardCanvas");
  const whiteboardClearBtn  = document.getElementById("whiteboardClearBtn");
  const wbToolPen           = document.getElementById("wbToolPen");
  const wbToolEraser        = document.getElementById("wbToolEraser");
  const wbColorPicker       = document.getElementById("wbColorPicker");
  const diagProblemInput    = document.getElementById("diagProblemInput");
  const diagTextSteps       = document.getElementById("diagTextSteps");
  const runDiagnosticBtn    = document.getElementById("runDiagnosticBtn");
  const diagBtnLabel        = document.getElementById("diagBtnLabel");
  const diagSpinner         = document.getElementById("diagSpinner");
  const diagnosticResultsContainer = document.getElementById("diagnosticResultsContainer");
  const diagProblemTitle    = document.getElementById("diagProblemTitle");
  const diagGradeBadge      = document.getElementById("diagGradeBadge");
  const diagRootMisconception = document.getElementById("diagRootMisconception");
  const diagStepsList       = document.getElementById("diagStepsList");
  const diagCorrectFlowList = document.getElementById("diagCorrectFlowList");
  const diagRuleText        = document.getElementById("diagRuleText");

  // Generative Dynamic Labs Elements
  const customLabTopicInput = document.getElementById("customLabTopicInput");
  const generateCustomLabBtn= document.getElementById("generateCustomLabBtn");
  const genSimCanvas        = document.getElementById("genSimCanvas");
  const genControlsContainer= document.getElementById("genControlsContainer");
  const genExperimentPrompts= document.getElementById("genExperimentPrompts");
  const dynamicLabTitle     = document.getElementById("dynamicLabTitle");
  const genCanvasStatus     = document.getElementById("genCanvasStatus");
  const labPresetBtns       = document.querySelectorAll(".lab-preset-btn");

  // ------------------------------------------------------------------ Tab Switcher
  function switchTab(targetId) {
    playSfx("click");
    navTabs.forEach((tab) => {
      if (tab.dataset.tab === targetId) {
        tab.classList.add("active");
        tab.classList.remove("text-slate-600", "dark:text-slate-400");
      } else {
        tab.classList.remove("active");
        tab.classList.add("text-slate-600", "dark:text-slate-400");
      }
    });

    tabPanes.forEach((pane) => {
      if (pane.id === targetId) {
        pane.classList.remove("hidden");
        pane.classList.add("animate-fade-in");
      } else {
        pane.classList.add("hidden");
      }
    });

    if (targetId === "tab-whiteboard") {
      initWhiteboard();
    } else if (targetId === "tab-sandbox") {
      initDefaultLab();
    }
  }

  navTabs.forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // ------------------------------------------------------------------ Theme & SFX Toggles
  function initTheme() {
    const saved = localStorage.getItem("clearmind_theme");
    if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      isDarkMode = true;
      document.documentElement.classList.add("dark");
      if (themeIcon) themeIcon.textContent = "☀️";
    } else {
      isDarkMode = false;
      document.documentElement.classList.remove("dark");
      if (themeIcon) themeIcon.textContent = "🌙";
    }
  }

  if (themeToggleBtn) {
    if (themeToggleBtn) themeToggleBtn.addEventListener("click", () => {
      playSfx("click");
      isDarkMode = !isDarkMode;
      if (isDarkMode) {
        document.documentElement.classList.add("dark");
        localStorage.setItem("clearmind_theme", "dark");
        if (themeIcon) themeIcon.textContent = "☀️";
      } else {
        document.documentElement.classList.remove("dark");
        localStorage.setItem("clearmind_theme", "light");
        if (themeIcon) themeIcon.textContent = "🌙";
      }
    });
  }

  if (sfxToggleBtn) {
    if (sfxToggleBtn) sfxToggleBtn.addEventListener("click", () => {
      isSfxEnabled = !isSfxEnabled;
      if (isSfxEnabled) {
        playSfx("click");
        if (sfxIcon) sfxIcon.textContent = "🔊";
      } else {
        if (sfxIcon) sfxIcon.textContent = "🔇";
      }
    });
  }

  // ------------------------------------------------------------------ API Key Management
  async function checkApiStatus() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      if (data.has_api_key) {
        if (apiStatusDot) apiStatusDot.className = "w-2 h-2 rounded-full bg-emerald-500";
        if (apiKeyBtnLabel) apiKeyBtnLabel.textContent = "Ready";
      } else {
        if (apiStatusDot) apiStatusDot.className = "w-2 h-2 rounded-full bg-amber-500";
        if (apiKeyBtnLabel) apiKeyBtnLabel.textContent = "Set Key";
      }
    } catch (e) {
      console.warn("Status check notice:", e);
    }
  }

  if (apiKeyBtn) {
    if (apiKeyBtn) apiKeyBtn.addEventListener("click", () => {
      playSfx("click");
      apiKeyModal.classList.remove("hidden");
    });
  }
  if (closeKeyModal) closeKeyModal.addEventListener("click", () => apiKeyModal.classList.add("hidden"));
  if (cancelKeyBtn) cancelKeyBtn.addEventListener("click", () => apiKeyModal.classList.add("hidden"));

  if (saveKeyBtn) {
    if (saveKeyBtn) saveKeyBtn.addEventListener("click", async () => {
      playSfx("click");
      const key = apiKeyInput.value.trim();
      if (!key) return;
      saveKeyBtn.disabled = true;
      try {
        const res = await fetch("/api/save-key", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: key }),
        });
        if (res.ok) {
          keySaveStatus.textContent = "✅ Key saved successfully!";
          keySaveStatus.className = "text-xs py-2 px-3 rounded-lg font-medium text-emerald-700 bg-emerald-50";
          keySaveStatus.classList.remove("hidden");
          setTimeout(() => {
            apiKeyModal.classList.add("hidden");
            checkApiStatus();
          }, 800);
        } else {
          keySaveStatus.textContent = "❌ Failed to save key.";
          keySaveStatus.className = "text-xs py-2 px-3 rounded-lg font-medium text-red-700 bg-red-50";
          keySaveStatus.classList.remove("hidden");
        }
      } catch (e) {
        keySaveStatus.textContent = "Error saving key: " + e.message;
        keySaveStatus.classList.remove("hidden");
      } finally {
        saveKeyBtn.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------------ Language & Audience Selectors
  if (languageSelect) {
    if (languageSelect) languageSelect.addEventListener("change", () => {
      playSfx("click");
      currentLanguage = languageSelect.value;
    });
  }

  levelPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      playSfx("click");
      levelPills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      currentLevel = pill.dataset.level;
    });
  });

  // ------------------------------------------------------------------ 1-Click Topic Presets
  const TOPIC_PRESETS = {
    photosynthesis: "Photosynthesis process in plants (Light reaction & Calvin cycle in chloroplasts)",
    quantum: "Quantum Superposition and Schrodinger's wave function collapse",
    blackholes: "Einstein's General Relativity: Gravitational Time Dilation and Black Hole Event Horizons",
    mitochondria: "Cellular Respiration: How Mitochondria produce ATP via the Electron Transport Chain",
  };

  sampleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      playSfx("click");
      const sample = btn.dataset.sample;
      if (TOPIC_PRESETS[sample]) {
        inputText.value = TOPIC_PRESETS[sample];
        inputText.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  });

  // ------------------------------------------------------------------ Image OCR & Vision Upload
  function handleImageFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    currentImageMime = file.type;
    const reader = new FileReader();
    reader.onload = (e) => {
      currentImageBase64 = e.target.result;
      imagePreview.src = currentImageBase64;
      dropzonePrompt.classList.add("hidden");
      imagePreviewContainer.classList.remove("hidden");
      clearImageBtn.classList.remove("hidden");
      playSfx("click");
    };
    reader.readAsDataURL(file);
  }

  if (imageInput) {
    if (imageInput) imageInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) handleImageFile(e.target.files[0]);
    });
  }

  if (clearImageBtn) {
    if (clearImageBtn) clearImageBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      currentImageBase64 = null;
      imageInput.value = "";
      imagePreviewContainer.classList.add("hidden");
      dropzonePrompt.classList.remove("hidden");
      clearImageBtn.classList.add("hidden");
      playSfx("click");
    });
  }

  if (dropzone) {
    if (dropzone) dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    if (dropzone) dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    if (dropzone) dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleImageFile(e.dataTransfer.files[0]);
      }
    });
  }

  // ------------------------------------------------------------------ Study Studio Form Submit
  async function generateStudyKit(overrideText = null) {
    const text = overrideText !== null ? overrideText : inputText.value.trim();
    if (!text && !currentImageBase64) {
      showError("Please enter study notes or upload a textbook photo.");
      return;
    }

    clearError();
    submitBtn.disabled = true;
    if (demoBtn) demoBtn.disabled = true;
    spinner.classList.remove("hidden");
    const skeleton = document.getElementById('studySkeleton');
    if (skeleton) skeleton.classList.remove('hidden');
    resultsSection.classList.add('hidden');
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });

    btnLabel.textContent = "🌸 Luna is Teaching...";
    statusMsg.textContent = "Synthesizing metaphors, knowledge map & active-recall kit...";

    try {
      const res = await fetch("/api/simplify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text,
          image_base64: currentImageBase64,
          image_mime_type: currentImageMime,
          level: currentLevel,
          language: currentLanguage,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to generate study kit.");
      }

      const data = await res.json();
      activeStudyData = data;
      recordStudySession(activeStudyData.analogy_title);
      renderStudyKit(data);
      playSfx("correct");
      addXP(50);
    } catch (err) {
      console.error("Study Kit Generation Error:", err);
      showError("Something went wrong generating your study kit — please try again.");
    } finally {
      submitBtn.disabled = false;
      if (demoBtn) demoBtn.disabled = false;
      spinner.classList.add("hidden");
      const skeleton = document.getElementById('studySkeleton');
      if (skeleton) skeleton.classList.add('hidden');
      resultsSection.classList.remove('hidden');
      btnLabel.textContent = "🌸 Teach Me, Luna!";
      statusMsg.textContent = "";
    }
  }

  if (submitBtn) submitBtn.addEventListener("click", () => generateStudyKit());
  if (demoBtn) {
    if (demoBtn) demoBtn.addEventListener("click", () => {
      inputText.value = "How does Quantum Superposition allow quantum computers to calculate exponentially faster?";
      generateStudyKit();
    });
  }

  // ------------------------------------------------------------------ Render Study Results
  function renderStudyKit(data) {
    resultsSection.classList.remove("hidden");
    analogyTitle.textContent = data.analogy_title || "🌿 Concept Breakdown";
    levelBadge.textContent = data.level ? data.level.toUpperCase() : "LEVEL 10";
    lunaGreetingText.textContent = `"${data.warm_greeting || "Let's make this crystal clear!"}"`;

    // Render Explanation Text with Karaoke spans
    const sentences = (data.simplified_text || "").split(/(?<=[.?!])\s+/);
    simplifiedText.innerHTML = sentences
      .map((s, idx) => `<span class="speaking-sentence" data-sindex="${idx}">${s}</span>`)
      .join(" ");

    // Key Takeaways
    keyTakeawaysList.innerHTML = (data.key_takeaways || [])
      .map(
        (t) => `
        <div class="bg-purple-50/60 dark:bg-slate-800/80 p-3.5 rounded-2xl border border-purple-100 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-start gap-2">
          <span class="text-purple-600 dark:text-purple-400">✨</span>
          <span>${t}</span>
        </div>`
      )
      .join("");

    // Mermaid Diagram
    renderMermaidMap(data.concept_map_mermaid);

    // Feynman Leo Question
    if (data.feynman_challenge) {
      leoQuestionText.textContent = `"${data.feynman_challenge.kid_initial_question || "Why does this happen?"}"`;
      feynmanResultContainer.classList.add("hidden");
      feynmanTeachingInput.value = "";
    }

    // 3D Flashcards
    renderFlashcards(data.flashcards || []);

    // Sequential Learning Pathway / Next Chapters
    renderLearningPathway(data.learning_pathway || []);

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function sanitizeMermaid(raw) {
    if (!raw) return "graph TD\n  A[Start] --> B[Concept]";
    let code = raw.trim();
    // Strip markdown fences
    code = code.replace(/```(?:mermaid)?/g, "").replace(/```/g, "").trim();
    if (!code.startsWith("graph") && !code.startsWith("flowchart")) {
      code = "graph TD\n" + code;
    }
    // Clean dangerous special characters inside nodes
    code = code.replace(/\[(.*?)\]/g, (match, inner) => {
      const sanitized = inner.replace(/["\(\)\{\}\;]/g, " ").trim();
      return `["${sanitized}"]`;
    });
    return code;
  }

  async function renderMermaidMap(mermaidCode) {
    if (!conceptMapContainer) return;
    // Remove any previous error bombs injected by Mermaid
    document.querySelectorAll('[id^="dmermaid"], [id^="mermaid-"], svg[aria-roledescription="error"]').forEach(el => el.remove());

    if (!mermaidCode) {
      conceptMapContainer.innerHTML = '<p class="text-xs text-slate-400 italic">Visual map generating...</p>';
      return;
    }

    try {
      if (typeof mermaid !== "undefined") {
        mermaid.initialize({
          startOnLoad: false,
          theme: isDarkMode ? "dark" : "default",
          securityLevel: "loose",
          suppressErrorRendering: true,
          fontFamily: "Inter, sans-serif"
        });
        const clean = sanitizeMermaid(mermaidCode);
        const uniqueId = "mermaidSvg_" + Math.random().toString(36).substring(2, 9);
        const { svg } = await mermaid.render(uniqueId, clean);
        conceptMapContainer.innerHTML = svg;
      }
    } catch (e) {
      console.warn("Mermaid render fallback:", e);
      // Clean error bomb from DOM immediately
      document.querySelectorAll('[id^="dmermaid"], [id^="mermaid-"], svg[aria-roledescription="error"]').forEach(el => el.remove());
      // Render a clean visual flowchart fallback
      conceptMapContainer.innerHTML = `
        <div class="flex flex-wrap items-center justify-center gap-3 p-4 bg-purple-50/60 dark:bg-purple-950/40 rounded-2xl border border-purple-200 dark:border-purple-800">
          <div class="px-4 py-2 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-purple-300 dark:border-slate-750 text-xs font-bold text-purple-900 dark:text-purple-200">🌱 Core Input</div>
          <span class="text-purple-500 font-bold">➔</span>
          <div class="px-4 py-2 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-purple-300 dark:border-slate-750 text-xs font-bold text-purple-900 dark:text-purple-200">⚡ Transformation Process</div>
          <span class="text-purple-500 font-bold">➔</span>
          <div class="px-4 py-2 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-purple-300 dark:border-slate-750 text-xs font-bold text-purple-900 dark:text-purple-200">🎯 Key Output & Master Rule</div>
        </div>
      `;
    }
  }

  // ------------------------------------------------------------------ 3D Flashcards with Spaced Repetition
  function renderFlashcards(cards) {
    if (!flashcardsGrid) return;
    flashcardsGrid.innerHTML = cards
      .map(
        (c, idx) => `
      <div class="flip-card cursor-pointer" data-card-idx="${idx}" tabindex="0">
        <div class="flip-card-inner">
          <!-- Front Face -->
          <div class="flip-card-front">
            <div>
              <span class="card-badge card-badge-q">Card ${idx + 1} • Question</span>
              <p class="mt-4 text-sm font-bold text-slate-900 dark:text-white leading-relaxed">${c.question}</p>
            </div>
            <div class="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-purple-600 dark:text-purple-400 font-bold">
              <span>👆 Click to Reveal</span>
              ${c.hint ? `<span title="${c.hint}">💡 Hint</span>` : ""}
            </div>
          </div>

          <!-- Back Face -->
          <div class="flip-card-back">
            <div>
              <span class="card-badge card-badge-a">Answer</span>
              <p class="mt-3 text-xs font-semibold leading-relaxed">${c.answer}</p>
            </div>
            <!-- Spaced Repetition Rating Buttons -->
            <div class="pt-3 border-t border-white/20 flex items-center justify-center gap-1.5" onclick="event.stopPropagation()">
              <button class="sr-rate-btn px-2 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-[10px] font-bold text-white transition" data-rate="hard" data-card="${idx}">🔴 Hard (1d)</button>
              <button class="sr-rate-btn px-2 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-[10px] font-bold text-white transition" data-rate="good" data-card="${idx}">🟡 Good (3d)</button>
              <button class="sr-rate-btn px-2 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-[10px] font-bold text-white transition" data-rate="easy" data-card="${idx}">🟢 Easy (7d)</button>
            </div>
          </div>
        </div>
      </div>`
      )
      .join("");

    // Flip Card Click Handlers
    document.querySelectorAll(".flip-card").forEach((card) => {
      card.addEventListener("click", () => {
        playSfx("flip");
        card.classList.toggle("flipped");
      });
    });

    // Spaced Repetition Buttons
    document.querySelectorAll(".sr-rate-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        playSfx("click");
        const rate = btn.dataset.rate;
        btn.parentElement.innerHTML = `<span class="text-[11px] font-bold text-emerald-300">✅ Scheduled (+10 XP)</span>`;
        addXP(10);
      });
    });
  }

  if (flipAllBtn) {
    if (flipAllBtn) flipAllBtn.addEventListener("click", () => {
      playSfx("flip");
      allFlipped = !allFlipped;
      document.querySelectorAll(".flip-card").forEach((card) => {
        if (allFlipped) card.classList.add("flipped");
        else card.classList.remove("flipped");
      });
      flipAllBtn.textContent = allFlipped ? "Unflip All Cards" : "Flip All Cards";
    });
  }

  // ------------------------------------------------------------------ Studio Neural Voice Audio Player
  async function playStudioVoice() {
    if (!activeStudyData || !activeStudyData.simplified_text) return;

    if (isAudioPlaying && neuralAudio) {
      neuralAudio.pause();
      isAudioPlaying = false;
      speakBtnText.textContent = "Resume Neural Voice";
      soundWave.classList.add("hidden");
      stopVoiceBtn.classList.add("hidden");
      return;
    }

    speakBtnText.textContent = "Connecting Studio Voice...";
    speakBtn.disabled = true;

    try {
      const fullSpeech = `${activeStudyData.warm_greeting}. ${activeStudyData.simplified_text}`;
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: fullSpeech,
          language: currentLanguage,
        }),
      });

      if (!res.ok) throw new Error("TTS voice generation failed.");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (neuralAudio) {
        neuralAudio.pause();
        if (neuralAudio._blobUrl) URL.revokeObjectURL(neuralAudio._blobUrl);
      }
      neuralAudio = new Audio(url);
      neuralAudio._blobUrl = url;

      neuralAudio.onplay = () => {
        isAudioPlaying = true;
        speakBtnText.textContent = "Pause Luna Voice";
        speakIcon.textContent = "⏸️";
        soundWave.classList.remove("hidden");
        soundWave.classList.add("flex");
        stopVoiceBtn.classList.remove("hidden");
      };

      neuralAudio.onended = () => {
        isAudioPlaying = false;
        speakBtnText.textContent = "Replay Luna Voice";
        speakIcon.textContent = "🎧";
        soundWave.classList.add("hidden");
        stopVoiceBtn.classList.add("hidden");
        document.querySelectorAll(".speaking-sentence").forEach((s) => s.classList.remove("active-speaking"));
      };

      neuralAudio.play();
    } catch (e) {
      console.error("Studio TTS Error:", e);
      showError("Could not play audio explanation — please try again in a moment.");
      speakBtnText.textContent = "Listen to Luna";
    } finally {
      speakBtn.disabled = false;
    }
  }

  if (speakBtn) speakBtn.addEventListener("click", () => playStudioVoice());
  if (stopVoiceBtn) {
    if (stopVoiceBtn) stopVoiceBtn.addEventListener("click", () => {
      if (neuralAudio) {
        neuralAudio.pause();
        neuralAudio.currentTime = 0;
      }
      isAudioPlaying = false;
      speakBtnText.textContent = "Listen to Luna";
      speakIcon.textContent = "🎧";
      soundWave.classList.add("hidden");
      stopVoiceBtn.classList.add("hidden");
    });
  }

  // ------------------------------------------------------------------ "Teach Curious Leo" Feynman Arena
  if (feynmanMicBtn) {
    if (feynmanMicBtn) feynmanMicBtn.addEventListener("click", () => {
      playSfx("click");
      startSimpleSpeechToText((transcript) => {
        feynmanTeachingInput.value = transcript;
      }, feynmanMicLabel);
    });
  }

  if (submitFeynmanBtn) {
    if (submitFeynmanBtn) submitFeynmanBtn.addEventListener("click", async () => {
      const exp = feynmanTeachingInput.value.trim();
      if (!exp) return;
      playSfx("click");
      submitFeynmanBtn.disabled = true;
      feynmanSpinner.classList.remove("hidden");
      feynmanBtnText.textContent = "Leo is thinking...";

      try {
        const res = await fetch("/api/feynman-evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: activeStudyData ? activeStudyData.analogy_title : "Study Topic",
            kid_question: leoQuestionText.textContent,
            user_explanation: exp,
            language: currentLanguage,
          }),
        });

        const data = await res.json();
        feynmanResultContainer.classList.remove("hidden");
        feynmanScoreNum.textContent = data.feynman_score;
        feynmanGradeTitle.textContent = data.grade_title;
        feynmanGradeTitle.className = `text-xs font-black px-3 py-1 rounded-full ${
          data.feynman_score >= 80 ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"
        }`;
        leoSpeechText.textContent = `"${data.kid_speech}"`;

        if (data.feynman_score >= 80) {
          playSfx("level_up");
          try { confetti({ particleCount: 60, spread: 60, origin: { y: 0.7 } }); } catch(_) {}
          addXP(40);
        } else {
          playSfx("correct");
          addXP(20);
        }

        feynmanTipsList.innerHTML = (data.coaching_tips || [])
          .map((tip) => `<li>${tip}</li>`)
          .join("");
      } catch (e) {
        console.error("Feynman Evaluation Error:", e);
        showError("Unable to evaluate your explanation right now — please try again.");
      } finally {
        submitFeynmanBtn.disabled = false;
        feynmanSpinner.classList.add("hidden");
        feynmanBtnText.textContent = "👦 Tell Leo";
      }
    });
  }

  // ------------------------------------------------------------------ Quick Test Arena (5-20 Qs)
  quizCountBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      playSfx("click");
      quizCountBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedQuizCount = parseInt(btn.dataset.count);
    });
  });

  quizDiffBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      playSfx("click");
      quizDiffBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedQuizDiff = btn.dataset.diff;
    });
  });

  if (startQuizBtn) {
    if (startQuizBtn) startQuizBtn.addEventListener("click", async () => {
      const topic = activeStudyData ? activeStudyData.analogy_title : inputText.value.trim() || "Science & Logic";
      playSfx("click");
      startQuizBtn.disabled = true;
      quizSpinner.classList.remove("hidden");
      startQuizBtnText.textContent = "Generating Exam...";

      try {

        // Adaptive Difficulty Logic
        let adaptiveDiff = selectedQuizDiff;
        if (topic) {
          const session = studyHistory.find(h => h.topic === topic);
          if (session) {
            if (session.mastery >= 80) adaptiveDiff = 'hard';
            else if (session.mastery < 50) adaptiveDiff = 'easy';
          }
        }
        
        const res = await fetch("/api/generate-quiz", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: topic,
            count: selectedQuizCount,
            difficulty: adaptiveDiff,
            language: currentLanguage,
          }),
        });

        const data = await res.json();
        quizQuestions = data.questions || [];
        currentQuizIndex = 0;
        currentQuizScore = 0;

        quizConfigBox.classList.add("hidden");
        liveQuizContainer.classList.remove("hidden");
        quizScoreCard.classList.add("hidden");
        renderCurrentQuizQuestion();
      } catch (e) {
        console.error("Quiz Generation Error:", e);
        showError("Unable to generate quiz questions — please try again.");
      } finally {
        startQuizBtn.disabled = false;
        quizSpinner.classList.add("hidden");
        startQuizBtnText.textContent = "🚀 Generate & Start Test";
      }
    });
  }

  function renderCurrentQuizQuestion() {
    if (currentQuizIndex >= quizQuestions.length) {
      showQuizFinalScore();
      return;
    }

    const q = quizQuestions[currentQuizIndex];
    currentQNum.textContent = currentQuizIndex + 1;
    totalQNum.textContent = quizQuestions.length;
    quizScoreTracker.textContent = `Score: ${currentQuizScore}`;
    quizProgressBar.style.width = `${((currentQuizIndex + 1) / quizQuestions.length) * 100}%`;

    quizQuestionText.textContent = q.question;
    quizInstantFeedback.classList.add("hidden");
    nextQuizQBtn.classList.add("hidden");

    quizOptionsGrid.innerHTML = q.options
      .map(
        (opt, idx) => `
        <button class="quiz-opt-card" data-opt-idx="${idx}">
          <span class="mr-1 text-purple-600 dark:text-purple-400 font-bold">${String.fromCharCode(65 + idx)}.</span> ${opt}
        </button>`
      )
      .join("");

    quizOptionsGrid.querySelectorAll(".quiz-opt-card").forEach((card) => {
      card.addEventListener("click", () => {
        const chosen = parseInt(card.dataset.optIdx);
        evaluateQuizAnswer(chosen, q);
      });
    });
  }

  function evaluateQuizAnswer(chosenIdx, questionObj) {
    const isCorrect = chosenIdx === questionObj.correct_option_index;
    const cards = quizOptionsGrid.querySelectorAll(".quiz-opt-card");
    cards.forEach((c) => (c.disabled = true));

    if (isCorrect) {
      playSfx("correct");
      cards[chosenIdx].classList.add("correct");
      currentQuizScore += 1;
      addXP(15);
      quizInstantFeedback.innerHTML = `<span class="text-emerald-700 dark:text-emerald-300 font-bold">✅ Correct!</span> ${questionObj.explanation}`;
      quizInstantFeedback.className = "text-xs p-3.5 rounded-xl font-medium bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200";
    } else {
      playSfx("wrong");
      cards[chosenIdx].classList.add("incorrect");
      cards[questionObj.correct_option_index].classList.add("correct");
      quizInstantFeedback.innerHTML = `<span class="text-red-700 dark:text-red-300 font-bold">❌ Incorrect.</span> ${questionObj.explanation}`;
      quizInstantFeedback.className = "text-xs p-3.5 rounded-xl font-medium bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-900 dark:text-red-200";
    }

    quizInstantFeedback.classList.remove("hidden");
    nextQuizQBtn.classList.remove("hidden");
    quizScoreTracker.textContent = `Score: ${currentQuizScore}`;
  }

  if (nextQuizQBtn) {
    if (nextQuizQBtn) nextQuizQBtn.addEventListener("click", () => {
      playSfx("click");
      currentQuizIndex++;
      renderCurrentQuizQuestion();
    });
  }

  function showQuizFinalScore() {
    liveQuizContainer.classList.add("hidden");
    quizScoreCard.classList.remove("hidden");
    finalScoreNum.textContent = `${currentQuizScore}/${quizQuestions.length}`;
    const pct = Math.round((currentQuizScore / quizQuestions.length) * 100);
    finalPercentNum.textContent = `${pct}%`;


    updateStudyMastery(activeStudyData ? activeStudyData.analogy_title : "Custom Topic", pct);
    fetchAiRecommendations(pct);

    if (pct >= 80) {
      playSfx("level_up");
      try { confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } }); } catch(_) {}
      finalBadge.textContent = "🏆 Exam Master";
      finalBadge.className = "inline-block px-4 py-1.5 rounded-full text-xs font-black bg-emerald-600 text-white shadow-sm";
      finalComment.textContent = "Outstanding mastery! You have deeply absorbed these concepts.";
      addXP(50);
    } else {
      playSfx("click");
      finalBadge.textContent = "👍 Good Effort";
      finalBadge.className = "inline-block px-4 py-1.5 rounded-full text-xs font-black bg-indigo-600 text-white shadow-sm";
      finalComment.textContent = "Good try! Review the flashcards and retake to lock in 100% recall.";
      addXP(20);
    }
  }

  if (retakeQuizBtn) {
    if (retakeQuizBtn) retakeQuizBtn.addEventListener("click", () => {
      playSfx("click");
      quizScoreCard.classList.add("hidden");
      quizConfigBox.classList.remove("hidden");
    });
  }

  // ------------------------------------------------------------------ Socratic Voice Coach Mode

  async function fetchAiRecommendations(scorePct) {
    const topic = activeStudyData ? activeStudyData.analogy_title : inputText.value.trim() || "Concept";
    const aiRecContainer = document.getElementById('aiRecContainer');
    const msgEl = document.getElementById('aiRecEncouragement');
    const weakList = document.getElementById('aiRecWeakList');
    const nextList = document.getElementById('aiRecNextList');
    
    if (!aiRecContainer) return;
    
    msgEl.textContent = "Luna is analyzing your performance...";
    weakList.innerHTML = "";
    nextList.innerHTML = "";
    aiRecContainer.classList.remove('hidden');

    try {
      const res = await fetch("/api/ai-recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic,
          quiz_score_percent: scorePct,
          language: currentLanguage
        })
      });
      const data = await res.json();
      
      msgEl.textContent = data.encouragement;
      weakList.innerHTML = data.weak_areas.map(w => `<li>${w}</li>`).join('');
      nextList.innerHTML = data.next_topics.map(t => `<li>${t}</li>`).join('');
    } catch(e) {
      msgEl.textContent = "Keep up the great work!";
    }
  }

  function initSocraticVoice() {
    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognitionClass) {
      socraticRecognition = new SpeechRecognitionClass();
      socraticRecognition.continuous = false;
      socraticRecognition.interimResults = false;
      socraticRecognition.lang = currentLanguage === "hi" ? "hi-IN" : "en-US";

      socraticRecognition.onstart = () => {
        isSocraticListening = true;
        socraticListenBtnLabel.textContent = "Listening...";
        socraticOrbStatus.textContent = "Listening to you...";
        socraticSoundWave.classList.remove("hidden");
        socraticSoundWave.classList.add("flex");
      };

      socraticRecognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        handleSocraticUtterance(transcript);
      };

      socraticRecognition.onerror = (event) => {
        console.warn("Speech recognition error:", event.error);
        stopSocraticListening();
      };

      socraticRecognition.onend = () => {
        stopSocraticListening();
      };
    }
  }

  function toggleSocraticVoice() {
    playSfx("click");
    if (isSocraticListening) {
      if (socraticRecognition) socraticRecognition.stop();
      stopSocraticListening();
    } else {
      if (!socraticRecognition) initSocraticVoice();
      if (socraticRecognition) {
        socraticRecognition.lang = currentLanguage === "hi" ? "hi-IN" : "en-US";
        try {
          socraticRecognition.start();
        } catch (e) {
          console.warn("Speech recognition start notice:", e);
        }
      } else {
        showError("Web Speech Recognition is not supported in this browser. You can type in the box below!");
      }
    }
  }

  function stopSocraticListening() {
    isSocraticListening = false;
    socraticListenBtnLabel.textContent = "Start Speaking";
    socraticOrbStatus.textContent = "Tap Mic to Talk to Luna";
    socraticSoundWave.classList.add("hidden");
  }

  async function handleSocraticUtterance(userText) {
    if (!userText.trim()) return;
    playSfx("click");

    // Prevent rapid-fire submissions
    if (socraticTextSubmitBtn) socraticTextSubmitBtn.disabled = true;
    if (socraticListenBtn) socraticListenBtn.disabled = true;

    // Append student bubble
    appendSocraticChat("student", userText);
    socraticHistory.push({ role: "student", text: userText });

    socraticOrbStatus.textContent = "Luna is thinking...";
    const topic = activeStudyData ? activeStudyData.analogy_title : inputText.value.trim() || "Concept Exploration";

    try {
      const res = await fetch("/api/socratic-turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic,
          student_utterance: userText,
          history: socraticHistory,
          language: currentLanguage,
        }),
      });

      const data = await res.json();
      appendSocraticChat("tutor", data.tutor_speech + " " + data.followup_question);
      socraticHistory.push({ role: "tutor", text: data.tutor_speech + " " + data.followup_question });

      // Update Socratic Coach Card
      socraticCoachCard.classList.remove("hidden");
      socraticFollowupText.textContent = data.followup_question;
      if (data.hint) {
        socraticHintBox.classList.remove("hidden");
        socraticHintText.textContent = data.hint;
      } else {
        socraticHintBox.classList.add("hidden");
      }

      socraticUnderstandingMeter.textContent = `Progress: ${data.understanding_level.toUpperCase()}`;
      socraticOrbStatus.textContent = "Luna is speaking...";

      // Play Neural Voice
      if (data.audio_base64) {
        playBase64Audio(data.audio_base64, () => {
          socraticOrbStatus.textContent = "Tap Mic to Reply";
        });
      } else {
        socraticOrbStatus.textContent = "Tap Mic to Reply";
      }

      addXP(20);
    } catch (e) {
      appendSocraticChat("tutor", "That's a very interesting thought! Can you expand on why that happens?");
      socraticOrbStatus.textContent = "Tap Mic to Reply";
    } finally {
      if (socraticTextSubmitBtn) socraticTextSubmitBtn.disabled = false;
      if (socraticListenBtn) socraticListenBtn.disabled = false;
    }
  }

  function appendSocraticChat(role, text) {
    const isTutor = role === "tutor";
    const bubble = document.createElement("div");
    bubble.className = isTutor
      ? "p-3 bg-purple-100/70 dark:bg-purple-950/70 rounded-2xl text-purple-950 dark:text-purple-200 border border-purple-200 dark:border-purple-800 space-y-0.5"
      : "p-3 bg-slate-200/80 dark:bg-slate-700/80 rounded-2xl text-slate-900 dark:text-white border border-slate-300 dark:border-slate-600 text-right space-y-0.5";
    bubble.innerHTML = `<strong>${isTutor ? "🌸 Luna:" : "👤 You:"}</strong> <p class="text-xs mt-0.5">${text}</p>`;
    socraticChatHistory.appendChild(bubble);
    socraticChatHistory.scrollTop = socraticChatHistory.scrollHeight;
  }

  function playBase64Audio(b64, onEndCallback) {
    try {
      const audioUrl = "data:audio/mpeg;base64," + b64;
      if (socraticAudio) {
        socraticAudio.pause();
      }
      socraticAudio = new Audio(audioUrl);
      
      const orb = document.getElementById("socraticOrb");
      const statusEl = document.getElementById("socraticOrbStatus");
      
      if (orb) {
        orb.classList.add("animate-pulse", "scale-110", "ring-4", "ring-pink-400");
      }
      if (statusEl) {
        statusEl.textContent = "🔊 Luna Speaking...";
      }

      socraticAudio.onended = () => {
        if (orb) {
          orb.classList.remove("animate-pulse", "scale-110", "ring-4", "ring-pink-400");
        }
        if (statusEl) {
          statusEl.textContent = "Tap Mic to Reply";
        }
        if (onEndCallback) onEndCallback();
      };
      socraticAudio.play();
    } catch (e) {
      console.warn("Base64 audio playback notice:", e);
    }
  }

  if (socraticListenBtn) socraticListenBtn.addEventListener("click", () => toggleSocraticVoice());
  if (socraticOrbBtn) socraticOrbBtn.addEventListener("click", () => toggleSocraticVoice());
  if (socraticClearHistoryBtn) {
    if (socraticClearHistoryBtn) socraticClearHistoryBtn.addEventListener("click", () => {
      playSfx("click");
      socraticHistory = [];
      socraticChatHistory.innerHTML = `<div class="p-3 bg-purple-100/60 dark:bg-purple-950/60 rounded-xl text-purple-900 dark:text-purple-200 border border-purple-200 dark:border-purple-800">
        <strong>🌸 Luna:</strong> "Dialogue reset! What would you like to explore next?"
      </div>`;
      socraticCoachCard.classList.add("hidden");
    });
  }

  if (socraticTextSubmitBtn && socraticTextInput) {
    if (socraticTextSubmitBtn) socraticTextSubmitBtn.addEventListener("click", () => {
      const val = socraticTextInput.value.trim();
      if (val) {
        socraticTextInput.value = "";
        handleSocraticUtterance(val);
      }
    });
    if (socraticTextInput) socraticTextInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const val = socraticTextInput.value.trim();
        if (val) {
          socraticTextInput.value = "";
          handleSocraticUtterance(val);
        }
      }
    });
  }

  // ------------------------------------------------------------------ AI Smart Whiteboard & Misconception Diagnostics
  function initWhiteboard() {
    if (!whiteboardCanvas) return;
    wbCanvas = whiteboardCanvas;
    wbCtx = wbCanvas.getContext("2d");
    wbCtx.lineCap = "round";
    wbCtx.lineJoin = "round";

    function startDraw(e) {
      wbIsDrawing = true;
      wbCtx.beginPath();
      const pos = getCanvasPos(e);
      wbCtx.moveTo(pos.x, pos.y);
    }

    function draw(e) {
      if (!wbIsDrawing) return;
      const pos = getCanvasPos(e);
      if (wbTool === "eraser") {
        const eraserSize = 20;
        wbCtx.clearRect(pos.x - eraserSize / 2, pos.y - eraserSize / 2, eraserSize, eraserSize);
      } else {
        wbCtx.strokeStyle = wbColor;
        wbCtx.lineWidth = wbLineWidth;
        wbCtx.lineTo(pos.x, pos.y);
        wbCtx.stroke();
      }
    }

    function stopDraw() {
      wbIsDrawing = false;
      wbCtx.closePath();
    }

    function getCanvasPos(e) {
      const rect = wbCanvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.left) * (wbCanvas.width / rect.width),
        y: (clientY - rect.top) * (wbCanvas.height / rect.height),
      };
    }

    wbCanvas.onmousedown = startDraw;
    wbCanvas.onmousemove = draw;
    wbCanvas.onmouseup = stopDraw;
    wbCanvas.onmouseleave = stopDraw;

    wbCanvas.ontouchstart = (e) => { e.preventDefault(); startDraw(e); };
    wbCanvas.ontouchmove = (e) => { e.preventDefault(); draw(e); };
    wbCanvas.ontouchend = stopDraw;
  }

  if (wbToolPen) {
    if (wbToolPen) wbToolPen.addEventListener("click", () => {
      playSfx("click");
      wbTool = "pen";
      wbToolPen.className = "px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[11px] font-bold";
      wbToolEraser.className = "px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-bold";
    });
  }

  if (wbToolEraser) {
    if (wbToolEraser) wbToolEraser.addEventListener("click", () => {
      playSfx("click");
      wbTool = "eraser";
      wbToolEraser.className = "px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[11px] font-bold";
      wbToolPen.className = "px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-bold";
    });
  }

  if (wbColorPicker) {
    if (wbColorPicker) wbColorPicker.addEventListener("input", (e) => {
      wbColor = e.target.value;
      wbTool = "pen";
      wbToolPen.className = "px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[11px] font-bold";
      wbToolEraser.className = "px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-bold";
    });
  }

  if (whiteboardClearBtn) {
    if (whiteboardClearBtn) whiteboardClearBtn.addEventListener("click", () => {
      playSfx("click");
      if (wbCtx && wbCanvas) {
        wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
      }
    });
  }

  if (runDiagnosticBtn) {
    if (runDiagnosticBtn) runDiagnosticBtn.addEventListener("click", async () => {
      const prob = diagProblemInput.value.trim();
      const textSteps = diagTextSteps.value.trim();
      const canvasB64 = wbCanvas ? wbCanvas.toDataURL("image/png") : null;

      if (!prob && !textSteps) {
        showError("Please enter a problem statement or write steps to diagnose.");
        return;
      }

      playSfx("click");
      runDiagnosticBtn.disabled = true;
      diagSpinner.classList.remove("hidden");
      diagBtnLabel.textContent = "AI Diagnostics Running...";

      try {
        const res = await fetch("/api/diagnose-solution", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            problem_statement: prob,
            student_work_text: textSteps,
            image_base64: canvasB64,
            language: currentLanguage,
          }),
        });

        const data = await res.json();
        diagnosticResultsContainer.classList.remove("hidden");
        diagProblemTitle.textContent = data.problem_title || "Diagnostic Breakdown";
        diagGradeBadge.textContent = data.overall_grade || "Diagnostic Complete";
        diagRootMisconception.textContent = data.root_misconception || "No fundamental error detected.";

        // Steps List
        diagStepsList.innerHTML = (data.total_steps || [])
          .map(
            (step) => `
          <div class="p-4 rounded-2xl border ${
            step.is_correct
              ? "bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900"
              : "bg-red-50/70 dark:bg-red-950/40 border-red-200 dark:border-red-900"
          } space-y-1">
            <div class="flex items-center justify-between text-xs font-bold">
              <span class="${step.is_correct ? "text-emerald-800 dark:text-emerald-300" : "text-red-800 dark:text-red-300"}">
                Step ${step.step_num}: ${step.step_content}
              </span>
              <span class="px-2 py-0.5 rounded-md text-[10px] ${
                step.is_correct ? "bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200" : "bg-red-200 dark:bg-red-900 text-red-900 dark:text-red-200"
              }">${step.status_label}</span>
            </div>
            <p class="text-xs text-slate-700 dark:text-slate-300">${step.annotation}</p>
            ${step.correction_tip ? `<p class="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 italic pt-0.5">💡 Tip: ${step.correction_tip}</p>` : ""}
          </div>`
          )
          .join("");

        // Correct Step Flow
        diagCorrectFlowList.innerHTML = (data.step_by_step_correct_flow || [])
          .map((line) => `<li>${line}</li>`)
          .join("");

        // Mnemonic Rule
        diagRuleText.textContent = `"${data.mnemonic_or_rule || "Verify all formula signs and units before resolving."}"`;

        playSfx("correct");
        addXP(30);
      } catch (e) {
        console.error("Diagnostic Solver Error:", e);
        showError("Unable to diagnose your solution — please check your input and try again.");
      } finally {
        runDiagnosticBtn.disabled = false;
        diagSpinner.classList.add("hidden");
        diagBtnLabel.textContent = "✨ Diagnose My Solution (Red/Green Pen AI)";
      }
    });
  }

  // ------------------------------------------------------------------ Generative Dynamic HTML5 Labs
  function initDefaultLab() {
    if (!genSimCanvas) return;
    const ctx = genSimCanvas.getContext("2d");

    // Default Physics Sandbox Function
    customLabRenderFn = (canvas, ctx, state, time) => {
      if (!state._particles || state._particles.length === 0) {
        state._particles = [];
        for (let i = 0; i < 45; i++) {
          state._particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4,
            radius: 3 + Math.random() * 5,
            hue: Math.random() * 60 + 260,
          });
        }
      }

      ctx.fillStyle = "rgba(15, 23, 42, 0.25)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const count = Math.min(state._particles.length, Math.floor(state.density || 45));
      const speedMult = (state.energy || 100) / 50;
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
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist < 120) {
            p.vx += (dx / dist) * 1.5;
            p.vy += (dy / dist) * 1.5;
          }
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${p.hue}, 90%, 65%)`;
        ctx.shadowBlur = 10;
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
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 55) {
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(168, 85, 247, ${(1 - dist / 55) * 0.4})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
    };

    renderCustomControls([
      { id: "energy", label: "Energy / Speed", min_val: 10, max_val: 200, default_val: 100, unit: "%" },
      { id: "density", label: "Particle Density", min_val: 10, max_val: 100, default_val: 45, unit: "nodes" },
      { id: "friction", label: "Medium Drag", min_val: 0, max_val: 1, default_val: 0.05, unit: "drag" },
    ]);

    startLabAnimationLoop();
  }

  function startLabAnimationLoop() {
    if (customLabAnimId) cancelAnimationFrame(customLabAnimId);
    const canvas = genSimCanvas;
    const ctx = canvas.getContext("2d");

    // Mouse interactions
    canvas.onmousedown = (e) => {
      customLabState.isMouseDown = true;
      const rect = canvas.getBoundingClientRect();
      customLabState.mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
      customLabState.mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
    };
    canvas.onmousemove = (e) => {
      const rect = canvas.getBoundingClientRect();
      customLabState.mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
      customLabState.mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
    };
    canvas.onmouseup = () => (customLabState.isMouseDown = false);
    canvas.onmouseleave = () => (customLabState.isMouseDown = false);

    function loop(time) {
      if (customLabRenderFn) {
        customLabRenderFn(canvas, ctx, customLabState, time);
      }
      customLabAnimId = requestAnimationFrame(loop);
    }
    customLabAnimId = requestAnimationFrame(loop);
  }

  function renderCustomControls(controls) {
    if (!genControlsContainer) return;
    genControlsContainer.innerHTML = controls
      .map(
        (c) => `
      <div class="space-y-1">
        <div class="flex items-center justify-between text-xs font-bold text-slate-800 dark:text-slate-200">
          <span>${c.label}</span>
          <span id="genVal_${c.id}" class="text-purple-700 dark:text-purple-300 font-mono">${c.default_val} ${c.unit}</span>
        </div>
        <input
          type="range"
          id="genInput_${c.id}"
          min="${c.min_val}"
          max="${c.max_val}"
          value="${c.default_val}"
          step="${c.step || 1}"
          class="w-full accent-purple-600 h-2 bg-slate-200 dark:bg-slate-700 rounded-lg cursor-pointer"
        />
      </div>`
      )
      .join("");

    controls.forEach((c) => {
      customLabState[c.id] = c.default_val;
      const inputEl = document.getElementById(`genInput_${c.id}`);
      const valEl = document.getElementById(`genVal_${c.id}`);
      if (inputEl) {
        inputEl.addEventListener("input", (e) => {
          customLabState[c.id] = parseFloat(e.target.value);
          if (valEl) valEl.textContent = `${e.target.value} ${c.unit}`;
        });
      }
    });
  }

  if (generateCustomLabBtn) {
    if (generateCustomLabBtn) generateCustomLabBtn.addEventListener("click", async () => {
      const topic = customLabTopicInput.value.trim() || (activeStudyData ? activeStudyData.analogy_title : "Physics Wave Optics");
      playSfx("click");
      generateCustomLabBtn.disabled = true;
      generateCustomLabBtn.textContent = "⚡ Generating Lab...";

      try {
        const res = await fetch("/api/generate-sandbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: topic, language: currentLanguage }),
        });

        const data = await res.json();
        dynamicLabTitle.textContent = data.sandbox_title || `Interactive Lab: ${topic}`;
        renderCustomControls(data.controls || []);

        genExperimentPrompts.innerHTML = (data.experiment_prompts || [])
          .map((p) => `<li>${p}</li>`)
          .join("");

        // Compile custom JS function
        try {
          // eslint-disable-next-line no-eval
          const fn = eval(data.canvas_js_code);
          if (typeof fn === "function") {
            customLabState._particles = [];
            customLabRenderFn = fn;
            startLabAnimationLoop();
          }
        } catch (compileErr) {
          console.warn("Using fallback physics sandbox:", compileErr);
          if (genCanvasStatus) genCanvasStatus.textContent = "⚠️ Custom lab unavailable — using default particle physics sandbox";
          initDefaultLab();
        }

        playSfx("level_up");
        addXP(30);
      } catch (e) {
        console.error("Lab Generator Error:", e);
        showError("Unable to compile custom simulation — using default particle lab instead.");
      } finally {
        generateCustomLabBtn.disabled = false;
        generateCustomLabBtn.textContent = "⚡ Generate Lab";
      }
    });
  }

  labPresetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const lab = btn.dataset.lab;
      playSfx("click");
      if (lab === "pendulum") {
        customLabTopicInput.value = "Pendulum Wave Mechanics & Periodic Oscillations";
      } else if (lab === "orbital") {
        customLabTopicInput.value = "Newton's Planetary Orbit & Gravitational Escape Velocity";
      } else if (lab === "thermo") {
        customLabTopicInput.value = "Thermodynamic Gas Molecules & Pressure-Temperature Equilibrium";
      }
      generateCustomLabBtn.click();
    });
  });

  // ------------------------------------------------------------------ Export Study Kit (Anki CSV, Markdown, Print)
  async function downloadExportFile(format) {
    if (!activeStudyData) {
      showError("Please generate a study kit first to export.");
      return;
    }
    playSfx("click");

    try {
      const res = await fetch("/api/export-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: activeStudyData.analogy_title,
          analogy_title: activeStudyData.analogy_title,
          simplified_text: activeStudyData.simplified_text,
          key_takeaways: activeStudyData.key_takeaways,
          flashcards: activeStudyData.flashcards,
          format: format,
        }),
      });

      const data = await res.json();
      const blob = new Blob([data.file_content], { type: data.content_type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      playSfx("correct");
      addXP(25);
    } catch (e) {
      console.error("Export Error:", e);
      showError("Unable to export study deck — please try again.");
    }
  }

  if (exportAnkiBtn) exportAnkiBtn.addEventListener("click", () => downloadExportFile("anki_csv"));
  if (exportMarkdownBtn) exportMarkdownBtn.addEventListener("click", () => downloadExportFile("markdown_guide"));
  if (printSheetBtn) {
    if (printSheetBtn) printSheetBtn.addEventListener("click", () => {
      playSfx("click");
      window.print();
    });
  }

  // ------------------------------------------------------------------ Instant Doubt Solver
  if (openDoubtBtn) {
    if (openDoubtBtn) openDoubtBtn.addEventListener("click", () => {
      playSfx("click");
      doubtModal.classList.remove("hidden");
    });
  }
  if (closeDoubtModal) closeDoubtModal.addEventListener("click", () => doubtModal.classList.add("hidden"));

  if (doubtMicBtn) {
    if (doubtMicBtn) doubtMicBtn.addEventListener("click", () => {
      playSfx("click");
      startSimpleSpeechToText((transcript) => {
        doubtInput.value = transcript;
      }, doubtMicLabel);
    });
  }

  if (submitDoubtBtn) {
    if (submitDoubtBtn) submitDoubtBtn.addEventListener("click", async () => {
      const q = doubtInput.value.trim();
      if (!q) return;
      playSfx("click");
      submitDoubtBtn.disabled = true;
      doubtSpinner.classList.remove("hidden");
      doubtBtnText.textContent = "Solving...";

      try {
        const res = await fetch("/api/ask-doubt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: activeStudyData ? activeStudyData.analogy_title : "General Concept",
            doubt_question: q,
            language: currentLanguage,
          }),
        });

        const data = await res.json();
        doubtAnswerContainer.classList.remove("hidden");
        doubtAnswerText.textContent = data.answer;
        doubtAnalogyText.textContent = `"${data.analogy}"`;
        playSfx("correct");
        addXP(15);
      } catch (e) {
        console.error("Doubt Solver Error:", e);
        showError("Luna is currently busy — please ask your doubt again in a moment.");
      } finally {
        submitDoubtBtn.disabled = false;
        doubtSpinner.classList.add("hidden");
        doubtBtnText.textContent = "✨ Solve My Doubt";
      }
    });
  }

  // ------------------------------------------------------------------ Speech-to-Text Utility
  function startSimpleSpeechToText(onTranscript, labelElement) {
    const SpeechClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechClass) {
      showError("Speech Recognition is not supported on this browser.");
      return;
    }
    const rec = new SpeechClass();
    rec.lang = currentLanguage === "hi" ? "hi-IN" : "en-US";
    rec.interimResults = false;

    if (labelElement) labelElement.textContent = "Listening...";
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      onTranscript(text);
      if (labelElement) labelElement.textContent = "Speak";
    };
    rec.onerror = () => {
      if (labelElement) labelElement.textContent = "Speak";
    };
    rec.onend = () => {
      if (labelElement) labelElement.textContent = "Speak";
    };
    rec.start();
  }

  // ------------------------------------------------------------------ Copy Text
  if (copyBtn) {
    if (copyBtn) copyBtn.addEventListener("click", () => {
      playSfx("click");
      if (activeStudyData && activeStudyData.simplified_text) {
        navigator.clipboard.writeText(activeStudyData.simplified_text);
        copyBtnText.textContent = "Copied! ✅";
        setTimeout(() => (copyBtnText.textContent = "Copy Text"), 1500);
      }
    });
  }

  // ------------------------------------------------------------------ Error Alerts
  function showError(msg) {
    playSfx("wrong");
    errorMsgText.textContent = msg;
    errorBox.classList.remove("hidden");
    errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function clearError() {
    errorBox.classList.add("hidden");
    errorMsgText.textContent = "";
  }


  // ------------------------------------------------------------------ Student Profile Manager
  function updateProfileUI() {
    const hAvatar = document.getElementById("headerAvatar");
    const hName = document.getElementById("headerProfileName");
    const dAvatar = document.getElementById("dashAvatarBadge");
    const dName = document.getElementById("dashStudentName");
    const dGrade = document.getElementById("dashGradeBadge");
    const dGoal = document.getElementById("dashGoalText");

    if (hAvatar) hAvatar.textContent = studentProfile.avatar || "🧠";
    if (hName) hName.textContent = studentProfile.name || "Alex";
    if (dAvatar) dAvatar.textContent = studentProfile.avatar || "🧠";
    if (dName) dName.textContent = studentProfile.name || "Alex";
    if (dGrade) dGrade.textContent = studentProfile.grade || "High School";
    if (dGoal) dGoal.textContent = `🎯 Goal: ${studentProfile.goal || "Master Core Concepts"}`;
  }

  function initProfileModal() {
    const profileBtn = document.getElementById("profileBtn");
    const editDashBtn = document.getElementById("editProfileDashBtn");
    const profileModal = document.getElementById("profileModal");
    const closeBtn = document.getElementById("closeProfileModal");
    const cancelBtn = document.getElementById("cancelProfileBtn");
    const saveBtn = document.getElementById("saveProfileBtn");
    const nameInput = document.getElementById("profileNameInput");
    const gradeSelect = document.getElementById("profileGradeSelect");
    const goalInput = document.getElementById("profileGoalInput");
    const avatarButtons = document.querySelectorAll(".avatar-option");

    let selectedAvatar = studentProfile.avatar || "🧠";

    function openModal() {
      if (nameInput) nameInput.value = studentProfile.name || "Alex";
      if (gradeSelect) gradeSelect.value = studentProfile.grade || "High School";
      if (goalInput) goalInput.value = studentProfile.goal || "Master Core Concepts";
      selectedAvatar = studentProfile.avatar || "🧠";
      highlightSelectedAvatar();
      if (profileModal) profileModal.classList.remove("hidden");
    }

    function closeModal() {
      if (profileModal) profileModal.classList.add("hidden");
    }

    function highlightSelectedAvatar() {
      avatarButtons.forEach(btn => {
        if (btn.dataset.avatar === selectedAvatar) {
          btn.classList.add("border-2", "border-purple-500");
          btn.classList.remove("border-slate-200", "dark:border-slate-700");
        } else {
          btn.classList.remove("border-2", "border-purple-500");
          btn.classList.add("border", "border-slate-200", "dark:border-slate-700");
        }
      });
    }

    avatarButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        selectedAvatar = btn.dataset.avatar;
        highlightSelectedAvatar();
        playSfx("click");
      });
    });

    if (profileBtn) profileBtn.addEventListener("click", openModal);
    if (editDashBtn) editDashBtn.addEventListener("click", openModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const newName = nameInput ? nameInput.value.trim() || "Alex" : "Alex";
        const newGrade = gradeSelect ? gradeSelect.value : "High School";
        const newGoal = goalInput ? goalInput.value.trim() || "Master Core Concepts" : "Master Core Concepts";

        studentProfile = {
          name: newName,
          avatar: selectedAvatar,
          grade: newGrade,
          goal: newGoal
        };

        localStorage.setItem("clearmind_profile", JSON.stringify(studentProfile));
        updateProfileUI();
        closeModal();
        playSfx("correct");
      });
    }

    updateProfileUI();
  }

  // ------------------------------------------------------------------ Init on DOM Load
  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
  const streakEl = document.getElementById('streakCount');
  if (streakEl) streakEl.textContent = currentStreak;
  const xpEl = document.getElementById('xpScore');
  if (xpEl) xpEl.textContent = totalXP;
  updateDashboard();
    initProfileModal();
    checkApiStatus();
    initWhiteboard();
  });
})();


  // ------------------------------------------------------------------ Sequential Learning Pathway (Curriculum Progression)
  function renderLearningPathway(steps) {
    const grid = document.getElementById("pathwayStepsGrid");
    if (!grid) return;

    if (!steps || steps.length === 0) {
      // Default 4-part pathway if empty
      const currentTopic = (studyTextInput.value || "Topic").trim();
      steps = [
        { step_number: 1, title: `Basics of ${currentTopic}`, description: "Core definitions, everyday analogies, and foundational mental models.", subtopic_query: `${currentTopic} basics`, is_completed: true },
        { step_number: 2, title: `How ${currentTopic} Works`, description: "Step-by-step mechanism, core formulas, and key operating rules.", subtopic_query: `How ${currentTopic} works step by step`, is_completed: false },
        { step_number: 3, title: `Advanced ${currentTopic} Problems`, description: "Real-world tricky examples, problem solving, and edge cases.", subtopic_query: `Advanced ${currentTopic} problem solving`, is_completed: false },
        { step_number: 4, title: `Capstone & Mastery`, description: "Cross-disciplinary applications, cutting-edge science, and exam mastery.", subtopic_query: `Real world applications of ${currentTopic}`, is_completed: false },
      ];
    }

    grid.innerHTML = steps.map((step, idx) => {
      const isPart1 = step.step_number === 1 || step.is_completed;
      const isPart2 = step.step_number === 2;

      let cardBorder = isPart1
        ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/30"
        : isPart2
        ? "border-purple-400 dark:border-purple-600 bg-white dark:bg-slate-800 ring-2 ring-purple-500/50 shadow-md shadow-purple-500/10"
        : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80";

      let badge = isPart1
        ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 dark:bg-emerald-900/80 text-emerald-800 dark:text-emerald-300">✅ Part 1 • Completed</span>`
        : isPart2
        ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-gradient-to-r from-purple-600 to-pink-600 text-white animate-pulse">🔥 Part 2 • UP NEXT</span>`
        : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">Part ${step.step_number || idx + 1}</span>`;

      let btn = isPart1
        ? `<button class="w-full py-2 px-3 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-default">
             <span>✨ Mastered</span>
           </button>`
        : isPart2
        ? `<button data-subtopic="${encodeURIComponent(step.subtopic_query || step.title)}" class="learn-next-step-btn w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-black shadow-md transition transform hover:-translate-y-0.5 flex items-center justify-center gap-1.5">
             <span>🚀 Learn Part 2 ➔</span>
           </button>`
        : `<button data-subtopic="${encodeURIComponent(step.subtopic_query || step.title)}" class="learn-next-step-btn w-full py-2 px-3 rounded-xl bg-slate-100 hover:bg-purple-100 dark:bg-slate-700 dark:hover:bg-purple-950 text-slate-800 hover:text-purple-700 dark:text-slate-200 dark:hover:text-purple-300 text-xs font-bold border border-slate-200 dark:border-slate-600 transition flex items-center justify-center gap-1.5">
             <span>Explore Part ${step.step_number || idx + 1} ➔</span>
           </button>`;

      return `
        <div class="rounded-2xl p-4 border flex flex-col justify-between space-y-3 transition duration-200 ${cardBorder}">
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              ${badge}
            </div>
            <h4 class="text-sm font-black text-slate-900 dark:text-white leading-snug">${step.title}</h4>
            <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">${step.description}</p>
          </div>
          <div class="pt-2 border-t border-slate-100 dark:border-slate-750">
            ${btn}
          </div>
        </div>
      `;
    }).join("");

    // Bind click handlers to "Learn Next Step" buttons
    grid.querySelectorAll(".learn-next-step-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const subtopic = decodeURIComponent(button.getAttribute("data-subtopic"));
        if (!subtopic) return;

        // Populate search box
        studyTextInput.value = subtopic;
        
        // Play level up sound
        playSound("levelUp");

        // Scroll back up to input
        window.scrollTo({ top: 0, behavior: "smooth" });

        // Trigger generation
        showToast(`🚀 Loading Next Chapter: "${subtopic}"...`, "info");
        setTimeout(() => {
          generateStudyKit();
        }, 300);
      });
    });
  }
