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
  let speechContext = null;
  let speechSession = null;
  let speechGeneration = 0;
  let voiceIntentVersion = 0;
  let activeVoiceGender = localStorage.getItem("clearmind_voice_gender") === "male" ? "male" : "female";
  let cachedCheatSheets = {};
  let awardedCheatSheetTopics = new Set();
  const examLoadState = { sequence: 0, pending: null, languages: new Map() };
  const blitzLoadState = { sequence: 0, pending: null };
  const flashcardsLoadState = { sequence: 0, pending: null, languages: new Map() };
  const featureErrors = new WeakMap();

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

  // v20 clean slate migration: purge obsolete hardcoded legacy mock concepts & mock progress
  if (!localStorage.getItem("clearmind_v20_clean_slate")) {
    const existingConcepts = localStorage.getItem("clearmind_cognitive_concepts");
    if (existingConcepts && (existingConcepts.includes("Recursion") || existingConcepts.includes("Backpropagation"))) {
      localStorage.removeItem("clearmind_cognitive_concepts");
    }
    localStorage.removeItem("clearmind_missions");
    localStorage.removeItem("clearmind_conv_history");
    localStorage.setItem("clearmind_v20_clean_slate", "true");
  }

  const rawProfile = JSON.parse(localStorage.getItem("clearmind_profile") || "{}");
  if (!activeTopic && rawProfile.subjects && rawProfile.subjects.length > 0) {
    const topSub = rawProfile.subjects[0].name || rawProfile.subjects[0];
    if (typeof topSub === "string") {
      activeTopic = topSub;
      localStorage.setItem("clearmind_active_topic", activeTopic);
    }
  }

  let totalXP = parseInt(localStorage.getItem("clearmind_xp") || "0", 10);
  let currentStreak = parseInt(localStorage.getItem("clearmind_streak") || "1", 10);

  let studentProfile = JSON.parse(
    localStorage.getItem("clearmind_profile") ||
      JSON.stringify({
        name: "",
        avatar: "🎓",
        level: ""
      })
  );
  const authUser = JSON.parse(localStorage.getItem("clearmind_auth_user") || "null");
  const studentUserId = authUser?.user_id || "CMP-STUDENT";
  if (!studentProfile.name && authUser?.name) {
    studentProfile.name = authUser.name;
  }
  if (!studentProfile.name && studentProfile.user?.name) {
    studentProfile.name = studentProfile.user.name;
  }

  // Update header name & User ID badge
  const pNameHeader = document.getElementById("profileNameHeader");
  if (pNameHeader) pNameHeader.textContent = studentProfile.name || "Student";
  const headerUserIdBadge = document.getElementById("headerUserIdBadge");
  if (headerUserIdBadge) headerUserIdBadge.textContent = studentUserId;
  const modalUserIdBadge = document.getElementById("modalUserIdBadge");
  if (modalUserIdBadge) modalUserIdBadge.textContent = studentUserId;

  let conversationHistory = JSON.parse(
    localStorage.getItem("clearmind_conv_history") || "[]"
  );
  function saveHistory() {
    conversationHistory = conversationHistory.slice(-12);
    localStorage.setItem("clearmind_conv_history", JSON.stringify(conversationHistory));
  }

  function openProfile(isFirstTime = false) {
    const pModal = document.getElementById("profileModal");
    const nInp = document.getElementById("inputStudentName");
    const tInp = document.getElementById("inputStudentTopic");
    const closeBtn = document.getElementById("closeProfileModal");

    const calibratedData = JSON.parse(localStorage.getItem("clearmind_profile") || "{}");
    const currentPersona = localStorage.getItem("clearmind_calibrated_persona") || calibratedData.persona || "strict";

    // Set name & topic
    if (nInp) nInp.value = studentProfile.name || calibratedData.user?.name || "";
    if (tInp) tInp.value = activeTopic || calibratedData.activeTopic || "";

    // Set curriculum info
    const hudCurriculum = document.getElementById("hudCurriculumText");
    if (hudCurriculum) {
      if (calibratedData.subDetails?.streamTitle) {
        hudCurriculum.textContent = `${calibratedData.subDetails.gradeTitle || ''} • ${calibratedData.subDetails.streamTitle}`;
      } else if (calibratedData.subDetails?.programTitle) {
        hudCurriculum.textContent = calibratedData.subDetails.programTitle;
      } else if (calibratedData.identityTitle) {
        hudCurriculum.textContent = calibratedData.identityTitle;
      } else {
        hudCurriculum.textContent = studentProfile.level || "Class 12 Science (PCM)";
      }
    }

    // Set countdown & rhythm
    const hudCountdown = document.getElementById("hudExamCountdown");
    const hudExamName = document.getElementById("hudExamName");
    const hudRhythm = document.getElementById("hudDailyRhythm");

    if (hudCountdown) {
      hudCountdown.textContent = calibratedData.daysUntilExam ? `${calibratedData.daysUntilExam} Days Left` : "172 Days Left";
    }
    if (hudExamName) {
      hudExamName.textContent = `Target: ${calibratedData.examTargetName || 'Board & Entrance Exams'}`;
    }
    if (hudRhythm) {
      hudRhythm.textContent = `${calibratedData.dailyRhythm || 45} mins / day`;
    }

    // Highlight active persona in HUD grid
    highlightHudPersona(currentPersona);

    // Populate tracked subjects list
    const subjectsContainer = document.getElementById("hudTrackedSubjectsList");
    if (subjectsContainer) {
      const subjects = calibratedData.subjects || [
        { name: "Physics", priority: "high" },
        { name: "Chemistry", priority: "high" },
        { name: "Mathematics", priority: "high" }
      ];
      subjectsContainer.innerHTML = subjects.map(s => {
        const sName = typeof s === "string" ? s : s.name;
        const isHigh = typeof s === "object" && s.priority === "high";
        const isActive = sName.toLowerCase() === (activeTopic || "").toLowerCase();
        return `<button type="button" data-pick-subject="${escapeHtml(sName)}" class="hud-subject-pill px-2.5 py-1 rounded-xl text-[11px] font-bold border transition flex items-center gap-1.5 cursor-pointer ${
          isActive 
            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-sm shadow-cyan-500/20' 
            : 'bg-white/[0.03] border-white/10 hover:border-cyan-500/40 text-slate-300 hover:text-white'
        }">
          <span>${isHigh ? '🔥' : '📚'}</span>
          <span>${escapeHtml(sName)}</span>
          ${isHigh ? '<span class="text-[9px] uppercase px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-extrabold">High</span>' : ''}
        </button>`;
      }).join("");

      subjectsContainer.querySelectorAll("[data-pick-subject]").forEach(btn => {
        btn.addEventListener("click", () => {
          const picked = btn.getAttribute("data-pick-subject");
          if (picked) {
            selectAndSetTopic(picked);
            if (tInp) tInp.value = picked;
            openProfile(false);
          }
        });
      });
    }

    if (closeBtn) closeBtn.classList.remove("hidden");
    pModal?.classList.remove("hidden");
  }

  function highlightHudPersona(personaKey) {
    const pKey = personaKey || "strict";
    const label = document.getElementById("currentActivePersonaLabel");
    const personaMap = {
      mentor: { label: "🎓 Encouraging Mentor", title: "Mentor" },
      strict: { label: "⚡ Strict Examiner", title: "Strict Examiner" },
      polymath: { label: "🔬 First-Principles", title: "First-Principles" },
      socratic: { label: "💡 Socratic Guide", title: "Socratic Guide" },
      hacker: { label: "🚀 Exam Hacker", title: "Exam Hacker" },
      feynman: { label: "🧠 Feynman (ELI5)", title: "Feynman (ELI5)" }
    };

    if (label) {
      label.textContent = personaMap[pKey]?.label || "⚡ Strict Examiner";
    }

    document.querySelectorAll(".hud-persona-btn").forEach(btn => {
      const p = btn.getAttribute("data-persona");
      if (p === pKey) {
        btn.className = "hud-persona-btn active p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-500 text-left transition flex flex-col justify-between min-h-[64px] cursor-pointer shadow-sm shadow-cyan-500/20";
        const t = btn.querySelector(".font-bold");
        if (t) t.className = "text-[11px] font-bold text-cyan-300";
      } else {
        btn.className = "hud-persona-btn p-2.5 rounded-xl bg-white/[0.02] border border-white/10 hover:border-cyan-500/50 text-left transition flex flex-col justify-between min-h-[64px] cursor-pointer";
        const t = btn.querySelector(".font-bold");
        if (t) t.className = "text-[11px] font-bold text-white";
      }
    });
  }
  window.openProfile = openProfile;

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
      // Clean dynamic initialization based on user's calibrated subjects
      const calibrated = JSON.parse(localStorage.getItem("clearmind_profile") || "{}");
      const subjects = (calibrated.subjects && calibrated.subjects.length > 0)
        ? calibrated.subjects
        : (studentProfile.subjects || []);
      if (!subjects || subjects.length === 0) {
        return [];
      }
      const palette = ["#a78bfa", "#f0abfc", "#22d3ee", "#34d399", "#fbbf24", "#fb7185", "#60a5fa", "#c084fc"];
      return subjects.map((s, i) => {
        const sName = typeof s === "string" ? s : (s.name || "Core Subject");
        const sId = sName.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 18);
        return {
          id: sId,
          name: `${sName} Foundations`,
          category: sName,
          strength: 0.5,
          stability: 1,
          lastReview: 0,
          reviews: 0,
          color: palette[i % palette.length],
          connections: []
        };
      });
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
        { id: "m1", title: "Morning Focus", description: "Start an active study turn or search a topic.", xp: 25, progress: 0, done: false, icon: "🌅" },
        { id: "m2", title: "Conceptual Dialogue", description: "Engage in an in-depth conversation with AI Tutor Luna.", xp: 60, progress: 0, done: false, icon: "🌸" },
        { id: "m3", title: "Flashcard Mastery", description: "Review 3 concepts in spaced-repetition flashcards.", xp: 45, progress: 0, done: false, icon: "📉" },
        { id: "m4", title: "Blitz Battle", description: "Complete a Blitz Arena round with combo 2x+.", xp: 75, progress: 0, done: false, icon: "⚔️" },
        { id: "m5", title: "Prerequisite Tree", description: "Inspect topic prerequisite relationships in Analytics.", xp: 50, progress: 0, done: false, icon: "🕸️" }
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
      // Missions removed from platform
    },

    getMindHealth() {
      const concepts = this.loadConcepts();
      if (concepts.length === 0 && totalXP === 0) {
        return {
          focusMinutes: 0,
          confidence: 0,
          curiosity: 0,
          avgRetention: 0
        };
      }
      const retentions = concepts.map((c) => this.currentRetention(c));
      const avgRetention = retentions.length > 0 ? retentions.reduce((a, b) => a + b, 0) / retentions.length : 0;
      const sessionMinutes = Math.min(90, Math.floor(totalXP / 30));
      const confidence = totalXP > 0 ? Math.min(100, Math.max(10, Math.round(avgRetention * 80 + (blitzBestCombo > 1 ? 15 : 5)))) : 0;
      const curiosity = totalXP > 0 ? Math.min(100, Math.max(20, Math.round(30 + (concepts.length * 4)))) : 0;
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
    if (wf) {
      wf.classList.toggle("hidden", !isActive);
      wf.classList.toggle("active", isActive);
      wf.setAttribute("aria-hidden", String(!isActive));
      if (!isActive) wf.querySelectorAll(".waveform-bar").forEach(bar => bar.style.removeProperty("--voice-level"));
    }
    const rings = document.getElementById("voiceCallWaveRings");
    if (rings) {
      rings.classList.toggle("hidden", !isActive);
      rings.classList.toggle("voice-speaking", isActive);
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

    const calibrated = JSON.parse(localStorage.getItem("clearmind_profile") || "{}");
    const personaIcons = {
      mentor: "🎓",
      strict: "⚡",
      socratic: "💡",
      polymath: "🔬",
      hacker: "🚀",
      feynman: "🧠"
    };
    const activePersonaKey = localStorage.getItem("clearmind_calibrated_persona") || calibrated.persona || "strict";
    const displayName = studentProfile.name || calibrated.user?.name || calibrated.name || "Student";
    const displayAvatar = personaIcons[activePersonaKey] || studentProfile.avatar || "⚡";

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

    // Update Persona Badge in Chat Stream Header
    const pBadge = document.getElementById("chatPersonaBadge");
    if (pBadge) {
      const persona = localStorage.getItem("clearmind_calibrated_persona") || calibrated.persona || studentProfile.persona || "mentor";
      const personaLabels = {
        strict: "⚡ Strict Examiner",
        socratic: "💡 Socratic Guide",
        polymath: "🔬 First-Principles",
        hacker: "🚀 Exam Hacker",
        feynman: "🧠 Feynman ELI5",
        mentor: "🎓 Mentor"
      };
      pBadge.textContent = personaLabels[persona] || "🎓 Mentor";
    }
  }

  // =========================================================================
  // UTILITIES: HTML ESCAPING, MARKDOWN & LATEX KATEX RENDERING
  // =========================================================================
  function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    // NOTE: the old implementation used textContent -> innerHTML, which escapes
    // only & < > and NOT " or '. That silently broke out of HTML attributes in
    // the onclick="..." / data-* usages below. Escape all five explicitly.
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  window.escapeHtml = escapeHtml;

  // Read the session token issued at login (app.html does not load auth.js,
  // so this getter has to exist here as well).
  if (typeof window.cmSessionToken !== 'function') {
    window.cmSessionToken = function () {
      try {
        const raw = localStorage.getItem("clearmind_auth_user");
        return raw ? (JSON.parse(raw).session_token || "") : "";
      } catch (e) {
        return "";
      }
    };
  }

  // Attach the session token to every /api/* call from one place, so individual
  // call sites cannot forget to authorize themselves.
  if (!window.__cmFetchPatched) {
    window.__cmFetchPatched = true;
    const cmOriginalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/api/') !== -1) {
          init = init || {};
          const headers = new Headers(init.headers || {});
          const token = (typeof window.cmSessionToken === 'function') ? window.cmSessionToken() : '';
          if (token && !headers.has('Authorization')) {
            headers.set('Authorization', 'Bearer ' + token);
          }
          init = Object.assign({}, init, { headers: headers });
        }
      } catch (e) {
        /* never block a request on header bookkeeping */
      }
      return cmOriginalFetch(input, init).then(function (res) {
        if (res && res.status === 401 && typeof window.cmOnSessionExpired === 'function') {
          window.cmOnSessionExpired();
        }
        return res;
      });
    };
  }

  window.cmOnSessionExpired = function () {
    if (window.__cmSessionExpiredFired) return;
    window.__cmSessionExpiredFired = true;
    try { localStorage.removeItem("clearmind_auth_user"); } catch (e) {}
    try { if (window.AuthEngine) { window.AuthEngine.currentUser = null; } } catch (e) {}
    alert("Your session has expired. Please sign in again.");
    window.location.href = "/?login=1";
  };

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

    if (sub) sub.textContent = `${activeTopic} Roadmap`;

    let steps = [];
    const savedChapters = JSON.parse(localStorage.getItem("clearmind_syllabus_chapters") || "[]");
    if (savedChapters && savedChapters.length > 0) {
      const matched = savedChapters.find(ch => 
        (ch.subject && activeTopic.toLowerCase().includes(ch.subject.toLowerCase())) ||
        (ch.name && activeTopic.toLowerCase().includes(ch.name.toLowerCase()))
      );
      if (matched && matched.topics && matched.topics.length > 0) {
        steps = matched.topics.map((t, idx) => ({
          name: t,
          status: idx === 0 ? "active" : "todo"
        }));
      } else {
        steps = savedChapters.slice(0, 5).map((ch, idx) => ({
          name: ch.name,
          status: idx === 0 ? "active" : "todo"
        }));
      }
    }

    if (steps.length === 0) {
      steps = [
        { name: `${activeTopic}: Core Principles`, status: "active" },
        { name: `${activeTopic}: Problem Solving & Derivations`, status: "todo" },
        { name: `${activeTopic}: High-Yield Exam Traps`, status: "todo" },
        { name: `${activeTopic}: Active Recall Verification`, status: "todo" }
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

    // Galaxy / Graph view aliases directly to Analytics Dependency Tree
    if (key === "galaxy" || key === "graph") {
      window.switchCanvasTab("journey", pushState);
      setTimeout(() => {
        document.getElementById("bentoDependencyTreeCard")?.scrollIntoView({ behavior: "smooth" });
      }, 150);
      return;
    }

    // For all other views, stay inside Classroom split-screen and switch canvas tab!
    let tab = "live";
    if (key === "cheatsheet" || key === "exam") tab = "exam";
    else if (key === "blitz") tab = "blitz";
    else if (key === "flashcards") tab = "flashcards";
    else if (key === "analytics" || key === "journey") tab = "journey";
    else if (key === "motion" || key === "studio") tab = "motion";
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
    if (normKey === "motion" || normKey === "studio") mappedKey = "motion";

    // Route galaxy to journey
    if (normKey === "galaxy" || normKey === "graph") {
      window.switchCanvasTab("journey", pushState);
      setTimeout(() => {
        document.getElementById("bentoDependencyTreeCard")?.scrollIntoView({ behavior: "smooth" });
      }, 150);
      return;
    }

    // Ensure Classroom is visible
    document.getElementById("pageClassroom")?.classList.remove("hidden");

    // Adapt mobile split-pane view
    if (typeof window.setMobileWorkspaceView === "function" && window.innerWidth < 1024) {
      window.setMobileWorkspaceView("canvas");
    }

    // Cancel pending questions as well as the timer when leaving Blitz.
    if (mappedKey !== "blitz" && (blitzState.isRunning || blitzLoadState.pending)) {
      cancelFeatureLoad(blitzLoadState);
      clearInterval(blitzState.timerInterval);
      blitzState.timerInterval = null;
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
      "viewCanvasJourney",
      "viewCanvasMotion"
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
      journey: "viewCanvasJourney",
      motion: "viewCanvasMotion"
    };
    const targetId = viewMap[mappedKey] || "viewCanvasLive";
    const targetEl = document.getElementById(targetId);
    if (targetEl) {
      targetEl.classList.remove("hidden");
    }

    // =========================================================================
    // DEDICATED FULL-WIDTH STUDIO vs CLASSROOM SPLIT-VIEW
    // When in Classroom (Live / Voice): show Split-View with Luna Chat!
    // When in Exam Cheat Sheet, Blitz Battle, 3D Flashcards, Analytics, or 3D Motion Studio:
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
        // Full-Width Dedicated Studio (Exam Sheet, Blitz Arena, Flashcards, Analytics, 3D Motion Studio)
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
      journey: "/analytics",
      motion: "/motion"
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
      journey: "analytics",
      motion: "motion"
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
    } else if (mappedKey === "motion") {
      initMotionStudio();
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
    } else if (raw === "motion" || raw === "studio") {
      window.switchCanvasTab("motion", false);
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

  function appendLunaMessage(data, autoplayIntent = null) {
    const box = document.getElementById("chatMessagesContainer");
    if (!box) return;
    const d = document.createElement("div");
    d.className = "luna-msg flex items-start gap-2.5 animate-fade-in";

    let analogyHtml = "";
    if (data.analogy_card && data.analogy_card.title) {
      analogyHtml = `
        <div class="p-3.5 glass-strong border border-violet-500/30 rounded-2xl space-y-1 shadow-sm">
          <span class="text-[9px] font-black uppercase tracking-wider text-violet-400">[Interactive Analogy Card]</span>
          <h5 class="text-xs font-black text-white">${escapeHtml(data.analogy_card.title)}</h5>
          <p class="text-[11px] text-violet-200/90 leading-relaxed">${escapeHtml(data.analogy_card.description || "")}</p>
        </div>`;
    }

    let rawSpeech = (data.speech_text || "").trim();
    const rawReply = (data.reply_text || "").trim();
    if (!rawSpeech || (rawReply.length > 150 && rawSpeech.length < rawReply.length * 0.65)) {
      rawSpeech = rawReply;
    }
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

    // Never autoplay a response after the user has already interrupted it.
    if (isVoiceCallActive && soundEnabled && autoplayIntent === voiceIntentVersion) {
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
    interruptSpeech();
    const autoplayIntent = voiceIntentVersion;
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
          persona: localStorage.getItem("clearmind_calibrated_persona") || studentProfile.persona || "mentor",
          image_base64: imageBase64 || null,
          include_audio: false,
          voice_gender: activeVoiceGender
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

      appendLunaMessage(data, autoplayIntent);
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

    renderConceptNodesForTopic(activeTopic);
  }

  function renderConceptNodesForTopic(topic) {
    const list = document.getElementById("canvasNodesGrid");
    if (!list) return;
    
    const t = (topic || activeTopic || "").toLowerCase();
    let nodes = [];

    if (t.includes("physics")) {
      nodes = [
        { type: "Node 01 • Fundamental Law", title: "Coulomb's Law & Electric Field Vector", desc: "Electrostatic force between point charges is inversely proportional to r². F = k·(q1·q2)/r²", color: "text-cyan-400" },
        { type: "Node 02 • High-Yield Trap", title: "Gauss's Law on Arbitrary Closed Surfaces", desc: "Flux depends strictly on enclosed charge Σq_enc / ε₀, independent of surface geometry.", color: "text-amber-400" }
      ];
    } else if (t.includes("chem")) {
      nodes = [
        { type: "Node 01 • Reaction Mechanism", title: "Electrophilic Aromatic Substitution (EAS)", desc: "Arenium ion intermediate formation preserving aromatic delocalization energy.", color: "text-emerald-400" },
        { type: "Node 02 • Examiner Trap", title: "Coordination Splitting & CFSE Ligand Field", desc: "Strong field vs weak field ligands determine spin states, pairing energy, and d-d absorption color.", color: "text-purple-400" }
      ];
    } else if (t.includes("math") || t.includes("calculus") || t.includes("algebra")) {
      nodes = [
        { type: "Node 01 • Core Theorem", title: "Mean Value Theorem & Differential Extrema", desc: "Continuity on [a,b] guarantees a tangent parallel to secant line: f'(c) = [f(b)-f(a)]/(b-a).", color: "text-indigo-400" },
        { type: "Node 02 • Speed Shortcut", title: "L'Hôpital's Rule for Indeterminate 0/0 & ∞/∞", desc: "Evaluate limits by independent differentiation of numerator and denominator.", color: "text-pink-400" }
      ];
    } else if (t.includes("bio") || t.includes("neet")) {
      nodes = [
        { type: "Node 01 • Molecular Process", title: "DNA Replication & Okazaki Fragment Splicing", desc: "Leading vs lagging strand synthesis orchestrated by DNA Polymerase III and Ligase.", color: "text-emerald-400" },
        { type: "Node 02 • High-Yield Cycle", title: "Calvin Cycle & Rubisco Oxygenase Competition", desc: "Photorespiration losses mitigated in C4/CAM plants through spatial/temporal CO₂ capture.", color: "text-cyan-400" }
      ];
    } else if (t.includes("python") || t.includes("computer") || t.includes("dsa")) {
      nodes = [
        { type: "Node 01 • Data Structures", title: "Hash Map & Collision Resolution O(1)", desc: "Key-value indexing with open addressing vs chaining for constant amortized access.", color: "text-emerald-400" },
        { type: "Node 02 • Core Principle", title: "Recursion Stack & Divide-and-Conquer", desc: "Base case termination preventing recursion depth overflow with O(log N) state trees.", color: "text-cyan-400" }
      ];
    } else {
      nodes = [
        { type: "Node 01 • Definition", title: `${topic || "Core Principles"} Foundations`, desc: `Essential terminology, axioms, and operational framework for ${topic || "this syllabus topic"}.`, color: "text-cyan-400" },
        { type: "Node 02 • Examiner Trap", title: "High-Yield Distinction & Pitfalls", desc: "Key conceptual boundaries that separate top scorers from common exam misinterpretations.", color: "text-amber-400" }
      ];
    }

    list.innerHTML = nodes.map(n => `
      <div class="bento-card p-3.5 rounded-2xl border border-white/10 space-y-1 animate-fade-in shadow-sm">
        <span class="text-[9px] font-black ${n.color} uppercase tracking-wider">${escapeHtml(n.type)}</span>
        <h5 class="text-xs font-extrabold text-white">${escapeHtml(n.title)}</h5>
        <p class="text-[11px] text-slate-400 leading-relaxed">${escapeHtml(n.desc)}</p>
      </div>
    `).join("");
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
  // One cancellable owner for requests, decoded buffers, playback, and UI.
  function setVoiceButton(btn, label, busy = false) {
    if (!btn) return;
    btn.textContent = label;
    btn.disabled = false; // Loading can always be cancelled.
    btn.setAttribute("aria-busy", String(busy));
    btn.setAttribute("aria-pressed", String(label === "Pause voice"));
  }

  function speechIsCurrent(session) {
    return speechSession === session && session.id === speechGeneration;
  }

  function stopCurrentAudio(fade = true) {
    ++speechGeneration;
    const session = speechSession;
    speechSession = null; // Invalidate before abort/ended callbacks can fire.
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setAudioWaveformActive(false);
    if (!session) return;
    session.controller.abort();
    clearTimeout(session.timeout);
    cancelAnimationFrame(session.frame);
    setVoiceButton(session.btn, "Listen with voice");
    if (session.media) {
      session.media.onended = session.media.onerror = session.media.onplaying = null;
      const media = session.media;
      const started = performance.now();
      const volume = media.volume;
      const finish = () => {
        media.pause();
        media.removeAttribute("src");
        media.load();
        if (session.url) URL.revokeObjectURL(session.url);
      };
      if (fade && !media.paused) {
        const tick = () => {
          const progress = Math.min(1, (performance.now() - started) / 45);
          media.volume = volume * (1 - progress);
          if (progress < 1) requestAnimationFrame(tick);
          else finish();
        };
        tick();
      } else finish();
    }
    if (session.gain) {
      const now = speechContext.currentTime;
      const tail = fade && speechContext.state === "running" ? 0.045 : 0;
      session.gain.gain.cancelScheduledValues(now);
      session.gain.gain.setValueAtTime(session.gain.gain.value, now);
      session.gain.gain.linearRampToValueAtTime(0, now + tail);
      for (const source of session.sources) {
        source.onended = null;
        try { source.stop(now + tail); } catch (_) { /* Already finished. */ }
      }
      setTimeout(() => {
        session.sources.forEach(source => source.disconnect());
        session.gain.disconnect();
        session.analyser.disconnect();
        session.sources.length = 0;
      }, tail * 1000 + 20);
    }
  }

  function interruptSpeech() {
    ++voiceIntentVersion; // Also suppress autoplay from an older chat response.
    stopCurrentAudio();
  }

  function getSpeechContext() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    if (!speechContext || speechContext.state === "closed") speechContext = new Context();
    return speechContext;
  }

  // Keep a little room around consonants. Remove only near-digital silence at
  // chunk edges (at most 300 ms), never silence inside the spoken phrase.
  function speechPlaybackBounds(buffer) {
    const rate = buffer.sampleRate;
    const limit = Math.min(Math.floor(rate * 0.3), Math.floor(buffer.length / 4));
    const padding = Math.floor(rate * 0.025);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const silent = i => channels.every(data => Math.abs(data[i]) < 0.0005);
    let first = 0;
    let last = buffer.length - 1;
    while (first < limit && silent(first)) ++first;
    while (last > buffer.length - 1 - limit && silent(last)) --last;
    const start = Math.max(0, first - padding);
    const end = Math.min(buffer.length, last + padding + 1);
    return { offset: start / rate, duration: (end - start) / rate,
      leading: (first - start) / rate, trailing: (end - last - 1) / rate };
  }

  function updateSpeechMeter(session) {
    if (!speechIsCurrent(session)) return;
    const running = speechContext.state === "running" && !session.paused && speechContext.currentTime >= session.startsAt;
    setAudioWaveformActive(running);
    if (running) {
      session.analyser.getByteFrequencyData(session.bins);
      document.querySelectorAll("#lunaWaveform .waveform-bar").forEach((bar, index) => {
        const base = 2 + index * 5;
        let energy = 0;
        for (let i = base; i < base + 5; i++) energy += session.bins[i] || 0;
        bar.style.setProperty("--voice-level", String(0.18 + (energy / 1275) * 0.82));
      });
    }
    session.frame = requestAnimationFrame(() => updateSpeechMeter(session));
  }

  async function pauseOrResumeSpeech(session) {
    if (session.loading) { interruptSpeech(); return; }
    const operation = ++session.controlVersion;
    try {
      if (session.media) {
        session.paused = !session.media.paused;
        if (session.paused) session.media.pause();
        else await session.media.play();
      } else {
        session.paused = !session.paused;
        if (session.paused) await speechContext.suspend();
        else await speechContext.resume();
      }
      if (!speechIsCurrent(session) || operation !== session.controlVersion) return;
      setVoiceButton(session.btn, session.paused ? "Resume voice" : "Pause voice");
      setAudioWaveformActive(!session.paused);
    } catch (_) {
      if (speechIsCurrent(session)) {
        stopCurrentAudio(false);
        showToast("Tap Listen again to enable audio playback.", "info");
      }
    }
  }

  function toggleVoiceAudio(base64Audio, rawSpeech, btn) {
    if (btn && speechSession && speechSession.btn === btn) {
      void pauseOrResumeSpeech(speechSession);
      return;
    }
    if (!soundEnabled) {
      soundEnabled = true;
      localStorage.setItem("clearmind_sound", "true");
    }
    // Prefer text over old embedded clips: older responses can be truncated
    // and do not necessarily match the currently selected voice.
    void startNeuralSpeech(rawSpeech, btn, rawSpeech ? null : base64Audio);
  }

  function playPreSynthesizedAudio(base64Audio, btn) {
    toggleVoiceAudio(base64Audio, null, btn);
  }

  function playLunaVoice(rawText, btn) {
    toggleVoiceAudio(null, rawText, btn);
  }

  async function startNeuralSpeech(rawText, btn, base64Audio = null) {
    interruptSpeech();
    const text = String(rawText || "").trim(); // Server owns math/markup cleaning.
    if (!text && !base64Audio) return;
    if (text.length > 5000) {
      showToast("Select a passage of up to 5,000 characters to listen.", "info");
      return;
    }
    const session = {
      id: speechGeneration, btn, controller: new AbortController(), sources: [],
      loading: true, paused: false, controlVersion: 0, frame: 0
    };
    speechSession = session;
    setVoiceButton(btn, "Preparing voice - click to cancel", true);
    const context = getSpeechContext();
    // Resume inside the click gesture, BEFORE waiting for the network.
    const unlocked = context ? context.resume().then(() => true, () => false) : Promise.resolve(false);
    session.timeout = setTimeout(() => {
      if (!speechIsCurrent(session)) return;
      stopCurrentAudio(false);
      showToast("Voice service took too long. Tap Listen to retry.", "error");
    }, 50000);
    try {
      let chunks;
      let legacyBytes;
      if (base64Audio) {
        chunks = [{ audio_base64: base64Audio, pause_after_ms: 0 }];
      } else {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: session.controller.signal,
          body: JSON.stringify({ text, language: activeLanguage, voice_gender: activeVoiceGender,
            response_format: context ? "chunks" : "mp3" })
        });
        if (!res.ok) {
          const error = new Error("Voice request failed");
          error.status = res.status;
          throw error;
        }
        if (!speechIsCurrent(session)) return;
        if ((res.headers.get("content-type") || "").includes("application/json")) {
          const payload = await res.json();
          chunks = payload.chunks;
          if (speechIsCurrent(session) && activeVoiceGender === "female" && payload.voice_gender === "male") {
            showToast("Female voice is temporarily unavailable; using the backup male voice.", "info");
          }
          if (!Array.isArray(chunks) || !chunks.length || chunks.length > 80) throw new Error("Invalid voice chunks");
        } else {
          legacyBytes = await res.arrayBuffer(); // Compatible with old servers.
        }
      }
      if (!speechIsCurrent(session)) return;
      const toBytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0)).buffer;
      if (!context) {
        const bytes = legacyBytes || toBytes(chunks[0].audio_base64);
        session.url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
        session.media = new Audio(session.url);
        session.media.preload = "auto";
        session.media.onplaying = () => { if (speechIsCurrent(session)) setAudioWaveformActive(true); };
        session.media.onended = () => { if (speechIsCurrent(session)) stopCurrentAudio(false); };
        session.media.onerror = () => {
          if (speechIsCurrent(session)) {
            stopCurrentAudio(false);
            showToast("Audio could not be played. Tap Listen to retry.", "error");
          }
        };
        await session.media.play();
        if (!speechIsCurrent(session)) return;
      } else {
        if (!await unlocked || context.state !== "running") throw new Error("Audio needs a user gesture");
        // Decode every chunk before playback. This intentionally trades startup
        // buffering for no network/decode stalls between sentences.
        const decoded = [];
        const inputs = legacyBytes ? [{ bytes: legacyBytes, pause_after_ms: 0 }] : chunks;
        for (const chunk of inputs) {
          const buffer = await context.decodeAudioData(chunk.bytes || toBytes(chunk.audio_base64));
          if (!speechIsCurrent(session)) return;
          decoded.push({ buffer, bounds: speechPlaybackBounds(buffer),
            pause: Math.max(0, Math.min(1000, Number(chunk.pause_after_ms) || 0)) / 1000 });
        }
        session.gain = context.createGain();
        session.analyser = context.createAnalyser();
        session.analyser.fftSize = 128;
        session.bins = new Uint8Array(session.analyser.frequencyBinCount);
        session.gain.connect(session.analyser);
        session.analyser.connect(context.destination);
        let cursor = context.currentTime + 0.04;
        session.startsAt = cursor;
        session.gain.gain.setValueAtTime(0, cursor);
        session.gain.gain.linearRampToValueAtTime(1, cursor + 0.012);
        let remaining = decoded.length;
        decoded.forEach((chunk, index) => {
          const source = context.createBufferSource();
          source.buffer = chunk.buffer;
          source.connect(session.gain);
          source.onended = () => {
            source.disconnect();
            if (--remaining === 0 && speechIsCurrent(session)) stopCurrentAudio(false);
          };
          session.sources.push(source);
          source.start(cursor, chunk.bounds.offset, chunk.bounds.duration);
          const next = decoded[index + 1];
          cursor += chunk.bounds.duration + (next ? Math.max(0, chunk.pause - chunk.bounds.trailing - next.bounds.leading) : 0);
        });
        session.gain.gain.setValueAtTime(1, Math.max(session.startsAt + 0.012, cursor - 0.012));
        session.gain.gain.linearRampToValueAtTime(0, cursor);
        updateSpeechMeter(session);
      }
      clearTimeout(session.timeout);
      session.loading = false;
      setVoiceButton(btn, "Pause voice");
    } catch (error) {
      if (!speechIsCurrent(session) || error.name === "AbortError") return;
      const status = error.status;
      stopCurrentAudio(false);
      // Never fall back to a robotic system voice or bypass an auth/rate error.
      const message = status === 401 ? "Sign in again to use voice."
        : status === 429 ? "Voice limit reached. Wait a minute, then retry."
        : status === 422 ? "This passage has no readable speech or is too long."
        : "Neural voice is unavailable. Tap Listen to retry; no system voice was substituted.";
      showToast(message, "error");
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

  function finishFeatureLoad(state, request) {
    if (request.ticket != null) {
      request.skeleton.clear(request.host, request.ticket);
      request.ticket = null;
    }
    if (state.pending === request) state.pending = null;
  }

  function cancelFeatureLoad(state) {
    state.sequence += 1;
    if (state.pending) finishFeatureLoad(state, state.pending);
  }

  function beginFeatureLoad(state, host, topic, language) {
    cancelFeatureLoad(state);
    const request = { sequence: state.sequence, host, topic, language, ticket: null, skeleton: window.CMSkeleton };
    state.pending = request;
    return request;
  }

  function showFeatureLoading(request, label) {
    if (request.host && typeof request.skeleton?.show === "function" && typeof request.skeleton?.clear === "function") {
      request.ticket = request.skeleton.show(request.host, 3, label);
    }
  }

  function isCurrentFeatureLoad(state, request) {
    return state.pending === request && state.sequence === request.sequence &&
      activeTopic === request.topic && activeLanguage === request.language;
  }

  function clearFeatureError(host) {
    if (!host) return;
    const error = featureErrors.get(host);
    if (!error) return;
    error.notice.remove();
    error.hiddenChildren.forEach((child) => child.classList.remove("hidden"));
    featureErrors.delete(host);
  }

  function showFeatureError(host, message, actions, hideContent = false) {
    if (!host) return;
    clearFeatureError(host);
    const hiddenChildren = hideContent ? Array.from(host.children).filter((child) => !child.classList.contains("hidden")) : [];
    hiddenChildren.forEach((child) => child.classList.add("hidden"));
    const notice = document.createElement("div");
    notice.className = "cm-feature-error space-y-3 text-sm";
    notice.setAttribute("role", "alert");
    const text = document.createElement("p");
    text.textContent = message;
    notice.appendChild(text);
    const buttons = document.createElement("div");
    buttons.className = "flex flex-wrap gap-2";
    actions.forEach(({ label, onClick }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "px-4 py-2 rounded-xl glass border border-white/10 text-xs font-bold hover:bg-white/10 transition cursor-pointer";
      button.textContent = label;
      button.addEventListener("click", onClick);
      buttons.appendChild(button);
    });
    notice.appendChild(buttons);
    host.prepend(notice);
    featureErrors.set(host, { notice, hiddenChildren });
  }

  async function loadExamCheatSheet(forceRegenerate = false) {
    const emptyState = document.getElementById("examNoTopicEmptyState");
    const content = document.getElementById("examSheetContentContainer");

    if (!hasActiveTopic()) {
      cancelFeatureLoad(examLoadState);
      clearFeatureError(content);
      if (emptyState) emptyState.classList.remove("hidden");
      if (content) content.classList.add("hidden");
      return;
    }

    const requestedTopic = activeTopic;
    const requestedLanguage = activeLanguage;
    if (emptyState) emptyState.classList.add("hidden");
    if (content) content.classList.remove("hidden");
    if (examLoadState.pending?.topic === requestedTopic && examLoadState.pending.language === requestedLanguage) return;
    cancelFeatureLoad(examLoadState);
    clearFeatureError(content);

    const title = document.getElementById("examSheetTopicTitle");
    if (title) title.textContent = `${requestedTopic} Cheat Sheet`;
    const cached = examLoadState.languages.get(requestedTopic) === requestedLanguage ? cachedCheatSheets[requestedTopic] : null;
    if (!forceRegenerate && cached) {
      renderExamCheatSheetData(cached);
      return;
    }

    const request = beginFeatureLoad(examLoadState, content, requestedTopic, requestedLanguage);
    try {
      showFeatureLoading(request, `Generating cheat sheet for ${requestedTopic}`);
      const res = await fetch("/api/exam-cheat-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gemini-Key": localStorage.getItem("clearmind_gemini_key") || "" },
        body: JSON.stringify({
          topic: requestedTopic,
          language: requestedLanguage,
          level: studentProfile.level || "College / University"
        })
      });

      if (!res.ok) throw new Error("Cheat sheet request failed");
      const d = await res.json();
      if (!isCurrentFeatureLoad(examLoadState, request)) return;
      if (!d || typeof d !== "object" || Array.isArray(d) || d.error || !Object.keys(d).length) {
        throw new Error("No cheat sheet was returned");
      }
      renderExamCheatSheetData(d);
      cachedCheatSheets[requestedTopic] = d;
      examLoadState.languages.set(requestedTopic, requestedLanguage);

      // Award XP once per session for this topic
      if (!awardedCheatSheetTopics.has(requestedTopic)) {
        awardedCheatSheetTopics.add(requestedTopic);
        addXP(50);
        bumpStreak();
        playSound("fanfare");
        if (typeof confetti === "function") {
          confetti({ particleCount: 50, spread: 60, origin: { y: 0.5 } });
        }
        showToast("Real Exam Cheat Sheet Generated! +50 XP Earned", "success");
      }
    } catch (e) {
      if (!isCurrentFeatureLoad(examLoadState, request)) return;
      console.warn("Cheat sheet error:", e);
      if (cached) renderExamCheatSheetData(cached);
      showFeatureError(content, cached ? "Could not refresh this cheat sheet. Your previous sheet is still available." : "Could not generate this cheat sheet. Please try again.", [
        { label: "Retry", onClick: () => loadExamCheatSheet(true) },
        { label: "Back to canvas", onClick: () => window.switchCanvasTab("live") }
      ], !cached);
    } finally {
      finishFeatureLoad(examLoadState, request);
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
    if (blitzState.isRunning && blitzState.topic === activeTopic && blitzState.language === activeLanguage) return;
    cancelFeatureLoad(blitzLoadState);
    clearInterval(blitzState.timerInterval);
    blitzState.timerInterval = null;
    blitzState.isRunning = false;
    const setupScreen = document.getElementById("blitzSetupScreen");
    const activeScreen = document.getElementById("blitzActiveScreen");
    clearFeatureError(activeScreen);
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
      cancelFeatureLoad(blitzLoadState);
      showToast("Please decide or select a test topic before entering the Arena!", "warning");
      playSound("error");
      const inp = document.getElementById("blitzCustomTopicInput");
      if (inp) {
        inp.focus();
        inp.classList.add("ring-2", "ring-rose-500");
        setTimeout(() => inp.classList.remove("ring-2", "ring-rose-500"), 2000);
      }
      return;
    }

    const requestedTopic = activeTopic;
    const requestedLanguage = activeLanguage;
    const requestedCount = blitzConfig.questionCount;
    const requestedTimeLimit = blitzConfig.timeLimit;
    if (blitzLoadState.pending?.topic === requestedTopic && blitzLoadState.pending.language === requestedLanguage) return;
    if (blitzState.isRunning && blitzState.topic === requestedTopic && blitzState.language === requestedLanguage) return;

    clearInterval(blitzState.timerInterval);
    blitzState.timerInterval = null;
    blitzState.isRunning = false;
    blitzState.score = 0;
    blitzState.combo = 1;
    blitzState.timeLeft = requestedTimeLimit;
    blitzState.currentQuestionIdx = 0;
    blitzState.questions = [];

    const setupScreen = document.getElementById("blitzSetupScreen");
    const activeScreen = document.getElementById("blitzActiveScreen");
    if (setupScreen) setupScreen.classList.add("hidden");
    if (activeScreen) activeScreen.classList.remove("hidden");
    clearFeatureError(activeScreen);

    const tmDisp = document.getElementById("blitzTimerDisplay");
    const scNum = document.getElementById("blitzScoreNum");
    const cbBadge = document.getElementById("blitzComboBadge");
    const qIdx = document.getElementById("blitzQuestionIdx");
    const qTotal = document.getElementById("blitzTotalQuestions");
    if (tmDisp) tmDisp.textContent = formatTimerString(blitzState.timeLeft);
    if (scNum) scNum.textContent = "0";
    if (cbBadge) cbBadge.textContent = "1x COMBO";
    if (qIdx) qIdx.textContent = "1";
    if (qTotal) qTotal.textContent = String(requestedCount);

    const request = beginFeatureLoad(blitzLoadState, document.getElementById("blitzQuestionCard"), requestedTopic, requestedLanguage);
    try {
      showFeatureLoading(request, `Preparing ${requestedCount} questions for ${requestedTopic}`);
      const res = await fetch("/api/blitz-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gemini-Key": localStorage.getItem("clearmind_gemini_key") || "" },
        body: JSON.stringify({
          topic: requestedTopic,
          language: requestedLanguage,
          num_questions: requestedCount,
          time_limit_seconds: requestedTimeLimit
        })
      });
      if (!res.ok) throw new Error("Blitz request failed");
      const d = await res.json();
      if (!isCurrentFeatureLoad(blitzLoadState, request)) return;
      if (!Array.isArray(d?.questions) || !d.questions.length || !d.questions.every((question) =>
        question && typeof question.question === "string" && question.question.trim() &&
        Array.isArray(question.options) && question.options.length >= 2 &&
        question.options.every((option) => typeof option === "string" && option.trim()) &&
        Number.isInteger(question.correct_index) && question.correct_index >= 0 && question.correct_index < question.options.length
      )) {
        throw new Error("No valid Blitz questions were returned");
      }
      blitzState.questions = d.questions;
      blitzState.topic = requestedTopic;
      blitzState.language = requestedLanguage;
      blitzState.isRunning = true;
      renderBlitzQuestion();

      // Start a single timer only after the current request has rendered.
      blitzState.timerInterval = setInterval(() => {
        if (blitzLoadState.sequence !== request.sequence || activeTopic !== requestedTopic || activeLanguage !== requestedLanguage) {
          clearInterval(blitzState.timerInterval);
          blitzState.timerInterval = null;
          blitzState.isRunning = false;
          showBlitzSetup();
          return;
        }
        blitzState.timeLeft -= 1;
        if (tmDisp) tmDisp.textContent = formatTimerString(blitzState.timeLeft);
        if (blitzState.timeLeft <= 10) playSound("tick");
        if (blitzState.timeLeft <= 0) endBlitzBattle("timeout");
      }, 1000);
    } catch (e) {
      if (!isCurrentFeatureLoad(blitzLoadState, request)) return;
      console.warn("Blitz error:", e);
      blitzState.isRunning = false;
      blitzState.questions = [];
      showFeatureError(activeScreen, "Could not load questions for this topic. No round has started.", [
        { label: "Retry", onClick: startBlitzBattle },
        { label: "Return to setup", onClick: showBlitzSetup }
      ], true);
    } finally {
      finishFeatureLoad(blitzLoadState, request);
    }
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
        ${(Array.isArray(q.options) ? q.options : [])
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

    const roundSequence = blitzLoadState.sequence;
    setTimeout(() => {
      if (!blitzState.isRunning || roundSequence !== blitzLoadState.sequence) return;
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
      cancelFeatureLoad(flashcardsLoadState);
      clearFeatureError(content);
      flashcardState.deck = [];
      if (emptyState) emptyState.classList.remove("hidden");
      if (content) content.classList.add("hidden");
      return;
    }

    const requestedTopic = activeTopic;
    const requestedLanguage = activeLanguage;
    if (emptyState) emptyState.classList.add("hidden");
    if (content) content.classList.remove("hidden");
    if (flashcardsLoadState.pending?.topic === requestedTopic && flashcardsLoadState.pending.language === requestedLanguage) return;
    cancelFeatureLoad(flashcardsLoadState);
    clearFeatureError(content);

    const topicBadge = document.getElementById("flashcardDeckTopicBadge");
    if (topicBadge) topicBadge.textContent = requestedTopic;
    const cached = flashcardsLoadState.languages.get(requestedTopic) === requestedLanguage ? flashcardState.cachedDecks[requestedTopic] : null;
    if (cached?.length && (!forceRegenerate || !flashcardState.deck.length || flashcardState.topic !== requestedTopic || flashcardState.language !== requestedLanguage)) {
      flashcardState.deck = cached;
      flashcardState.topic = requestedTopic;
      flashcardState.language = requestedLanguage;
      flashcardState.currentIndex = 0;
      renderCurrentFlashcard();
      if (!forceRegenerate) return;
    }
    if (flashcardState.topic !== requestedTopic || flashcardState.language !== requestedLanguage) {
      flashcardState.deck = [];
      flashcardState.currentIndex = 0;
    }
    const previousDeck = flashcardState.deck;
    const previousIndex = flashcardState.currentIndex;

    const request = beginFeatureLoad(flashcardsLoadState, content, requestedTopic, requestedLanguage);
    try {
      showFeatureLoading(request, `Generating flashcards for ${requestedTopic}`);
      const res = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gemini-Key": localStorage.getItem("clearmind_gemini_key") || "" },
        body: JSON.stringify({
          topic: requestedTopic,
          language: requestedLanguage,
          count: 6
        })
      });

      if (!res.ok) throw new Error("Flashcards request failed");
      const d = await res.json();
      if (!isCurrentFeatureLoad(flashcardsLoadState, request)) return;
      if (!Array.isArray(d?.cards) || !d.cards.length || !d.cards.every((card) =>
        card && typeof card.front === "string" && card.front.trim() && typeof card.back === "string" && card.back.trim()
      )) {
        throw new Error("No valid flashcards were returned");
      }
      flashcardState.deck = d.cards;
      flashcardState.topic = requestedTopic;
      flashcardState.language = requestedLanguage;
      flashcardState.currentIndex = 0;
      renderCurrentFlashcard();
      flashcardState.cachedDecks[requestedTopic] = d.cards;
      flashcardsLoadState.languages.set(requestedTopic, requestedLanguage);
      showToast("3D Flashcard Deck Calibrated!", "success");
    } catch (e) {
      if (!isCurrentFeatureLoad(flashcardsLoadState, request)) return;
      console.warn("Flashcards error:", e);
      flashcardState.deck = previousDeck;
      flashcardState.currentIndex = previousIndex;
      if (previousDeck.length) renderCurrentFlashcard();
      showFeatureError(content, previousDeck.length ? "Could not refresh your flashcards. Your previous deck is still available." : "Could not load flashcards for this topic. Please try again.", [
        { label: "Retry", onClick: () => loadFlashcardsDeck(true) },
        { label: "Back to canvas", onClick: () => window.switchCanvasTab("live") }
      ], !previousDeck.length);
    } finally {
      finishFeatureLoad(flashcardsLoadState, request);
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

    const reviewedDeck = flashcardState.deck;
    const reviewSequence = flashcardsLoadState.sequence;
    setTimeout(() => {
      if (reviewSequence !== flashcardsLoadState.sequence || flashcardState.deck !== reviewedDeck || !reviewedDeck.length) return;
      flashcardState.currentIndex = (flashcardState.currentIndex + 1) % reviewedDeck.length;
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

    const displayName = studentProfile.name || "Student";
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

    renderHeatmap();
    renderJourneyMilestones();
    renderConceptDependencyGraph();
  }

  function renderDailyMissions() {
    // Missions removed from Analytics
  }

  window.claimMissionXP = function() {
    // No-op
  };

  function renderPredictedToFade() {
    // Predicted to Fade removed from Analytics
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
  // 2D TOPIC PREREQUISITE & MASTERY DEPENDENCY TREE CONTROLLER
  // =========================================================================
  let dependencyTreeState = {
    selectedNodeId: null,
    activeCategory: "all"
  };

  function initDependencyTreeWorkspace() {
    // 1-Click Action: Ask Luna in Classroom
    const startSocraticBtn = document.getElementById("inspectorStartSocraticBtn");
    if (startSocraticBtn) {
      startSocraticBtn.onclick = () => {
        const concepts = CognitiveEngine.loadConcepts();
        const found = concepts.find((c) => c.id === dependencyTreeState.selectedNodeId) || concepts[0];
        if (found) {
          activeTopic = found.name;
          localStorage.setItem("clearmind_active_topic", activeTopic);
          const chatTopic = document.getElementById("chatActiveTopic");
          if (chatTopic) chatTopic.textContent = activeTopic;
          window.navigateToPage("classroom");
          if (typeof window.askLunaStep === "function") {
            window.askLunaStep(`Explain the core intuition and foundational prerequisites for ${found.name}`);
          }
        } else {
          window.navigateToPage("classroom");
        }
      };
    }

    // 1-Click Action: Practice in Flashcards
    const reviewBtn = document.getElementById("inspectorReviewBtn");
    if (reviewBtn) {
      reviewBtn.onclick = () => {
        if (dependencyTreeState.selectedNodeId) {
          const concepts = CognitiveEngine.loadConcepts();
          const found = concepts.find((c) => c.id === dependencyTreeState.selectedNodeId);
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

    // Initial render
    renderConceptDependencyGraph();
  }

  function updateDependencyCategoryFilters(allConcepts) {
    const filtersContainer = document.getElementById("graphCategoryFilters");
    if (!filtersContainer) return;

    const categories = Array.from(new Set(allConcepts.map((c) => c.category || "General").filter(Boolean)));
    if (categories.length === 0) {
      filtersContainer.innerHTML = `<button data-cat="all" class="graph-cat-btn px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-obsidian-950 transition cursor-pointer">All</button>`;
      return;
    }

    let filterHtml = `
      <button data-cat="all" class="graph-cat-btn px-2.5 py-1 rounded-lg text-xs font-bold ${
        dependencyTreeState.activeCategory === "all" ? "bg-white text-obsidian-950" : "bg-obsidian-850 text-slate-300 hover:text-white"
      } transition cursor-pointer">All</button>
    `;

    categories.forEach((cat) => {
      const isActive = dependencyTreeState.activeCategory.toLowerCase() === cat.toLowerCase();
      filterHtml += `
        <button data-cat="${escapeHtml(cat)}" class="graph-cat-btn px-2.5 py-1 rounded-lg text-xs font-bold ${
          isActive ? "bg-white text-obsidian-950" : "bg-obsidian-850 text-slate-300 hover:text-white"
        } transition cursor-pointer">${escapeHtml(cat)}</button>
      `;
    });

    filtersContainer.innerHTML = filterHtml;

    filtersContainer.querySelectorAll(".graph-cat-btn").forEach((btn) => {
      btn.onclick = () => {
        const cat = btn.getAttribute("data-cat") || "all";
        dependencyTreeState.activeCategory = cat;
        filtersContainer.querySelectorAll(".graph-cat-btn").forEach((b) => {
          b.className = "graph-cat-btn px-2.5 py-1 rounded-lg text-xs font-bold bg-obsidian-850 text-slate-300 hover:text-white transition cursor-pointer";
        });
        btn.className = "graph-cat-btn px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-obsidian-950 transition cursor-pointer";
        renderConceptDependencyGraph();
      };
    });
  }

  function renderConceptDependencyGraph() {
    const svg = document.getElementById("knowledgeGraphSvg");
    const countBadge = document.getElementById("graphNodeCountBadge");
    if (!svg) return;

    const allConcepts = CognitiveEngine.loadConcepts();
    if (!allConcepts || allConcepts.length === 0) {
      svg.innerHTML = `
        <text x="500" y="320" text-anchor="middle" fill="rgba(255,255,255,0.35)" font-size="14" font-weight="600" font-family="'Plus Jakarta Sans', sans-serif">
          No concepts loaded yet. Complete onboarding or set your syllabus to generate your dependency tree.
        </text>
      `;
      if (countBadge) countBadge.textContent = "0 Nodes";
      return;
    }

    // Advance quest: Concept Mastery & Dependency Exploration
    const missions = CognitiveEngine.loadMissions();
    const m5 = missions.find((m) => m.id === "m5");
    if (m5 && !m5.done && m5.progress < 1) {
      m5.progress = 1;
      CognitiveEngine.saveMissions(missions);
      CognitiveEngine.completeMission("m5");
    }

    updateDependencyCategoryFilters(allConcepts);

    const activeCat = (dependencyTreeState.activeCategory || "all").toLowerCase();
    const filtered = activeCat === "all"
      ? allConcepts
      : allConcepts.filter((c) => (c.category || "").toLowerCase() === activeCat);

    if (countBadge) countBadge.textContent = `${filtered.length} Nodes`;

    if (filtered.length === 0) {
      svg.innerHTML = `
        <text x="500" y="320" text-anchor="middle" fill="rgba(255,255,255,0.35)" font-size="14" font-weight="600" font-family="'Plus Jakarta Sans', sans-serif">
          No concepts found for category "${escapeHtml(dependencyTreeState.activeCategory)}".
        </text>
      `;
      return;
    }

    // Topological Depth DAG Layout
    const nodeMap = new Map();
    filtered.forEach((c) => {
      nodeMap.set(c.id, {
        ...c,
        inPrereqs: [],
        outDependents: [],
        depth: 0
      });
    });

    // Build directed adjacency: if A is in B's connections, A is prerequisite for B (A -> B)
    filtered.forEach((c) => {
      const prereqs = c.connections || [];
      prereqs.forEach((pId) => {
        if (nodeMap.has(pId) && pId !== c.id) {
          nodeMap.get(pId).outDependents.push(c.id);
          nodeMap.get(c.id).inPrereqs.push(pId);
        }
      });
    });

    // Calculate depth iteratively
    let changed = true;
    let iter = 0;
    while (changed && iter < 12) {
      changed = false;
      iter++;
      filtered.forEach((c) => {
        const node = nodeMap.get(c.id);
        if (!node) return;
        let maxPDepth = -1;
        node.inPrereqs.forEach((pId) => {
          const p = nodeMap.get(pId);
          if (p && p.depth > maxPDepth) {
            maxPDepth = p.depth;
          }
        });
        if (maxPDepth !== -1 && node.depth !== maxPDepth + 1) {
          node.depth = maxPDepth + 1;
          changed = true;
        }
      });
    }

    const maxDepth = Math.max(0, ...Array.from(nodeMap.values()).map((n) => n.depth));
    const depthGroups = {};
    for (let d = 0; d <= maxDepth; d++) depthGroups[d] = [];
    nodeMap.forEach((n) => {
      depthGroups[n.depth].push(n);
    });

    // Position nodes along X (depth) and Y (spread within depth)
    const leftMargin = 120;
    const rightMargin = 880;
    const topMargin = 90;
    const bottomMargin = 590;
    const widthSpan = maxDepth > 0 ? (rightMargin - leftMargin) / maxDepth : 0;

    for (let d = 0; d <= maxDepth; d++) {
      const group = depthGroups[d];
      const x = maxDepth === 0 ? 500 : leftMargin + d * widthSpan;
      const count = group.length;
      group.forEach((node, idx) => {
        const y = count === 1 ? 340 : topMargin + (idx / (count - 1)) * (bottomMargin - topMargin);
        node.x = Math.round(x);
        node.y = Math.round(y);
        node.retention = CognitiveEngine.currentRetention(node);
        node.radius = 22;
      });
    }

    // Render SVG Defs (Markers for directed prerequisite arrows)
    let svgDefs = `
      <defs>
        <marker id="arrowhead-normal" markerWidth="8" markerHeight="6" refX="28" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="rgba(168, 85, 247, 0.6)" />
        </marker>
        <marker id="arrowhead-highlight" markerWidth="8" markerHeight="6" refX="28" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#c084fc" />
        </marker>
        <marker id="arrowhead-weak" markerWidth="8" markerHeight="6" refX="28" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#f43f5e" />
        </marker>
      </defs>
    `;

    // Render Edges (Prerequisite Directed Flow)
    let edgesSvg = "";
    nodeMap.forEach((node) => {
      node.inPrereqs.forEach((pId) => {
        const prereq = nodeMap.get(pId);
        if (!prereq) return;

        const isWeakGap = prereq.retention < 0.4;
        const isHighlighted = dependencyTreeState.selectedNodeId &&
          (dependencyTreeState.selectedNodeId === node.id || dependencyTreeState.selectedNodeId === prereq.id);

        let strokeColor = "rgba(255, 255, 255, 0.15)";
        let strokeWidth = 1.5;
        let markerId = "arrowhead-normal";
        let strokeDash = "";

        if (isWeakGap) {
          strokeColor = "rgba(244, 63, 94, 0.75)";
          strokeWidth = 2;
          markerId = "arrowhead-weak";
          strokeDash = 'stroke-dasharray="4,4" class="dependency-edge"';
        } else if (isHighlighted) {
          strokeColor = "rgba(192, 132, 252, 0.9)";
          strokeWidth = 2.5;
          markerId = "arrowhead-highlight";
        }

        const midX = (prereq.x + node.x) / 2;
        edgesSvg += `
          <path d="M ${prereq.x} ${prereq.y} C ${midX} ${prereq.y}, ${midX} ${node.y}, ${node.x} ${node.y}"
                fill="none"
                stroke="${strokeColor}"
                stroke-width="${strokeWidth}"
                marker-end="url(#${markerId})"
                ${strokeDash} />
        `;
      });
    });

    // Render Nodes
    let nodesSvg = "";
    nodeMap.forEach((n) => {
      const isSelected = dependencyTreeState.selectedNodeId === n.id;
      const isConnected = dependencyTreeState.selectedNodeId
        ? (n.inPrereqs.includes(dependencyTreeState.selectedNodeId) || n.outDependents.includes(dependencyTreeState.selectedNodeId))
        : false;

      const opacity = dependencyTreeState.selectedNodeId && !isSelected && !isConnected ? 0.35 : 1;
      const isWeak = n.retention < 0.4;
      const isMastered = n.retention >= 0.7;

      // Status indicator ring color
      const statusColor = isWeak ? "#f43f5e" : isMastered ? "#10b981" : "#f59e0b";
      const weakClass = isWeak ? 'class="animate-weak-node"' : "";

      nodesSvg += `
        <g style="opacity:${opacity}; cursor:pointer;" onclick="selectDependencyNode('${n.id}')">
          <!-- Background Glow -->
          <circle cx="${n.x}" cy="${n.y}" r="${n.radius + 10}" fill="${statusColor}" opacity="${isSelected ? '0.35' : isWeak ? '0.25' : '0.12'}" filter="blur(8px)" />
          
          <!-- Outer Status Ring -->
          <circle cx="${n.x}" cy="${n.y}" r="${n.radius + 4}" fill="none" stroke="${statusColor}" stroke-width="${isSelected ? '2.5' : '1.5'}" stroke-dasharray="${isWeak ? '3,3' : 'none'}" ${weakClass} />

          <!-- Core Node Circle -->
          <circle cx="${n.x}" cy="${n.y}" r="${n.radius}" fill="${n.color || '#8b5cf6'}" stroke="${isSelected ? '#ffffff' : 'rgba(255,255,255,0.4)'}" stroke-width="${isSelected ? 3 : 1.5}" />

          <!-- Inner Retention Progress Arc/Dot -->
          <circle cx="${n.x + n.radius - 6}" cy="${n.y - n.radius + 6}" r="4.5" fill="${statusColor}" stroke="#0b0f19" stroke-width="1.5" />

          <!-- Label -->
          <text x="${n.x}" y="${n.y + n.radius + 16}" text-anchor="middle" fill="${isSelected ? '#ffffff' : 'rgba(255,255,255,0.85)'}" font-size="11" font-weight="${isSelected ? '800' : '700'}" font-family="'Plus Jakarta Sans', sans-serif">
            ${escapeHtml(n.name)}
          </text>
        </g>
      `;
    });

    svg.innerHTML = svgDefs + edgesSvg + nodesSvg;

    // Auto-select or inspect node
    if (dependencyTreeState.selectedNodeId && nodeMap.has(dependencyTreeState.selectedNodeId)) {
      updateDependencyInspector(nodeMap.get(dependencyTreeState.selectedNodeId), allConcepts);
    } else if (filtered.length > 0) {
      // Find the first weak node or default to the first node
      const firstWeak = Array.from(nodeMap.values()).find((n) => n.retention < 0.4);
      const chosen = firstWeak || filtered[0];
      dependencyTreeState.selectedNodeId = chosen.id;
      updateDependencyInspector(nodeMap.get(chosen.id) || chosen, allConcepts);
    }
  }

  window.selectDependencyNode = function(id) {
    const allConcepts = CognitiveEngine.loadConcepts();
    const node = allConcepts.find((c) => c.id === id);
    if (!node) return;
    dependencyTreeState.selectedNodeId = id;
    renderConceptDependencyGraph();
    updateDependencyInspector(node, allConcepts);
    playSound("click");
  };

  // Backwards compatibility aliases
  window.selectGraphNode = window.selectDependencyNode;
  window.selectGalaxyConcept = window.selectDependencyNode;

  function updateDependencyInspector(node, allConcepts) {
    const nameEl = document.getElementById("inspectorNodeName");
    const catEl = document.getElementById("inspectorNodeCategory");
    const diagBanner = document.getElementById("inspectorDiagnosticBanner");
    const diagIcon = document.getElementById("inspectorDiagIcon");
    const diagTitle = document.getElementById("inspectorDiagTitle");
    const diagMsg = document.getElementById("inspectorDiagMessage");

    const retVal = document.getElementById("inspectorRetentionVal");
    const retBar = document.getElementById("inspectorRetentionBar");
    const strVal = document.getElementById("inspectorStrengthVal");
    const strBar = document.getElementById("inspectorStrengthBar");
    const revVal = document.getElementById("inspectorReviewsVal");
    const conVal = document.getElementById("inspectorConnectionsVal");
    const pillsEl = document.getElementById("inspectorLinkedPills");

    if (!node) return;
    const r = CognitiveEngine.currentRetention(node);
    const strength = node.strength !== undefined ? node.strength : 0.5;

    if (nameEl) nameEl.textContent = node.name;
    if (catEl) catEl.textContent = `Domain: ${node.category || "General"} • Ebbinghaus memory decay modeling active.`;

    if (retVal) {
      const statusLabel = r < 0.4 ? "Prerequisite Gap" : r < 0.7 ? "Developing" : "Mastered";
      retVal.textContent = `${Math.round(r * 100)}% (${statusLabel})`;
    }
    if (retBar) retBar.style.width = `${Math.round(r * 100)}%`;

    if (strVal) strVal.textContent = `${Math.round(strength * 100)}%`;
    if (strBar) strBar.style.width = `${Math.round(strength * 100)}%`;

    if (revVal) revVal.textContent = String(node.reviews || 0);

    const directPrereqs = (node.connections || []).map((pId) => allConcepts.find((x) => x.id === pId)).filter(Boolean);
    if (conVal) conVal.textContent = String(directPrereqs.length);

    // Prerequisite Gap Diagnosis
    const weakPrereq = directPrereqs.find((p) => CognitiveEngine.currentRetention(p) < 0.4);
    if (weakPrereq) {
      const pRet = Math.round(CognitiveEngine.currentRetention(weakPrereq) * 100);
      if (diagBanner) diagBanner.className = "p-3 rounded-xl bg-rose-950/60 border border-rose-800/80 text-[11px] space-y-1";
      if (diagIcon) diagIcon.textContent = "⚠️";
      if (diagTitle) {
        diagTitle.textContent = "Prerequisite Gap Detected!";
        diagTitle.className = "font-bold text-rose-300";
      }
      if (diagMsg) {
        diagMsg.innerHTML = `Foundational prerequisite <strong>${escapeHtml(weakPrereq.name)}</strong> has decayed to <strong>${pRet}%</strong> retention. Master it first before attempting <strong>${escapeHtml(node.name)}</strong>.`;
        diagMsg.className = "text-rose-200 text-[10px] leading-relaxed";
      }
    } else if (r < 0.4) {
      if (diagBanner) diagBanner.className = "p-3 rounded-xl bg-amber-950/60 border border-amber-800/80 text-[11px] space-y-1";
      if (diagIcon) diagIcon.textContent = "📉";
      if (diagTitle) {
        diagTitle.textContent = "Cognitive Decay Alert";
        diagTitle.className = "font-bold text-amber-300";
      }
      if (diagMsg) {
        diagMsg.innerHTML = `Memory trace for <strong>${escapeHtml(node.name)}</strong> is weakening (${Math.round(r * 100)}%). Ask Luna for an intuitive refresher or review via flashcards.`;
        diagMsg.className = "text-amber-200 text-[10px] leading-relaxed";
      }
    } else if (r >= 0.7) {
      if (diagBanner) diagBanner.className = "p-3 rounded-xl bg-emerald-950/50 border border-emerald-800/60 text-[11px] space-y-1";
      if (diagIcon) diagIcon.textContent = "✅";
      if (diagTitle) {
        diagTitle.textContent = "Prerequisites Solid";
        diagTitle.className = "font-bold text-emerald-300";
      }
      if (diagMsg) {
        diagMsg.innerHTML = `Foundational mastery is rock solid (${Math.round(r * 100)}%). Ready for advanced derivations and blitz battle!`;
        diagMsg.className = "text-emerald-200 text-[10px] leading-relaxed";
      }
    } else {
      if (diagBanner) diagBanner.className = "p-3 rounded-xl bg-purple-950/40 border border-purple-800/40 text-[11px] space-y-1";
      if (diagIcon) diagIcon.textContent = "🌱";
      if (diagTitle) {
        diagTitle.textContent = "Developing Mastery";
        diagTitle.className = "font-bold text-purple-300";
      }
      if (diagMsg) {
        diagMsg.innerHTML = `Concept is progressing well (${Math.round(r * 100)}%). Reinforce with 1-2 practice reviews.`;
        diagMsg.className = "text-slate-300 text-[10px] leading-relaxed";
      }
    }

    // Direct Prerequisite Pills
    if (pillsEl) {
      if (!directPrereqs.length) {
        pillsEl.innerHTML = '<span class="text-xs text-slate-500 italic">No foundational prerequisites (Root Concept)</span>';
      } else {
        pillsEl.innerHTML = directPrereqs.map((prereq) => {
          const pR = CognitiveEngine.currentRetention(prereq);
          const dotColor = pR < 0.4 ? "#f43f5e" : pR < 0.7 ? "#f59e0b" : "#10b981";
          return `
            <button onclick="selectDependencyNode('${prereq.id}')" class="px-2.5 py-1 bg-obsidian-900 hover:bg-obsidian-800 border border-obsidian-750 text-xs font-bold text-slate-300 rounded-lg flex items-center gap-1.5 transition cursor-pointer">
              <span class="w-1.5 h-1.5 rounded-full" style="background:${dotColor}"></span>
              ${escapeHtml(prereq.name)}
            </button>
          `;
        }).join("");
      }
    }
  }

  // =========================================================================
  // 3D MOTION CONCEPT STUDIO (SIGNBRIDGE AI INSPIRED)
  // Real-Time Spatial Kinematics & Socratic Simulation Engine
  // =========================================================================
  const MOTION_MODELS = {
    dna: {
      id: "dna",
      tag: "DNA_DOUBLE_HELIX",
      title: "DNA Double Helix Unwinding & Replication",
      domain: "Molecular Biology & Genetics",
      summary: "Spatial visualization of right-handed B-DNA unwinding by helicase enzyme at the replication fork.",
      formulaTag: "Watson-Crick & Chargaff Axiom",
      formulaKatex: "\\text{bp} = \\{A \\cdot\\cdot T, \\; G \\cdot\\cdot\\cdot C\\}, \\quad \\Delta G^{\\circ}_{\\text{unwind}} > 0",
      lunaInsight: "Notice how the A-T pair has only 2 hydrogen bonds, whereas G-C has 3! That's why helicase unzips DNA much faster at A-T rich promoter sites like the TATA box.",
      speechText: "DNA is a right-handed double helix. Nitrogenous base pairs Adenine-Thymine and Guanine-Cytosine are bound by hydrogen bonds at the core. As helicase advances, it unzips the strands to form the replication fork.",
      phases: [
        {
          num: 1,
          title: "Double Helix Architecture",
          desc: "Intact 3D antiparallel strands with 10 base-pairs per helical turn and major/minor grooves.",
          transcript: "Phase 1: Intact right-handed B-DNA double helix. Antiparallel sugar-phosphate backbones wind around base pairs."
        },
        {
          num: 2,
          title: "Helicase Cleavage & Unzipping",
          desc: "Helicase enzyme cleaves weak hydrogen bonds between complementary nucleotides from the 5' to 3' fork.",
          transcript: "Phase 2: Helicase breaks hydrogen bonds. Notice the strands pulling apart into a distinct Y-shaped replication fork."
        },
        {
          num: 3,
          title: "Template Stabilization",
          desc: "Single-stranded binding proteins stabilize open strands, preparing templates for DNA Polymerase III synthesis.",
          transcript: "Phase 3: Separated single strands are stabilized as templates for leading and lagging strand synthesis."
        }
      ]
    },
    motor: {
      id: "motor",
      tag: "DC_MOTOR_LORENTZ",
      title: "DC Electric Motor & Magnetic Torque",
      domain: "Electromagnetism & Mechanics",
      summary: "Visualizing Fleming's Left-Hand Rule, magnetic flux lines, and continuous torque rotation.",
      formulaTag: "Lorentz Force & Biot-Savart Law",
      formulaKatex: "\\vec{F} = I (\\vec{L} \\times \\vec{B}), \\quad \\tau = N I A B \\sin\\theta",
      lunaInsight: "At perpendicular angles (90°), torque is maximized (sin 90° = 1). The split-ring commutator reverses current every 180° so the coil keeps spinning in one direction without stalling!",
      speechText: "In a DC motor, magnetic flux flows from North to South. By Fleming's Left Hand Rule, current in the wire loop generates magnetic forces that produce continuous rotational torque.",
      phases: [
        {
          num: 1,
          title: "Uniform Magnetic Flux Field",
          desc: "Static magnetic B-field lines stream steadily from the North pole (Red) to the South pole (Blue).",
          transcript: "Phase 1: Uniform magnetic flux lines span between North and South poles across the central armature."
        },
        {
          num: 2,
          title: "Lorentz Force & Torque Generation",
          desc: "Current traversing opposite coil arms experiences equal and opposite magnetic forces: F = I(L × B).",
          transcript: "Phase 2: Current flows through the coil. Opposite vertical forces create a couple that drives rotational torque."
        },
        {
          num: 3,
          title: "Commutator Current Reversal",
          desc: "As the coil passes perpendicular inertia, the split-ring commutator flips current direction to prevent counter-torque.",
          transcript: "Phase 3: The commutator flips current at 180 degrees, keeping rotation unidirectional and smooth."
        }
      ]
    },
    electron: {
      id: "electron",
      tag: "QUANTUM_WAVE_ORBITAL",
      title: "Quantum Electron Probability Cloud",
      domain: "Quantum Chemistry & Atomic Physics",
      summary: "Spatial probability density |ψ(r, θ, φ)|² of electrons in 1s spherical and 2p dumbbell atomic orbitals.",
      formulaTag: "Schrödinger Wave Equation",
      formulaKatex: "-\\frac{\\hbar^2}{2m}\\nabla^2\\psi + V\\psi = E\\psi, \\quad P(r) = 4\\pi r^2 |\\psi|^2",
      lunaInsight: "Electrons do not orbit like miniature planets! They exist as quantum probability waves. The denser the particle cloud, the higher the probability of finding the electron upon measurement.",
      speechText: "Electrons exist as quantum wavefunctions rather than fixed trajectories. The spatial probability density dictates where the electron is most likely to interact.",
      phases: [
        {
          num: 1,
          title: "Spherical 1s Ground State",
          desc: "Radially symmetric wave with zero angular nodes. Probability density is highest near the atomic nucleus.",
          transcript: "Phase 1: Ground state 1s orbital. Spherically symmetric probability density centered on the dense nucleus."
        },
        {
          num: 2,
          title: "Dumbbell 2p Nodal Plane",
          desc: "Angular momentum (l=1) produces twin lobes with an exact zero-probability nodal plane separating them.",
          transcript: "Phase 2: Excited 2p state with dumbbell lobes. The central nodal plane has zero probability of electron presence."
        },
        {
          num: 3,
          title: "Quantum Wave Superposition",
          desc: "Dynamic phase oscillation showing probability wave breathing and orbital hybridization.",
          transcript: "Phase 3: Quantum wave breathing. Harmonic oscillations illustrate electron orbital transitions."
        }
      ]
    },
    vector: {
      id: "vector",
      tag: "VECTOR_CROSS_PRODUCT",
      title: "3D Vector Cross Product (A × B = C)",
      domain: "Vector Calculus & Spatial Mechanics",
      summary: "Interactive demonstration of C = A × B, Right-Hand Rule orientation, and parallelogram surface area.",
      formulaTag: "Cross Product Determinant",
      formulaKatex: "\\vec{A} \\times \\vec{B} = |\\vec{A}||\\vec{B}|\\sin\\theta \\, \\hat{n} = \\begin{vmatrix} \\hat{i} & \\hat{j} & \\hat{k} \\\\ A_x & A_y & A_z \\\\ B_x & B_y & B_z \\end{vmatrix}",
      lunaInsight: "The magnitude of the cross product equals the area of the parallelogram formed by A and B. When the angle theta is 0 or 180 degrees (parallel vectors), the cross product drops to zero!",
      speechText: "The vector cross product produces a third vector perpendicular to both input vectors, with magnitude equal to the area of the spanned parallelogram.",
      phases: [
        {
          num: 1,
          title: "Coplanar Vectors A & B",
          desc: "Vector A (Cyan) and Vector B (Fuchsia) define a variable plane with angle theta in 3D coordinate space.",
          transcript: "Phase 1: Vectors A (Cyan) and B (Fuchsia) form an angle in 3D space, defining the reference plane."
        },
        {
          num: 2,
          title: "Parallelogram Area Sweep",
          desc: "The shaded planar surface represents magnitude |A||B|sin(theta), dynamically altering with angle sweep.",
          transcript: "Phase 2: The highlighted parallelogram area directly represents the scalar magnitude of the cross product."
        },
        {
          num: 3,
          title: "Right-Hand Orthogonal Vector C",
          desc: "Resultant Vector C (Gold) shoots perpendicularly upward, satisfying the Right-Hand Rule: C = A × B.",
          transcript: "Phase 3: Vector C (Gold) emerges strictly orthogonal to both A and B, governed by the right-hand rule."
        }
      ]
    },
    robot: {
      id: "robot",
      tag: "ROBOTIC_ARM_KINEMATICS",
      title: "3-Axis Articulated Robotic Arm Kinematics",
      domain: "Robotics & Spatial Kinematics",
      summary: "Forward and inverse kinematics with Denavit-Hartenberg parameter matrices across rotational joints.",
      formulaTag: "Denavit-Hartenberg Forward Kinematics",
      formulaKatex: "^{i-1}T_i = \\text{Rot}_z(\\theta_i) \\text{Trans}_z(d_i) \\text{Trans}_x(a_i) \\text{Rot}_x(\\alpha_i)",
      lunaInsight: "Each joint transformation matrix multiplies sequentially: T_03 = T_01 * T_12 * T_23. This computes the exact end-effector gripper position in 3D space!",
      speechText: "Forward kinematics calculates the 3D position of the robot's gripper by multiplying rotation and translation transformation matrices along each joint.",
      phases: [
        {
          num: 1,
          title: "Base Azimuth Yaw Rotation",
          desc: "Pedestal turntable rotates horizontally around the Z-axis, orienting the workspace azimuth (theta 1).",
          transcript: "Phase 1: Base turntable yaw rotation sweeps the entire articulated robotic arm in the azimuth plane."
        },
        {
          num: 2,
          title: "Shoulder Boom Pitch Elevation",
          desc: "Primary shoulder joint modulates pitch angle (theta 2) to overcome gravity and extend reach.",
          transcript: "Phase 2: Shoulder joint elevates the main boom, extending vertical reach and workspace radius."
        },
        {
          num: 3,
          title: "Elbow & End-Effector Trajectory",
          desc: "Forearm joint flexes (theta 3) to orient precision dual-finger claw gripper onto coordinate targets.",
          transcript: "Phase 3: Elbow joint articulates the end-effector gripper along a precision spatial path."
        }
      ]
    }
  };

  let motionStudioState = {
    currentModelKey: "dna",
    isPlaying: true,
    speed: 1.0,
    currentPhaseIndex: 0,
    animTime: 0,
    isInitialized: false,
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    activeModelGroup: null,
    lastFrameTime: performance.now(),
    frameCount: 0,
    lastFpsUpdate: performance.now()
  };

  function initMotionStudio() {
    setupMotionUIControls();
    loadMotionModel(motionStudioState.currentModelKey);

    if (!motionStudioState.isInitialized) {
      initThreeJsEngine();
    }
  }

  function setupMotionUIControls() {
    // Model Selector Tabs
    document.querySelectorAll(".motion-model-btn").forEach((btn) => {
      btn.onclick = () => {
        const modelKey = btn.getAttribute("data-model");
        if (!modelKey || !MOTION_MODELS[modelKey]) return;

        document.querySelectorAll(".motion-model-btn").forEach((b) => {
          b.className = "motion-model-btn px-3 py-1.5 rounded-lg text-xs font-bold text-slate-300 hover:text-white transition cursor-pointer shrink-0";
        });
        btn.className = "motion-model-btn active px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-obsidian-950 shadow-md transition cursor-pointer shrink-0";

        loadMotionModel(modelKey);
        playSound("click");
      };
    });

    // Play / Pause Toggle
    const playPauseBtn = document.getElementById("motionPlayPauseBtn");
    const playPauseIcon = document.getElementById("motionPlayPauseIcon");
    const playPauseLabel = document.getElementById("motionPlayPauseLabel");
    if (playPauseBtn && !playPauseBtn.dataset.wired) {
      playPauseBtn.dataset.wired = "true";
      playPauseBtn.onclick = () => {
        motionStudioState.isPlaying = !motionStudioState.isPlaying;
        if (playPauseIcon) playPauseIcon.textContent = motionStudioState.isPlaying ? "⏸️" : "▶️";
        if (playPauseLabel) playPauseLabel.textContent = motionStudioState.isPlaying ? "Pause" : "Play";
        playSound("click");
      };
    }

    // Speed Controls (0.5x, 1x, 2x)
    document.querySelectorAll(".motion-speed-btn").forEach((btn) => {
      if (!btn.dataset.wired) {
        btn.dataset.wired = "true";
        btn.onclick = () => {
          document.querySelectorAll(".motion-speed-btn").forEach((b) => {
            b.className = "motion-speed-btn px-2 py-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer";
          });
          btn.className = "motion-speed-btn active px-2 py-1 rounded-lg bg-white/15 text-white transition cursor-pointer";
          const spd = parseFloat(btn.getAttribute("data-speed") || "1.0");
          motionStudioState.speed = spd;
          playSound("click");
        };
      }
    });

    // Reset Camera Button
    const resetCamBtn = document.getElementById("motionResetCamBtn");
    if (resetCamBtn && !resetCamBtn.dataset.wired) {
      resetCamBtn.dataset.wired = "true";
      resetCamBtn.onclick = () => {
        if (motionStudioState.camera && motionStudioState.controls) {
          motionStudioState.camera.position.set(0, 2.8, 8.5);
          motionStudioState.controls.target.set(0, 0, 0);
          motionStudioState.controls.update();
          playSound("click");
        }
      };
    }

    // Neural Voice Narration Button
    const speakBtn = document.getElementById("motionSpeakBtn");
    if (speakBtn && !speakBtn.dataset.wired) {
      speakBtn.dataset.wired = "true";
      speakBtn.onclick = () => {
        const model = MOTION_MODELS[motionStudioState.currentModelKey];
        if (model && typeof playLunaVoice === "function") {
          playLunaVoice(model.speechText, speakBtn);
        }
      };
    }

    // Ask Luna in Split Classroom Action Button
    const askClassroomBtn = document.getElementById("motionAskClassroomBtn");
    if (askClassroomBtn && !askClassroomBtn.dataset.wired) {
      askClassroomBtn.dataset.wired = "true";
      askClassroomBtn.onclick = () => {
        const model = MOTION_MODELS[motionStudioState.currentModelKey];
        if (model) {
          activeTopic = model.title;
          localStorage.setItem("clearmind_active_topic", activeTopic);
          const chatTopic = document.getElementById("chatActiveTopic");
          if (chatTopic) chatTopic.textContent = activeTopic;
          window.navigateToPage("classroom");
          if (typeof window.askLunaStep === "function") {
            window.askLunaStep(`Can you explain the physical mechanism and first-principles intuition behind ${model.title}?`);
          }
        }
      };
    }
  }

  function loadMotionModel(modelKey) {
    const model = MOTION_MODELS[modelKey];
    if (!model) return;

    motionStudioState.currentModelKey = modelKey;
    motionStudioState.currentPhaseIndex = 0;
    motionStudioState.animTime = 0;

    // Update Header & Socratic Info
    const domEl = document.getElementById("motionModelDomain");
    const titEl = document.getElementById("motionModelTitle");
    const sumEl = document.getElementById("motionModelSummary");
    const tagEl = document.getElementById("motionHudModelTag");
    const fTagEl = document.getElementById("motionFormulaTag");
    const fKatexEl = document.getElementById("motionFormulaKatex");
    const insightEl = document.getElementById("motionLunaInsight");

    if (domEl) domEl.textContent = model.domain;
    if (titEl) titEl.textContent = model.title;
    if (sumEl) sumEl.textContent = model.summary;
    if (tagEl) tagEl.textContent = `MODEL: ${model.tag}`;
    if (fTagEl) fTagEl.textContent = model.formulaTag;
    if (insightEl) insightEl.innerHTML = `"${escapeHtml(model.lunaInsight)}"`;

    if (fKatexEl) {
      if (typeof katex !== "undefined" && typeof katex.renderToString === "function") {
        try {
          fKatexEl.innerHTML = katex.renderToString(model.formulaKatex, { displayMode: true, throwOnError: false });
        } catch (e) {
          fKatexEl.textContent = model.formulaKatex;
        }
      } else {
        fKatexEl.textContent = model.formulaKatex;
      }
    }

    // Render 3-Phase Steps
    renderMotionPhaseSteps(model, 0);
    updateMotionTranscript(model, 0);

    // Rebuild 3D Model in Three.js Scene
    if (motionStudioState.scene) {
      buildThreeJsModel(modelKey);
    }
  }

  function renderMotionPhaseSteps(model, activePhaseIdx) {
    const list = document.getElementById("motionPhaseStepsList");
    if (!list) return;

    list.innerHTML = model.phases.map((ph, idx) => {
      const isActive = idx === activePhaseIdx;
      const isPast = idx < activePhaseIdx;
      const borderCls = isActive
        ? "active border-purple-500/70 bg-purple-950/30 text-white shadow-md shadow-purple-500/15"
        : isPast
        ? "completed border-emerald-800/40 bg-emerald-950/20 text-slate-300 opacity-80"
        : "border-white/10 bg-white/[0.02] text-slate-400";
      const icon = isPast ? "✓" : isActive ? "▶" : String(ph.num);
      const iconBg = isActive ? "bg-purple-600 text-white" : isPast ? "bg-emerald-600 text-white" : "bg-white/10 text-slate-400";

      return `
        <div class="motion-phase-step p-2.5 rounded-xl border transition-all duration-300 flex items-start gap-2.5 ${borderCls}">
          <span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${iconBg}">
            ${icon}
          </span>
          <div class="min-w-0 flex-1">
            <h5 class="text-xs font-bold text-white flex items-center justify-between">
              <span>Phase ${ph.num}: ${escapeHtml(ph.title)}</span>
              ${isActive ? '<span class="text-[9px] font-mono text-cyan-400 animate-pulse">ACTIVE</span>' : ''}
            </h5>
            <p class="text-[11px] text-slate-300 mt-0.5 leading-relaxed">${escapeHtml(ph.desc)}</p>
          </div>
        </div>
      `;
    }).join("");
  }

  function updateMotionTranscript(model, phaseIdx) {
    const phase = model.phases[phaseIdx] || model.phases[0];
    const phEl = document.getElementById("motionTranscriptPhase");
    const txEl = document.getElementById("motionTranscriptText");
    if (phEl) phEl.textContent = `Phase ${phase.num}: ${phase.title}`;
    if (txEl) txEl.textContent = phase.transcript;
  }

  function initThreeJsEngine() {
    const container = document.getElementById("motionStageContainer");
    if (!container) return;

    if (typeof THREE === "undefined") {
      container.innerHTML = `
        <div class="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2 p-6 text-center">
          <div class="text-3xl animate-spin">⚙️</div>
          <p class="text-xs font-bold text-white">Initializing 3D Spatial Engine...</p>
          <p class="text-[11px] text-slate-500">Loading Three.js spatial kinematics shaders.</p>
        </div>
      `;
      setTimeout(() => initThreeJsEngine(), 250);
      return;
    }

    container.innerHTML = "";
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 440;

    // Three.js Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050714);
    scene.fog = new THREE.FogExp2(0x050714, 0.035);

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 2.8, 8.5);

    // WebGL Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // OrbitControls
    let controls = null;
    if (typeof THREE.OrbitControls !== "undefined") {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.maxDistance = 22;
      controls.minDistance = 2.5;
      controls.maxPolarAngle = Math.PI / 2 + 0.15; // Don't flip below perspective floor
    }

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x312e81, 1.2);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.3);
    dirLight.position.set(6, 12, 8);
    scene.add(dirLight);

    const cyanPoint = new THREE.PointLight(0x06b6d4, 1.8, 20);
    cyanPoint.position.set(-5, 3, -3);
    scene.add(cyanPoint);

    const purplePoint = new THREE.PointLight(0xa855f7, 1.8, 20);
    purplePoint.position.set(5, -2, 3);
    scene.add(purplePoint);

    // Cybernetic Floor Grid (SignBridge AI Inspired)
    const floorGrid = new THREE.GridHelper(20, 20, 0x8b5cf6, 0x1e1b4b);
    floorGrid.position.y = -2.2;
    scene.add(floorGrid);

    // Model Group Mount
    const activeModelGroup = new THREE.Group();
    scene.add(activeModelGroup);

    motionStudioState.scene = scene;
    motionStudioState.camera = camera;
    renderer.domElement.className = "w-full h-full block";
    motionStudioState.renderer = renderer;
    motionStudioState.controls = controls;
    motionStudioState.activeModelGroup = activeModelGroup;
    motionStudioState.isInitialized = true;

    // Handle Container Resizing via ResizeObserver
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        if (!container || !renderer || !camera) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w > 0 && h > 0) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      });
      ro.observe(container);
    }

    // Build Current Active Model
    buildThreeJsModel(motionStudioState.currentModelKey);

    // Main 60 FPS Render Loop
    function animate(time) {
      requestAnimationFrame(animate);

      const delta = Math.min((time - motionStudioState.lastFrameTime) / 1000, 0.1);
      motionStudioState.lastFrameTime = time;

      // Calculate FPS Counter
      motionStudioState.frameCount++;
      if (time - motionStudioState.lastFpsUpdate >= 500) {
        const fps = Math.round((motionStudioState.frameCount * 1000) / (time - motionStudioState.lastFpsUpdate));
        const fpsEl = document.getElementById("motionHudFps");
        if (fpsEl) fpsEl.textContent = String(fps);
        motionStudioState.frameCount = 0;
        motionStudioState.lastFpsUpdate = time;
      }

      // Advance Motion Simulation Time
      if (motionStudioState.isPlaying) {
        motionStudioState.animTime += delta * motionStudioState.speed;
      }

      const t = motionStudioState.animTime;

      // Update Phase Progression (9 second loop: 3s per phase)
      const cycleLength = 9.0;
      const normalizedTime = t % cycleLength;
      const phaseIdx = Math.min(2, Math.floor(normalizedTime / 3.0));

      if (phaseIdx !== motionStudioState.currentPhaseIndex) {
        motionStudioState.currentPhaseIndex = phaseIdx;
        const model = MOTION_MODELS[motionStudioState.currentModelKey];
        if (model) {
          renderMotionPhaseSteps(model, phaseIdx);
          updateMotionTranscript(model, phaseIdx);
        }
      }

      // Update 3D Kinematic Models
      if (motionStudioState.activeModelGroup && motionStudioState.activeModelGroup.userData.updateFn) {
        motionStudioState.activeModelGroup.userData.updateFn(t, delta);
      }

      if (controls) {
        controls.update();
      }

      renderer.render(scene, camera);
    }

    requestAnimationFrame(animate);
  }

  function clearThreeGroup(group) {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  }

  function buildThreeJsModel(modelKey) {
    const group = motionStudioState.activeModelGroup;
    if (!group) return;

    clearThreeGroup(group);

    if (modelKey === "dna") {
      buildDnaModel(group);
    } else if (modelKey === "motor") {
      buildMotorModel(group);
    } else if (modelKey === "electron") {
      buildElectronModel(group);
    } else if (modelKey === "vector") {
      buildVectorModel(group);
    } else if (modelKey === "robot") {
      buildRobotModel(group);
    }
  }

  // -------------------------------------------------------------------------
  // 1. MODEL: DNA DOUBLE HELIX UNWINDING & REPLICATION FORK
  // -------------------------------------------------------------------------
  function buildDnaModel(group) {
    const strandRadius = 1.2;
    const height = 4.8;
    const numPairs = 28;
    const baseColors = [0xef4444, 0x3b82f6, 0x10b981, 0xf59e0b]; // A (Red), T (Blue), G (Emerald), C (Amber)

    const rungs = [];
    const backbonePointsA = [];
    const backbonePointsB = [];

    const sphereGeo = new THREE.SphereGeometry(0.12, 16, 16);
    const strandMatA = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, roughness: 0.3, metalness: 0.2 });
    const strandMatB = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.3, metalness: 0.2 });

    for (let i = 0; i < numPairs; i++) {
      const tNorm = i / numPairs;
      const y = (tNorm - 0.5) * height;
      const angle = tNorm * Math.PI * 4;

      const x1 = Math.cos(angle) * strandRadius;
      const z1 = Math.sin(angle) * strandRadius;
      const x2 = Math.cos(angle + Math.PI) * strandRadius;
      const z2 = Math.sin(angle + Math.PI) * strandRadius;

      // Backbone Nodes
      const nodeA = new THREE.Mesh(sphereGeo, strandMatA);
      nodeA.position.set(x1, y, z1);
      group.add(nodeA);

      const nodeB = new THREE.Mesh(sphereGeo, strandMatB);
      nodeB.position.set(x2, y, z2);
      group.add(nodeB);

      // Base Pair Rung (Half A, Half B)
      const colA = baseColors[i % 4];
      const colB = baseColors[(i + 1) % 4];
      const rungMatA = new THREE.MeshStandardMaterial({ color: colA, roughness: 0.4 });
      const rungMatB = new THREE.MeshStandardMaterial({ color: colB, roughness: 0.4 });

      const rungGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 8);
      const halfRung1 = new THREE.Mesh(rungGeo, rungMatA);
      const halfRung2 = new THREE.Mesh(rungGeo, rungMatB);

      halfRung1.position.set((x1 * 0.5), y, (z1 * 0.5));
      halfRung2.position.set((x2 * 0.5), y, (z2 * 0.5));

      group.add(halfRung1);
      group.add(halfRung2);

      rungs.push({
        nodeA,
        nodeB,
        halfRung1,
        halfRung2,
        baseX1: x1,
        baseZ1: z1,
        baseX2: x2,
        baseZ2: z2,
        y: y,
        index: i
      });
    }

    group.userData.updateFn = (t) => {
      // Rotation around Y
      group.rotation.y = t * 0.45;

      // Helicase unzipping dynamic fork: upper half spreads out as time passes
      const unwindProgress = 0.5 + 0.45 * Math.sin(t * 0.8);

      rungs.forEach((r) => {
        const ratio = r.index / numPairs;
        if (ratio > 1 - unwindProgress) {
          // Unwind / separate strands outward at the replication fork
          const separationFactor = (ratio - (1 - unwindProgress)) * 2.2;
          const spreadX1 = r.baseX1 * (1 + separationFactor * 1.5);
          const spreadZ1 = r.baseZ1 * (1 + separationFactor * 1.5);
          const spreadX2 = r.baseX2 * (1 + separationFactor * 1.5);
          const spreadZ2 = r.baseZ2 * (1 + separationFactor * 1.5);

          r.nodeA.position.set(spreadX1, r.y, spreadZ1);
          r.nodeB.position.set(spreadX2, r.y, spreadZ2);

          r.halfRung1.position.set(spreadX1 * 0.6, r.y, spreadZ1 * 0.6);
          r.halfRung2.position.set(spreadX2 * 0.6, r.y, spreadZ2 * 0.6);

          // Disconnect rungs at fork
          r.halfRung1.scale.y = Math.max(0.2, 1 - separationFactor * 0.5);
          r.halfRung2.scale.y = Math.max(0.2, 1 - separationFactor * 0.5);
        } else {
          // Intact double helix
          r.nodeA.position.set(r.baseX1, r.y, r.baseZ1);
          r.nodeB.position.set(r.baseX2, r.y, r.baseZ2);
          r.halfRung1.position.set(r.baseX1 * 0.5, r.y, r.baseZ1 * 0.5);
          r.halfRung2.position.set(r.baseX2 * 0.5, r.y, r.baseZ2 * 0.5);
          r.halfRung1.scale.y = 1;
          r.halfRung2.scale.y = 1;
        }
      });
    };
  }

  // -------------------------------------------------------------------------
  // 2. MODEL: DC ELECTRIC MOTOR & LORENTZ FORCE
  // -------------------------------------------------------------------------
  function buildMotorModel(group) {
    // North Pole (Red)
    const poleGeo = new THREE.BoxGeometry(1.2, 2.5, 3.2);
    const northMat = new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.6, roughness: 0.3 });
    const northPole = new THREE.Mesh(poleGeo, northMat);
    northPole.position.set(-2.8, 0, 0);
    group.add(northPole);

    // South Pole (Blue)
    const southMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, metalness: 0.6, roughness: 0.3 });
    const southPole = new THREE.Mesh(poleGeo, southMat);
    southPole.position.set(2.8, 0, 0);
    group.add(southPole);

    // Magnetic Flux Lines (Cyan Dashed Beams)
    const fluxGroup = new THREE.Group();
    for (let y = -0.8; y <= 0.8; y += 0.8) {
      for (let z = -0.8; z <= 0.8; z += 0.8) {
        const lineGeo = new THREE.CylinderGeometry(0.02, 0.02, 4.4, 6);
        const lineMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.45 });
        const fluxLine = new THREE.Mesh(lineGeo, lineMat);
        fluxLine.rotation.z = Math.PI / 2;
        fluxLine.position.set(0, y, z);
        fluxGroup.add(fluxLine);
      }
    }
    group.add(fluxGroup);

    // Rotating Armature Sub-group
    const rotor = new THREE.Group();
    group.add(rotor);

    // Central Shaft Axle
    const shaftGeo = new THREE.CylinderGeometry(0.08, 0.08, 4.2, 16);
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.2 });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    rotor.add(shaft);

    // Rectangular Copper Wire Loop
    const copperMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.85, roughness: 0.25 });
    const loopW = 1.8;
    const loopH = 2.4;

    const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, loopH, 8), copperMat);
    arm1.position.set(-loopW / 2, 0, 0);
    rotor.add(arm1);

    const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, loopH, 8), copperMat);
    arm2.position.set(loopW / 2, 0, 0);
    rotor.add(arm2);

    const topCross = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, loopW, 8), copperMat);
    topCross.rotation.z = Math.PI / 2;
    topCross.position.set(0, loopH / 2, 0);
    rotor.add(topCross);

    const botCross = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, loopW, 8), copperMat);
    botCross.rotation.z = Math.PI / 2;
    botCross.position.set(0, -loopH / 2, 0);
    rotor.add(botCross);

    // Force Vector Arrows (Lorentz Force F = IL x B)
    const arrowGeo = new THREE.ConeGeometry(0.14, 0.4, 8);
    const forceMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
    const forceArrowLeft = new THREE.Mesh(arrowGeo, forceMat);
    const forceArrowRight = new THREE.Mesh(arrowGeo, forceMat);

    forceArrowLeft.position.set(-loopW / 2, 0.2, 0.6);
    forceArrowRight.position.set(loopW / 2, -0.2, -0.6);
    forceArrowRight.rotation.x = Math.PI;

    rotor.add(forceArrowLeft);
    rotor.add(forceArrowRight);

    group.userData.updateFn = (t) => {
      // Continuous armature rotation driven by torque
      rotor.rotation.y = t * 2.2;

      // Pulse magnetic flux opacity
      fluxGroup.children.forEach((fl, idx) => {
        fl.material.opacity = 0.35 + 0.2 * Math.sin(t * 3 + idx);
      });
    };
  }

  // -------------------------------------------------------------------------
  // 3. MODEL: QUANTUM ELECTRON PROBABILITY CLOUD
  // -------------------------------------------------------------------------
  function buildElectronModel(group) {
    // Dense Central Nucleus (Cluster of Protons/Neutrons)
    const nucleusGroup = new THREE.Group();
    const pGeo = new THREE.SphereGeometry(0.16, 16, 16);
    const pMat = new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.3, roughness: 0.2 });
    const nMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, metalness: 0.3, roughness: 0.2 });

    const nCoords = [
      [0, 0, 0], [0.18, 0.12, 0], [-0.15, -0.1, 0.1],
      [0.08, -0.15, -0.12], [-0.12, 0.16, -0.08], [0.12, -0.05, 0.15]
    ];
    nCoords.forEach((pos, idx) => {
      const sphere = new THREE.Mesh(pGeo, idx % 2 === 0 ? pMat : nMat);
      sphere.position.set(pos[0], pos[1], pos[2]);
      nucleusGroup.add(sphere);
    });
    group.add(nucleusGroup);

    // Quantum Wavefunction Particle Cloud (1000 probability points)
    const particleCount = 1200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const baseCoords = [];

    for (let i = 0; i < particleCount; i++) {
      // Exponential radial probability distribution (1s orbital)
      const u = Math.random();
      const r = -Math.log(1 - u * 0.96) * 1.1 + 0.3;
      const theta = Math.acos(2 * Math.random() - 1);
      const phi = 2 * Math.PI * Math.random();

      const x = r * Math.sin(theta) * Math.cos(phi);
      const y = r * Math.sin(theta) * Math.sin(phi);
      const z = r * Math.cos(theta);

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      baseCoords.push({ r, theta, phi });
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const pMaterial = new THREE.PointsMaterial({
      color: 0x22d3ee,
      size: 0.065,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });
    const particleCloud = new THREE.Points(geometry, pMaterial);
    group.add(particleCloud);

    // Orbiting Pilot Wave Ring with tracer
    const ringGeo = new THREE.TorusGeometry(2.2, 0.02, 16, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.35 });
    const orbitRing = new THREE.Mesh(ringGeo, ringMat);
    orbitRing.rotation.x = Math.PI / 3;
    group.add(orbitRing);

    const electronSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    group.add(electronSphere);

    group.userData.updateFn = (t) => {
      // Rotate cloud
      particleCloud.rotation.y = t * 0.25;
      nucleusGroup.rotation.y = t * 0.4;

      // Pulse probability density wave: morph between 1s sphere and 2p dumbbell
      const waveFactor = 0.5 + 0.5 * Math.sin(t * 1.5);
      const posAttr = particleCloud.geometry.attributes.position;

      for (let i = 0; i < particleCount; i++) {
        const bc = baseCoords[i];
        // 2p dumbbell modulation factor: cos(theta)^2
        const pMod = 1 + waveFactor * 0.8 * Math.cos(bc.theta) * Math.cos(bc.theta);
        const currR = bc.r * pMod * (0.95 + 0.1 * Math.sin(t * 2 + bc.r * 2));

        posAttr.setXYZ(
          i,
          currR * Math.sin(bc.theta) * Math.cos(bc.phi),
          currR * Math.sin(bc.theta) * Math.sin(bc.phi),
          currR * Math.cos(bc.theta)
        );
      }
      posAttr.needsUpdate = true;

      // Pilot electron tracing along ring
      const eAngle = t * 3.5;
      const ringRadius = 2.2;
      const ex = Math.cos(eAngle) * ringRadius;
      const ez = Math.sin(eAngle) * ringRadius;
      electronSphere.position.set(ex, Math.sin(t * 2) * 0.4, ez);
    };
  }

  // -------------------------------------------------------------------------
  // 4. MODEL: 3D VECTOR CROSS PRODUCT & RIGHT-HAND RULE
  // -------------------------------------------------------------------------
  function buildVectorModel(group) {
    const origin = new THREE.Vector3(0, -0.5, 0);

    // Vector A (Cyan, along X-axis)
    const arrowA = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      origin,
      2.8,
      0x06b6d4,
      0.45,
      0.22
    );
    group.add(arrowA);

    // Vector B (Fuchsia, variable angle in X-Z plane)
    const arrowB = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      origin,
      2.4,
      0xec4899,
      0.45,
      0.22
    );
    group.add(arrowB);

    // Resultant Vector C = A x B (Gold, pointing along Y-axis)
    const arrowC = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      origin,
      2.8,
      0xfbbf24,
      0.5,
      0.25
    );
    group.add(arrowC);

    // Shaded Parallelogram Surface representing Area |A x B|
    const planeGeo = new THREE.BufferGeometry();
    const planeVertices = new Float32Array(6 * 3); // 2 triangles
    planeGeo.setAttribute("position", new THREE.BufferAttribute(planeVertices, 3));

    const planeMat = new THREE.MeshBasicMaterial({
      color: 0xa855f7,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide
    });
    const planeMesh = new THREE.Mesh(planeGeo, planeMat);
    group.add(planeMesh);

    group.userData.updateFn = (t) => {
      // Angle theta sweep between vectors A and B
      const theta = Math.PI / 4 + (Math.PI / 3) * Math.sin(t * 1.2);
      const bDir = new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta)).normalize();
      arrowB.setDirection(bDir);

      // Resultant C = A x B
      const aDir = new THREE.Vector3(1, 0, 0);
      const cDir = new THREE.Vector3().crossVectors(aDir, bDir).normalize();
      const crossMag = Math.abs(Math.sin(theta)) * 3.0;

      arrowC.setDirection(cDir);
      arrowC.setLength(Math.max(0.4, crossMag), 0.45, 0.22);

      // Update Parallelogram 3D coordinates
      const vA = new THREE.Vector3(2.8, -0.5, 0);
      const vB = new THREE.Vector3(bDir.x * 2.4, -0.5, bDir.z * 2.4);
      const vAB = new THREE.Vector3(vA.x + vB.x, -0.5, vA.z + vB.z);
      const vO = new THREE.Vector3(0, -0.5, 0);

      const pos = planeMesh.geometry.attributes.position;
      // Triangle 1: O -> A -> AB
      pos.setXYZ(0, vO.x, vO.y, vO.z);
      pos.setXYZ(1, vA.x, vA.y, vA.z);
      pos.setXYZ(2, vAB.x, vAB.y, vAB.z);
      // Triangle 2: O -> AB -> B
      pos.setXYZ(3, vO.x, vO.y, vO.z);
      pos.setXYZ(4, vAB.x, vAB.y, vAB.z);
      pos.setXYZ(5, vB.x, vB.y, vB.z);
      pos.needsUpdate = true;
    };
  }

  // -------------------------------------------------------------------------
  // 5. MODEL: 3-AXIS ARTICULATED ROBOTIC ARM KINEMATICS
  // -------------------------------------------------------------------------
  function buildRobotModel(group) {
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.2 });
    const jointMat = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, metalness: 0.5, roughness: 0.3 });
    const cyanMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, metalness: 0.5, roughness: 0.3 });

    // Base Pedestal
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 0.5, 24), metalMat);
    base.position.y = -1.9;
    group.add(base);

    // Yaw Joint 1 (Azimuth Turntable)
    const yawJoint = new THREE.Group();
    yawJoint.position.y = -1.6;
    group.add(yawJoint);

    const turntable = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.4, 24), jointMat);
    yawJoint.add(turntable);

    // Shoulder Pitch Joint 2
    const shoulderJoint = new THREE.Group();
    shoulderJoint.position.y = 0.3;
    yawJoint.add(shoulderJoint);

    const shoulderPivot = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 16), cyanMat);
    shoulderJoint.add(shoulderPivot);

    // Link 1 Boom Arm
    const link1 = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.0, 16), metalMat);
    link1.position.y = 1.0;
    shoulderJoint.add(link1);

    // Elbow Joint 3
    const elbowJoint = new THREE.Group();
    elbowJoint.position.y = 2.0;
    shoulderJoint.add(elbowJoint);

    const elbowPivot = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), jointMat);
    elbowJoint.add(elbowPivot);

    // Link 2 Forearm
    const link2 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.8, 16), metalMat);
    link2.position.y = 0.9;
    elbowJoint.add(link2);

    // End-Effector Gripper Wrist
    const gripperWrist = new THREE.Group();
    gripperWrist.position.y = 1.8;
    elbowJoint.add(gripperWrist);

    const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.3), cyanMat);
    gripperWrist.add(wrist);

    // Dual-Finger Claws
    const fingerMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.7, roughness: 0.3 });
    const claw1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.1), fingerMat);
    const claw2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.1), fingerMat);

    claw1.position.set(-0.16, 0.25, 0);
    claw2.position.set(0.16, 0.25, 0);
    gripperWrist.add(claw1);
    gripperWrist.add(claw2);

    group.userData.updateFn = (t) => {
      // Forward kinematics harmonic joint oscillations
      yawJoint.rotation.y = 0.8 * Math.sin(t * 0.9);
      shoulderJoint.rotation.z = 0.4 * Math.sin(t * 1.2) - 0.2;
      elbowJoint.rotation.z = 0.6 * Math.cos(t * 1.4) + 0.3;

      // Gripper pinch action
      const pinch = 0.08 * Math.sin(t * 3.0);
      claw1.position.x = -0.16 + pinch;
      claw2.position.x = 0.16 - pinch;
    };
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
    const calibratedData = JSON.parse(localStorage.getItem("clearmind_profile") || "{}");
    const persona = localStorage.getItem("clearmind_calibrated_persona") || calibratedData.persona || studentProfile.persona || "strict";
    const subjects = (calibratedData.subjects && calibratedData.subjects.length > 0)
      ? calibratedData.subjects.map(s => s.name || s)
      : (studentProfile.subjects && studentProfile.subjects.length > 0)
        ? studentProfile.subjects.map(s => s.name || s)
        : [];

    let customChips = [];
    if (subjects.length > 0) {
      subjects.slice(0, 3).forEach(s => customChips.push(`📚 Teach me ${s}`));
    } else {
      customChips.push(`⚛️ Physics: Newton's Laws of Motion`);
      customChips.push(`📐 Math: Calculus & Derivatives`);
      customChips.push(`🌿 Biology: Photosynthesis in Plants`);
    }
    customChips.push(`⚡ Quick Blitz Arena Test`);
    customChips.push(`📋 1-Page Exam Cheat Sheet`);

    const finalName = (name && name !== "there") ? name : (studentProfile.name || calibratedData.user?.name || "there");
    const topicLabel = activeTopic || calibratedData.activeTopic || (subjects.length > 0 ? subjects[0] : (studentProfile.level || "your syllabus"));

    if (activeLanguage === "hinglish") {
      const personaIntros = {
        strict: `Understood, **${finalName}**! ⚡ Main hoon **Luna**, aapki **Strict Examiner**.\n\nAapka track **${topicLabel}** lock ho chuka hai. Zero fluff, pure exam rigor.\n\nKoi bhi tough problem, derivation ya exam trap pucho!`,
        socratic: `Namaste **${finalName}**! 💡 Main hoon **Luna**, aapki **Socratic Guide**.\n\n**${topicLabel}** seekhne ke liye ready? Main direct answer nahi dungi—thought-provoking questions se aapko khud solution deduce karwaungi!`,
        polymath: `Welcome **${finalName}**! 🔬 Main hoon **Luna**, **First-Principles Polymath** mode mein.\n\n**${topicLabel}** ke governing laws aur mathematical proofs ko fundamental science se derive karenge!`,
        hacker: `Let's crack this, **${finalName}**! 🚀 Main hoon **Luna**, aapki **Blitz Exam Hacker**.\n\n**${topicLabel}** ke high-yield shortcuts, mnemonics aur scoring patterns ko master karte hain!`,
        feynman: `Hey **${finalName}**! 🧠 Main hoon **Luna**, aapki **Feynman ELI5 Explainer**.\n\nNo heavy textbook jargon! **${topicLabel}** ka koi bhi complex concept bolo, main everyday simple metaphors se samjhaungi!`,
        mentor: `Hey **${finalName}**! 🌸 Main hoon **Luna**, aapki AI personal tutor.\n\n**${topicLabel}** ka koi bhi topic, formula ya problem pucho—main step-by-step real-world analogies ke saath explain karungi!`
      };
      return {
        reply_text: personaIntros[persona] || personaIntros.mentor,
        speech_text: `Hey ${finalName}! Main hoon Luna. Aaj ${topicLabel} mein kya seekhna chahte ho?`,
        chips: customChips
      };
    } else if (activeLanguage === "hi") {
      return {
        reply_text: `नमस्ते **${finalName}**! 🌸 मैं हूँ **लूना**, आपकी AI शिक्षक।\n\n**${topicLabel}** में आज आप क्या सीखना चाहते हैं?`,
        speech_text: `नमस्ते ${finalName}! मैं हूँ लूना। आज क्या सीखना चाहते हैं?`,
        chips: customChips
      };
    } else {
      const personaIntrosEn = {
        strict: `Welcome, **${finalName}**! ⚡ I am **Luna**, configured as your **Strict Examiner**.\n\nYour target track is set: **${topicLabel}**.\n\nAsk your toughest questions, upload past-paper problems, or tap a milestone below to test your mastery under strict exam standards.`,
        socratic: `Greetings, **${finalName}**! 💡 I am **Luna**, your **Socratic Guide**.\n\nReady to master **${topicLabel}**? I won't just hand you answers; I'll ask probing questions that empower you to deduce core truths yourself.`,
        polymath: `Welcome, **${finalName}**! 🔬 I am **Luna**, in **First-Principles Polymath** mode.\n\nWe will derive fundamental governing laws and math proofs for **${topicLabel}** from basic axioms. Where shall we begin?`,
        hacker: `Ready to accelerate, **${finalName}**? 🚀 I am **Luna**, your **Blitz Exam Hacker**.\n\nHigh-yield patterns, speed formulas, and score shortcuts for **${topicLabel}**. Pick a topic or jump into a Blitz Battle!`,
        feynman: `Hey there, **${finalName}**! 🧠 I am **Luna**, your **Feynman ELI5 Explainer**.\n\nZero academic jargon. Tell me any intimidating concept in **${topicLabel}**, and I'll break it down with simple, vivid metaphors!`,
        mentor: `Hello **${finalName}**! 🌸 I am **Luna**, your personal AI tutor.\n\n**${topicLabel}** is loaded into your classroom workspace. What would you like to explore first?`
      };
      return {
        reply_text: personaIntrosEn[persona] || personaIntrosEn.mentor,
        speech_text: `Hello ${finalName}! I am Luna. What would you like to master in ${topicLabel} today?`,
        chips: customChips
      };
    }
  }

  // =========================================================================
  // LIVE VOICE CALL ORBIT
  // =========================================================================
  function startVoiceCall() {
    interruptSpeech();
    const context = getSpeechContext();
    if (context) context.resume().catch(() => {});
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
          // Do not feed Luna's own speaker output back into the tutor.
          // Tap Mic/orb to interrupt before dictating while she is speaking.
          if (speechSession && !speechSession.paused) return;
          let transcript = "";
          let finalTranscript = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            transcript += e.results[i][0].transcript + " ";
            if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + " ";
          }
          const el = document.getElementById("voiceLiveTranscript");
          if (el) el.textContent = transcript.trim();
          if (finalTranscript.trim()) sendChatMessage(finalTranscript.trim());
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
    interruptSpeech();
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
      chatInput.addEventListener("input", interruptSpeech);
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
      interruptSpeech();
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
      interruptSpeech();
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

    const voiceSelect = document.getElementById("voiceGenderSelect");
    if (voiceSelect) {
      voiceSelect.value = activeVoiceGender;
      voiceSelect.addEventListener("change", () => {
        interruptSpeech();
        activeVoiceGender = voiceSelect.value === "male" ? "male" : "female";
        localStorage.setItem("clearmind_voice_gender", activeVoiceGender);
      });
    }
    window.addEventListener("pagehide", interruptSpeech);
    document.getElementById("voiceCallOrbBtn")?.addEventListener("click", () => {
      if (isVoiceCallActive) interruptSpeech();
      else startVoiceCall();
    });

    // Sound FX Toggle (with icon sync & audio stop)
    const soundBtn = document.getElementById("soundToggleBtn");
    if (soundBtn) {
      soundBtn.textContent = soundEnabled ? "🔊" : "🔇";
      soundBtn.addEventListener("click", () => {
        soundEnabled = !soundEnabled;
        localStorage.setItem("clearmind_sound", String(soundEnabled));
        soundBtn.textContent = soundEnabled ? "🔊" : "🔇";
        if (!soundEnabled) {
          interruptSpeech();
        }
        showToast("Sound FX " + (soundEnabled ? "Enabled" : "Muted"), "info");
      });
    }

    // Profile / Settings Modal Controller
    const pModal = document.getElementById("profileModal");

    // All buttons that open Profile Modal
    document.getElementById("headerProfileBtn")?.addEventListener("click", () => openProfile(false));
    document.getElementById("headerProfileBtnMobile")?.addEventListener("click", () => openProfile(false));
    document.getElementById("dockSettingsBtn")?.addEventListener("click", () => openProfile(false));
    document.getElementById("editProfileJourneyBtn")?.addEventListener("click", () => openProfile(false));
    document.getElementById("brandLogoBtn")?.addEventListener("click", () => openProfile(false));

    // Close / Skip Profile Buttons
    document.getElementById("closeProfileModal")?.addEventListener("click", () => {
      pModal?.classList.add("hidden");
    });
    document.getElementById("skipProfileBtn")?.addEventListener("click", () => {
      pModal?.classList.add("hidden");
    });

    // Logout & Session Memory Purge Controller
    const triggerSessionLogout = () => {
      // CRITICAL PRIVACY & SESSION PURGE:
      // Active study topics, chapters studied, and chat logs are wiped on logout
      localStorage.removeItem("clearmind_auth_user");
      localStorage.removeItem("clearmind_conv_history");
      localStorage.removeItem("clearmind_active_topic");
      localStorage.removeItem("clearmind_canvas_nodes");
      sessionStorage.clear();
      showToast("Logging out & clearing session memory...", "info");
      setTimeout(() => {
        window.location.href = "/";
      }, 300);
    };
    document.getElementById("appLogoutBtn")?.addEventListener("click", triggerSessionLogout);
    document.getElementById("modalLogoutBtn")?.addEventListener("click", triggerSessionLogout);

    // Wire HUD Persona Switcher Grid Buttons
    document.querySelectorAll(".hud-persona-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.getAttribute("data-persona");
        if (p) {
          localStorage.setItem("clearmind_calibrated_persona", p);
          highlightHudPersona(p);
          updateHUD();
          playSound("click");
          const pName = studentProfile.name || "Student";
          showToast(`Pedagogical persona switched to ${p}`, "info");
        }
      });
    });

    // Save Profile Submit Button
    document.getElementById("saveProfileBtn")?.addEventListener("click", () => {
      const nInp = document.getElementById("inputStudentName");
      const tInp = document.getElementById("inputStudentTopic");
      const enteredName = nInp?.value.trim() || "";
      const chosenTopic = tInp?.value.trim() || "";

      const finalName = (enteredName && enteredName.toLowerCase() !== "student") ? enteredName : (studentProfile.name || "Student");

      studentProfile.name = finalName;
      
      if (chosenTopic) {
        activeTopic = chosenTopic;
        localStorage.setItem("clearmind_active_topic", activeTopic);
      }

      // Update stored profile with new name and active topic
      const curData = JSON.parse(localStorage.getItem("clearmind_profile") || "{}");
      curData.user = curData.user || {};
      curData.user.name = finalName;
      if (chosenTopic) curData.activeTopic = chosenTopic;
      localStorage.setItem("clearmind_profile", JSON.stringify(curData));
      localStorage.setItem("clearmind_setup_completed", "true");

      // Sync persona & updated profile to backend SQLite DB
      if (authUser && authUser.user_id) {
        fetch('/api/auth/sync-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: authUser.user_id,
            name: finalName,
            persona: localStorage.getItem("clearmind_calibrated_persona") || curData.persona || "mentor",
            identity: curData.identity || "school",
            level: curData.level || studentProfile.level || "Class 12",
            board: curData.subDetails?.curriculum || curData.board || "CBSE",
            daily_rhythm: curData.dailyRhythm || "45 mins / day",
            target_goal: curData.targetGoal || "",
            subjects: curData.subjects || []
          })
        }).catch(err => console.warn('Profile sync on save:', err));
      }

      updateHUD();
      updateActiveTopicUI();
      updateDynamicRoadmap();
      pModal?.classList.add("hidden");
      playSound("fanfare");
      
      showToast("Academic calibration saved for " + finalName + "!", "success");

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
        // Preserve the auth session. A blanket clear() logged the user out
        // while AuthEngine still rendered them as signed in - UI/storage desync.
        let savedAuth = null;
        try { savedAuth = localStorage.getItem("clearmind_auth_user"); } catch (e) { savedAuth = null; }
        localStorage.clear();
        if (savedAuth) {
          try { localStorage.setItem("clearmind_auth_user", savedAuth); } catch (e) {}
        }
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
      { id: "nav-analytics", cat: "Navigation", title: "Student Analytics & Mastery", desc: "Bento dashboard, topic prerequisite tree, and study heatmap", icon: "📊", action: () => window.navigateToPage("analytics") },
      { id: "nav-motion", cat: "Navigation", title: "3D Motion Concept Studio", desc: "Interactive Three.js STEM kinematics and spatial simulations (SignBridge AI)", icon: "🧊", action: () => window.navigateToPage("motion") },

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
    initDependencyTreeWorkspace();
    initMotionStudio();
    initSpotlightCards();
    initCommandPalette();
    initMobileAdaptiveSplitter();
    initShortcutsModal();
    initTopicEmptyStateListeners();

    // RESTORE CHAT HISTORY IF EXISTS, OR SHOW INITIAL GREETING
    const box = document.getElementById("chatMessagesContainer");
    if (box) {
      box.innerHTML = "";
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
        const calibrated = JSON.parse(localStorage.getItem("clearmind_profile") || "{}");
        const currentName = studentProfile.name || calibrated.user?.name || "there";
        const gr = getLocalizedGreeting(currentName);
        appendLunaMessage({
          reply_text: gr.reply_text,
          speech_text: gr.speech_text,
          analogy_card: {
            title: "🌸 Ready Whenever You Are",
            description: "Ask any problem, derivation, or formula—I am fully calibrated to your syllabus and pace!"
          }
        });
        renderSuggestedChips(gr.chips);
      }
    }

    // Mandatory Auth Check: Guest access is temporarily disabled — require active Google or Email session
    const urlParams = new URLSearchParams(window.location.search);
    const authUser = JSON.parse(localStorage.getItem("clearmind_auth_user") || "null");
    if ((!authUser || authUser.isGuest) && !urlParams.has("preview")) {
      window.location.replace("/?login=1");
      return;
    }

    // Mandatory Setup Check: If user has never completed setup or requested via URL
    const hasCompletedSetup = localStorage.getItem("clearmind_setup_completed");

    if (!hasCompletedSetup && !urlParams.has("preview")) {
      window.location.replace("/?onboard=1");
      return;
    }

    if (urlParams.has("settings")) {
      setTimeout(() => {
        openProfile(false);
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
    } else if (rawPath === "motion" || rawPath === "studio") {
      window.navigateToPage("motion", false);
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
