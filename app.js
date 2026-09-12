/**
 * ClearMind Pro v17.0 — Obsidian Glass Live Knowledge Canvas
 * 100% Complete, High-Yield Educational Engine
 */
(function () {
  "use strict";

  // =========================================================================
  // APP STATE & PROFILE
  // =========================================================================
  let activeTopic = localStorage.getItem("clearmind_active_topic") || "";
  let activeLanguage = localStorage.getItem("clearmind_lang") || "hinglish";
  let soundEnabled = localStorage.getItem("clearmind_sound") !== "false";
  let isVoiceCallActive = false;
  let voiceRecognition = null;
  let activeAudio = null;
  let cachedCheatSheets = {};
  let awardedCheatSheetTopics = new Set();

  // Purge any stale generic topic defaults from localStorage
  if (
    activeTopic &&
    (activeTopic.toLowerCase().includes("general science") ||
      activeTopic.toLowerCase().includes("problem solving") ||
      activeTopic.toLowerCase().includes("what would you like to learn") ||
      activeTopic.toLowerCase().includes("choose any topic"))
  ) {
    activeTopic = "";
    localStorage.removeItem("clearmind_active_topic");
  }

  // v19 clean greeting migration: clear old default Python conversation
  if (!localStorage.getItem("clearmind_v19_ask_greeting")) {
    localStorage.removeItem("clearmind_conv_history");
    localStorage.removeItem("clearmind_active_topic");
    localStorage.setItem("clearmind_v19_ask_greeting", "true");
  }

  let totalXP = parseInt(localStorage.getItem("clearmind_xp") || "0", 10);
  let currentStreak = parseInt(localStorage.getItem("clearmind_streak") || "1", 10);

  let studentProfile = JSON.parse(
    localStorage.getItem("clearmind_profile") ||
      JSON.stringify({
        name: "",
        avatar: "🎓",
        level: "College / University (Undergraduate - B.Tech, B.Sc, MBBS, etc.)"
      })
  );

  let conversationHistory = JSON.parse(
    localStorage.getItem("clearmind_conv_history") || "[]"
  );
  function saveHistory() {
    conversationHistory = conversationHistory.slice(-12);
    localStorage.setItem("clearmind_conv_history", JSON.stringify(conversationHistory));
  }

  // Teaching Mode: "direct" (lecture & analogies) vs "socratic" (guiding questions)
  let teachingMode = localStorage.getItem("clearmind_teaching_mode") || "direct";

  // Blitz Battle Arena 2.0 Config & Record
  let blitzConfig = {
    timeLimit: parseInt(localStorage.getItem("clearmind_blitz_time") || "60", 10),
    questionCount: parseInt(localStorage.getItem("clearmind_blitz_count") || "8", 10),
    difficulty: "Standard"
  };
  let blitzHighScore = parseInt(localStorage.getItem("clearmind_blitz_highscore") || "0", 10);
  let blitzBestCombo = parseInt(localStorage.getItem("clearmind_blitz_best_combo") || "1", 10);

  // Blitz Battle Arena Live Runtime State
  let blitzState = {
    timerInterval: null,
    timeLeft: 60,
    score: 0,
    combo: 1,
    currentQuestionIdx: 0,
    questions: [],
    isRunning: false
  };

  // 3D Spaced-Repetition Flashcard Deck State
  let flashcardState = {
    deck: [],
    currentIndex: 0,
    masteredCards: new Set(JSON.parse(localStorage.getItem("clearmind_mastered_cards") || "[]")),
    cardsReviewed: parseInt(localStorage.getItem("clearmind_cards_reviewed") || "0", 10),
    cachedDecks: {}
  };

  // =========================================================================
  // SECONDBRAIN COGNITIVE MODELING & EBBINGHAUS DECAY ENGINE
  // =========================================================================
  const CognitiveEngine = {
    retention(stability, elapsedDays) {
      if (stability <= 0) return 0;
      return Math.exp(-elapsedDays / stability);
    },

    currentRetention(c, now = Date.now()) {
      const elapsedDays = (now - (c.lastReview || now)) / (1000 * 60 * 60 * 24);
      return this.retention(c.stability || 2, Math.max(0, elapsedDays));
    },

    reinforce(c, quality = 0.8, now = Date.now()) {
      const factor = 1 + quality * (1.2 + (c.reviews || 0) * 0.15);
      return {
        ...c,
        strength: Math.min(1, (c.strength || 0.5) + quality * 0.12),
        stability: Math.max(1, (c.stability || 2) * factor),
        lastReview: now,
        reviews: (c.reviews || 0) + 1
      };
    },

    weaken(c, now = Date.now()) {
      return {
        ...c,
        strength: Math.max(0.1, (c.strength || 0.5) * 0.65),
        stability: Math.max(0.5, (c.stability || 2) * 0.5),
        lastReview: now
      };
    },

    predictForgetting(concepts, count = 5) {
      const now = Date.now();
      return [...concepts]
        .map((c) => ({ c, r: this.currentRetention(c, now) }))
        .sort((a, b) => a.r - b.r)
        .slice(0, count)
        .map((x) => x.c);
    },

    xpForLevel(level) {
      return Math.floor(200 * Math.pow(1.35, level - 1));
    },

    levelFromXp(xp) {
      let level = 1;
      let remaining = Math.max(0, xp);
      while (remaining >= this.xpForLevel(level)) {
        remaining -= this.xpForLevel(level);
        level++;
      }
      return {
        level,
        progress: remaining / this.xpForLevel(level),
        nextAt: this.xpForLevel(level),
        remaining
      };
    },

    getInitialConcepts() {
      const palette = ["#a78bfa", "#f0abfc", "#22d3ee", "#34d399", "#fbbf24", "#fb7185", "#60a5fa", "#c084fc"];
      const now = Date.now();
      const raw = [
        { id: "programming", name: "Programming", category: "CS", strength: 0.9, stability: 120, lastReview: now - 86400000 * 2, reviews: 42 },
        { id: "variables", name: "Variables", category: "CS", strength: 0.95, stability: 200, lastReview: now - 86400000, reviews: 38 },
        { id: "functions", name: "Functions", category: "CS", strength: 0.82, stability: 80, lastReview: now - 86400000 * 3, reviews: 28 },
        { id: "loops", name: "Loops", category: "CS", strength: 0.88, stability: 110, lastReview: now - 86400000 * 2, reviews: 31 },
        { id: "recursion", name: "Recursion", category: "CS", strength: 0.52, stability: 12, lastReview: now - 86400000 * 8, reviews: 7 },
        { id: "objects", name: "Objects & OOP", category: "CS", strength: 0.78, stability: 65, lastReview: now - 86400000 * 4, reviews: 18 },
        { id: "arrays", name: "Arrays & Lists", category: "CS", strength: 0.85, stability: 95, lastReview: now - 86400000 * 2, reviews: 24 },
        { id: "graphs", name: "Graph Algorithms", category: "CS", strength: 0.38, stability: 6, lastReview: now - 86400000 * 12, reviews: 4 },
        { id: "dp", name: "Dynamic Programming", category: "CS", strength: 0.28, stability: 4, lastReview: now - 86400000 * 14, reviews: 2 },
        { id: "ml", name: "Machine Learning", category: "ML", strength: 0.72, stability: 40, lastReview: now - 86400000 * 4, reviews: 16 },
        { id: "neural", name: "Neural Networks", category: "ML", strength: 0.45, stability: 9, lastReview: now - 86400000 * 9, reviews: 8 },
        { id: "backprop", name: "Backpropagation", category: "ML", strength: 0.32, stability: 5, lastReview: now - 86400000 * 11, reviews: 3 },
        { id: "attention", name: "Attention Mechanism", category: "ML", strength: 0.65, stability: 30, lastReview: now - 86400000 * 4, reviews: 12 },
        { id: "llm", name: "Large Language Models", category: "ML", strength: 0.82, stability: 60, lastReview: now - 86400000 * 2, reviews: 22 },
        { id: "embeddings", name: "Vector Embeddings", category: "ML", strength: 0.58, stability: 18, lastReview: now - 86400000 * 6, reviews: 9 },
        { id: "calculus", name: "Calculus & Rates", category: "Math", strength: 0.64, stability: 25, lastReview: now - 86400000 * 5, reviews: 14 },
        { id: "linalg", name: "Linear Algebra", category: "Math", strength: 0.55, stability: 16, lastReview: now - 86400000 * 8, reviews: 11 },
        { id: "probability", name: "Probability & Bayes", category: "Math", strength: 0.68, stability: 35, lastReview: now - 86400000 * 4, reviews: 13 },
        { id: "physics", name: "Conservation Laws", category: "Science", strength: 0.42, stability: 8, lastReview: now - 86400000 * 13, reviews: 5 },
        { id: "quantum", name: "Quantum Mechanics", category: "Science", strength: 0.35, stability: 5, lastReview: now - 86400000 * 15, reviews: 3 }
      ];

      const connections = {
        programming: ["variables", "functions", "loops", "objects", "arrays"],
        variables: ["programming"],
        functions: ["programming", "recursion"],
        loops: ["programming"],
        recursion: ["functions", "dp"],
        objects: ["programming", "arrays"],
        arrays: ["programming", "objects"],
        graphs: ["dp", "recursion"],
        dp: ["graphs", "recursion", "programming"],
        ml: ["neural", "probability", "linalg", "calculus"],
        neural: ["ml", "backprop", "attention"],
        backprop: ["neural", "calculus"],
        attention: ["neural", "llm", "embeddings"],
        llm: ["attention", "embeddings", "ml"],
        embeddings: ["llm", "linalg"],
        calculus: ["backprop", "probability"],
        linalg: ["embeddings", "neural", "ml"],
        probability: ["ml", "calculus"],
        physics: ["calculus"],
        quantum: ["physics", "linalg"]
      };

      return raw.map((d, i) => ({
        ...d,
        color: palette[i % palette.length],
        connections: connections[d.id] || []
      }));
    },

    loadConcepts() {
      try {
        const stored = localStorage.getItem("clearmind_cognitive_concepts");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (e) {}
      const init = this.getInitialConcepts();
      this.saveConcepts(init);
      return init;
    },

    saveConcepts(concepts) {
      try {
        localStorage.setItem("clearmind_cognitive_concepts", JSON.stringify(concepts));
      } catch (e) {}
    },

    recordConceptRecall(conceptNameOrId, quality = 0.8) {
      if (!conceptNameOrId) return;
      const concepts = this.loadConcepts();
      const lower = conceptNameOrId.toLowerCase().trim();
      let found = concepts.find((c) => c.id.toLowerCase() === lower || c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase()));
      if (found) {
        const updated = quality >= 0.6 ? this.reinforce(found, quality) : this.weaken(found);
        const index = concepts.findIndex((c) => c.id === found.id);
        if (index >= 0) concepts[index] = updated;
      } else {
        const palette = ["#a78bfa", "#f0abfc", "#22d3ee", "#34d399", "#fbbf24", "#fb7185", "#60a5fa"];
        const newC = {
          id: `concept-${Date.now()}`,
          name: conceptNameOrId.slice(0, 24),
          category: "CS",
          strength: quality >= 0.6 ? 0.6 : 0.3,
          stability: quality >= 0.6 ? 7 : 2,
          lastReview: Date.now(),
          reviews: 1,
          color: palette[concepts.length % palette.length],
          connections: []
        };
        concepts.push(newC);
      }
      this.saveConcepts(concepts);
    },

    getInitialMissions() {
      return [
        { id: "m1", title: "Morning Focus", description: "Start an active study turn or search a topic.", xp: 25, progress: 1, done: false, icon: "🌅" },
        { id: "m2", title: "Socratic Dialogue", description: "Have a deep multi-turn chat with AI Tutor Luna.", xp: 60, progress: 0.5, done: false, icon: "🌸" },
        { id: "m3", title: "Fading Concepts Sprint", description: "Review 3 concepts predicted to fade.", xp: 45, progress: 0.66, done: false, icon: "📉" },
        { id: "m4", title: "60s Blitz Battle", description: "Complete a Blitz Arena round with combo 2x+.", xp: 75, progress: 0, done: false, icon: "⚔️" },
        { id: "m5", title: "Knowledge Galaxy", description: "Inspect concept relationships in Galaxy View.", xp: 50, progress: 0, done: false, icon: "🌌" }
      ];
    },

    loadMissions() {
      const today = new Date().toISOString().slice(0, 10);
      try {
        const storedDate = localStorage.getItem("clearmind_missions_date");
        const stored = localStorage.getItem("clearmind_missions");
        if (storedDate === today && stored) {
          return JSON.parse(stored);
        }
      } catch (e) {}
      const fresh = this.getInitialMissions();
      this.saveMissions(fresh, today);
      return fresh;
    },

    saveMissions(missions, date = new Date().toISOString().slice(0, 10)) {
      try {
        localStorage.setItem("clearmind_missions", JSON.stringify(missions));
        localStorage.setItem("clearmind_missions_date", date);
      } catch (e) {}
    },

    completeMission(id) {
      const missions = this.loadMissions();
      const m = missions.find((x) => x.id === id);
      if (!m || m.done) return;
      m.done = true;
      m.progress = 1;
      this.saveMissions(missions);
      addXP(m.xp);
      playSound("correct");
      showToast(`🎯 Quest Completed: "${m.title}"! +${m.xp} XP`, "success");
      if (typeof confetti === "function") {
        confetti({ particleCount: 45, spread: 65, origin: { y: 0.8 } });
      }
      updateAnalyticsDashboard();
    },

    getMindHealth() {
      const concepts = this.loadConcepts();
      const retentions = concepts.map((c) => this.currentRetention(c));
      const avgRetention = retentions.reduce((a, b) => a + b, 0) / (retentions.length || 1);
      const sessionMinutes = Math.min(90, 35 + Math.floor(totalXP / 75));
      const confidence = Math.min(100, Math.max(40, Math.round(avgRetention * 80 + (blitzBestCombo > 1 ? 15 : 5))));
      const curiosity = Math.min(100, Math.max(50, Math.round(55 + (concepts.length * 1.5))));
      return {
        focusMinutes: sessionMinutes,
        confidence,
        curiosity,
        avgRetention
      };
    }
  };

  // =========================================================================
  // WEB AUDIO SYNTHESIZER
  // =========================================================================
  const audioCtx =
    typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext)
      ? new (window.AudioContext || window.webkitAudioContext)()
      : null;

  function playSound(type) {
    if (!soundEnabled || !audioCtx) return;
    try {
      if (audioCtx.state === "suspended") audioCtx.resume();
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === "click") {
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(400, now + 0.05);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === "correct") {
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.08);
        osc.frequency.setValueAtTime(783.99, now + 0.16);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === "wrong") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.linearRampToValueAtTime(160, now + 0.2);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      } else if (type === "combo") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.25);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === "tick") {
        osc.frequency.setValueAtTime(1000, now);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        osc.start(now);
        osc.stop(now + 0.03);
      } else if (type === "palette") {
        // Soft high chime for command palette
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1318.5, now + 0.08);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === "copy") {
        // Crisp snappy high-frequency confirmation blip
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(1800, now + 0.05);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.start(now);
        osc.stop(now + 0.06);
      } else if (type === "navigate") {
        // Soft bass whoosh for view switches
        osc.type = "sine";
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(330, now + 0.07);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
        osc.start(now);
        osc.stop(now + 0.07);
      } else if (type === "fanfare") {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          const o = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          o.connect(g);
          g.connect(audioCtx.destination);
          o.frequency.setValueAtTime(f, now + i * 0.1);
          g.gain.setValueAtTime(0.15, now + i * 0.1);
          g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.25);
          o.start(now + i * 0.1);
          o.stop(now + i * 0.1 + 0.25);
        });
      }
    } catch (e) {
      console.warn("Audio error:", e);
    }
  }

  // Dynamic Audio Waveform Indicator Controller
  function setAudioWaveformActive(isActive) {
    const wf = document.getElementById("lunaWaveform");
    if (!wf) return;
    if (isActive) {
      wf.classList.remove("hidden");
      wf.classList.add("active");
    } else {
      wf.classList.remove("active");
      wf.classList.add("hidden");
    }
  }

  // Global Tactile Copy-to-Clipboard with Audio & Toast Feedback
  window.copyToClipboard = function (text, btn) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      playSound("copy");
      showToast("✓ Copied to clipboard!", "success");
      if (btn) {
        const origHtml = btn.innerHTML;
        btn.innerHTML = `<span class="text-emerald-400">✓</span> <span class="text-emerald-300 font-bold">Copied!</span>`;
        setTimeout(() => {
          btn.innerHTML = origHtml;
        }, 1600);
      }
    }).catch(err => {
      console.warn("Clipboard copy error:", err);
      showToast("Could not copy text", "error");
    });
  };

  // =========================================================================
  // TOAST NOTIFICATIONS
  // =========================================================================
  function showToast(msg, type) {
    type = type || "info";
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    const bg =
      type === "success"
        ? "bg-emerald-950/90 border-emerald-600 text-emerald-200"
        : type === "error"
        ? "bg-rose-950/90 border-rose-600 text-rose-200"
        : "bg-obsidian-850/90 border-obsidian-700 text-slate-200";

    toast.className =
      "px-4 py-2.5 rounded-2xl border text-xs font-bold shadow-xl backdrop-blur-md transition transform duration-300 translate-y-2 opacity-0 pointer-events-auto " +
      bg;
    toast.textContent = msg;
    container.appendChild(toast);

    setTimeout(() => toast.classList.remove("translate-y-2", "opacity-0"), 20);
    setTimeout(() => {
      toast.classList.add("opacity-0", "translate-y-2");
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // =========================================================================
  // GAMIFICATION: XP & DAILY STREAK
  // =========================================================================
  function addXP(amount) {
    totalXP += amount;
    localStorage.setItem("clearmind_xp", String(totalXP));
    updateHUD();
    const disp = document.getElementById("totalXPDisplay");
    if (disp) {
      disp.classList.add("scale-125", "text-purple-300");
      setTimeout(() => disp.classList.remove("scale-125", "text-purple-300"), 400);
    }
  }

  function bumpStreak() {
    const today = new Date().toISOString().slice(0, 10);
    const lastDate = localStorage.getItem("clearmind_last_streak_date") || "";
    if (lastDate === today) return;

    currentStreak += 1;
    localStorage.setItem("clearmind_streak", String(currentStreak));
    localStorage.setItem("clearmind_last_streak_date", today);
    updateHUD();
    showToast("🔥 Daily Streak Extended: " + currentStreak + " Days!", "success");
  }

  function updateHUD() {
    const sName = document.getElementById("profileNameHeader");
    const sAvatar = document.getElementById("profileAvatarHeader");
    const sXP = document.getElementById("totalXPDisplay");
    const sStreak = document.getElementById("streakCount");

    const jName = document.getElementById("journeyStudentName");
    const jAvatar = document.getElementById("journeyAvatar");
    const jLevel = document.getElementById("journeyStudyLevel");
    const jProgress = document.getElementById("journeyXPProgress");
    const jBar = document.getElementById("journeyXPBar");

    const displayName = studentProfile.name || "Student";
    const displayAvatar = studentProfile.avatar || "🎓";

    // Update Header HUD (Desktop & Mobile)
    if (sName) sName.textContent = displayName;
    if (sAvatar) sAvatar.textContent = displayAvatar;
    if (sXP) sXP.textContent = totalXP;
    if (sStreak) sStreak.textContent = currentStreak;

    const sAvatarm = document.getElementById("profileAvatarHeaderMobile");
    const sXPm = document.getElementById("totalXPDisplayMobile");
    const sStreakm = document.getElementById("streakCountMobile");
    if (sAvatarm) sAvatarm.textContent = displayAvatar;
    if (sXPm) sXPm.textContent = totalXP;
    if (sStreakm) sStreakm.textContent = currentStreak;

    // Update Student Journey View
    if (jName) jName.textContent = displayName;
    if (jAvatar) jAvatar.textContent = displayAvatar;
    if (jLevel) jLevel.textContent = studentProfile.level || "College / University";
    if (jProgress) jProgress.textContent = `${totalXP} / 4000 XP`;
    if (jBar) {
      const pct = Math.min(100, Math.max(3, Math.round((totalXP / 4000) * 100)));
      jBar.style.width = `${pct}%`;
    }
  }

  // =========================================================================
  // UTILITIES: HTML ESCAPING, MARKDOWN & LATEX KATEX RENDERING
  // =========================================================================
  function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function formatMarkdown(raw) {
    if (!raw) return "";

    const mathTokens = [];
    // Protect display math $$...$$
    let text = raw.replace(/\$\$([\s\S]*?)\$\$/g, (m, expr) => {
      const idx = mathTokens.length;
      mathTokens.push({ expr: expr.trim(), display: true });
      return `___MATH_TOKEN_${idx}___`;
    });

    // Protect inline math $...$
    text = text.replace(/\$([^$\n]+)\$/g, (m, expr) => {
      const idx = mathTokens.length;
      mathTokens.push({ expr: expr.trim(), display: false });
      return `___MATH_TOKEN_${idx}___`;
    });

    // Protect code blocks ```...```
    const codeTokens = [];
    text = text.replace(/```([a-zA-Z]*)\n([\s\S]*?)```/g, (m, lang, code) => {
      const idx = codeTokens.length;
      codeTokens.push({ lang: lang || "code", code: code });
      return `___CODE_TOKEN_${idx}___`;
    });

    // Escape text characters safely
    let h = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    // Markdown styling
    h = h.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/\*(.*?)\*/g, "<em>$1</em>");
    h = h.replace(/`(.*?)`/g, '<code class="bg-obsidian-950 px-1.5 py-0.5 rounded text-purple-300 font-mono text-xs">$1</code>');
    h = h.replace(/\n/g, "<br/>");

    // Rehydrate code blocks
    codeTokens.forEach((b, idx) => {
      const esc = b.code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const encodedCode = encodeURIComponent(b.code);
      const block = `<div class="relative group my-2.5 p-3.5 rounded-2xl bg-[#030614]/90 border border-white/10 font-mono text-xs text-purple-200 overflow-x-auto shadow-lg">
        <div class="flex items-center justify-between text-[9px] uppercase tracking-wider text-purple-400 pb-1.5 font-bold border-b border-white/5 mb-2">
          <span>${escapeHtml(b.lang || 'code')}</span>
          <button type="button" onclick="window.copyToClipboard(decodeURIComponent('${encodedCode}'), this)" class="code-copy-btn text-[10px] px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white border border-white/10 transition cursor-pointer flex items-center gap-1">
            <span>📋</span> <span>Copy</span>
          </button>
        </div>
        <pre class="leading-relaxed whitespace-pre font-mono"><code>${esc}</code></pre>
      </div>`;
      h = h.replace(`___CODE_TOKEN_${idx}___`, block);
    });

    // Rehydrate math with KaTeX directly into HTML!
    mathTokens.forEach((m, idx) => {
      let rendered = "";
      if (typeof katex !== "undefined") {
        try {
          rendered = katex.renderToString(m.expr, { displayMode: m.display, throwOnError: false });
        } catch (e) {
          rendered = `<code class="text-amber-300 font-mono text-xs">${escapeHtml(m.expr)}</code>`;
        }
      } else {
        rendered = `<code class="text-amber-300 font-mono text-xs">${escapeHtml(m.expr)}</code>`;
      }
      if (m.display) {
        const encodedMath = encodeURIComponent(m.expr);
        rendered = `<div class="relative group my-2.5 p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between gap-3 overflow-x-auto">
          <div class="flex-1 overflow-x-auto">${rendered}</div>
          <button type="button" onclick="window.copyToClipboard(decodeURIComponent('${encodedMath}'), this)" title="Copy LaTeX Formula" class="code-copy-btn opacity-0 group-hover:opacity-100 shrink-0 text-[10px] px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white border border-white/10 transition cursor-pointer flex items-center gap-1">
            <span>📐</span> <span>LaTeX</span>
          </button>
        </div>`;
      }
      h = h.replace(`___MATH_TOKEN_${idx}___`, rendered);
    });

    return h;
  }

  function renderFormulaLatex(raw) {
    if (!raw) return "";
    let clean = String(raw).trim();
    clean = clean.replace(/^['"`$]+|['"`$]+$/g, "").trim();
    clean = clean.replace(/^['"`]+|['"`]+$/g, "").trim();
    if (typeof katex !== "undefined") {
      try {
        const rendered = katex.renderToString(clean, { displayMode: true, throwOnError: false });
        const encoded = encodeURIComponent(clean);
        return `<div class="relative group my-1.5 flex items-center justify-between gap-2 overflow-x-auto">
          <div class="flex-1 overflow-x-auto text-center">${rendered}</div>
          <button type="button" onclick="window.copyToClipboard(decodeURIComponent('${encoded}'), this)" title="Copy LaTeX Formula" class="code-copy-btn opacity-0 group-hover:opacity-100 shrink-0 text-[10px] px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white border border-white/10 transition cursor-pointer flex items-center gap-1">
            <span>📐</span> <span>LaTeX</span>
          </button>
        </div>`;
      } catch (e) {
        console.warn("KaTeX render error:", e);
      }
    }
    return `<code class="text-amber-300 font-mono text-xs">${escapeHtml(clean)}</code>`;
  }
  window.renderFormulaLatex = renderFormulaLatex;

  // =========================================================================
  // DYNAMIC LEARNING ROADMAP GENERATOR
  // =========================================================================
  function updateDynamicRoadmap() {
    const list = document.getElementById("dynamicRoadmapStepsList");
    const sub = document.getElementById("roadmapPathSubtitle");
    if (!list) return;

    if (!hasActiveTopic()) {
      if (sub) sub.textContent = "Awaiting Topic";
      list.innerHTML = `
        <div class="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/20 text-center space-y-1">
          <p class="text-[11px] text-amber-300 font-bold">⚠️ Topic not decided yet</p>
          <p class="text-[10px] text-slate-400">Ask Luna in the Classroom or choose a topic to unlock your roadmap.</p>
        </div>`;
      return;
    }

    if (sub) sub.textContent = `${activeTopic} Path`;

    let steps = [
      { name: "Foundations & Terminology", status: "done" },
      { name: "Core Principles & Mechanism", status: "active" },
      { name: "Common Examiner Traps", status: "todo" },
      { name: "Mastery & Blitz Verification", status: "todo" }
    ];

    if (activeTopic.toLowerCase().includes("calculus") || activeTopic.toLowerCase().includes("math")) {
      steps = [
        { name: "Limits & Continuous Rates", status: "done" },
        { name: "Derivatives & Power Rules", status: "active" },
        { name: "Chain Rule & Examiner Traps", status: "todo" },
        { name: "Integration & Real Applications", status: "todo" }
      ];
    } else if (activeTopic.toLowerCase().includes("python") || activeTopic.toLowerCase().includes("code")) {
      steps = [
        { name: "Variables & Data Types", status: "done" },
        { name: "Functions & Parameters", status: "active" },
        { name: "Loops & Data Structures", status: "todo" },
        { name: "Algorithms & OOP Design", status: "todo" }
      ];
    } else if (activeTopic.toLowerCase().includes("physics")) {
      steps = [
        { name: "Vectors & Kinematics", status: "done" },
        { name: "Newton's Laws & Free-Body Forces", status: "active" },
        { name: "Conservation of Momentum & Energy", status: "todo" },
        { name: "Wave Mechanics & Fields", status: "todo" }
      ];
    } else if (activeTopic.toLowerCase().includes("bio") || activeTopic.toLowerCase().includes("photo")) {
      steps = [
        { name: "Cellular Structure & Chloroplasts", status: "done" },
        { name: "Light Reactions & ATP Synthesis", status: "active" },
        { name: "Calvin Cycle & Biochemical Traps", status: "todo" },
        { name: "Ecosystem Respiration Energy Flows", status: "todo" }
      ];
    }

    list.innerHTML = steps
      .map((s) => {
        if (s.status === "done") {
          return `<div class="text-emerald-400 flex items-center gap-1.5 font-medium"><span>✓</span> <span>${escapeHtml(s.name)}</span></div>`;
        } else if (s.status === "active") {
          return `<div class="text-purple-300 font-extrabold flex items-center gap-1.5 animate-pulse"><span>➔</span> <span>${escapeHtml(s.name)} (Active)</span></div>`;
        } else {
          return `<div class="text-slate-500 flex items-center gap-1.5"><span>○</span> <span>${escapeHtml(s.name)}</span></div>`;
        }
      })
      .join("");
  }

  // =========================================================================
  // UNIFIED VIEW SWITCHING ENGINE (Supports Tabs, Cards, & Dock)
  // =========================================================================
  // =========================================================================
  // =========================================================================
  // UNIFIED CLASSROOM WORKSPACE ROUTER & CANVAS SWITCHER
  // =========================================================================
  window.toggleFullscreenCanvas = function () {
    const chatSection = document.getElementById("leftChatSection");
    const splitter = document.getElementById("workspaceSplitter");
    const icon = document.getElementById("fullscreenCanvasIcon");
    const label = document.getElementById("fullscreenCanvasLabel");
    const btn = document.getElementById("toggleFullscreenCanvasBtn");

    if (!chatSection) return;
    const isNowFullscreen = chatSection.classList.toggle("hidden");
    if (splitter) {
      if (isNowFullscreen) {
        splitter.classList.add("hidden");
        splitter.classList.remove("lg:flex");
      } else {
        splitter.classList.remove("hidden");
        splitter.classList.add("lg:flex");
      }
    }

    if (isNowFullscreen) {
      if (icon) icon.textContent = "⧉";
      if (label) label.textContent = "Split View";
      if (btn) btn.title = "Exit Focus Mode & Restore Luna Chat";
    } else {
      if (icon) icon.textContent = "⛶";
      if (label) label.textContent = "Focus";
      if (btn) btn.title = "Focus Canvas (Full Screen)";
    }
    playSound("click");
  };

  window.navigateToPage = function (pageKey, pushState = true) {
    const key = (pageKey || "classroom").toLowerCase();

    // Galaxy / Graph view opens dedicated cosmic galaxy page
    if (key === "galaxy" || key === "graph") {
      document.getElementById("pageClassroom")?.classList.add("hidden");
      document.getElementById("pageGalaxy")?.classList.remove("hidden");

      if (pushState && window.history && window.history.pushState) {
        const cur = (window.location.pathname || "").toLowerCase();
        if (cur !== "/galaxy" && cur !== "/graph") {
          window.history.pushState({ page: "galaxy" }, "", "/galaxy");
        }
      }

      // Update Top Nav
      document.querySelectorAll(".global-nav-link").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-page-link") === "galaxy");
      });

      // Update Dock
      document.querySelectorAll(".dock-nav-btn").forEach((btn) => {
        const isMatch = btn.getAttribute("data-dock-tab") === "galaxy";
        if (isMatch) {
          btn.classList.add("active", "bg-gradient-to-br", "from-violet-500", "to-fuchsia-500", "text-white", "shadow-lg", "shadow-violet-500/30");
          btn.classList.remove("glass", "text-slate-400", "border-white/5");
        } else {
          btn.classList.remove("active", "bg-gradient-to-br", "from-violet-500", "to-fuchsia-500", "text-white", "shadow-lg", "shadow-violet-500/30");
          btn.classList.add("glass", "text-slate-400", "border-white/5");
        }
      });

      playSound("navigate");
      renderKnowledgeGalaxy();
      return;
    }

    // For all other views, stay inside Classroom split-screen and switch canvas tab!
    let tab = "live";
    if (key === "cheatsheet" || key === "exam") tab = "exam";
    else if (key === "blitz") tab = "blitz";
    else if (key === "flashcards") tab = "flashcards";
    else if (key === "analytics" || key === "journey") tab = "journey";
    else if (key === "voice") tab = "voice";
    else tab = "live";

    window.switchCanvasTab(tab, pushState);
  };

  // Switch canvas tab within classroom right panel
  window.switchCanvasTab = function (tabKey, pushState = true) {
    const normKey = (tabKey || "live").toLowerCase();
    let mappedKey = normKey;
    if (normKey === "cheatsheet") mappedKey = "exam";
    if (normKey === "analytics") mappedKey = "journey";
    if (normKey === "canvas") mappedKey = "live";

    // Route galaxy to navigateToPage
    if (normKey === "galaxy" || normKey === "graph") {
      window.navigateToPage("galaxy", pushState);
      return;
    }

    // Ensure Classroom is visible and Galaxy is hidden
    document.getElementById("pageGalaxy")?.classList.add("hidden");
    document.getElementById("pageClassroom")?.classList.remove("hidden");

    // Adapt mobile split-pane view
    if (typeof window.setMobileWorkspaceView === "function" && window.innerWidth < 1024) {
      window.setMobileWorkspaceView("canvas");
    }

    // Stop blitz timer if leaving Blitz tab
    if (mappedKey !== "blitz" && blitzState && blitzState.isRunning) {
      clearInterval(blitzState.timerInterval);
      blitzState.isRunning = false;
      const tmDisp = document.getElementById("blitzTimerDisplay");
      if (tmDisp) tmDisp.textContent = formatTimerString(blitzConfig.timeLimit);
    }

    // End voice call if leaving voice tab
    if (mappedKey !== "voice" && isVoiceCallActive) {
      endVoiceCall();
    }

    // Hide all canvas views
    const allViews = [
      "viewCanvasLive",
      "viewCanvasExam",
      "viewCanvasBlitz",
      "viewCanvasFlashcards",
      "viewCanvasVoice",
      "viewCanvasJourney"
    ];
    allViews.forEach((id) => {
      document.getElementById(id)?.classList.add("hidden");
    });

    // Show target view
    const viewMap = {
      live: "viewCanvasLive",
      exam: "viewCanvasExam",
      blitz: "viewCanvasBlitz",
      flashcards: "viewCanvasFlashcards",
      voice: "viewCanvasVoice",
      journey: "viewCanvasJourney"
    };
    const targetId = viewMap[mappedKey] || "viewCanvasLive";
    const targetEl = document.getElementById(targetId);
    if (targetEl) {
      targetEl.classList.remove("hidden");
    }

    // =========================================================================
    // DEDICATED FULL-WIDTH STUDIO vs CLASSROOM SPLIT-VIEW
    // When in Classroom (Live / Voice): show Split-View with Luna Chat!
    // When in Exam Cheat Sheet, Blitz Battle, 3D Flashcards, or Analytics:
    // HIDE the left chat section completely so the canvas is an uncluttered, 100% full-width studio!
    // =========================================================================
    const chatSection = document.getElementById("leftChatSection");
    const splitter = document.getElementById("workspaceSplitter");
    const mobileSegment = document.getElementById("mobileWorkspaceSegment");
    const fullscreenBtn = document.getElementById("toggleFullscreenCanvasBtn");
    const icon = document.getElementById("fullscreenCanvasIcon");
    const label = document.getElementById("fullscreenCanvasLabel");
    const isClassroomMode = (mappedKey === "live" || mappedKey === "voice");

    if (chatSection) {
      if (isClassroomMode) {
        // Restore Classroom Split-Screen with Luna Chat
        chatSection.classList.remove("hidden");
        if (splitter) {
          splitter.classList.remove("hidden");
          splitter.classList.add("lg:flex");
        }
        if (mobileSegment) {
          mobileSegment.classList.remove("hidden");
        }
        if (fullscreenBtn) {
          fullscreenBtn.classList.remove("hidden");
          if (icon) icon.textContent = "⛶";
          if (label) label.textContent = "Focus";
        }
      } else {
        // Full-Width Dedicated Studio (Exam Sheet, Blitz Arena, Flashcards, Analytics)
        chatSection.classList.add("hidden");
        if (splitter) {
          splitter.classList.add("hidden");
          splitter.classList.remove("lg:flex");
        }
        if (mobileSegment) {
          mobileSegment.classList.add("hidden");
        }
        if (fullscreenBtn) {
          fullscreenBtn.classList.add("hidden"); // Already 100% full width
        }
        if (typeof window.setMobileWorkspaceView === "function") {
          window.setMobileWorkspaceView("canvas");
        }
      }
    }

    // Push URL state without reloading
    const pathMap = {
      live: "/classroom",
      exam: "/cheatsheet",
      blitz: "/blitz",
      flashcards: "/flashcards",
      voice: "/classroom",
      journey: "/analytics"
    };
    const targetPath = pathMap[mappedKey] || "/classroom";
    if (pushState && window.history && window.history.pushState) {
      const currentPath = (window.location.pathname || "").toLowerCase();
      if (currentPath !== targetPath && !(currentPath === "/" && targetPath === "/classroom")) {
        window.history.pushState({ tab: mappedKey }, "", targetPath);
      }
    }

    // Sync Classroom Canvas Tab Buttons (.canvas-tab-btn)
    document.querySelectorAll(".canvas-tab-btn").forEach((btn) => {
      const k = btn.getAttribute("data-canvas-tab");
      const isMatch = (k === mappedKey) || (k === "live" && mappedKey === "live");
      if (isMatch) {
        btn.classList.add("active", "bg-gradient-to-r", "from-violet-600", "to-fuchsia-600", "text-white", "shadow-md", "shadow-violet-500/25");
        btn.classList.remove("text-slate-400", "hover:bg-white/[0.05]", "border-transparent");
      } else {
        btn.classList.remove("active", "bg-gradient-to-r", "from-violet-600", "to-fuchsia-600", "text-white", "shadow-md", "shadow-violet-500/25");
        btn.classList.add("text-slate-400", "hover:bg-white/[0.05]", "border-transparent");
      }
    });

    // Sync Top Workspace Nav Links (.global-nav-link)
    const navKeyMap = {
      live: "classroom",
      exam: "cheatsheet",
      blitz: "blitz",
      flashcards: "flashcards",
      voice: "classroom",
      journey: "analytics"
    };
    const currentNav = navKeyMap[mappedKey] || "classroom";
    document.querySelectorAll(".global-nav-link").forEach((btn) => {
      const p = btn.getAttribute("data-page-link");
      btn.classList.toggle("active", p === currentNav);
    });

    // Sync Left Mini-Dock Navigation Buttons (.dock-nav-btn)
    document.querySelectorAll(".dock-nav-btn").forEach((btn) => {
      const d = btn.getAttribute("data-dock-tab");
      const isMatch = (d === mappedKey) || (d === "live" && mappedKey === "live");
      if (isMatch) {
        btn.classList.add("active", "bg-gradient-to-br", "from-violet-500", "to-fuchsia-500", "text-white", "shadow-lg", "shadow-violet-500/30");
        btn.classList.remove("glass", "text-slate-400", "border-white/5");
      } else {
        btn.classList.remove("active", "bg-gradient-to-br", "from-violet-500", "to-fuchsia-500", "text-white", "shadow-lg", "shadow-violet-500/30");
        btn.classList.add("glass", "text-slate-400", "border-white/5");
      }
    });

    playSound("navigate");

    // Initialize/Refresh view-specific data
    if (mappedKey === "exam") {
      loadExamCheatSheet(false);
    } else if (mappedKey === "blitz") {
      showBlitzSetup();
    } else if (mappedKey === "flashcards") {
      loadFlashcardsDeck(false);
    } else if (mappedKey === "journey") {
      updateAnalyticsDashboard();
    } else if (mappedKey === "voice") {
      startVoiceCall();
    }
  };

  // Listen for browser Back/Forward navigation
  window.addEventListener("popstate", (e) => {
    const raw = (window.location.pathname || "").replace(/^\//, "").toLowerCase();
    if (raw === "cheatsheet" || raw === "exam") {
      window.switchCanvasTab("exam", false);
    } else if (raw === "blitz") {
      window.switchCanvasTab("blitz", false);
    } else if (raw === "flashcards") {
      window.switchCanvasTab("flashcards", false);
    } else if (raw === "analytics" || raw === "journey") {
      window.switchCanvasTab("journey", false);
    } else if (raw === "galaxy" || raw === "graph") {
      window.navigateToPage("galaxy", false);
    } else {
      window.switchCanvasTab("live", false);
    }
  });

  // =========================================================================
  // CHAT STREAM: USER & LUNA MESSAGE RENDERERS
  // =========================================================================
  function appendUserMessage(text, imageSrc) {
    const box = document.getElementById("chatMessagesContainer");
    if (!box) return;
    const d = document.createElement("div");
    d.className = "flex items-start justify-end gap-2.5 animate-fade-in";
    const imgHtml = imageSrc
      ? `<div class="mb-2"><img src="${imageSrc}" class="max-w-[200px] max-h-[140px] rounded-xl border border-violet-500/50 object-cover shadow-md" /></div>`
      : "";
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    d.innerHTML = `
      <div class="space-y-1 max-w-[85%] text-right">
        <div class="bg-gradient-to-r from-violet-600/30 to-indigo-600/30 border border-violet-500/30 glass p-3.5 rounded-2xl rounded-tr-sm text-xs font-medium leading-relaxed shadow-lg inline-block text-left text-white">
          <div class="flex items-center justify-between border-b border-violet-500/30 pb-1 text-[10px] text-violet-300 mb-1">
            <span class="font-bold">${escapeHtml(studentProfile.name || "Student")}</span>
            <span class="text-slate-400">${timeStr}</span>
          </div>
          ${imgHtml}
          <div>${escapeHtml(text)}</div>
        </div>
      </div>
      <div class="w-8 h-8 rounded-xl glass-strong border border-violet-500/30 flex items-center justify-center text-sm shrink-0 mt-1 shadow-md">
        ${studentProfile.avatar || "🎓"}
      </div>`;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }

  function appendLunaMessage(data) {
    const box = document.getElementById("chatMessagesContainer");
    if (!box) return;
    const d = document.createElement("div");
    d.className = "flex items-start gap-2.5 animate-fade-in";

    let analogyHtml = "";
    if (data.analogy_card && data.analogy_card.title) {
      analogyHtml = `
        <div class="p-3.5 glass-strong border border-violet-500/30 rounded-2xl space-y-1 shadow-sm">
          <span class="text-[9px] font-black uppercase tracking-wider text-violet-400">[Interactive Analogy Card]</span>
          <h5 class="text-xs font-black text-white">${escapeHtml(data.analogy_card.title)}</h5>
          <p class="text-[11px] text-violet-200/90 leading-relaxed">${escapeHtml(data.analogy_card.description || "")}</p>
        </div>`;
    }

    const rawSpeech = (data.speech_text || data.reply_text || "").replace(/<[^>]*>/g, "").trim();
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    d.innerHTML = `
      <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-violet-600 via-fuchsia-500 to-cyan-400 flex items-center justify-center text-sm text-white shrink-0 mt-1 shadow-md shadow-violet-500/30">
        🌸
      </div>
      <div class="space-y-2 max-w-[90%]">
        <div class="glass border border-white/10 p-4 rounded-2xl rounded-tl-sm text-slate-200 text-xs leading-relaxed shadow-lg space-y-3 backdrop-blur-xl">
          <div class="flex items-center justify-between border-b border-white/10 pb-1.5 text-[10px] text-slate-400">
            <span class="font-bold text-violet-400">Luna</span>
            <span>${timeStr}</span>
          </div>
          <div class="space-y-2 text-slate-200 leading-relaxed font-normal">${formatMarkdown(data.reply_text)}</div>
          ${analogyHtml}
          <div class="pt-2 flex items-center justify-between border-t border-white/10">
            <button class="chat-listen-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-950/80 hover:bg-violet-900 text-violet-300 text-[11px] font-bold border border-violet-800/60 shadow-sm transition cursor-pointer">
              <span>🎧</span> <span>Listen with Voice</span>
            </button>
            <span class="text-[10px] text-slate-500">Dual Gemini &amp; GLM-4</span>
          </div>
        </div>
      </div>`;

    box.appendChild(d);
    box.scrollTop = box.scrollHeight;

    const btn = d.querySelector(".chat-listen-btn");
    if (btn) {
      btn.addEventListener("click", () => {
        toggleVoiceAudio(data.audio_base64, rawSpeech, btn);
      });
    }

    // In live call, speak immediately
    if (isVoiceCallActive) {
      toggleVoiceAudio(data.audio_base64, rawSpeech, null);
    }
  }

  function appendTyping() {
    const box = document.getElementById("chatMessagesContainer");
    if (!box) return;
    const ind = document.createElement("div");
    ind.id = "lunaTypingIndicator";
    ind.className = "flex items-start gap-2.5 animate-fade-in";
    ind.innerHTML = `
      <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-violet-600 via-fuchsia-500 to-cyan-400 flex items-center justify-center text-sm text-white shrink-0 shadow shadow-violet-500/30 animate-pulse">
        🌸
      </div>
      <div class="glass border border-white/10 px-4 py-2.5 rounded-2xl rounded-tl-sm flex items-center gap-2 text-xs text-violet-400 font-bold backdrop-blur-xl">
        <span>🧠 Luna is thinking...</span>
      </div>`;
    box.appendChild(ind);
    box.scrollTop = box.scrollHeight;
  }

  function removeTyping() {
    document.getElementById("lunaTypingIndicator")?.remove();
  }



  function extractRoadmapFromClientText(text) {
    if (!text) return [];
    const steps = [];
    const lines = text.split('\n');
    for (const line of lines) {
      const m = line.match(/(?:(?:Step\s*(\d+)|\b(\d+)\.))\s*[:\-–]\s*([^\n\r]+)/i);
      if (m) {
        const num = parseInt(m[1] || m[2], 10);
        let rawTitle = m[3].replace(/[\*#_`]/g, '').trim();
        const descMatch = rawTitle.match(/\(([^\)]+)\)/);
        const desc = descMatch ? descMatch[1] : `Master ${rawTitle}`;
        const title = rawTitle.replace(/\s*\([^\)]*\)/, '').trim();
        if (title.length > 2 && title.length < 50) {
          steps.push({
            step_number: num || (steps.length + 1),
            title: title,
            status: steps.length === 0 ? "done" : steps.length === 1 ? "active" : "todo",
            description: desc
          });
        }
      }
    }
    return steps.slice(0, 6);
  }

  function applyRoadmapSteps(steps, topicName) {
    if (!steps || !steps.length) return;
    const list = document.getElementById("dynamicRoadmapStepsList");
    const sub = document.getElementById("roadmapPathSubtitle");
    if (sub) sub.textContent = `${topicName || activeTopic} Roadmap (${steps.length} Steps)`;

    if (list) {
      list.innerHTML = steps.map((s, i) => {
        const num = s.step_number || (i + 1);
        const title = s.title || `Step ${num}`;
        const desc = s.description ? `<p class="text-[10px] text-slate-400 pl-4">${escapeHtml(s.description)}</p>` : "";
        
        let icon = `<span class="text-purple-400 font-bold">➔</span>`;
        let badgeStyle = "text-purple-300 font-bold";
        if (s.status === "done" || i === 0) {
          icon = `<span class="text-emerald-400 font-bold">✓</span>`;
          badgeStyle = "text-emerald-300 font-medium";
        } else if (s.status === "active") {
          icon = `<span class="text-pink-400 animate-pulse font-bold">●</span>`;
          badgeStyle = "text-pink-300 font-extrabold";
        } else {
          icon = `<span class="text-slate-500 font-bold">○</span>`;
          badgeStyle = "text-slate-400";
        }

        return `
          <div class="p-2 rounded-xl bg-obsidian-900/60 border border-obsidian-750 hover:border-purple-600/60 transition cursor-pointer group roadmap-step-item" data-step-topic="${escapeHtml(title)}">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5 ${badgeStyle}">
                ${icon}
                <span class="text-xs">${num}. ${escapeHtml(title)}</span>
              </div>
              <span class="text-[9px] text-purple-400 opacity-0 group-hover:opacity-100 transition">Teach ➔</span>
            </div>
            ${desc}
          </div>`;
      }).join("");

      // Bind click on step to ask Luna about that milestone
      list.querySelectorAll(".roadmap-step-item").forEach(item => {
        item.addEventListener("click", () => {
          const stepTitle = item.getAttribute("data-step-topic");
          sendChatMessage(`Teach me: ${stepTitle} in ${activeTopic}!`);
        });
      });
    }

    // Also populate Unlocked Concept Nodes with the roadmap steps!
    const nodesGrid = document.getElementById("canvasNodesGrid");
    if (nodesGrid) {
      nodesGrid.innerHTML = steps.map((s, i) => {
        const num = s.step_number || (i + 1);
        return `
          <div class="p-3.5 rounded-2xl bg-obsidian-850 border border-purple-800/60 space-y-1 animate-fade-in cursor-pointer hover:border-pink-500/80 transition" onclick="window.askLunaStep('${escapeHtml(s.title)}')">
            <span class="text-[9px] font-black text-purple-400 uppercase">Milestone 0${num} • Step</span>
            <h5 class="text-xs font-extrabold text-white">${escapeHtml(s.title)}</h5>
            <p class="text-[11px] text-slate-400 leading-relaxed">${escapeHtml(s.description || "Master this conceptual milestone.")}</p>
          </div>`;
      }).join("");
    }
  }

  window.askLunaStep = function(title) {
    if (title) {
      sendChatMessage(`Teach me ${title} in detail with an everyday analogy!`);
    }
  };

  // =========================================================================
  // SEND CHAT MESSAGE TO BACKEND (MULTIMODAL VISION SUPPORT)
  // =========================================================================
  async function sendChatMessage(userText, imageBase64) {
    if (!userText || !userText.trim()) return;
    const clean = userText.trim();
    appendUserMessage(clean, imageBase64);

    const input = document.getElementById("chatMessageInput");
    const sendBtn = document.getElementById("chatSendBtn");
    if (input) input.value = "";
    if (sendBtn) sendBtn.disabled = true;

    appendTyping();
    playSound("click");

    conversationHistory.push({ role: "user", content: clean, image: imageBase64 || null });
    saveHistory();

    try {
      const res = await fetch("/api/chat-teach", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gemini-Key": localStorage.getItem("clearmind_gemini_key") || "" },
        body: JSON.stringify({
          topic: activeTopic,
          message: clean,
          conversation_history: conversationHistory.slice(-6).map((x) => ({ role: x.role, content: x.content })),
          language: activeLanguage,
          student_name: studentProfile.name || "Student",
          level: studentProfile.level || "College / University",
          mode: teachingMode,
          image_base64: imageBase64 || null
        })
      });

      removeTyping();
      if (!res.ok) throw new Error("Server response " + res.status);
      const data = await res.json();

      if (data.detected_topic && data.detected_topic !== activeTopic) {
        activeTopic = data.detected_topic;
        localStorage.setItem("clearmind_active_topic", activeTopic);
        updateActiveTopicUI();
        updateDynamicRoadmap();
      }

      conversationHistory.push({ role: "assistant", content: data.reply_text, data: data });
      saveHistory();

      appendLunaMessage(data);
      playSound("correct");
      addXP(25);

      if (data.suggested_replies && data.suggested_replies.length) {
        renderSuggestedChips(data.suggested_replies);
      }

      // Ensure roadmap is ALWAYS updated on the right side
      let finalSteps = data.roadmap_steps;
      if (!finalSteps || !finalSteps.length) {
        // Extract steps from text if Luna formatted them as a list
        finalSteps = extractRoadmapFromClientText(data.reply_text);
      }
      if (!finalSteps || !finalSteps.length) {
        if (clean.toLowerCase().includes("roadmap") || (data.detected_topic && !data.detected_topic.toLowerCase().includes("general science"))) {
          const topicName = data.detected_topic || activeTopic || "Core";
          finalSteps = [
            { step_number: 1, title: `${topicName} Foundations`, status: "done", description: "Prerequisites, definitions & vocabulary" },
            { step_number: 2, title: `Core Mechanism & Rules`, status: "active", description: "Fundamental operations & relations" },
            { step_number: 3, title: `Classification & Types`, status: "todo", description: "Key categories and mapping models" },
            { step_number: 4, title: `Examiner Traps & Formulas`, status: "todo", description: "Common exam mistakes and traps" },
            { step_number: 5, title: `Mastery & 60s Blitz Arena`, status: "todo", description: "Rapid testing and verification" }
          ];
        }
      }

      if (finalSteps && finalSteps.length) {
        applyRoadmapSteps(finalSteps, data.detected_topic || activeTopic);
        showToast("🗺️ Learning Roadmap Synced to Canvas!", "success");
        // Smoothly scroll or highlight roadmap card
        const rCard = document.getElementById("dynamicRoadmapStepsList")?.parentElement;
        if (rCard) {
          rCard.classList.add("ring-2", "ring-purple-500", "shadow-lg", "shadow-purple-500/20");
          setTimeout(() => rCard.classList.remove("ring-2", "ring-purple-500", "shadow-lg", "shadow-purple-500/20"), 2500);
        }
      }

      if (data.canvas_node_title && (!data.roadmap_steps || !data.roadmap_steps.length)) {
        addRoadmapNode(data.canvas_node_title, data.canvas_node_summary);
      }
    } catch (e) {
      console.warn("Chat error:", e);
      removeTyping();
      showToast("Network error communicating with AI tutor.", "error");
    } finally {
      if (sendBtn) sendBtn.disabled = false;
      if (input) input.focus();
    }
  }

  function hasActiveTopic() {
    if (!activeTopic) return false;
    const t = activeTopic.trim().toLowerCase();
    if (!t) return false;
    const invalid = [
      "ready to learn",
      "mastery",
      "core topic",
      "core fundamentals",
      "arena",
      "general science",
      "problem solving",
      "what would you like to learn",
      "choose any topic",
      "awaiting topic"
    ];
    return !invalid.includes(t);
  }

  function selectAndSetTopic(newTopic, targetAction = null) {
    if (!newTopic || !newTopic.trim()) return;
    const clean = newTopic.trim();
    activeTopic = clean;
    localStorage.setItem("clearmind_active_topic", activeTopic);
    updateActiveTopicUI();
    updateDynamicRoadmap();
    showToast(`🎯 Topic selected: ${clean}`, "success");
    playSound("click");

    // If currently viewing exam, blitz, or flashcards, reload that view
    const isExamVisible = !document.getElementById("viewCanvasExam")?.classList.contains("hidden");
    const isBlitzVisible = !document.getElementById("viewCanvasBlitz")?.classList.contains("hidden");
    const isFlashcardsVisible = !document.getElementById("viewCanvasFlashcards")?.classList.contains("hidden");

    if (targetAction === "exam" || (!targetAction && isExamVisible)) {
      loadExamCheatSheet(true);
    } else if (targetAction === "blitz" || (!targetAction && isBlitzVisible)) {
      showBlitzSetup();
    } else if (targetAction === "flashcards" || (!targetAction && isFlashcardsVisible)) {
      loadFlashcardsDeck(true);
    }
  }
  window.selectAndSetTopic = selectAndSetTopic;

  function updateActiveTopicUI() {
    const tTopic = document.getElementById("chatActiveTopic");
    const cTitle = document.getElementById("canvasTopicTitle");
    const examTopic = document.getElementById("examSheetTopicTitle");
    const flashTopic = document.getElementById("flashcardDeckTopicBadge");
    const hasTopic = hasActiveTopic();
    const dispTopic = hasTopic ? activeTopic : "Ready to Learn";

    if (tTopic) tTopic.textContent = dispTopic;
    if (cTitle) cTitle.textContent = hasTopic ? `${activeTopic} Knowledge Canvas` : "Live Knowledge Canvas";
    if (examTopic) {
      examTopic.innerHTML = `<span>⚡</span> <span>${escapeHtml(hasTopic ? activeTopic : "Mastery")} Cheat Sheet</span>`;
    }
    if (flashTopic) {
      flashTopic.textContent = hasTopic ? activeTopic : "Topic";
    }

    if (typeof renderBlitzTopicSection === "function") {
      renderBlitzTopicSection();
    }
  }

  function renderSuggestedChips(chips) {
    const dock = document.getElementById("suggestedChipsDock");
    if (!dock || !chips) return;
    dock.innerHTML = chips
      .map(
        (c) =>
          `<button class="suggested-chip text-[11px] font-semibold px-3 py-1 rounded-xl glass hover:bg-white/[0.08] text-slate-300 hover:text-violet-300 border border-white/10 hover:border-violet-500/40 transition shrink-0 cursor-pointer shadow-sm">
            ${escapeHtml(c)}
          </button>`
      )
      .join("");

    dock.querySelectorAll(".suggested-chip").forEach((btn) => {
      btn.addEventListener("click", () => sendChatMessage(btn.textContent.trim()));
    });
  }

  function addRoadmapNode(title, summary) {
    const list = document.getElementById("canvasNodesGrid");
    if (!list) return;
    const node = document.createElement("div");
    node.className =
      "bento-card p-3.5 rounded-2xl border border-white/10 space-y-1 animate-fade-in shadow-sm";
    node.innerHTML = `
      <span class="text-[9px] font-black text-violet-400 uppercase tracking-wider">✨ New Unlocked Node</span>
      <h5 class="text-xs font-extrabold text-white">${escapeHtml(title)}</h5>
      <p class="text-[11px] text-slate-400 leading-relaxed">${escapeHtml(summary || "")}</p>`;
    list.prepend(node);
  }

  // =========================================================================
  // VOICE TTS AUDIO PLAYBACK (INTERACTIVE PLAY / PAUSE / RESUME CONTROLLER)
  // =========================================================================
  let currentActiveVoiceBtn = null;

  function resetVoiceButton(btn) {
    if (!btn) return;
    btn.innerHTML = "<span>🎧</span> <span>Listen with Voice</span>";
    btn.classList.remove("bg-red-950/80", "border-red-800/60", "text-red-300");
    btn.classList.add("bg-purple-950/80", "border-purple-800/60", "text-purple-300");
    btn.disabled = false;
  }

  function stopCurrentAudio() {
    if (activeAudio) {
      try {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      } catch (e) {}
      activeAudio = null;
    }
    if (currentActiveVoiceBtn) {
      resetVoiceButton(currentActiveVoiceBtn);
      currentActiveVoiceBtn = null;
    }
    setAudioWaveformActive(false);
  }

  function toggleVoiceAudio(base64Audio, rawSpeech, btn) {
    if (!soundEnabled) {
      soundEnabled = true;
      localStorage.setItem("clearmind_sound", "true");
      const sBtn = document.getElementById("soundToggleBtn");
      if (sBtn) sBtn.textContent = "🔊";
    }

    // 1. If currently playing this audio, PAUSE IT
    if (activeAudio && !activeAudio.paused && currentActiveVoiceBtn === btn && btn) {
      activeAudio.pause();
      setAudioWaveformActive(false);
      btn.innerHTML = "<span>▶️</span> <span>Resume Voice</span>";
      btn.classList.remove("bg-red-950/80", "border-red-800/60", "text-red-300");
      btn.classList.add("bg-emerald-950/80", "border-emerald-800/60", "text-emerald-300");
      btn.disabled = false;
      return;
    }

    // 2. If currently paused on this button, RESUME IT
    if (activeAudio && activeAudio.paused && currentActiveVoiceBtn === btn && btn && activeAudio.currentTime > 0 && !activeAudio.ended) {
      activeAudio.play().then(() => {
        setAudioWaveformActive(true);
        btn.innerHTML = "<span>⏸️</span> <span>Pause Voice</span>";
        btn.classList.remove("bg-emerald-950/80", "border-emerald-800/60", "text-emerald-300");
        btn.classList.add("bg-red-950/80", "border-red-800/60", "text-red-300");
        btn.disabled = false;
      }).catch(err => {
        console.warn("Audio resume error:", err);
        stopCurrentAudio();
      });
      return;
    }

    // 3. Otherwise, stop any previous playing audio and start fresh
    stopCurrentAudio();

    if (!base64Audio && !rawSpeech) return;

    if (btn) {
      btn.innerHTML = "<span>⏸️</span> <span>Pause Voice</span>";
      btn.classList.remove("bg-purple-950/80", "border-purple-800/60", "text-purple-300", "bg-emerald-950/80", "border-emerald-800/60", "text-emerald-300");
      btn.classList.add("bg-red-950/80", "border-red-800/60", "text-red-300");
      btn.disabled = false;
      currentActiveVoiceBtn = btn;
    }

    if (base64Audio) {
      try {
        activeAudio = new Audio("data:audio/mpeg;base64," + base64Audio);
        activeAudio.onended = () => {
          stopCurrentAudio();
        };
        activeAudio.onerror = () => {
          stopCurrentAudio();
        };
        activeAudio.play().then(() => {
          setAudioWaveformActive(true);
        }).catch(e => {
          console.warn("Audio play rejected:", e);
          stopCurrentAudio();
        });
      } catch (err) {
        console.warn("Audio init error:", err);
        stopCurrentAudio();
      }
    } else if (rawSpeech) {
      playLunaVoice(rawSpeech, btn);
    }
  }

  function playPreSynthesizedAudio(base64Audio, btn) {
    toggleVoiceAudio(base64Audio, null, btn);
  }

  async function playLunaVoice(rawText, btn) {
    if (!soundEnabled || !rawText) return;
    const clean = rawText.replace(/<[^>]*>/g, "").trim();
    if (!clean) return;

    if (btn) {
      btn.innerHTML = "<span>⏳</span> <span>Synthesizing...</span>";
      btn.disabled = true;
    }

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gemini-Key": localStorage.getItem("clearmind_gemini_key") || "" },
        body: JSON.stringify({ text: clean, language: activeLanguage })
      });
      if (!res.ok) throw new Error("TTS failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (activeAudio) activeAudio.pause();
      activeAudio = new Audio(url);
      activeAudio.play().then(() => {
        setAudioWaveformActive(true);
      }).catch(e => console.warn(e));
      activeAudio.onended = () => {
        setAudioWaveformActive(false);
        if (btn) {
          btn.innerHTML = "<span>🎧</span> <span>Listen with Voice</span>";
          btn.disabled = false;
        }
      };
    } catch (e) {
      console.warn("TTS fallback:", e);
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(clean);
        u.lang = activeLanguage === "hinglish" ? "en-IN" : activeLanguage === "hi" ? "hi-IN" : "en-US";
        u.onstart = () => setAudioWaveformActive(true);
        u.onend = () => setAudioWaveformActive(false);
        u.onerror = () => setAudioWaveformActive(false);
        window.speechSynthesis.speak(u);
      }
      if (btn) {
        btn.innerHTML = "<span>🎧</span> <span>Listen with Voice</span>";
        btn.disabled = false;
      }
    }
  }

  // =========================================================================
  // 60-SECOND COMPREHENSIVE EXAM CHEAT SHEET & PDF EXPORT
  // =========================================================================
  function renderExamCheatSheetData(d) {
    const title = document.getElementById("examSheetTopicTitle");
    const syn = document.getElementById("examSheetSynopsis");
    const trap = document.getElementById("examTrapWarningText");
    const fGrid = document.getElementById("examFormulasGrid");
    const trapsList = document.getElementById("examTrapsList");
    const mnem = document.getElementById("examMnemonicText");
    const mnemTip = document.getElementById("examMnemonicTip");
    const gRules = document.getElementById("examGoldenRulesList");
    const q5 = document.getElementById("exam5MarkQuestionText");
    const q5Steps = document.getElementById("exam5MarkSolutionSteps");

    const dispTopic = d.topic || activeTopic || "Core Topic";
    if (title) title.innerHTML = `<span>⚡</span> <span>${escapeHtml(dispTopic)} Cheat Sheet</span>`;
    if (syn) syn.textContent = d.synopsis || "High-yield equations, examiner traps, derivations, and SPARK memory anchors.";
    if (trap) {
      trap.textContent = d.examiner_trap_warning || (d.examiner_traps && d.examiner_traps[0]?.trap) || "Avoid common sign errors, unit misalignments, and premature substitutions.";
    }

    // Formulas Grid
    if (fGrid) {
      if (d.formula_cards && d.formula_cards.length > 0) {
        fGrid.innerHTML = d.formula_cards.map((f) => `
          <div class="bento-card lift p-3.5 border border-white/10 rounded-2xl space-y-1.5 formula-card-print shadow-md">
            <div class="flex items-center justify-between">
              <span class="text-xs font-black text-white">${escapeHtml(f.name)}</span>
              <span class="text-[9px] font-black uppercase text-violet-300 bg-violet-950/80 px-2 py-0.5 rounded border border-violet-800/60">${escapeHtml(f.importance || "Core Rule")}</span>
            </div>
            <div class="p-2.5 bg-black/40 border border-white/5 rounded-xl text-amber-300 font-mono text-xs overflow-x-auto">
              ${renderFormulaLatex(f.latex || "")}
            </div>
            ${f.variables ? `<p class="text-[11px] text-slate-300 leading-relaxed"><strong class="text-violet-300">Variables:</strong> ${escapeHtml(f.variables)}</p>` : ""}
          </div>
        `).join("");
      } else if (d.formulas_and_definitions && d.formulas_and_definitions.length > 0) {
        fGrid.innerHTML = d.formulas_and_definitions.map((f) => `
          <div class="bento-card lift p-3 border border-white/10 rounded-xl text-xs text-amber-300 font-mono flex items-center justify-between formula-card-print shadow-sm">
            <div class="flex-1 overflow-x-auto">${renderFormulaLatex(f)}</div>
            <span class="text-[9px] text-violet-400 uppercase font-bold shrink-0 ml-2">Rule</span>
          </div>
        `).join("");
      }
    }

    // Traps List
    if (trapsList) {
      if (d.examiner_traps && d.examiner_traps.length > 0) {
        trapsList.innerHTML = d.examiner_traps.map((t) => `
          <div class="p-3 bg-rose-950/25 border border-rose-500/30 rounded-xl space-y-1 trap-card-print shadow-sm">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                <span>🛑</span> <span>${escapeHtml(t.trap)}</span>
              </span>
              <span class="text-[9px] font-black uppercase text-rose-400 bg-rose-950/80 px-2 py-0.5 rounded border border-rose-800/80">${escapeHtml(t.exam_type || "Negative Mark Risk")}</span>
            </div>
            ${t.fix ? `<p class="text-[11px] text-emerald-300/90 pl-5 font-medium leading-relaxed">✓ Solution: ${escapeHtml(t.fix)}</p>` : ""}
          </div>
        `).join("");
      } else {
        trapsList.innerHTML = `
          <div class="p-3 bg-rose-950/20 border border-rose-500/30 rounded-xl text-xs text-rose-300 trap-card-print shadow-sm">
            ${escapeHtml(d.examiner_trap_warning || "Avoid standard algebraic misinterpretations during time pressure.")}
          </div>`;
      }
    }

    // Rapid Memory Mnemonic
    if (mnem) {
      if (d.mnemonics && d.mnemonics.length > 0) {
        const m = d.mnemonics[0];
        mnem.textContent = `${m.acronym}: ${m.expansion}`;
        if (mnemTip && m.tip) mnemTip.textContent = m.tip;
      } else {
        mnem.textContent = d.rapid_memory_mnemonic || "S.P.A.R.K: Scope -> Parameters -> Apply -> Resolve -> Keep Units";
      }
    }

    // Golden Rules
    if (gRules) {
      if (d.golden_rules && d.golden_rules.length > 0) {
        gRules.innerHTML = d.golden_rules.map((r) => `<li>${escapeHtml(r)}</li>`).join("");
      } else {
        gRules.innerHTML = `
          <li>Box final numerical answers with standard SI units.</li>
          <li>State governing axioms before mathematical substitutions.</li>`;
      }
    }

    // 5-Mark Question
    if (q5) {
      if (d.must_know_questions && d.must_know_questions.length > 0) {
        const qObj = d.must_know_questions[0];
        q5.textContent = qObj.question;
        if (q5Steps && qObj.solution_steps && qObj.solution_steps.length > 0) {
          q5Steps.innerHTML = qObj.solution_steps.map((st, i) => `
            <div class="p-2 rounded-lg bg-obsidian-900/80 border border-obsidian-750 flex items-start gap-2">
              <span class="text-[10px] font-black text-purple-400 bg-purple-950 px-1.5 py-0.5 rounded border border-purple-800 shrink-0">Step 0${i + 1}</span>
              <span class="text-xs text-slate-200 leading-relaxed">${formatMarkdown(st)}</span>
            </div>
          `).join("");
        }
      } else {
        q5.innerHTML = formatMarkdown(d.must_know_5mark_question || "Derive fundamental relationship step-by-step with boundary limits.");
        if (q5Steps) {
          q5Steps.innerHTML = `
            <div class="p-2 rounded-lg bg-obsidian-900/80 border border-obsidian-750 text-xs text-slate-300">
              Apply fundamental definitions, state assumptions, compute intermediate values, and verify edge cases.
            </div>`;
        }
      }
    }
  }

  async function loadExamCheatSheet(forceRegenerate = false) {
    const emptyState = document.getElementById("examNoTopicEmptyState");
    const content = document.getElementById("examSheetContentContainer");

    if (!hasActiveTopic()) {
      if (emptyState) emptyState.classList.remove("hidden");
      if (content) content.classList.add("hidden");
      return;
    }

    if (emptyState) emptyState.classList.add("hidden");
    if (content) content.classList.remove("hidden");

    const title = document.getElementById("examSheetTopicTitle");
    if (title) {
      title.innerHTML = `<span>⚡</span> <span>${escapeHtml(activeTopic)} Cheat Sheet</span>`;
    }

    if (!forceRegenerate && cachedCheatSheets[activeTopic]) {
      renderExamCheatSheetData(cachedCheatSheets[activeTopic]);
      return;
    }

    const trap = document.getElementById("examTrapWarningText");
    const mnem = document.getElementById("examMnemonicText");
    const q5 = document.getElementById("exam5MarkQuestionText");
    if (trap) trap.textContent = "Synthesizing examiner traps & formulas...";
    if (mnem) mnem.textContent = "Generating rapid memory mnemonic...";
    if (q5) q5.textContent = "Extracting guaranteed 5-mark question...";

    try {
      const res = await fetch("/api/exam-cheat-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gemini-Key": localStorage.getItem("clearmind_gemini_key") || "" },
        body: JSON.stringify({
          topic: activeTopic,
          language: activeLanguage,
          level: studentProfile.level || "College / University"
        })
      });

      if (!res.ok) throw new Error("Cheat sheet request failed");
      const d = await res.json();
      cachedCheatSheets[activeTopic] = d;
      renderExamCheatSheetData(d);

      // Award XP once per session for this topic
      if (!awardedCheatSheetTopics.has(activeTopic)) {
        awardedCheatSheetTopics.add(activeTopic);
        addXP(50);
        bumpStreak();
        playSound("fanfare");
        if (typeof confetti === "function") {
          confetti({ particleCount: 50, spread: 60, origin: { y: 0.5 } });
        }
        showToast("⚡ Real Exam Cheat Sheet Generated! +50 XP Earned", "success");
      }
    } catch (e) {
      console.warn("Cheat sheet error:", e);
      showToast("Could not generate cheat sheet from AI.", "error");
    }
  }

  // =========================================================================
  // BLITZ BATTLE ARENA 2.0 (CUSTOMIZABLE RAPID-FIRE ARENA)
  // =========================================================================
  function formatTimerString(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
  }

  function renderBlitzTopicSection() {
    const container = document.getElementById("blitzTopicPickerSection");
    if (!container) return;

    if (hasActiveTopic()) {
      container.innerHTML = `
        <div class="p-3.5 rounded-2xl bg-gradient-to-r from-violet-950/70 to-purple-950/50 border border-violet-500/40 flex items-center justify-between shadow-inner">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl bg-violet-600/30 border border-violet-500/40 flex items-center justify-center text-sm shadow-sm">
              🎯
            </div>
            <div>
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[10px] uppercase font-black text-violet-300 tracking-wider">Test Arena Subject:</span>
                <span class="text-xs font-black text-white bg-violet-800/80 px-2.5 py-0.5 rounded-md border border-violet-600/60 shadow-sm">${escapeHtml(activeTopic)}</span>
              </div>
              <p class="text-[10px] text-slate-400">Match questions will specifically test your speed and accuracy on this topic.</p>
            </div>
          </div>
          <button type="button" id="blitzChangeTopicBtn" class="px-2.5 py-1.5 text-[11px] font-bold text-violet-300 hover:text-white glass rounded-xl border border-white/10 hover:border-violet-500/50 transition cursor-pointer shrink-0">
            ✏️ Change
          </button>
        </div>
        <div id="blitzChangeTopicDrawer" class="hidden mt-2.5 p-3 rounded-2xl glass-strong border border-white/10 space-y-2 animate-fade-in">
          <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Switch Test Subject:</span>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5" id="blitzDrawerChips">
            <button type="button" data-select-topic="Introduction to Python" class="p-1.5 rounded-lg glass border border-white/10 hover:border-violet-500/50 text-[11px] font-semibold text-slate-300 hover:text-white transition text-center cursor-pointer">🐍 Python</button>
            <button type="button" data-select-topic="Calculus & Derivatives" class="p-1.5 rounded-lg glass border border-white/10 hover:border-violet-500/50 text-[11px] font-semibold text-slate-300 hover:text-white transition text-center cursor-pointer">📐 Calculus</button>
            <button type="button" data-select-topic="Photosynthesis & Cellular Respiration" class="p-1.5 rounded-lg glass border border-white/10 hover:border-violet-500/50 text-[11px] font-semibold text-slate-300 hover:text-white transition text-center cursor-pointer">🌿 Biology</button>
            <button type="button" data-select-topic="Thermodynamics & Heat Laws" class="p-1.5 rounded-lg glass border border-white/10 hover:border-violet-500/50 text-[11px] font-semibold text-slate-300 hover:text-white transition text-center cursor-pointer">⚛️ Physics</button>
            <button type="button" data-select-topic="Quantum Computing & Qubits" class="p-1.5 rounded-lg glass border border-white/10 hover:border-violet-500/50 text-[11px] font-semibold text-slate-300 hover:text-white transition text-center cursor-pointer">🌌 Quantum</button>
            <button type="button" data-select-topic="Neural Networks & Deep Learning" class="p-1.5 rounded-lg glass border border-white/10 hover:border-violet-500/50 text-[11px] font-semibold text-slate-300 hover:text-white transition text-center cursor-pointer">🧠 AI & ML</button>
          </div>
          <div class="flex items-center gap-1.5 pt-1">
            <input type="text" id="blitzDrawerCustomInput" placeholder="Or enter custom test topic..." class="flex-1 glass border border-white/15 focus:border-violet-500 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none" />
            <button type="button" id="blitzDrawerSubmitBtn" class="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-bold transition cursor-pointer">Set</button>
          </div>
        </div>
      `;

      document.getElementById("blitzChangeTopicBtn")?.addEventListener("click", () => {
        const drawer = document.getElementById("blitzChangeTopicDrawer");
        if (drawer) drawer.classList.toggle("hidden");
      });

      document.querySelectorAll("#blitzDrawerChips [data-select-topic]").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectAndSetTopic(btn.getAttribute("data-select-topic"), "blitz");
        });
      });

      const drawerInput = document.getElementById("blitzDrawerCustomInput");
      const drawerBtn = document.getElementById("blitzDrawerSubmitBtn");
      if (drawerBtn && drawerInput) {
        drawerBtn.addEventListener("click", () => {
          const val = drawerInput.value.trim();
          if (val) selectAndSetTopic(val, "blitz");
        });
        drawerInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            const val = drawerInput.value.trim();
            if (val) selectAndSetTopic(val, "blitz");
          }
        });
      }
    } else {
      // TOPIC NOT DECIDED YET
      container.innerHTML = `
        <div class="p-4 rounded-2xl bg-amber-950/40 border border-amber-500/40 text-amber-200 space-y-3 shadow-lg">
          <div class="flex items-start gap-2.5">
            <span class="text-xl shrink-0">⚠️</span>
            <div class="space-y-0.5">
              <h4 class="text-xs font-black uppercase tracking-wider text-amber-300">Topic Not Decided Yet!</h4>
              <p class="text-[11px] text-amber-200/90 leading-relaxed">
                Blitz Battle Arena tests speed and recall on a specific subject. Select a subject below or enter your own so Luna can generate match questions:
              </p>
            </div>
          </div>

          <!-- Quick Topic Pills -->
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1" id="blitzEmptyStateChips">
            <button type="button" data-select-topic="Introduction to Python" class="p-2 rounded-xl glass border border-amber-500/30 hover:border-amber-400 text-xs font-bold text-slate-200 hover:text-white transition text-center cursor-pointer">🐍 Python</button>
            <button type="button" data-select-topic="Calculus & Derivatives" class="p-2 rounded-xl glass border border-amber-500/30 hover:border-amber-400 text-xs font-bold text-slate-200 hover:text-white transition text-center cursor-pointer">📐 Calculus</button>
            <button type="button" data-select-topic="Photosynthesis & Cellular Respiration" class="p-2 rounded-xl glass border border-amber-500/30 hover:border-amber-400 text-xs font-bold text-slate-200 hover:text-white transition text-center cursor-pointer">🌿 Biology</button>
            <button type="button" data-select-topic="Thermodynamics & Heat Laws" class="p-2 rounded-xl glass border border-amber-500/30 hover:border-amber-400 text-xs font-bold text-slate-200 hover:text-white transition text-center cursor-pointer">⚛️ Physics</button>
            <button type="button" data-select-topic="Quantum Computing & Qubits" class="p-2 rounded-xl glass border border-amber-500/30 hover:border-amber-400 text-xs font-bold text-slate-200 hover:text-white transition text-center cursor-pointer">🌌 Quantum</button>
            <button type="button" data-select-topic="Neural Networks & Deep Learning" class="p-2 rounded-xl glass border border-amber-500/30 hover:border-amber-400 text-xs font-bold text-slate-200 hover:text-white transition text-center cursor-pointer">🧠 AI & ML</button>
          </div>

          <!-- Custom Input -->
          <div class="flex items-center gap-2 pt-1">
            <input type="text" id="blitzCustomTopicInput" placeholder="Or enter custom test topic (e.g. Thermodynamics)..." class="flex-1 glass border border-white/20 focus:border-amber-400 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-400" />
            <button type="button" id="blitzCustomTopicSubmitBtn" class="px-4 py-2 bg-gradient-to-r from-amber-500 to-pink-600 text-white rounded-xl text-xs font-bold hover:opacity-95 shadow-md shadow-amber-500/25 transition shrink-0 cursor-pointer">
              Set Topic ⚡
            </button>
          </div>
        </div>
      `;

      document.querySelectorAll("#blitzEmptyStateChips [data-select-topic]").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectAndSetTopic(btn.getAttribute("data-select-topic"), "blitz");
        });
      });

      const custInput = document.getElementById("blitzCustomTopicInput");
      const custBtn = document.getElementById("blitzCustomTopicSubmitBtn");
      if (custBtn && custInput) {
        custBtn.addEventListener("click", () => {
          const val = custInput.value.trim();
          if (val) selectAndSetTopic(val, "blitz");
        });
        custInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            const val = custInput.value.trim();
            if (val) selectAndSetTopic(val, "blitz");
          }
        });
      }
    }
  }

  function showBlitzSetup() {
    if (blitzState.isRunning) return;
    const setupScreen = document.getElementById("blitzSetupScreen");
    const activeScreen = document.getElementById("blitzActiveScreen");
    if (setupScreen) setupScreen.classList.remove("hidden");
    if (activeScreen) activeScreen.classList.add("hidden");

    // Render / sync topic banner
    renderBlitzTopicSection();

    // Sync active pills
    document.querySelectorAll("#blitzTimePills .blitz-config-pill").forEach((btn) => {
      const t = parseInt(btn.getAttribute("data-time"), 10);
      if (t === blitzConfig.timeLimit) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    document.querySelectorAll("#blitzCountPills .blitz-config-pill").forEach((btn) => {
      const c = parseInt(btn.getAttribute("data-count"), 10);
      if (c === blitzConfig.questionCount) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  async function startBlitzBattle() {
    if (!hasActiveTopic()) {
      showToast("⚠️ Please decide or select a test topic before entering the Arena!", "warning");
      playSound("error");
      const inp = document.getElementById("blitzCustomTopicInput");
      if (inp) {
        inp.focus();
        inp.classList.add("ring-2", "ring-rose-500");
        setTimeout(() => inp.classList.remove("ring-2", "ring-rose-500"), 2000);
      }
      return;
    }

    clearInterval(blitzState.timerInterval);
    blitzState.isRunning = false;
    blitzState.score = 0;
    blitzState.combo = 1;
    blitzState.timeLeft = blitzConfig.timeLimit;
    blitzState.currentQuestionIdx = 0;
    blitzState.questions = [];

    const setupScreen = document.getElementById("blitzSetupScreen");
    const activeScreen = document.getElementById("blitzActiveScreen");
    if (setupScreen) setupScreen.classList.add("hidden");
    if (activeScreen) activeScreen.classList.remove("hidden");

    const tmDisp = document.getElementById("blitzTimerDisplay");
    const scNum = document.getElementById("blitzScoreNum");
    const cbBadge = document.getElementById("blitzComboBadge");
    const qCard = document.getElementById("blitzQuestionCard");
    const qIdx = document.getElementById("blitzQuestionIdx");
    const qTotal = document.getElementById("blitzTotalQuestions");

    if (tmDisp) tmDisp.textContent = formatTimerString(blitzState.timeLeft);
    if (scNum) scNum.textContent = "0";
    if (cbBadge) cbBadge.textContent = "1x COMBO";
    if (qIdx) qIdx.textContent = "1";
    if (qTotal) qTotal.textContent = String(blitzConfig.questionCount);

    if (qCard) {
      qCard.innerHTML = `
        <div class="p-8 text-center space-y-3">
          <p class="text-xs text-purple-300 font-bold animate-pulse">Loading ${blitzConfig.questionCount} rapid-fire questions for ${escapeHtml(activeTopic || "Arena")}...</p>
          <p class="text-[11px] text-slate-400">Match duration: ${blitzConfig.timeLimit}s. Timer starts as soon as questions load!</p>
        </div>`;
    }

    try {
      const res = await fetch("/api/blitz-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gemini-Key": localStorage.getItem("clearmind_gemini_key") || "" },
        body: JSON.stringify({
          topic: activeTopic || "Core Fundamentals",
          language: activeLanguage,
          num_questions: blitzConfig.questionCount,
          time_limit_seconds: blitzConfig.timeLimit
        })
      });
      const d = await res.json();
      blitzState.questions = d.questions || [];
    } catch (e) {
      console.warn("Blitz error:", e);
    }

    if (!blitzState.questions || !blitzState.questions.length) {
      blitzState.questions = [
        {
          id: 1,
          question: `What fundamental principle governs ${activeTopic || "this topic"}?`,
          options: ["Conservation of State", "Random Variance", "Infinite Acceleration"],
          correct_index: 0,
          explanation: "Fundamental laws dictate structured conservation."
        },
        {
          id: 2,
          question: "What is the standard order of operations?",
          options: ["BODMAS / PEMDAS", "Random order", "Right to Left always"],
          correct_index: 0,
          explanation: "Brackets, Orders, Division, Multiplication, Addition, Subtraction."
        },
        {
          id: 3,
          question: "Which data structure operates on LIFO (Last In First Out)?",
          options: ["Queue", "Stack", "Array"],
          correct_index: 1,
          explanation: "Stacks push and pop from the top."
        },
        {
          id: 4,
          question: "What is the time complexity of binary search on a sorted array?",
          options: ["O(1)", "O(n)", "O(log n)"],
          correct_index: 2,
          explanation: "Binary search halves the search space at each step."
        }
      ];
    }

    blitzState.isRunning = true;
    renderBlitzQuestion();

    // Start timer AFTER questions are displayed
    blitzState.timerInterval = setInterval(() => {
      blitzState.timeLeft -= 1;
      if (tmDisp) tmDisp.textContent = formatTimerString(blitzState.timeLeft);
      if (blitzState.timeLeft <= 10) playSound("tick");
      if (blitzState.timeLeft <= 0) endBlitzBattle("timeout");
    }, 1000);
  }

  function renderBlitzQuestion() {
    if (!blitzState.isRunning) return;
    const q = blitzState.questions[blitzState.currentQuestionIdx];
    if (!q) {
      endBlitzBattle("completed");
      return;
    }

    const qIdx = document.getElementById("blitzQuestionIdx");
    const qTotal = document.getElementById("blitzTotalQuestions");
    if (qIdx) qIdx.textContent = blitzState.currentQuestionIdx + 1;
    if (qTotal) qTotal.textContent = blitzState.questions.length;

    const qCard = document.getElementById("blitzQuestionCard");
    if (!qCard) return;

    qCard.innerHTML = `
      <p id="blitzQuestionText" class="text-sm font-extrabold text-white leading-relaxed text-center">
        ${escapeHtml(q.question)}
      </p>
      <div id="blitzOptionsGrid" class="grid gap-2.5 pt-2">
        ${q.options
          .map(
            (opt, idx) => `
          <button data-opt="${idx}" class="blitz-opt-btn p-3.5 rounded-xl glass hover:bg-violet-600/20 border border-white/10 hover:border-violet-500/40 text-xs font-bold text-white text-left transition flex items-center justify-between cursor-pointer active:scale-98 shadow-sm">
            <span>${escapeHtml(opt)}</span>
            <span class="text-[10px] text-slate-400 font-mono">Option ${String.fromCharCode(65 + idx)}</span>
          </button>`
          )
          .join("")}
      </div>`;

    qCard.querySelectorAll(".blitz-opt-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        handleBlitzAnswer(parseInt(btn.getAttribute("data-opt"), 10), btn);
      });
    });
  }

  function handleBlitzAnswer(selectedIdx, btn) {
    if (!blitzState.isRunning) {
      showToast("⏰ Time is up! You cannot answer after the timer ends.", "error");
      return;
    }

    const q = blitzState.questions[blitzState.currentQuestionIdx];
    if (!q) return;

    const allBtns = document.querySelectorAll(".blitz-opt-btn");
    allBtns.forEach((b) => (b.disabled = true));

    const correctIdx = parseInt(q.correct_index, 10);
    if (selectedIdx === correctIdx) {
      playSound(blitzState.combo > 1 ? "combo" : "correct");
      blitzState.score += 100 * blitzState.combo;
      blitzState.combo = Math.min(5, blitzState.combo + 1);
      btn.classList.add("bg-emerald-950/90", "border-emerald-500", "text-emerald-200");
    } else {
      playSound("wrong");
      blitzState.combo = 1;
      btn.classList.add("bg-rose-950/90", "border-rose-500", "text-rose-200");
      if (allBtns[correctIdx]) {
        allBtns[correctIdx].classList.add("bg-emerald-950/90", "border-emerald-500", "text-emerald-200");
      }
    }

    const scNum = document.getElementById("blitzScoreNum");
    const cbBadge = document.getElementById("blitzComboBadge");
    if (scNum) scNum.textContent = blitzState.score;
    if (cbBadge) cbBadge.textContent = blitzState.combo + "x COMBO";

    setTimeout(() => {
      if (!blitzState.isRunning) return;
      blitzState.currentQuestionIdx += 1;
      renderBlitzQuestion();
    }, 450);
  }

  function endBlitzBattle(reason) {
    clearInterval(blitzState.timerInterval);
    blitzState.isRunning = false;

    document.querySelectorAll(".blitz-opt-btn").forEach((b) => (b.disabled = true));

    playSound("fanfare");
    if (typeof confetti === "function") {
      confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 } });
    }

    const earnedXP = Math.round(blitzState.score / 2);
    addXP(earnedXP);

    // Track High Scores
    let isNewRecord = false;
    if (blitzState.score > blitzHighScore) {
      blitzHighScore = blitzState.score;
      localStorage.setItem("clearmind_blitz_highscore", String(blitzHighScore));
      isNewRecord = true;
    }
    if (blitzState.combo > blitzBestCombo) {
      blitzBestCombo = blitzState.combo;
      localStorage.setItem("clearmind_blitz_best_combo", String(blitzBestCombo));
    }

    // Cognitive Engine reinforcement for the topic
    if (activeTopic) {
      CognitiveEngine.recordConceptRecall(activeTopic, blitzState.score >= 80 ? 0.85 : 0.55);
    }

    // Update Daily Mission for Blitz Battle
    const missions = CognitiveEngine.loadMissions();
    const m4 = missions.find((m) => m.id === "m4");
    if (m4 && !m4.done) {
      m4.progress = 1;
      CognitiveEngine.saveMissions(missions);
      if (blitzState.combo >= 2 || blitzState.score >= 80) {
        CognitiveEngine.completeMission("m4");
      }
    }

    const tmDisp = document.getElementById("blitzTimerDisplay");
    if (tmDisp) tmDisp.textContent = "00:00 (Done)";

    const qCard = document.getElementById("blitzQuestionCard");
    if (qCard) {
      qCard.innerHTML = `
        <div class="p-6 glass-strong rounded-2xl border border-violet-500/40 space-y-4 text-center shadow-2xl backdrop-blur-xl">
          <div class="w-14 h-14 rounded-full bg-amber-400 text-black mx-auto flex items-center justify-center text-2xl font-black shadow-lg">
            🏆
          </div>
          <div>
            <h4 class="text-base font-black text-white">${reason === "timeout" ? "⏰ Time's Up! Round Finished" : "⚡ Blitz Battle Complete!"}</h4>
            <p class="text-xs text-violet-200">Topic: ${escapeHtml(activeTopic || "Arena")}</p>
            ${isNewRecord ? `<span class="inline-block mt-1 px-3 py-0.5 rounded-full text-[10px] font-black bg-amber-400 text-black animate-pulse">🌟 NEW ALL-TIME RECORD!</span>` : ""}
          </div>
          <div class="grid grid-cols-3 gap-2 py-2 border-y border-white/10">
            <div class="p-2.5 glass rounded-xl border border-white/5">
              <span class="text-[10px] text-slate-400 block uppercase font-bold">Final Score</span>
              <span class="text-sm font-black text-amber-400 font-mono">${blitzState.score} PTS</span>
            </div>
            <div class="p-2.5 glass rounded-xl border border-white/5">
              <span class="text-[10px] text-slate-400 block uppercase font-bold">XP Gained</span>
              <span class="text-sm font-black text-emerald-400 font-mono">+${earnedXP} XP</span>
            </div>
            <div class="p-2.5 glass rounded-xl border border-white/5">
              <span class="text-[10px] text-slate-400 block uppercase font-bold">Answered</span>
              <span class="text-sm font-black text-violet-400 font-mono">${blitzState.currentQuestionIdx} / ${blitzState.questions.length}</span>
            </div>
          </div>
          <div class="flex flex-wrap justify-center gap-2.5 pt-1">
            <button id="restartBlitzBtn" class="px-5 py-2.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:opacity-95 text-white rounded-xl text-xs font-bold transition shadow-md shadow-violet-500/25 cursor-pointer">
              ⚡ Play Again (${blitzConfig.timeLimit}s)
            </button>
            <button id="configBlitzBtn" class="px-4 py-2.5 glass hover:bg-white/[0.08] text-violet-300 rounded-xl text-xs font-bold border border-white/10 transition cursor-pointer">
              ⚙️ Arena Config
            </button>
            <button id="closeBlitzSummaryBtn" class="px-4 py-2.5 glass hover:bg-white/[0.08] text-slate-300 rounded-xl text-xs font-bold border border-white/10 transition cursor-pointer">
              Back to Canvas
            </button>
          </div>
        </div>`;

      document.getElementById("restartBlitzBtn")?.addEventListener("click", startBlitzBattle);
      document.getElementById("configBlitzBtn")?.addEventListener("click", showBlitzSetup);
      document.getElementById("closeBlitzSummaryBtn")?.addEventListener("click", () => window.switchCanvasTab("live"));
    }

    showToast("🏆 Blitz Done! +" + earnedXP + " XP Earned", "success");
  }

  // =========================================================================
  // 3D SPACED-REPETITION FLASHCARD LAB CONTROLLER
  // =========================================================================
  async function loadFlashcardsDeck(forceRegenerate = false) {
    const emptyState = document.getElementById("flashcardsNoTopicEmptyState");
    const content = document.getElementById("flashcardsContentContainer");

    if (!hasActiveTopic()) {
      if (emptyState) emptyState.classList.remove("hidden");
      if (content) content.classList.add("hidden");
      return;
    }

    if (emptyState) emptyState.classList.add("hidden");
    if (content) content.classList.remove("hidden");

    const topicBadge = document.getElementById("flashcardDeckTopicBadge");
    if (topicBadge) topicBadge.textContent = activeTopic;

    if (!forceRegenerate && flashcardState.cachedDecks[activeTopic] && flashcardState.cachedDecks[activeTopic].length > 0) {
      flashcardState.deck = flashcardState.cachedDecks[activeTopic];
      flashcardState.currentIndex = 0;
      renderCurrentFlashcard();
      return;
    }

    const qFront = document.getElementById("flashcardQuestionFront");
    if (qFront) qFront.textContent = `Synthesizing 3D Leitner flashcard deck for ${activeTopic}...`;

    try {
      const res = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gemini-Key": localStorage.getItem("clearmind_gemini_key") || "" },
        body: JSON.stringify({
          topic: activeTopic,
          language: activeLanguage,
          count: 6
        })
      });

      if (!res.ok) throw new Error("Flashcards request failed");
      const d = await res.json();
      flashcardState.deck = d.cards || [];
      flashcardState.cachedDecks[activeTopic] = flashcardState.deck;
      flashcardState.currentIndex = 0;
      renderCurrentFlashcard();
      showToast("🎴 3D Flashcard Deck Calibrated!", "success");
    } catch (e) {
      console.warn("Flashcards error:", e);
      flashcardState.deck = [
        {
          id: 1,
          category: "Core Principle",
          front: `What is the defining rule of ${activeTopic}?`,
          back: `The fundamental equation dictates balance and conserved states throughout transformation.`,
          hint: "Think about invariant quantities."
        },
        {
          id: 2,
          category: "Examiner Trap",
          front: "Why do students lose easy marks on boundary limits?",
          back: "They forget to check zero denominators and negative radicands under extreme cases.",
          hint: "Check denominators first."
        },
        {
          id: 3,
          category: "Application",
          front: "How is this concept applied in real engineering systems?",
          back: "Through closed-loop feedback, state validation, and error margins.",
          hint: "Real-world physical tolerances."
        }
      ];
      flashcardState.currentIndex = 0;
      renderCurrentFlashcard();
    }
  }

  function renderCurrentFlashcard() {
    if (!flashcardState.deck || !flashcardState.deck.length) return;
    if (flashcardState.currentIndex >= flashcardState.deck.length) {
      flashcardState.currentIndex = 0;
    }

    const card = flashcardState.deck[flashcardState.currentIndex];
    const inner = document.getElementById("flashcardInner");
    if (inner) inner.classList.remove("is-flipped");

    const catEl = document.getElementById("flashcardCategoryFront");
    const qEl = document.getElementById("flashcardQuestionFront");
    const hintEl = document.getElementById("flashcardHintFront");
    const aEl = document.getElementById("flashcardAnswerBack");
    const analogyEl = document.getElementById("flashcardAnalogyBox");
    const hintToggleBtn = document.getElementById("toggleFlashcardHintBtn");

    const curNum = document.getElementById("flashcardCurrentNum");
    const totNum = document.getElementById("flashcardTotalNum");
    const mastCount = document.getElementById("flashcardMasteredCount");
    const pBar = document.getElementById("flashcardProgressBar");

    if (catEl) catEl.textContent = card.category || "Core Concept";
    if (qEl) qEl.innerHTML = formatMarkdown(card.front || "");
    if (hintEl) {
      hintEl.textContent = card.hint ? `💡 Hint: ${card.hint}` : "💡 Hint: Focus on the primary relation.";
      hintEl.classList.add("hidden");
    }
    if (hintToggleBtn) hintToggleBtn.textContent = "💡 Show Hint";

    if (aEl) aEl.innerHTML = formatMarkdown(card.back || "");
    if (analogyEl) {
      analogyEl.innerHTML = `💡 <strong>Master Key:</strong> ${escapeHtml(card.hint || "Review axioms and verify edge conditions.")}`;
    }

    if (curNum) curNum.textContent = String(flashcardState.currentIndex + 1);
    if (totNum) totNum.textContent = String(flashcardState.deck.length);
    if (mastCount) mastCount.textContent = String(flashcardState.masteredCards.size);
    if (pBar) {
      const pct = Math.round(((flashcardState.currentIndex + 1) / flashcardState.deck.length) * 100);
      pBar.style.width = `${pct}%`;
    }

    // Ebbinghaus Memory Decay Urgency Calculation
    const cardTopic = activeTopic || card.category || "Core Concept";
    const concepts = CognitiveEngine.loadConcepts();
    const matchedConcept = concepts.find((c) => c.name.toLowerCase().includes(cardTopic.toLowerCase()) || cardTopic.toLowerCase().includes(c.name.toLowerCase()));
    const retention = matchedConcept ? CognitiveEngine.currentRetention(matchedConcept) : 0.72;
    const decayEl = document.getElementById("flashcardDecayUrgency");
    const retValEl = document.getElementById("flashcardRetentionVal");

    if (decayEl) {
      if (retention < 0.4) {
        decayEl.textContent = "Urgent Review";
        decayEl.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-700 animate-pulse";
      } else if (retention < 0.7) {
        decayEl.textContent = "Review Soon";
        decayEl.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-700";
      } else {
        decayEl.textContent = "Memory Stable";
        decayEl.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700";
      }
    }
    if (retValEl) {
      retValEl.textContent = `${Math.round(retention * 100)}%`;
    }
  }

  function toggleFlashcardFlip() {
    const inner = document.getElementById("flashcardInner");
    if (inner) {
      inner.classList.toggle("is-flipped");
      playSound("click");
    }
  }

  function handleFlashcardRating(rating) {
    if (!flashcardState.deck || !flashcardState.deck.length) return;
    const card = flashcardState.deck[flashcardState.currentIndex];
    const cardKey = `${activeTopic}__${card.id || flashcardState.currentIndex}`;
    const cardTopic = activeTopic || card.category || "Core Concept";

    flashcardState.cardsReviewed += 1;
    localStorage.setItem("clearmind_cards_reviewed", String(flashcardState.cardsReviewed));

    // Cognitive Ebbinghaus reinforcement or weakening
    const qualityMap = { repeat: 0.0, hard: 0.35, good: 0.75, easy: 1.0 };
    const q = qualityMap[rating] !== undefined ? qualityMap[rating] : 0.7;
    CognitiveEngine.recordConceptRecall(cardTopic, q);

    // Advance daily mission for fading sprint
    const missions = CognitiveEngine.loadMissions();
    const m3 = missions.find((m) => m.id === "m3");
    if (m3 && !m3.done) {
      m3.progress = Math.min(1, m3.progress + 0.34);
      if (m3.progress >= 0.99) {
        CognitiveEngine.saveMissions(missions);
        CognitiveEngine.completeMission("m3");
      } else {
        CognitiveEngine.saveMissions(missions);
      }
    }

    if (rating === "easy" || rating === "good") {
      flashcardState.masteredCards.add(cardKey);
      localStorage.setItem("clearmind_mastered_cards", JSON.stringify(Array.from(flashcardState.masteredCards)));
      addXP(20);
      playSound("correct");
      showToast(`🟢 Card Mastered (${rating.toUpperCase()})! +20 XP`, "success");
    } else {
      addXP(10);
      playSound("click");
      showToast(`🟠 Review Scheduled (${rating.toUpperCase()})! +10 XP`, "info");
    }

    const mastCount = document.getElementById("flashcardMasteredCount");
    if (mastCount) mastCount.textContent = String(flashcardState.masteredCards.size);

    const inner = document.getElementById("flashcardInner");
    if (inner) inner.classList.remove("is-flipped");

    setTimeout(() => {
      flashcardState.currentIndex = (flashcardState.currentIndex + 1) % flashcardState.deck.length;
      renderCurrentFlashcard();
    }, 320);
  }

  // =========================================================================
  // STUDENT MASTERY & ANALYTICS DASHBOARD CONTROLLER
  // =========================================================================
  function updateAnalyticsDashboard() {
    const jName = document.getElementById("journeyStudentName");
    const jAvatar = document.getElementById("journeyAvatar");
    const jLevel = document.getElementById("journeyStudyLevel");
    const jRank = document.getElementById("journeyRankBadge");
    const jXP = document.getElementById("journeyXPProgress");
    const jBar = document.getElementById("journeyXPBar");

    const aTotalXP = document.getElementById("analyticsTotalXP");
    const aHighScore = document.getElementById("analyticsBlitzHighScore");
    const aBestCombo = document.getElementById("analyticsBestCombo");
    const aReviewed = document.getElementById("analyticsFlashcardsReviewed");

    const displayName = studentProfile.name || "Prakhar";
    const displayAvatar = studentProfile.avatar || "🎓";

    if (jName) jName.textContent = displayName;
    if (jAvatar) jAvatar.textContent = displayAvatar;
    if (jLevel) jLevel.textContent = studentProfile.level || "College / University";

    // Dynamic Rank & Exponential Level Calculation
    let rank = "Novice Explorer 🌱";
    let lvlInfo = null;
    if (typeof CognitiveEngine !== "undefined" && typeof CognitiveEngine.levelFromXp === "function") {
      lvlInfo = CognitiveEngine.levelFromXp(totalXP);
    }

    const currentLevel = lvlInfo ? lvlInfo.level : Math.max(1, Math.floor(totalXP / 200) + 1);
    const xpRemaining = lvlInfo ? lvlInfo.remaining : (totalXP % 200);
    const xpNextAt = lvlInfo ? lvlInfo.nextAt : 200;
    const progressRatio = lvlInfo ? lvlInfo.progress : (xpRemaining / xpNextAt);

    if (totalXP >= 5000) rank = "ClearMind Luminary 🌟";
    else if (totalXP >= 2500) rank = "Grandmaster Thinker 👑";
    else if (totalXP >= 1200) rank = "Senior Scholar 🎓";
    else if (totalXP >= 500) rank = "Scholar in Training 📚";
    else if (totalXP > 0) rank = "Junior Explorer 🌱";
    else rank = "Novice Explorer 🌱";

    if (jRank) jRank.textContent = rank;
    if (jXP) {
      if (totalXP === 0) {
        jXP.textContent = `0 / 200 XP (Level 1)`;
      } else {
        jXP.textContent = `${xpRemaining} / ${xpNextAt} XP (Level ${currentLevel})`;
      }
    }
    if (jBar) {
      const pct = totalXP === 0 ? 4 : Math.min(100, Math.max(4, Math.round(progressRatio * 100)));
      jBar.style.width = `${pct}%`;
    }

    if (aTotalXP) aTotalXP.textContent = `${totalXP} XP`;
    if (aHighScore) aHighScore.textContent = `${blitzHighScore} PTS`;
    if (aBestCombo) aBestCombo.textContent = `${blitzBestCombo}x`;
    if (aReviewed) aReviewed.textContent = String(flashcardState.cardsReviewed || flashcardState.masteredCards.size || 0);

    // Update Mind Health Circular SVG Gauges (Circumference C = 2 * pi * 24 ~= 150.8)
    const mh = CognitiveEngine.getMindHealth();

    // 1. Focus Span Dial (up to 90 min)
    const fRing = document.getElementById("mindHealthFocusRing");
    const fText = document.getElementById("mindHealthFocusText");
    const fVal = document.getElementById("mindHealthFocusVal");
    const fBar = document.getElementById("mindHealthFocusBar");
    const focusMinutes = mh.focusMinutes || 0;
    const focusPct = Math.min(100, Math.max(0, Math.round((focusMinutes / 90) * 100)));
    const focusOffset = 150.8 * (1 - focusPct / 100);
    if (fRing) fRing.style.strokeDashoffset = focusOffset.toFixed(1);
    if (fText) fText.textContent = `${focusMinutes}m`;
    if (fVal) fVal.textContent = `${focusMinutes}m / 90m`;
    if (fBar) fBar.style.width = `${focusPct}%`;

    // 2. Confidence (Recall Accuracy) Dial
    const cRing = document.getElementById("mindHealthConfidenceRing");
    const cText = document.getElementById("mindHealthConfidenceText");
    const cVal = document.getElementById("mindHealthConfidenceVal");
    const cBar = document.getElementById("mindHealthConfidenceBar");
    const confPct = Math.min(100, Math.max(0, mh.confidence || 0));
    const confOffset = 150.8 * (1 - confPct / 100);
    if (cRing) cRing.style.strokeDashoffset = confOffset.toFixed(1);
    if (cText) cText.textContent = `${confPct}%`;
    if (cVal) cVal.textContent = `${confPct}%`;
    if (cBar) cBar.style.width = `${confPct}%`;

    // 3. Curiosity Dial
    const qRing = document.getElementById("mindHealthCuriosityRing");
    const qText = document.getElementById("mindHealthCuriosityText");
    const qVal = document.getElementById("mindHealthCuriosityVal");
    const qBar = document.getElementById("mindHealthCuriosityBar");
    const curPct = Math.min(100, Math.max(0, mh.curiosity || 0));
    const curOffset = 150.8 * (1 - curPct / 100);
    if (qRing) qRing.style.strokeDashoffset = curOffset.toFixed(1);
    if (qText) qText.textContent = `${curPct}%`;
    if (qVal) qVal.textContent = `${curPct}%`;
    if (qBar) qBar.style.width = `${curPct}%`;

    renderDailyMissions();
    renderPredictedToFade();
    renderHeatmap();
    renderJourneyMilestones();
  }

  function renderDailyMissions() {
    const list = document.getElementById("dailyMissionsList");
    const progText = document.getElementById("dailyMissionsProgress");
    if (!list) return;

    const missions = CognitiveEngine.loadMissions();
    const completedCount = missions.filter((m) => m.done).length;
    if (progText) progText.textContent = `${completedCount}/${missions.length} Completed`;

    list.innerHTML = missions.map((m) => {
      const isDone = m.done;
      return `
        <div class="p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${isDone ? 'glass border-white/5 opacity-60' : 'bento-card border-white/10 hover:border-violet-500/40 shadow-sm'}">
          <div class="flex items-center gap-3 min-w-0">
            <span class="text-xl shrink-0">${m.icon || '🎯'}</span>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold ${isDone ? 'line-through text-slate-400' : 'text-white'}">${escapeHtml(m.title)}</span>
                <span class="px-2 py-0.5 rounded text-[10px] font-black bg-amber-950/80 text-amber-300 border border-amber-800/80">+${m.xp} XP</span>
              </div>
              <p class="text-[11px] text-slate-400 truncate mt-0.5">${escapeHtml(m.description)}</p>
              <div class="w-28 h-1.5 bg-black/40 rounded-full mt-1.5 overflow-hidden border border-white/5">
                <div class="h-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 rounded-full" style="width: ${Math.round((m.progress || 0) * 100)}%"></div>
              </div>
            </div>
          </div>
          <div>
            ${isDone
              ? `<span class="px-2.5 py-1 rounded-lg text-[10px] font-black bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">✓ Claimed</span>`
              : `<button onclick="window.claimMissionXP('${m.id}')" class="px-3 py-1.5 rounded-xl text-[10px] font-bold bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:opacity-95 text-white shadow-md shadow-violet-500/25 transition cursor-pointer">Claim XP</button>`
            }
          </div>
        </div>
      `;
    }).join("");
  }

  window.claimMissionXP = function(id) {
    CognitiveEngine.completeMission(id);
  };

  function renderPredictedToFade() {
    const list = document.getElementById("predictedToFadeList");
    if (!list) return;

    const concepts = CognitiveEngine.loadConcepts();
    const fading = CognitiveEngine.predictForgetting(concepts, 5);

    if (!fading.length) {
      list.innerHTML = `
        <div class="p-4 rounded-xl glass border border-white/5 text-center space-y-1.5">
          <div class="text-xl">✨</div>
          <p class="text-xs font-bold text-emerald-300">Memory Curve Stable</p>
          <p class="text-[10px] text-slate-400">All concept traces currently at optimal retention. No decay detected!</p>
        </div>
      `;
      return;
    }

    list.innerHTML = fading.map((c) => {
      const r = CognitiveEngine.currentRetention(c);
      const isUrgent = r < 0.4;
      const isSoon = r < 0.7;
      const badgeClass = isUrgent
        ? "bg-rose-950/80 text-rose-300 border-rose-800 animate-pulse"
        : isSoon
        ? "bg-amber-950/80 text-amber-300 border-amber-800"
        : "bg-emerald-950/80 text-emerald-300 border-emerald-800";

      const remainingDays = Math.max(1, Math.round((c.stability || 2) * Math.log(2) * r));
      const countdownText = isUrgent ? "Review <24h" : `Review in ${remainingDays}d`;
      const retPct = Math.round(r * 100);

      return `
        <div class="p-3.5 bento-card border border-white/10 hover:border-violet-500/30 rounded-xl flex items-center justify-between gap-3 text-xs transition group shadow-sm">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs text-white shrink-0 shadow-sm" style="background:${c.color || '#a78bfa'}">
              ${escapeHtml((c.name || 'C').slice(0, 1))}
            </div>
            <div class="min-w-0">
              <div class="font-bold text-white truncate group-hover:text-violet-300 transition">${escapeHtml(c.name)}</div>
              <div class="text-[10px] text-slate-400 truncate">${c.category || 'STEM'} • ${c.reviews || 0} reviews</div>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <div class="text-right hidden sm:block">
              <span class="font-mono text-xs font-black ${isUrgent ? 'text-rose-400' : isSoon ? 'text-amber-400' : 'text-emerald-400'}">${retPct}%</span>
              <span class="block text-[8px] uppercase font-bold text-slate-500">${countdownText}</span>
            </div>
            <button onclick="window.reviewFadingConcept('${escapeHtml(c.name)}')" class="px-2.5 py-1 glass hover:bg-violet-600 border border-white/10 hover:border-violet-500 text-violet-300 hover:text-white rounded-lg text-[10px] font-bold transition cursor-pointer">
              Review ➔
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  window.reviewFadingConcept = function(conceptName) {
    activeTopic = conceptName;
    localStorage.setItem("clearmind_active_topic", conceptName);
    const badge = document.getElementById("chatActiveTopic");
    if (badge) badge.textContent = conceptName;
    window.navigateToPage("flashcards");
  };

  function renderHeatmap() {
    const grid = document.getElementById("analyticsHeatmapGrid");
    if (!grid) return;
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const now = new Date();
    const todayDayIdx = (now.getDay() + 6) % 7;

    grid.innerHTML = days.map((d, i) => {
      let boxColor = "bg-white/[0.04] border-white/10";
      let isToday = (i === todayDayIdx);
      if (isToday) {
        boxColor = "bg-pink-600 border-pink-400 animate-pulse shadow-md shadow-pink-500/30";
      } else if (i < todayDayIdx && (todayDayIdx - i) < currentStreak) {
        boxColor = "bg-violet-700 border-violet-500";
      } else if (i < todayDayIdx) {
        boxColor = "bg-violet-950 border-violet-800/50";
      }
      return `
        <div class="p-2 glass border border-white/5 rounded-xl text-center space-y-1">
          <span class="text-[9px] ${isToday ? "text-pink-300 font-black" : "text-slate-500 font-bold"} block">${d}</span>
          <div class="w-4 h-4 rounded-md mx-auto border ${boxColor}"></div>
        </div>`;
    }).join("");
  }

  function renderJourneyMilestones() {
    const list = document.getElementById("journeyHistoryList");
    if (!list) return;

    const topics = Array.from(awardedCheatSheetTopics);
    if (!topics.includes(activeTopic) && activeTopic) {
      topics.push(activeTopic);
    }

    if (!topics.length) {
      list.innerHTML = `
        <div class="p-4 rounded-xl glass border border-white/5 text-center space-y-2">
          <div class="text-2xl">🌱</div>
          <p class="text-xs font-bold text-slate-300">Telemetry Initializing</p>
          <p class="text-[11px] text-slate-400 max-w-xs mx-auto leading-relaxed">Ask Luna your first question or start a Blitz to record concept mastery!</p>
          <div class="pt-1">
            <button onclick="window.navigateToPage('classroom')" class="px-3 py-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:opacity-95 text-white rounded-lg text-[11px] font-bold shadow-md shadow-violet-500/25 transition cursor-pointer">
              Start Learning in Classroom ➔
            </button>
          </div>
        </div>`;
      return;
    }

    list.innerHTML = topics.map((top) => `
      <div class="p-3 bento-card border border-white/10 rounded-xl flex items-center justify-between text-xs shadow-sm">
        <div class="flex items-center gap-2">
          <span class="text-violet-400 font-black">✓</span>
          <span class="font-bold text-white">${escapeHtml(top)}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-800/60 font-bold">Mastered</span>
          <button onclick="window.askLunaStep('${escapeHtml(top)}')" class="text-[10px] text-violet-400 hover:text-violet-300 font-semibold cursor-pointer">Revise ➔</button>
        </div>
      </div>
    `).join("");
  }

  // =========================================================================
  // GALAXY VIEW & KNOWLEDGE GRAPH RENDERING CONTROLLER
  // =========================================================================
  let galaxyState = {
    mode: "cosmic",
    selectedNodeId: null,
    activeCategory: "all"
  };

  function initGalaxyWorkspace() {
    const cosmicBtn = document.getElementById("galaxyModeCosmicBtn");
    const graphBtn = document.getElementById("galaxyModeGraphBtn");
    const cosmicView = document.getElementById("galaxyCosmicContainer");
    const graphView = document.getElementById("galaxyGraphContainer");

    if (cosmicBtn && graphBtn) {
      cosmicBtn.onclick = () => {
        galaxyState.mode = "cosmic";
        cosmicBtn.className = "px-3 py-1.5 rounded-lg font-bold bg-purple-600 text-white shadow-sm transition";
        graphBtn.className = "px-3 py-1.5 rounded-lg font-bold text-slate-400 hover:text-white transition";
        cosmicView?.classList.remove("hidden");
        graphView?.classList.add("hidden");
        renderKnowledgeGalaxy();
      };
      graphBtn.onclick = () => {
        galaxyState.mode = "graph";
        graphBtn.className = "px-3 py-1.5 rounded-lg font-bold bg-purple-600 text-white shadow-sm transition";
        cosmicBtn.className = "px-3 py-1.5 rounded-lg font-bold text-slate-400 hover:text-white transition";
        graphView?.classList.remove("hidden");
        cosmicView?.classList.add("hidden");
        renderKnowledgeGraph();
      };
    }

    document.querySelectorAll(".graph-cat-btn").forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll(".graph-cat-btn").forEach((b) => {
          b.className = "graph-cat-btn px-2.5 py-1 rounded-lg text-xs font-bold bg-obsidian-850 text-slate-300 hover:text-white transition";
        });
        btn.className = "graph-cat-btn px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-obsidian-950 transition";
        galaxyState.activeCategory = btn.getAttribute("data-cat") || "all";
        renderKnowledgeGraph();
      };
    });

    const reviewBtn = document.getElementById("inspectorReviewBtn");
    if (reviewBtn) {
      reviewBtn.onclick = () => {
        if (galaxyState.selectedNodeId) {
          const concepts = CognitiveEngine.loadConcepts();
          const found = concepts.find((c) => c.id === galaxyState.selectedNodeId);
          if (found) {
            activeTopic = found.name;
            localStorage.setItem("clearmind_active_topic", activeTopic);
            const chatTopic = document.getElementById("chatActiveTopic");
            if (chatTopic) chatTopic.textContent = activeTopic;
          }
        }
        window.navigateToPage("flashcards");
      };
    }
  }

  function renderKnowledgeGalaxy() {
    const concepts = CognitiveEngine.loadConcepts();
    const starfield = document.getElementById("galaxyConceptStars");
    const bgStarsContainer = document.getElementById("galaxyTwinklingStars");
    if (!starfield) return;

    // Advance quest: Concept Galaxy Exploration
    const missions = CognitiveEngine.loadMissions();
    const m5 = missions.find((m) => m.id === "m5");
    if (m5 && !m5.done && m5.progress < 1) {
      m5.progress = 1;
      CognitiveEngine.saveMissions(missions);
      CognitiveEngine.completeMission("m5");
    }

    if (bgStarsContainer && !bgStarsContainer.hasChildNodes()) {
      let starsHtml = "";
      for (let i = 0; i < 120; i++) {
        const top = Math.random() * 100;
        const left = Math.random() * 100;
        const size = (Math.random() * 1.5 + 0.5).toFixed(1);
        const delay = (Math.random() * 4).toFixed(1);
        const dur = (Math.random() * 3 + 2).toFixed(1);
        starsHtml += `<div class="absolute rounded-full bg-white/70 pointer-events-none" style="top:${top}%; left:${left}%; width:${size}px; height:${size}px; animation: twinkle ${dur}s ease-in-out infinite; animation-delay: ${delay}s;"></div>`;
      }
      bgStarsContainer.innerHTML = starsHtml;
    }

    const now = Date.now();
    let brightCount = 0;
    let fadingCount = 0;
    const categoriesSet = new Set();

    const cx = 50;
    const cy = 50;
    let conceptHtml = "";

    concepts.forEach((c, i) => {
      categoriesSet.add(c.category);
      const r = CognitiveEngine.currentRetention(c, now);
      if (r >= 0.7) brightCount++;
      if (r < 0.4) fadingCount++;

      const angle = i * 0.62 + 0.3;
      const radius = 8 + (i / concepts.length) * 38;
      const left = cx + Math.cos(angle) * radius;
      const top = cy + Math.sin(angle) * (radius * 0.85);
      const size = Math.round(6 + (c.strength || 0.5) * 16);
      const glowOpacity = (0.25 + r * 0.55).toFixed(2);

      conceptHtml += `
        <div class="absolute group cursor-pointer -translate-x-1/2 -translate-y-1/2"
             style="top:${top.toFixed(2)}%; left:${left.toFixed(2)}%; z-index:10;"
             onclick="selectGalaxyConcept('${c.id}')"
             title="${escapeHtml(c.name)} (${c.category}) — ${(r * 100).toFixed(0)}% retained">
          <div class="absolute inset-0 rounded-full blur-md pointer-events-none transition-all duration-300 group-hover:scale-150"
               style="background:${c.color}; opacity:${glowOpacity}; width:${size * 3}px; height:${size * 3}px; transform:translate(-33%, -33%);"></div>
          <div class="rounded-full relative transition-transform duration-200 group-hover:scale-125 border border-white/60 shadow-lg"
               style="width:${size}px; height:${size}px; background:${c.color}; box-shadow: 0 0 ${size * 1.5}px ${c.color};"></div>
          <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 rounded-xl bg-obsidian-950/95 border border-obsidian-750 text-[11px] text-white opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap shadow-2xl z-30">
            <div class="font-extrabold flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full" style="background:${c.color}"></span>
              ${escapeHtml(c.name)}
            </div>
            <div class="text-[10px] text-slate-400">
              ${c.category} • <strong class="${r < 0.4 ? 'text-rose-400' : r < 0.7 ? 'text-amber-400' : 'text-emerald-400'}">${(r * 100).toFixed(0)}% retained</strong>
            </div>
          </div>
        </div>
      `;
    });

    starfield.innerHTML = conceptHtml;

    const sStars = document.getElementById("galaxyStatStars");
    const sBright = document.getElementById("galaxyStatBright");
    const sFading = document.getElementById("galaxyStatFading");
    const sCat = document.getElementById("galaxyStatCategories");
    if (sStars) sStars.textContent = String(concepts.length);
    if (sBright) sBright.textContent = String(brightCount);
    if (sFading) sFading.textContent = String(fadingCount);
    if (sCat) sCat.textContent = String(categoriesSet.size);
  }

  window.selectGalaxyConcept = function(id) {
    const concepts = CognitiveEngine.loadConcepts();
    const c = concepts.find((x) => x.id === id);
    if (!c) return;
    galaxyState.selectedNodeId = id;
    galaxyState.mode = "graph";
    document.getElementById("galaxyModeGraphBtn")?.click();
    updateGraphInspector(c, concepts);
  };

  function renderKnowledgeGraph() {
    const concepts = CognitiveEngine.loadConcepts();
    const svg = document.getElementById("knowledgeGraphSvg");
    if (!svg) return;

    const cat = galaxyState.activeCategory;
    const filtered = cat === "all" ? concepts : concepts.filter((c) => c.category === cat);
    const filteredIds = new Set(filtered.map((c) => c.id));

    const categoryCenters = {
      CS: { cx: 280, cy: 260 },
      ML: { cx: 750, cy: 260 },
      Math: { cx: 280, cy: 680 },
      Science: { cx: 750, cy: 680 }
    };

    const byCategory = {};
    const layoutNodes = filtered.map((c) => {
      const center = categoryCenters[c.category] || { cx: 500, cy: 450 };
      const idx = (byCategory[c.category] = (byCategory[c.category] || 0) + 1);
      const angle = (idx * 2.39996) + Math.PI;
      const radius = 70 + idx * 28;
      const x = Math.round(center.cx + Math.cos(angle) * radius);
      const y = Math.round(center.cy + Math.sin(angle) * radius);
      const r = CognitiveEngine.currentRetention(c);
      return {
        ...c,
        x,
        y,
        retention: r,
        radius: Math.round(18 + (c.strength || 0.5) * 22)
      };
    });

    const nodeMap = Object.fromEntries(layoutNodes.map((n) => [n.id, n]));

    let edgesSvg = "";
    filtered.forEach((c) => {
      const from = nodeMap[c.id];
      if (!from) return;
      (c.connections || []).forEach((targetId) => {
        if (!filteredIds.has(targetId)) return;
        const to = nodeMap[targetId];
        if (!to) return;
        const isHighlighted = galaxyState.selectedNodeId && (galaxyState.selectedNodeId === c.id || galaxyState.selectedNodeId === targetId);
        const strokeColor = isHighlighted ? "rgba(168, 85, 247, 0.85)" : "rgba(255, 255, 255, 0.12)";
        const strokeWidth = isHighlighted ? 2.5 : 1;
        edgesSvg += `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />`;
      });
    });

    let nodesSvg = "";
    layoutNodes.forEach((n) => {
      const isSelected = galaxyState.selectedNodeId === n.id;
      const isConnected = galaxyState.selectedNodeId
        ? concepts.find((x) => x.id === galaxyState.selectedNodeId)?.connections?.includes(n.id)
        : false;
      const opacity = galaxyState.selectedNodeId && !isSelected && !isConnected ? 0.28 : 1;

      nodesSvg += `
        <g style="opacity:${opacity}; cursor:pointer;" onclick="selectGraphNode('${n.id}')">
          <circle cx="${n.x}" cy="${n.y}" r="${n.radius + 10}" fill="${n.color}" opacity="${(0.15 + n.retention * 0.4).toFixed(2)}" filter="blur(6px)" />
          <circle cx="${n.x}" cy="${n.y}" r="${n.radius}" fill="${n.color}" stroke="${isSelected ? '#ffffff' : 'rgba(255,255,255,0.3)'}" stroke-width="${isSelected ? 3.5 : 1.5}" />
          <text x="${n.x}" y="${n.y + n.radius + 16}" text-anchor="middle" fill="rgba(255,255,255,0.85)" font-size="11" font-weight="700" font-family="'Plus Jakarta Sans', sans-serif">
            ${escapeHtml(n.name)}
          </text>
        </g>
      `;
    });

    svg.innerHTML = edgesSvg + nodesSvg;

    if (galaxyState.selectedNodeId && nodeMap[galaxyState.selectedNodeId]) {
      updateGraphInspector(nodeMap[galaxyState.selectedNodeId], concepts);
    } else if (filtered.length > 0 && !galaxyState.selectedNodeId) {
      updateGraphInspector(filtered[0], concepts);
    }
  }

  window.selectGraphNode = function(id) {
    const concepts = CognitiveEngine.loadConcepts();
    const node = concepts.find((c) => c.id === id);
    if (!node) return;
    galaxyState.selectedNodeId = id;
    renderKnowledgeGraph();
    updateGraphInspector(node, concepts);
    playSound("click");
  };

  function updateGraphInspector(node, allConcepts) {
    const nameEl = document.getElementById("inspectorNodeName");
    const catEl = document.getElementById("inspectorNodeCategory");
    const strVal = document.getElementById("inspectorStrengthVal");
    const strBar = document.getElementById("inspectorStrengthBar");
    const retVal = document.getElementById("inspectorRetentionVal");
    const retBar = document.getElementById("inspectorRetentionBar");
    const revVal = document.getElementById("inspectorReviewsVal");
    const conVal = document.getElementById("inspectorConnectionsVal");
    const pillsEl = document.getElementById("inspectorLinkedPills");

    if (!node) return;
    const r = CognitiveEngine.currentRetention(node);

    if (nameEl) nameEl.textContent = node.name;
    if (catEl) catEl.textContent = `Domain: ${node.category} • Ebbinghaus memory decay modeling active.`;
    if (strVal) strVal.textContent = `${Math.round((node.strength || 0.5) * 100)}%`;
    if (strBar) strBar.style.width = `${Math.round((node.strength || 0.5) * 100)}%`;
    if (retVal) retVal.textContent = `${Math.round(r * 100)}% (${r < 0.4 ? 'Urgent' : r < 0.7 ? 'Review Soon' : 'Stable'})`;
    if (retBar) retBar.style.width = `${Math.round(r * 100)}%`;
    if (revVal) revVal.textContent = String(node.reviews || 0);
    if (conVal) conVal.textContent = String((node.connections || []).length);

    if (pillsEl) {
      const connections = node.connections || [];
      if (!connections.length) {
        pillsEl.innerHTML = '<span class="text-xs text-slate-500 italic">No connected nodes</span>';
      } else {
        pillsEl.innerHTML = connections.map((cId) => {
          const target = allConcepts.find((x) => x.id === cId);
          const tName = target ? target.name : cId;
          const tColor = target ? target.color : "#a855f7";
          return `
            <button onclick="selectGraphNode('${cId}')" class="px-2.5 py-1 bg-obsidian-900 hover:bg-obsidian-800 border border-obsidian-750 text-xs font-bold text-slate-300 rounded-lg flex items-center gap-1.5 transition">
              <span class="w-1.5 h-1.5 rounded-full" style="background:${tColor}"></span>
              ${escapeHtml(tName)}
            </button>
          `;
        }).join("");
      }
    }
  }

  // =========================================================================
  // TEACHING MODE & LOCALIZED GREETINGS CONTROLLERS
  // =========================================================================
  function updateTeachingModeUI() {
    const btn = document.getElementById("teachingModeBtn");
    const icon = document.getElementById("teachingModeIcon");
    const label = document.getElementById("teachingModeLabel");
    if (!btn) return;
    if (teachingMode === "socratic") {
      if (icon) icon.textContent = "❓";
      if (label) label.textContent = "Socratic";
      btn.className = "px-2.5 py-1 text-[11px] font-bold text-pink-300 bg-pink-950/80 hover:bg-pink-900/80 border border-pink-700/70 rounded-xl transition cursor-pointer shadow-sm";
      btn.title = "Socratic Mode: Luna guides you with questions rather than direct answers";
    } else {
      if (icon) icon.textContent = "▶";
      if (label) label.textContent = "Direct";
      btn.className = "px-2.5 py-1 text-[11px] font-bold text-purple-300 bg-purple-950/80 hover:bg-purple-900/80 border border-purple-800/60 rounded-xl transition cursor-pointer shadow-sm";
      btn.title = "Direct Mode: Luna provides clear, direct explanations with analogies";
    }
  }

  function getLocalizedGreeting(name) {
    if (activeLanguage === "hinglish") {
      return {
        reply_text: `Hey **${name}**! 🌸 Main hoon **Luna**, aapki AI personal tutor.\n\n**Aaj aap kya seekhna chahte ho?**\n\nKoi bhi topic, formula ya problem pucho (ya 📷 button se textbook photo upload karo) — main step-by-step real-world analogies ke saath explain karungi!`,
        speech_text: `Hey ${name}! Main hoon Luna, aapki personal tutor. Aaj aap kya seekhna chahte ho?`,
        chips: [
          `⚛️ Physics: Newton's Laws of Motion`,
          `📐 Math: Calculus & Derivatives`,
          `🌿 Biology: Photosynthesis in Plants`,
          `💻 Programming: Python Functions`,
          `⚡ Quick Blitz Arena Test`
        ]
      };
    } else if (activeLanguage === "hi") {
      return {
        reply_text: `नमस्ते **${name}**! 🌸 मैं हूँ **लूना**, आपकी व्यक्तिगत AI शिक्षक।\n\n**आज आप क्या सीखना चाहते हैं?**\n\nकोई भी विषय, सूत्र या समस्या पूछें (या 📷 बटन से फोटो अपलोड करें) — मैं दैनिक जीवन के उदाहरणों के साथ समझाऊँगी!`,
        speech_text: `नमस्ते ${name}! मैं हूँ लूना। आज आप क्या सीखना चाहते हैं?`,
        chips: [
          `⚛️ भौतिक विज्ञान: न्यूटन के नियम`,
          `📐 गणित: अवकलन और कैलकुलस`,
          `🌿 जीव विज्ञान: प्रकाश संश्लेषण`,
          `💻 प्रोग्रामिंग: पायथन फंक्शन्स`,
          `⚡ ब्लिट्ज़ क्विज़ टेस्ट`
        ]
      };
    } else {
      return {
        reply_text: `Hello **${name}**! 🌸 I am **Luna**, your personal AI tutor.\n\n**What would you like to learn today?**\n\nYou can ask about any subject, formula, or concept (or upload textbook photos with the 📷 button), or tap one of the popular topics below to begin!`,
        speech_text: `Hello ${name}! I am Luna, your personal AI tutor. What would you like to learn today?`,
        chips: [
          `⚛️ Physics: Newton's Laws of Motion`,
          `📐 Math: Differentiation & Calculus`,
          `🌿 Biology: Photosynthesis & Plants`,
          `💻 Computer Science & Programming`,
          `⚡ Test me with Blitz Battle`
        ]
      };
    }
  }

  // =========================================================================
  // LIVE VOICE CALL ORBIT
  // =========================================================================
  function startVoiceCall() {
    isVoiceCallActive = true;
    const statusText = document.getElementById("voiceCallStatusText");
    if (statusText) statusText.textContent = "Live Call Active • Speak with Luna";
    const callBtn = document.getElementById("endVoiceCallBtn");
    if (callBtn) {
      callBtn.innerHTML = "<span>End Call 📵</span>";
      callBtn.className = "px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold shadow-lg shadow-rose-600/30 transition transform hover:scale-105 active:scale-95";
    }
    playSound("combo");

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRec) {
      try {
        if (voiceRecognition) {
          voiceRecognition.stop();
        }
        voiceRecognition = new SpeechRec();
        voiceRecognition.continuous = true;
        voiceRecognition.interimResults = true;
        voiceRecognition.lang = activeLanguage === "hinglish" ? "en-IN" : activeLanguage === "hi" ? "hi-IN" : "en-US";
        voiceRecognition.onresult = (e) => {
          const tr = Array.from(e.results)
            .map((r) => r[0].transcript)
            .join("");
          const el = document.getElementById("voiceLiveTranscript");
          if (el) el.textContent = `"${tr}"`;
          if (e.results[e.results.length - 1].isFinal) {
            sendChatMessage(tr);
          }
        };
        voiceRecognition.onerror = (e) => {
          console.warn("Voice rec error:", e);
          if (e.error === "not-allowed") {
            showToast("Microphone permission denied. Please allow mic in browser settings.", "error");
          }
        };
        voiceRecognition.start();
        showToast("🎙️ Voice Call Active. Speak now!", "info");
      } catch (err) {
        console.warn("SpeechRec start error:", err);
      }
    } else {
      showToast("Voice recognition not supported in this browser. Use Chrome/Edge.", "error");
    }
  }

  function endVoiceCall() {
    isVoiceCallActive = false;
    if (voiceRecognition) {
      try { voiceRecognition.stop(); } catch (e) {}
      voiceRecognition = null;
    }
    const statusText = document.getElementById("voiceCallStatusText");
    if (statusText) statusText.textContent = "Tap Orb to Start Call";
    const callBtn = document.getElementById("endVoiceCallBtn");
    if (callBtn) {
      callBtn.innerHTML = "<span>Start Call 📞</span>";
      callBtn.className = "px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-lg shadow-emerald-600/30 transition transform hover:scale-105 active:scale-95";
    }
    if (activeAudio) activeAudio.pause();
    playSound("click");
    showToast("Voice call ended.", "info");
  }

  // =========================================================================
  // RESIZABLE SPLIT-PANE CONTROLLER (DRAG TO RESIZE CHAT PANEL)
  // =========================================================================
  function initSplitPaneResizer() {
    const left = document.getElementById("leftChatSection");
    const splitter = document.getElementById("workspaceSplitter");
    if (!left || !splitter) return;

    const savedWidth = localStorage.getItem("clearmind_chat_width");
    if (savedWidth && window.innerWidth >= 1024) {
      left.style.width = parseFloat(savedWidth) + "%";
    }

    let isDragging = false;

    splitter.addEventListener("mousedown", (e) => {
      isDragging = true;
      e.preventDefault();
      document.body.classList.add("cursor-col-resize", "select-none");
      left.style.transition = "none";
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging || window.innerWidth < 1024) return;
      const parent = left.parentElement;
      const rect = parent.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      let pct = Math.max(25, Math.min(75, (offsetX / rect.width) * 100));
      left.style.width = pct + "%";
      localStorage.setItem("clearmind_chat_width", pct.toFixed(1));
    });

    window.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        document.body.classList.remove("cursor-col-resize", "select-none");
        left.style.transition = "";
      }
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth < 1024) {
        left.style.width = "";
      }
    });
  }

  // =========================================================================
  // EVENT LISTENERS & INITIALIZATION
  // =========================================================================
  function initEventListeners() {
    initSplitPaneResizer();

    // Top Multi-Page Workspace Nav Links
    document.querySelectorAll("[data-page-link]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const page = btn.getAttribute("data-page-link");
        window.navigateToPage(page);
      });
    });

    // Top Canvas Tabs
    document.querySelectorAll(".canvas-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-canvas-tab");
        window.switchCanvasTab(tab);
      });
    });

    // Left Vertical Mini-Sidebar Dock Buttons
    document.querySelectorAll(".dock-nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-dock-tab");
        window.switchCanvasTab(tab);
      });
    });

    // Central Knowledge Orb
    document.getElementById("centralKnowledgeOrb")?.addEventListener("click", () => {
      window.switchCanvasTab("voice");
    });

    // Regenerate Cheat Sheet Button
    document.getElementById("regenerateExamSheetBtn")?.addEventListener("click", () => {
      loadExamCheatSheet(true);
    });

    // Toggle Fullscreen Focus Canvas Button
    document.getElementById("toggleFullscreenCanvasBtn")?.addEventListener("click", () => {
      window.toggleFullscreenCanvas();
    });

    // Quick Topic Chips (Exam Sheet & Quick Switcher)
    document.querySelectorAll(".quick-topic-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const top = btn.getAttribute("data-quick");
        if (top) {
          selectAndSetTopic(top, "exam");
        }
      });
    });

    // Chat Form Submit
    const chatForm = document.getElementById("chatInputForm");
    const chatInput = document.getElementById("chatMessageInput");
    if (chatForm) {
      chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        if (chatInput && chatInput.value.trim()) {
          sendChatMessage(chatInput.value);
        }
      });
    }

    // ENTER TO SEND MESSAGE, SHIFT + ENTER FOR NEWLINE!
    if (chatInput) {
      chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (chatInput.value.trim()) {
            sendChatMessage(chatInput.value);
          }
        }
      });
    }

    // Photo OCR Upload (with vision base64 pass-through)
    const photoInput = document.getElementById("chatPhotoInput");
    if (photoInput) {
      photoInput.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          sendChatMessage("Teach me the formulas and concepts from this textbook photo!", ev.target.result);
          photoInput.value = "";
        };
        reader.readAsDataURL(file);
      });
    }

    // Voice & Mic Button
    document.getElementById("chatMicBtn")?.addEventListener("click", () => {
      window.switchCanvasTab("voice");
    });
    document.getElementById("endVoiceCallBtn")?.addEventListener("click", () => {
      if (isVoiceCallActive) {
        endVoiceCall();
      } else {
        startVoiceCall();
      }
    });

    // Global Search Input
    const gSearch = document.getElementById("globalTopicSearchInput");
    if (gSearch) {
      gSearch.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && gSearch.value.trim()) {
          activeTopic = gSearch.value.trim();
          localStorage.setItem("clearmind_active_topic", activeTopic);
          updateActiveTopicUI();
          updateDynamicRoadmap();
          showToast("Switched topic to " + activeTopic, "info");
          sendChatMessage(`Hi Luna! Teach me ${activeTopic}.`);
          gSearch.value = "";
        }
      });
    }

    // Quick Topic Chips in Header
    document.querySelectorAll(".quick-topic-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.getAttribute("data-topic");
        if (t) {
          activeTopic = t;
          localStorage.setItem("clearmind_active_topic", activeTopic);
          updateActiveTopicUI();
          updateDynamicRoadmap();
          showToast("Switched topic to " + activeTopic, "info");
          sendChatMessage(`Hi Luna! Teach me ${activeTopic}.`);
        }
      });
    });

    // Language Dropdown (Desktop & Mobile)
    const langSelect = document.getElementById("languageSelect");
    const langSelectMobile = document.getElementById("languageSelectMobile");
    
    function applyLanguage(langVal, sourceEl) {
      activeLanguage = langVal;
      localStorage.setItem("clearmind_lang", activeLanguage);
      if (langSelect && langSelect !== sourceEl) langSelect.value = activeLanguage;
      if (langSelectMobile && langSelectMobile !== sourceEl) langSelectMobile.value = activeLanguage;
      if (voiceRecognition && isVoiceCallActive) {
        voiceRecognition.lang = activeLanguage === "hinglish" ? "en-IN" : activeLanguage === "hi" ? "hi-IN" : "en-US";
      }
      const label = (sourceEl && sourceEl.options && sourceEl.selectedIndex >= 0)
        ? sourceEl.options[sourceEl.selectedIndex].text
        : activeLanguage;
      showToast("Language changed to " + label, "info");
    }

    if (langSelect) {
      langSelect.value = activeLanguage;
      langSelect.addEventListener("change", () => applyLanguage(langSelect.value, langSelect));
    }
    if (langSelectMobile) {
      langSelectMobile.value = activeLanguage;
      langSelectMobile.addEventListener("change", () => applyLanguage(langSelectMobile.value, langSelectMobile));
    }

    // Sound FX Toggle (with icon sync & audio stop)
    const soundBtn = document.getElementById("soundToggleBtn");
    if (soundBtn) {
      soundBtn.textContent = soundEnabled ? "🔊" : "🔇";
      soundBtn.addEventListener("click", () => {
        soundEnabled = !soundEnabled;
        localStorage.setItem("clearmind_sound", String(soundEnabled));
        soundBtn.textContent = soundEnabled ? "🔊" : "🔇";
        if (!soundEnabled) {
          stopCurrentAudio();
        }
        showToast("Sound FX " + (soundEnabled ? "Enabled" : "Muted"), "info");
      });
    }

    // Profile / Settings Modal Controller
    const pModal = document.getElementById("profileModal");
    const openProfile = (isFirstTime = false) => {
      const nInp = document.getElementById("inputStudentName");
      const lInp = document.getElementById("inputStudyLevel");
      const tInp = document.getElementById("inputStudentTopic");
      const closeBtn = document.getElementById("closeProfileModal");
      const titleEl = document.getElementById("profileModalTitle");
      const subtitleEl = document.getElementById("profileModalSubtitle");

      if (nInp) nInp.value = studentProfile.name || "Prakhar";
      if (lInp) lInp.value = studentProfile.level || "College / University (Undergraduate - B.Tech, B.Sc, MBBS, etc.)";
      if (tInp) tInp.value = activeTopic || "";

      if (isFirstTime) {
        if (titleEl) titleEl.innerHTML = `<span>✨ Welcome to ClearMind Pro</span>`;
        if (subtitleEl) subtitleEl.textContent = "Please enter your name and topic to enter the classroom";
        if (closeBtn) closeBtn.classList.add("hidden");
      } else {
        if (titleEl) titleEl.innerHTML = `<span>⚙️ Student Profile & Settings</span>`;
        if (subtitleEl) subtitleEl.textContent = "Update your name, target topic, or grade level anytime";
        if (closeBtn) closeBtn.classList.remove("hidden");
      }

      pModal?.classList.remove("hidden");
    };

    // All buttons that open Profile Modal
    document.getElementById("headerProfileBtn")?.addEventListener("click", openProfile);
    document.getElementById("headerProfileBtnMobile")?.addEventListener("click", openProfile);
    document.getElementById("dockSettingsBtn")?.addEventListener("click", openProfile);
    document.getElementById("editProfileJourneyBtn")?.addEventListener("click", openProfile);
    document.getElementById("brandLogoBtn")?.addEventListener("click", openProfile);

    // Close Profile Modal ✕ Button
    document.getElementById("closeProfileModal")?.addEventListener("click", () => {
      pModal?.classList.add("hidden");
    });

    // Save Profile Submit Button
    document.getElementById("saveProfileBtn")?.addEventListener("click", () => {
      const nInp = document.getElementById("inputStudentName");
      const lInp = document.getElementById("inputStudyLevel");
      const tInp = document.getElementById("inputStudentTopic");
      const enteredName = nInp?.value.trim() || "";
      const chosenTopic = tInp?.value.trim() || "";

      const finalName = (enteredName && enteredName.toLowerCase() !== "student") ? enteredName : (studentProfile.name || "Prakhar");

      studentProfile.name = finalName;
      studentProfile.level = lInp?.value || "College / University";
      
      if (chosenTopic) {
        activeTopic = chosenTopic;
        localStorage.setItem("clearmind_active_topic", activeTopic);
      } else {
        activeTopic = "";
        localStorage.removeItem("clearmind_active_topic");
      }

      localStorage.setItem("clearmind_profile", JSON.stringify(studentProfile));
      localStorage.setItem("clearmind_setup_completed", "true");

      updateHUD();
      updateActiveTopicUI();
      updateDynamicRoadmap();
      pModal?.classList.add("hidden");
      playSound("fanfare");
      if (activeTopic) {
        showToast("Welcome " + finalName + "! Classroom ready for " + activeTopic, "success");
      } else {
        showToast("Welcome " + finalName + "! Ask Luna anything to start.", "success");
      }

      // Reset chat and give clean welcoming greeting
      const box = document.getElementById("chatMessagesContainer");
      if (box) box.innerHTML = "";
      conversationHistory = [];
      saveHistory();

      const welcomeData = getLocalizedGreeting(finalName);
      appendLunaMessage({
        reply_text: welcomeData.reply_text,
        speech_text: welcomeData.speech_text,
        analogy_card: null
      });

      renderSuggestedChips(welcomeData.chips);
    });

    // Avatar Picker Buttons
    document.querySelectorAll(".avatar-btn").forEach((b) => {
      b.addEventListener("click", () => {
        studentProfile.avatar = b.getAttribute("data-avatar") || "🎓";
        document.querySelectorAll(".avatar-btn").forEach((x) => x.classList.remove("ring-2", "ring-purple-500"));
        b.classList.add("ring-2", "ring-purple-500");
      });
    });

    // Print Exam Sheet
    document.getElementById("printExamSheetBtn")?.addEventListener("click", () => window.print());

    // Reset Session / Clear Data Button in Dock
    document.getElementById("dockResetBtn")?.addEventListener("click", () => {
      if (confirm("Reset study session and configure new profile?")) {
        localStorage.clear();
        studentProfile = { name: "", avatar: "🎓", level: "College / University" };
        totalXP = 0;
        currentStreak = 1;
        conversationHistory = [];
        cachedCheatSheets = {};
        awardedCheatSheetTopics = new Set();
        activeTopic = "Introduction to Python";
        updateHUD();
        updateActiveTopicUI();
        updateDynamicRoadmap();
        updateAnalyticsDashboard();
        const box = document.getElementById("chatMessagesContainer");
        if (box) box.innerHTML = "";
        openProfile();
        showToast("Session reset. Please enter your details!", "info");
      }
    });

    // Reset Chat Button (Top Left of Chat Stream)
    document.getElementById("resetChatBtn")?.addEventListener("click", () => {
      conversationHistory = [];
      saveHistory();
      const box = document.getElementById("chatMessagesContainer");
      if (box) box.innerHTML = "";
      const currentName = studentProfile.name || "there";
      const gr = getLocalizedGreeting(currentName);
      appendLunaMessage({
        reply_text: gr.reply_text,
        speech_text: gr.speech_text,
        analogy_card: {
          title: "🌸 Clean Slate Ready",
          description: "Choose any subject or ask any question to get started!"
        }
      });
      renderSuggestedChips(gr.chips);
      showToast("Chat reset. Ready for new questions!", "info");
    });

    // Prompt Chips in Chat Stream
    document.getElementById("chipAnalogy")?.addEventListener("click", () => {
      const topicPrompt = hasActiveTopic() ? activeTopic : "the core fundamentals";
      sendChatMessage(`Teach me ${topicPrompt} with an everyday real-world analogy.`);
    });
    document.getElementById("chipTraps")?.addEventListener("click", () => {
      const topicPrompt = hasActiveTopic() ? activeTopic : "this subject";
      sendChatMessage(`What is the #1 examiner trap that students lose marks on in ${topicPrompt}?`);
    });
    document.getElementById("chipBlitz")?.addEventListener("click", () => {
      window.switchCanvasTab("blitz");
    });

    // Socratic / Direct Teaching Mode Toggle
    document.getElementById("teachingModeBtn")?.addEventListener("click", () => {
      teachingMode = teachingMode === "direct" ? "socratic" : "direct";
      localStorage.setItem("clearmind_teaching_mode", teachingMode);
      updateTeachingModeUI();
      playSound("click");
      showToast(
        teachingMode === "socratic"
          ? "❓ Socratic Mode Active: Luna guides you with questions!"
          : "▶ Direct Mode Active: Luna provides clear lectures & analogies.",
        "info"
      );
    });

    // Quick Flashcard Button in Chat Header
    document.getElementById("quickFlashcardBtn")?.addEventListener("click", () => {
      window.switchCanvasTab("flashcards");
    });

    // Blitz Match Config Pills
    document.querySelectorAll("#blitzTimePills .blitz-config-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = parseInt(btn.getAttribute("data-time"), 10);
        if (t) {
          blitzConfig.timeLimit = t;
          localStorage.setItem("clearmind_blitz_time", String(t));
          document.querySelectorAll("#blitzTimePills .blitz-config-pill").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          playSound("click");
        }
      });
    });

    document.querySelectorAll("#blitzCountPills .blitz-config-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = parseInt(btn.getAttribute("data-count"), 10);
        if (c) {
          blitzConfig.questionCount = c;
          localStorage.setItem("clearmind_blitz_count", String(c));
          document.querySelectorAll("#blitzCountPills .blitz-config-pill").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          playSound("click");
        }
      });
    });

    document.getElementById("launchBlitzBattleBtn")?.addEventListener("click", () => {
      startBlitzBattle();
    });

    document.getElementById("blitzAbortBtn")?.addEventListener("click", () => {
      clearInterval(blitzState.timerInterval);
      blitzState.isRunning = false;
      showBlitzSetup();
      showToast("Blitz Arena challenge cancelled.", "info");
    });

    // 3D Flashcard Controls
    document.getElementById("prevFlashcardBtn")?.addEventListener("click", () => {
      if (!flashcardState.deck || !flashcardState.deck.length) return;
      flashcardState.currentIndex =
        (flashcardState.currentIndex - 1 + flashcardState.deck.length) % flashcardState.deck.length;
      renderCurrentFlashcard();
      playSound("click");
    });

    document.getElementById("nextFlashcardBtn")?.addEventListener("click", () => {
      if (!flashcardState.deck || !flashcardState.deck.length) return;
      flashcardState.currentIndex =
        (flashcardState.currentIndex + 1) % flashcardState.deck.length;
      renderCurrentFlashcard();
      playSound("click");
    });

    document.getElementById("flipFlashcardActionBtn")?.addEventListener("click", toggleFlashcardFlip);
    document.getElementById("flashcardFlipTrigger")?.addEventListener("click", (e) => {
      if (e.target.closest("#toggleFlashcardHintBtn")) return;
      toggleFlashcardFlip();
    });

    document.getElementById("toggleFlashcardHintBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const hintEl = document.getElementById("flashcardHintFront");
      const btn = document.getElementById("toggleFlashcardHintBtn");
      if (hintEl) {
        hintEl.classList.toggle("hidden");
        if (btn) btn.textContent = hintEl.classList.contains("hidden") ? "💡 Show Hint" : "🙈 Hide Hint";
      }
    });

    document.getElementById("generateFlashcardsBtn")?.addEventListener("click", () => {
      loadFlashcardsDeck(true);
    });

    // Leitner rating buttons
    document.querySelectorAll("#leitnerRatingButtons button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rate = btn.getAttribute("data-rate");
        if (rate) handleFlashcardRating(rate);
      });
    });

    // Keyboard navigation for Flashcards
    window.addEventListener("keydown", (e) => {
      const flashView = document.getElementById("viewCanvasFlashcards");
      const isFlashcardView = flashView && !flashView.classList.contains("hidden");
      const isInputFocused = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);

      if (isFlashcardView && !isInputFocused) {
        if (e.code === "Space") {
          e.preventDefault();
          toggleFlashcardFlip();
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          document.getElementById("nextFlashcardBtn")?.click();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          document.getElementById("prevFlashcardBtn")?.click();
        } else if (e.key === "1") {
          handleFlashcardRating("repeat");
        } else if (e.key === "2") {
          handleFlashcardRating("hard");
        } else if (e.key === "3") {
          handleFlashcardRating("good");
        } else if (e.key === "4") {
          handleFlashcardRating("easy");
        }
      }
    });
  }

  // =========================================================================
  // INTERACTIVE CURSOR SPOTLIGHT EFFECT (BENTO CARDS)
  // =========================================================================
  function initSpotlightCards() {
    let pending = false;
    let lastEvt = null;

    document.addEventListener(
      "mousemove",
      (e) => {
        lastEvt = e;
        if (!pending) {
          pending = true;
          requestAnimationFrame(() => {
            pending = false;
            if (!lastEvt) return;
            const targetCard = lastEvt.target.closest(".bento-card, .spotlight-card");
            if (targetCard) {
              const rect = targetCard.getBoundingClientRect();
              const x = Math.round(lastEvt.clientX - rect.left);
              const y = Math.round(lastEvt.clientY - rect.top);
              targetCard.style.setProperty("--mouse-x", `${x}px`);
              targetCard.style.setProperty("--mouse-y", `${y}px`);
            }
          });
        }
      },
      { passive: true }
    );
  }

  // =========================================================================
  // GLOBAL COMMAND PALETTE (CMD+K / CTRL+K)
  // =========================================================================
  function initCommandPalette() {
    const modal = document.getElementById("cmdPaletteModal");
    const input = document.getElementById("cmdPaletteInput");
    const results = document.getElementById("cmdPaletteResults");
    const openBtn = document.getElementById("openCmdPaletteBtn");
    const backdrop = document.getElementById("cmdPaletteBackdrop");

    if (!modal || !input || !results) return;

    let selectedIndex = 0;
    let filteredCommands = [];

    const COMMANDS = [
      // Navigation
      { id: "nav-classroom", cat: "Navigation", title: "AI Classroom & Split-Screen", desc: "Interactive AI tutor with live canvas", icon: "🏫", action: () => window.navigateToPage("classroom") },
      { id: "nav-cheatsheet", cat: "Navigation", title: "Real Exam Cheat Sheet & PDF", desc: "Print-ready revision sheets, key equations, and pitfalls", icon: "📑", action: () => window.navigateToPage("cheatsheet") },
      { id: "nav-blitz", cat: "Navigation", title: "60-Second Blitz Battle Arena", desc: "Speed combat challenge with combo multipliers", icon: "⚔️", action: () => window.navigateToPage("blitz") },
      { id: "nav-flashcards", cat: "Navigation", title: "3D Spaced-Repetition Flashcards", desc: "Ebbinghaus memory decay deck with 3D card flips", icon: "🎴", action: () => window.navigateToPage("flashcards") },
      { id: "nav-galaxy", cat: "Navigation", title: "3D Knowledge Galaxy", desc: "Interactive concept graph and topic clusters", icon: "🌌", action: () => window.navigateToPage("galaxy") },
      { id: "nav-analytics", cat: "Navigation", title: "Student Analytics & Mind Health", desc: "Bento dashboard, mind meters, and study heatmap", icon: "📊", action: () => window.navigateToPage("analytics") },

      // AI Tutor Actions
      { id: "act-socratic", cat: "AI Actions", title: "Ask: Explain with Intuitive Analogies", desc: "Break down topic with everyday real-world examples", icon: "💡", action: () => { window.navigateToPage("classroom"); sendChatMessage("Can you explain the foundational intuition of this topic using simple real-world analogies?"); } },
      { id: "act-derive", cat: "AI Actions", title: "Ask: Step-by-Step Mathematical Derivation", desc: "Derive key governing formulas with KaTeX math notation", icon: "📐", action: () => { window.navigateToPage("classroom"); sendChatMessage("Can you derive the core governing formulas step-by-step with LaTeX math notation?"); } },
      { id: "act-traps", cat: "AI Actions", title: "Ask: Top 3 Examiner Traps & Gotchas", desc: "Discover common mistakes where students lose marks", icon: "⚠️", action: () => { window.navigateToPage("classroom"); sendChatMessage("What are the top 3 examiner traps and common mistakes students make on this topic?"); } },
      { id: "act-cheat", cat: "AI Actions", title: "Generate 1-Page Exam Cheat Sheet", desc: "Synthesize high-yield summary for quick revision", icon: "⚡", action: () => { window.navigateToPage("cheatsheet"); loadExamCheatSheet(true); } },
      { id: "act-flash", cat: "AI Actions", title: "Generate Flashcards for Topic", desc: "AI-generated spaced repetition cards for active recall", icon: "🧠", action: () => { window.navigateToPage("flashcards"); loadFlashcardsDeck(true); } },

      // Tools & Settings
      { id: "set-voice", cat: "Tools & Settings", title: "Start Live Voice Discussion", desc: "Switch to interactive live voice orbit call", icon: "🎙️", action: () => { window.navigateToPage("classroom"); window.switchCanvasTab("voice"); } },
      { id: "set-sound", cat: "Tools & Settings", title: "Toggle UI Sound FX", desc: "Turn tactile audio feedback on or off", icon: "🔊", action: () => { document.getElementById("soundToggleBtn")?.click(); } },
      { id: "set-mode", cat: "Tools & Settings", title: "Switch Teaching Mode", desc: "Toggle between Socratic and Direct modes", icon: "🎯", action: () => { document.getElementById("teachingModeBtn")?.click(); } },
      { id: "set-profile", cat: "Tools & Settings", title: "Edit Student Profile & Target Exam", desc: "Customize grade level, major, and difficulty", icon: "👤", action: () => { document.getElementById("headerProfileBtn")?.click(); } },
      { id: "set-reset", cat: "Tools & Settings", title: "Reset Session & New Topic", desc: "Clear active conversation and start fresh topic", icon: "🔄", action: () => { document.getElementById("resetChatBtn")?.click(); } }
    ];

    function openPalette() {
      modal.classList.remove("hidden");
      playSound("palette");
      input.value = "";
      input.focus();
      filterCommands("");
    }

    function closePalette() {
      modal.classList.add("hidden");
      input.blur();
    }

    function renderList() {
      if (!filteredCommands.length) {
        results.innerHTML = `
          <div class="py-8 text-center text-slate-400">
            <span class="text-2xl block mb-1">🔍</span>
            <p class="text-xs font-semibold">No matching commands found</p>
            <p class="text-[11px] text-slate-500 mt-1">Press <kbd class="cmd-kbd px-1 py-0.5 rounded text-[10px]">Enter</kbd> to ask Luna about "<strong>${escapeHtml(input.value)}</strong>"</p>
          </div>
        `;
        return;
      }

      let html = "";
      let currentCat = "";

      filteredCommands.forEach((cmd, idx) => {
        if (cmd.cat !== currentCat) {
          currentCat = cmd.cat;
          html += `<div class="px-3 pt-2 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-500">${currentCat}</div>`;
        }
        const isSelected = idx === selectedIndex;
        html += `
          <div data-cmd-idx="${idx}" class="cmd-item flex items-center justify-between px-3 py-2 rounded-xl text-xs ${isSelected ? 'active bg-white/10' : 'text-slate-300 hover:text-white'}">
            <div class="flex items-center gap-2.5 min-w-0">
              <span class="text-base shrink-0">${cmd.icon}</span>
              <div class="truncate">
                <div class="font-semibold text-white truncate">${escapeHtml(cmd.title)}</div>
                <div class="text-[10px] text-slate-400 truncate">${escapeHtml(cmd.desc)}</div>
              </div>
            </div>
            <div class="shrink-0 ml-2">
              <span class="text-[10px] text-slate-500">Jump ↵</span>
            </div>
          </div>
        `;
      });

      results.innerHTML = html;

      results.querySelectorAll(".cmd-item").forEach((el) => {
        el.addEventListener("click", () => {
          const idx = parseInt(el.getAttribute("data-cmd-idx"), 10);
          executeCommand(idx);
        });
      });
    }

    function filterCommands(query) {
      const q = query.trim().toLowerCase();
      if (!q) {
        filteredCommands = [...COMMANDS];
      } else {
        filteredCommands = COMMANDS.filter(cmd =>
          cmd.title.toLowerCase().includes(q) ||
          cmd.desc.toLowerCase().includes(q) ||
          cmd.cat.toLowerCase().includes(q)
        );
      }
      selectedIndex = 0;
      renderList();
    }

    function executeCommand(idx) {
      const cmd = filteredCommands[idx];
      if (cmd) {
        closePalette();
        playSound("click");
        cmd.action();
      } else if (input.value.trim()) {
        const q = input.value.trim();
        closePalette();
        window.navigateToPage("classroom");
        sendChatMessage(q);
      }
    }

    if (openBtn) {
      openBtn.addEventListener("click", openPalette);
    }
    if (backdrop) {
      backdrop.addEventListener("click", closePalette);
    }

    input.addEventListener("input", (e) => {
      filterCommands(e.target.value);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (filteredCommands.length > 0) {
          selectedIndex = (selectedIndex + 1) % filteredCommands.length;
          renderList();
          scrollSelectedIntoView();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (filteredCommands.length > 0) {
          selectedIndex = (selectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
          renderList();
          scrollSelectedIntoView();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        executeCommand(selectedIndex);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePalette();
      }
    });

    function scrollSelectedIntoView() {
      const activeEl = results.querySelector(`.cmd-item[data-cmd-idx="${selectedIndex}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }

    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (modal.classList.contains("hidden")) {
          openPalette();
        } else {
          closePalette();
        }
      } else if (e.key === "Escape" && !modal.classList.contains("hidden")) {
        closePalette();
      }
    });
  }

  // =========================================================================
  // MOBILE ADAPTIVE SPLIT-PANE CONTROLLER (< 1024px)
  // =========================================================================
  function initMobileAdaptiveSplitter() {
    const chatBtn = document.getElementById("mobileViewChatBtn");
    const canvasBtn = document.getElementById("mobileViewCanvasBtn");

    window.setMobileWorkspaceView = function (view) {
      if (view === "canvas") {
        document.body.classList.remove("mobile-view-chat");
        document.body.classList.add("mobile-view-canvas");
        if (canvasBtn) {
          canvasBtn.className = "flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-md cursor-pointer";
        }
        if (chatBtn) {
          chatBtn.className = "flex-1 py-2 px-3 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition flex items-center justify-center gap-1.5 cursor-pointer";
        }
      } else {
        document.body.classList.remove("mobile-view-canvas");
        document.body.classList.add("mobile-view-chat");
        if (chatBtn) {
          chatBtn.className = "flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-md cursor-pointer";
        }
        if (canvasBtn) {
          canvasBtn.className = "flex-1 py-2 px-3 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition flex items-center justify-center gap-1.5 cursor-pointer";
        }
      }
    };

    if (chatBtn) {
      chatBtn.addEventListener("click", () => {
        window.setMobileWorkspaceView("chat");
        playSound("click");
      });
    }

    if (canvasBtn) {
      canvasBtn.addEventListener("click", () => {
        window.setMobileWorkspaceView("canvas");
        playSound("click");
      });
    }

    // When typing in chat or focusing, ensure mobile chat view is active
    const chatInput = document.getElementById("chatMessageInput");
    if (chatInput) {
      chatInput.addEventListener("focus", () => {
        if (window.innerWidth < 1024) {
          window.setMobileWorkspaceView("chat");
        }
      });
    }

    // Default mobile state
    if (window.innerWidth < 1024) {
      window.setMobileWorkspaceView("chat");
    }
  }

  // =========================================================================
  // KEYBOARD SHORTCUTS MODAL CONTROLLER
  // =========================================================================
  function initShortcutsModal() {
    const modal = document.getElementById("shortcutsModal");
    const openBtn = document.getElementById("shortcutsHelpBtn");
    const closeBtn = document.getElementById("closeShortcutsModal");
    const closeBtn2 = document.getElementById("closeShortcutsModalBtn");
    const backdrop = document.getElementById("shortcutsModalBackdrop");

    if (!modal) return;

    function openModal() {
      modal.classList.remove("hidden");
      playSound("palette");
    }

    function closeModal() {
      modal.classList.add("hidden");
    }

    if (openBtn) openBtn.addEventListener("click", openModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (closeBtn2) closeBtn2.addEventListener("click", closeModal);
    if (backdrop) backdrop.addEventListener("click", closeModal);

    // Global '?' key to toggle shortcuts modal
    window.addEventListener("keydown", (e) => {
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (document.activeElement?.tagName || "").toLowerCase();
        if (tag !== "input" && tag !== "textarea") {
          e.preventDefault();
          if (modal.classList.contains("hidden")) {
            openModal();
          } else {
            closeModal();
          }
        }
      } else if (e.key === "Escape" && !modal.classList.contains("hidden")) {
        closeModal();
      }
    });
  }

  function initTopicEmptyStateListeners() {
    // Exam Cheat Sheet Empty State Chips
    document.querySelectorAll("#examEmptyStateChips [data-select-topic]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.getAttribute("data-select-topic");
        selectAndSetTopic(t, "exam");
      });
    });

    // Exam Custom Topic Input
    const examInput = document.getElementById("examCustomTopicInput");
    const examBtn = document.getElementById("examCustomTopicSubmitBtn");
    if (examBtn && examInput) {
      examBtn.addEventListener("click", () => {
        const val = examInput.value.trim();
        if (val) selectAndSetTopic(val, "exam");
      });
      examInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const val = examInput.value.trim();
          if (val) selectAndSetTopic(val, "exam");
        }
      });
    }

    // Flashcards Empty State Chips
    document.querySelectorAll("#flashcardsEmptyStateChips [data-select-topic]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.getAttribute("data-select-topic");
        selectAndSetTopic(t, "flashcards");
      });
    });

    // Flashcards Custom Topic Input
    const flashInput = document.getElementById("flashcardsCustomTopicInput");
    const flashBtn = document.getElementById("flashcardsCustomTopicSubmitBtn");
    if (flashBtn && flashInput) {
      flashBtn.addEventListener("click", () => {
        const val = flashInput.value.trim();
        if (val) selectAndSetTopic(val, "flashcards");
      });
      flashInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const val = flashInput.value.trim();
          if (val) selectAndSetTopic(val, "flashcards");
        }
      });
    }
  }

  // =========================================================================
  // APP BOOTSTRAP & CHAT HISTORY RESTORATION
  // =========================================================================
  document.addEventListener("DOMContentLoaded", () => {
    updateHUD();
    updateActiveTopicUI();
    updateDynamicRoadmap();
    updateTeachingModeUI();
    updateAnalyticsDashboard();
    initEventListeners();
    initGalaxyWorkspace();
    initSpotlightCards();
    initCommandPalette();
    initMobileAdaptiveSplitter();
    initShortcutsModal();
    initTopicEmptyStateListeners();

    // RESTORE CHAT HISTORY IF EXISTS, OR SHOW INITIAL GREETING
    const box = document.getElementById("chatMessagesContainer");
    if (box) {
      if (conversationHistory && conversationHistory.length > 0) {
        conversationHistory.forEach((item) => {
          if (item.role === "user") {
            appendUserMessage(item.content, item.image);
          } else if (item.role === "assistant") {
            if (item.data) {
              appendLunaMessage(item.data);
            } else {
              appendLunaMessage({ reply_text: item.content });
            }
          }
        });
      } else {
        const currentName = studentProfile.name || "there";
        const gr = getLocalizedGreeting(currentName);
        appendLunaMessage({
          reply_text: gr.reply_text,
          speech_text: gr.speech_text,
          analogy_card: {
            title: "🌸 Ready Whenever You Are",
            description: "Tell me any topic in science, mathematics, engineering, or literature, and I'll break it down with everyday analogies!"
          }
        });
        renderSuggestedChips(gr.chips);
      }
    }

    // Mandatory Setup Check: If user has never completed setup or requested via URL
    const urlParams = new URLSearchParams(window.location.search);
    const hasCompletedSetup = localStorage.getItem("clearmind_setup_completed");

    if (!hasCompletedSetup || urlParams.has("settings")) {
      setTimeout(() => {
        openProfile(!hasCompletedSetup);
      }, 400);
    }

    // Multi-Page Initial Route Resolution from URL Path
    const rawPath = (window.location.pathname || "").replace(/^\//, "").toLowerCase();
    if (rawPath === "cheatsheet" || rawPath === "exam") {
      window.navigateToPage("cheatsheet", false);
    } else if (rawPath === "blitz") {
      window.navigateToPage("blitz", false);
    } else if (rawPath === "flashcards") {
      window.navigateToPage("flashcards", false);
    } else if (rawPath === "analytics" || rawPath === "journey") {
      window.navigateToPage("analytics", false);
    } else if (rawPath === "galaxy" || rawPath === "graph") {
      window.navigateToPage("galaxy", false);
    } else {
      window.navigateToPage("classroom", false);
    }

    // Browser Back / Forward History Listener
    window.addEventListener("popstate", () => {
      const p = (window.location.pathname || "").replace(/^\//, "").toLowerCase();
      window.navigateToPage(p || "classroom", false);
    });

    console.log("🌸 ClearMind Pro v17.0 — High-Yield Educational Engine Ready.");
  });
})();
