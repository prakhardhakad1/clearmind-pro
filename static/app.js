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

  // 60s Blitz Battle State
  let blitzState = {
    timerInterval: null,
    timeLeft: 60,
    score: 0,
    combo: 1,
    currentQuestionIdx: 0,
    questions: [],
    isRunning: false
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

    // Update Header HUD
    if (sName) sName.textContent = displayName;
    if (sAvatar) sAvatar.textContent = displayAvatar;
    if (sXP) sXP.textContent = totalXP;
    if (sStreak) sStreak.textContent = currentStreak;

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
      const block = `<div class="my-2 p-3 rounded-xl bg-obsidian-950 border border-purple-900/60 font-mono text-xs text-purple-200 overflow-x-auto"><div class="text-[9px] uppercase tracking-wider text-purple-400 pb-1 font-bold border-b border-obsidian-800 mb-1.5">${b.lang}</div><pre class="leading-relaxed whitespace-pre"><code>${esc}</code></pre></div>`;
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
      h = h.replace(`___MATH_TOKEN_${idx}___`, rendered);
    });

    return h;
  }

  // =========================================================================
  // DYNAMIC LEARNING ROADMAP GENERATOR
  // =========================================================================
  function updateDynamicRoadmap() {
    const list = document.getElementById("dynamicRoadmapStepsList");
    const sub = document.getElementById("roadmapPathSubtitle");
    if (!list) return;

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
  const viewMap = {
    live: "viewCanvasLive",
    canvas: "viewCanvasLive",
    exam: "viewCanvasExam",
    cheatsheet: "viewCanvasExam",
    blitz: "viewCanvasBlitz",
    voice: "viewCanvasVoice",
    journey: "viewCanvasJourney"
  };

  window.switchCanvasTab = function (tabKey) {
    // If switching AWAY from Blitz Quiz while timer is running, stop timer cleanly
    if (tabKey !== "blitz" && blitzState.isRunning) {
      clearInterval(blitzState.timerInterval);
      blitzState.isRunning = false;
      const tmDisp = document.getElementById("blitzTimerDisplay");
      if (tmDisp) tmDisp.textContent = "01:00";
    }

    // Hide all views
    [
      "viewCanvasLive",
      "viewCanvasExam",
      "viewCanvasBlitz",
      "viewCanvasVoice",
      "viewCanvasJourney"
    ].forEach((id) => {
      document.getElementById(id)?.classList.add("hidden");
    });

    // Show target view
    const targetId = viewMap[tabKey] || "viewCanvasLive";
    document.getElementById(targetId)?.classList.remove("hidden");

    // Update Top Canvas Tab Buttons Active Style
    document.querySelectorAll(".canvas-tab-btn").forEach((btn) => {
      const key = btn.getAttribute("data-canvas-tab");
      const isMatch = (key === tabKey) || (key === "live" && tabKey === "canvas") || (key === "exam" && tabKey === "cheatsheet");
      if (isMatch) {
        btn.classList.add("bg-gradient-to-r", "from-purple-600", "to-pink-600", "text-white", "shadow-sm");
        btn.classList.remove("text-slate-400", "hover:text-white", "hover:bg-obsidian-750");
      } else {
        btn.classList.remove("bg-gradient-to-r", "from-purple-600", "to-pink-600", "text-white", "shadow-sm");
        btn.classList.add("text-slate-400", "hover:text-white", "hover:bg-obsidian-750");
      }
    });

    // Update Mini-Dock Buttons Active Style
    document.querySelectorAll(".dock-nav-btn").forEach((btn) => {
      const key = btn.getAttribute("data-dock-tab");
      const isMatch = (key === tabKey) || (key === "live" && tabKey === "canvas") || (key === "exam" && tabKey === "cheatsheet");
      if (isMatch) {
        btn.classList.add("bg-purple-600", "text-white", "shadow-md");
        btn.classList.remove("bg-obsidian-850", "text-slate-400", "hover:text-white");
      } else {
        btn.classList.remove("bg-purple-600", "text-white", "shadow-md");
        btn.classList.add("bg-obsidian-850", "text-slate-400", "hover:text-white");
      }
    });

    playSound("click");

    if (tabKey === "exam" || tabKey === "cheatsheet") {
      loadExamCheatSheet(false);
    } else if (tabKey === "blitz") {
      startBlitzBattle();
    } else if (tabKey === "voice") {
      startVoiceCall();
    }
  };

  // =========================================================================
  // CHAT STREAM: USER & LUNA MESSAGE RENDERERS
  // =========================================================================
  function appendUserMessage(text, imageSrc) {
    const box = document.getElementById("chatMessagesContainer");
    if (!box) return;
    const d = document.createElement("div");
    d.className = "flex items-start justify-end gap-2.5 animate-fade-in";
    const imgHtml = imageSrc
      ? `<div class="mb-2"><img src="${imageSrc}" class="max-w-[200px] max-h-[140px] rounded-xl border border-purple-500/50 object-cover" /></div>`
      : "";
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    d.innerHTML = `
      <div class="space-y-1 max-w-[85%] text-right">
        <div class="bg-gradient-to-r from-purple-900/70 to-indigo-900/70 border border-purple-700/50 p-3.5 rounded-2xl rounded-tr-sm text-xs font-medium leading-relaxed shadow-sm inline-block text-left text-white">
          <div class="flex items-center justify-between border-b border-purple-700/40 pb-1 text-[10px] text-purple-300 mb-1">
            <span class="font-bold">${escapeHtml(studentProfile.name || "Student")}</span>
            <span>${timeStr}</span>
          </div>
          ${imgHtml}
          <div>${escapeHtml(text)}</div>
        </div>
      </div>
      <div class="w-8 h-8 rounded-xl bg-purple-950 border border-purple-800 flex items-center justify-center text-sm shrink-0 mt-1 shadow">
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
        <div class="p-3 bg-obsidian-950/80 border border-purple-800/60 rounded-xl space-y-1">
          <span class="text-[9px] font-black uppercase tracking-wider text-purple-400">[Interactive Analogy Card]</span>
          <h5 class="text-xs font-black text-white">${escapeHtml(data.analogy_card.title)}</h5>
          <p class="text-[11px] text-purple-200/90 leading-relaxed">${escapeHtml(data.analogy_card.description || "")}</p>
        </div>`;
    }

    const rawSpeech = (data.speech_text || data.reply_text || "").replace(/<[^>]*>/g, "").trim();
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    d.innerHTML = `
      <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 to-pink-500 flex items-center justify-center text-sm text-white shrink-0 mt-1 shadow shadow-purple-500/20">
        🌸
      </div>
      <div class="space-y-2 max-w-[90%]">
        <div class="bg-obsidian-850 border border-obsidian-750 p-4 rounded-2xl rounded-tl-sm text-slate-200 text-xs leading-relaxed shadow-sm space-y-3">
          <div class="flex items-center justify-between border-b border-obsidian-750 pb-1.5 text-[10px] text-slate-400">
            <span class="font-bold text-purple-400">Luna</span>
            <span>${timeStr}</span>
          </div>
          <div class="space-y-2 text-slate-200 leading-relaxed font-normal">${formatMarkdown(data.reply_text)}</div>
          ${analogyHtml}
          <div class="pt-2 flex items-center justify-between border-t border-obsidian-750">
            <button class="chat-listen-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-purple-950/80 hover:bg-purple-900 text-purple-300 text-[11px] font-bold border border-purple-800/60 transition">
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
        if (data.audio_base64) {
          playPreSynthesizedAudio(data.audio_base64, btn);
        } else {
          playLunaVoice(rawSpeech, btn);
        }
      });
    }

    // In live call, speak immediately
    if (isVoiceCallActive) {
      if (data.audio_base64) {
        playPreSynthesizedAudio(data.audio_base64);
      } else if (rawSpeech) {
        playLunaVoice(rawSpeech);
      }
    }
  }

  function appendTyping() {
    const box = document.getElementById("chatMessagesContainer");
    if (!box) return;
    const ind = document.createElement("div");
    ind.id = "lunaTypingIndicator";
    ind.className = "flex items-start gap-2.5 animate-fade-in";
    ind.innerHTML = `
      <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 to-pink-500 flex items-center justify-center text-sm text-white shrink-0 shadow animate-pulse">
        🌸
      </div>
      <div class="bg-obsidian-850 border border-obsidian-750 px-4 py-2.5 rounded-2xl rounded-tl-sm flex items-center gap-2 text-xs text-purple-400 font-bold">
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
        if (clean.toLowerCase().includes("roadmap") || (data.detected_topic && data.detected_topic !== "General Science")) {
          finalSteps = [
            { step_number: 1, title: `${data.detected_topic || activeTopic} Foundations`, status: "done", description: "Prerequisites, definitions & vocabulary" },
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

  function updateActiveTopicUI() {
    const tTopic = document.getElementById("chatActiveTopic");
    const cTitle = document.getElementById("canvasTopicTitle");
    const examTopic = document.getElementById("examSheetTopicTitle");
    const dispTopic = activeTopic || "Choose Any Topic";
    if (tTopic) tTopic.textContent = dispTopic;
    if (cTitle) cTitle.textContent = dispTopic + (activeTopic ? " Knowledge Canvas" : "");
    if (examTopic) {
      examTopic.innerHTML = `<span>⚡</span> <span>${escapeHtml(dispTopic)} Cheat Sheet</span>`;
    }
  }

  function renderSuggestedChips(chips) {
    const dock = document.getElementById("suggestedChipsDock");
    if (!dock || !chips) return;
    dock.innerHTML = chips
      .map(
        (c) =>
          `<button class="suggested-chip text-[11px] font-semibold px-3 py-1 rounded-xl bg-obsidian-850 hover:bg-purple-950 text-slate-300 hover:text-purple-300 border border-obsidian-750 transition shrink-0 cursor-pointer">
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
      "p-3.5 rounded-2xl bg-obsidian-850 border border-purple-800/60 space-y-1 animate-fade-in";
    node.innerHTML = `
      <span class="text-[9px] font-black text-purple-400 uppercase">✨ New Unlocked Node</span>
      <h5 class="text-xs font-extrabold text-white">${escapeHtml(title)}</h5>
      <p class="text-[11px] text-slate-400 leading-relaxed">${escapeHtml(summary || "")}</p>`;
    list.prepend(node);
  }

  // =========================================================================
  // VOICE TTS AUDIO PLAYBACK (INSTANT PRE-SYNTHESIZED + FALLBACK)
  // =========================================================================
  function playPreSynthesizedAudio(base64Audio, btn) {
    if (!soundEnabled || !base64Audio) return;
    try {
      if (activeAudio) activeAudio.pause();
      if (btn) {
        btn.innerHTML = "<span>🔊</span> <span>Playing...</span>";
        btn.disabled = true;
      }
      activeAudio = new Audio("data:audio/mpeg;base64," + base64Audio);
      activeAudio.play();
      activeAudio.onended = () => {
        if (btn) {
          btn.innerHTML = "<span>🎧</span> <span>Listen with Voice</span>";
          btn.disabled = false;
        }
      };
    } catch (e) {
      console.warn("Base64 audio play failed, falling back:", e);
      if (btn) btn.disabled = false;
    }
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
      activeAudio.play();
      activeAudio.onended = () => {
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
        window.speechSynthesis.speak(u);
      }
      if (btn) {
        btn.innerHTML = "<span>🎧</span> <span>Listen with Voice</span>";
        btn.disabled = false;
      }
    }
  }

  // =========================================================================
  // 60-SECOND EXAM CHEAT SHEET (WITH TOPIC CACHING & REGENERATE)
  // =========================================================================
  async function loadExamCheatSheet(forceRegenerate = false) {
    const title = document.getElementById("examSheetTopicTitle");
    if (title) {
      title.innerHTML = `<span>⚡</span> <span>${escapeHtml(activeTopic)} Cheat Sheet</span>`;
    }

    const trap = document.getElementById("examTrapWarningText");
    const mnem = document.getElementById("examMnemonicText");
    const q5 = document.getElementById("exam5MarkQuestionText");
    const fList = document.getElementById("examFormulasList");

    // Check cache to avoid repeated AI calls and infinite XP exploit
    if (!forceRegenerate && cachedCheatSheets[activeTopic]) {
      const d = cachedCheatSheets[activeTopic];
      if (trap) trap.textContent = d.examiner_trap_warning;
      if (mnem) mnem.textContent = d.rapid_memory_mnemonic;
      if (q5) q5.innerHTML = formatMarkdown(d.must_know_5mark_question);
      if (fList && d.formulas_and_definitions) {
        fList.innerHTML = d.formulas_and_definitions
          .map(
            (f) => `
            <div class="p-3 bg-obsidian-850 border border-obsidian-750 rounded-xl text-xs text-emerald-400 font-mono flex items-center justify-between">
              <span>${escapeHtml(f)}</span>
              <span class="text-[10px] text-slate-500 uppercase font-bold">Rule</span>
            </div>`
          )
          .join("");
      }
      return;
    }

    if (trap) trap.textContent = "Synthesizing examiner traps...";
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

      if (trap) trap.textContent = d.examiner_trap_warning || "Avoid standard order of operations errors.";
      if (mnem) mnem.textContent = d.rapid_memory_mnemonic || "S.P.A.R.K: Scope, Parameters, Arguments, Return, Keep clean!";
      if (q5) q5.innerHTML = formatMarkdown(d.must_know_5mark_question || "Derive fundamental relationship step-by-step.");

      if (fList && d.formulas_and_definitions) {
        fList.innerHTML = d.formulas_and_definitions
          .map(
            (f) => `
            <div class="p-3 bg-obsidian-850 border border-obsidian-750 rounded-xl text-xs text-emerald-400 font-mono flex items-center justify-between">
              <span>${escapeHtml(f)}</span>
              <span class="text-[10px] text-slate-500 uppercase font-bold">Rule</span>
            </div>`
          )
          .join("");
      }

      // Award XP once per session for this topic
      if (!awardedCheatSheetTopics.has(activeTopic)) {
        awardedCheatSheetTopics.add(activeTopic);
        addXP(50);
        bumpStreak();
        playSound("fanfare");
        if (typeof confetti === "function") {
          confetti({ particleCount: 50, spread: 60, origin: { y: 0.5 } });
        }
        showToast("⚡ 60s Cheat Sheet Created! +50 XP Earned", "success");
      }
    } catch (e) {
      console.warn("Cheat sheet error:", e);
      showToast("Could not generate cheat sheet from AI.", "error");
    }
  }

  // =========================================================================
  // 60-SECOND RAPID-FIRE BLITZ BATTLE (LOCKS ANSWERS WHEN TIME RUNS OUT)
  // =========================================================================
  function formatTimerString(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
  }

  async function startBlitzBattle() {
    clearInterval(blitzState.timerInterval);
    blitzState.isRunning = false;
    blitzState.score = 0;
    blitzState.combo = 1;
    blitzState.timeLeft = 60;
    blitzState.currentQuestionIdx = 0;
    blitzState.questions = [];

    const tmDisp = document.getElementById("blitzTimerDisplay");
    const scNum = document.getElementById("blitzScoreNum");
    const cbBadge = document.getElementById("blitzComboBadge");
    const qCard = document.getElementById("blitzQuestionCard");

    if (tmDisp) tmDisp.textContent = "01:00";
    if (scNum) scNum.textContent = "0";
    if (cbBadge) cbBadge.textContent = "1x COMBO";

    if (qCard) {
      qCard.innerHTML = `
        <div class="p-8 text-center space-y-3">
          <p class="text-xs text-purple-300 font-bold animate-pulse">Loading rapid-fire questions for ${escapeHtml(activeTopic)}...</p>
          <p class="text-[11px] text-slate-400">Timer starts when questions are ready!</p>
        </div>`;
    }

    try {
      const res = await fetch("/api/blitz-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gemini-Key": localStorage.getItem("clearmind_gemini_key") || "" },
        body: JSON.stringify({ topic: activeTopic, language: activeLanguage })
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
          question: `What fundamental rule governs ${activeTopic}?`,
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
          <button data-opt="${idx}" class="blitz-opt-btn p-3 rounded-xl bg-obsidian-800 hover:bg-purple-950/80 border border-obsidian-750 text-xs font-bold text-white text-left transition flex items-center justify-between cursor-pointer">
            <span>${escapeHtml(opt)}</span>
            <span class="text-[10px] text-slate-400">Option ${String.fromCharCode(65 + idx)}</span>
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

    const tmDisp = document.getElementById("blitzTimerDisplay");
    if (tmDisp) tmDisp.textContent = "00:00 (Time's Up!)";

    const qCard = document.getElementById("blitzQuestionCard");
    if (qCard) {
      qCard.innerHTML = `
        <div class="p-6 bg-gradient-to-br from-obsidian-900 to-purple-950/60 rounded-2xl border border-purple-800/60 space-y-4 text-center">
          <div class="w-14 h-14 rounded-full bg-amber-400 text-black mx-auto flex items-center justify-center text-2xl font-black shadow-lg">
            🏆
          </div>
          <div>
            <h4 class="text-base font-black text-white">${reason === "timeout" ? "⏰ Time's Up! Round Finished" : "⚡ Blitz Battle Complete!"}</h4>
            <p class="text-xs text-purple-200">Topic: ${escapeHtml(activeTopic)}</p>
          </div>
          <div class="grid grid-cols-3 gap-2 py-2 border-y border-obsidian-750">
            <div class="p-2 bg-obsidian-850 rounded-xl">
              <span class="text-[10px] text-slate-400 block uppercase">Final Score</span>
              <span class="text-sm font-black text-amber-400">${blitzState.score} PTS</span>
            </div>
            <div class="p-2 bg-obsidian-850 rounded-xl">
              <span class="text-[10px] text-slate-400 block uppercase">XP Gained</span>
              <span class="text-sm font-black text-emerald-400">+${earnedXP} XP</span>
            </div>
            <div class="p-2 bg-obsidian-850 rounded-xl">
              <span class="text-[10px] text-slate-400 block uppercase">Answered</span>
              <span class="text-sm font-black text-purple-400">${blitzState.currentQuestionIdx} / ${blitzState.questions.length}</span>
            </div>
          </div>
          <div class="flex justify-center gap-3 pt-1">
            <button id="restartBlitzBtn" class="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-xl text-xs font-bold transition shadow-md">
              ⚡ Play Again (60s)
            </button>
            <button id="closeBlitzSummaryBtn" class="px-4 py-2.5 bg-obsidian-800 hover:bg-obsidian-750 text-slate-300 rounded-xl text-xs font-bold transition">
              Back to Canvas
            </button>
          </div>
        </div>`;

      document.getElementById("restartBlitzBtn")?.addEventListener("click", startBlitzBattle);
      document.getElementById("closeBlitzSummaryBtn")?.addEventListener("click", () => window.switchCanvasTab("live"));
    }

    showToast("🏆 Blitz Done! +" + earnedXP + " XP Earned", "success");
  }

  // =========================================================================
  // LIVE VOICE CALL ORBIT
  // =========================================================================
  function startVoiceCall() {
    isVoiceCallActive = true;
    const statusText = document.getElementById("voiceCallStatusText");
    if (statusText) statusText.textContent = "Live Call Active • Speak with Luna";
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
    document.getElementById("endVoiceCallBtn")?.addEventListener("click", endVoiceCall);

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

    // Language Dropdown
    const langSelect = document.getElementById("languageSelect");
    if (langSelect) {
      langSelect.value = activeLanguage;
      langSelect.addEventListener("change", () => {
        activeLanguage = langSelect.value;
        localStorage.setItem("clearmind_lang", activeLanguage);
        if (voiceRecognition && isVoiceCallActive) {
          voiceRecognition.lang = activeLanguage === "hinglish" ? "en-IN" : activeLanguage === "hi" ? "hi-IN" : "en-US";
        }
        showToast("Language changed to " + langSelect.options[langSelect.selectedIndex].text, "info");
      });
    }

    // Sound FX Toggle (with icon sync & audio stop)
    const soundBtn = document.getElementById("soundToggleBtn");
    if (soundBtn) {
      soundBtn.textContent = soundEnabled ? "🔊" : "🔇";
      soundBtn.addEventListener("click", () => {
        soundEnabled = !soundEnabled;
        localStorage.setItem("clearmind_sound", String(soundEnabled));
        soundBtn.textContent = soundEnabled ? "🔊" : "🔇";
        if (!soundEnabled && activeAudio) {
          activeAudio.pause();
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
      const enteredName = nInp?.value.trim() || "Student";
      const chosenTopic = tInp?.value.trim() || "General Science & Problem Solving";

      const finalName = (enteredName && enteredName.toLowerCase() !== "student") ? enteredName : "Prakhar";

      studentProfile.name = finalName;
      studentProfile.level = lInp?.value || "College / University";
      activeTopic = chosenTopic;
      localStorage.setItem("clearmind_profile", JSON.stringify(studentProfile));
      localStorage.setItem("clearmind_active_topic", activeTopic);
      localStorage.setItem("clearmind_setup_completed", "true");

      updateHUD();
      updateActiveTopicUI();
      updateDynamicRoadmap();
      pModal?.classList.add("hidden");
      playSound("fanfare");
      showToast("Welcome " + finalName + "! Classroom ready for " + activeTopic, "success");

      // Reset chat and give clean welcoming greeting
      const box = document.getElementById("chatMessagesContainer");
      if (box) box.innerHTML = "";
      conversationHistory = [];
      saveHistory();

      appendLunaMessage({
        reply_text: `Hey **${finalName}**! 🌸 Welcome to ClearMind Pro!\n\nI have calibrated your personal session for **${studentProfile.level}** on **${activeTopic}**.\n\n**What would you like to explore or conquer first?** Ask me any question, paste a problem, or tap a suggestion below!`,
        speech_text: `Hey ${finalName}! Welcome to ClearMind Pro. What would you like to learn today?`,
        analogy_card: null
      });

      renderSuggestedChips([
        `Explain ${activeTopic} in simple terms`,
        "Show a vivid real-world analogy 💡",
        "Give me the #1 Examiner Trap ⚠️",
        "Test me with 60s Blitz Quiz ⏱️"
      ]);
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
      appendLunaMessage({
        reply_text: `Hello **${currentName}**! 🌸 Fresh start ready.\n\n**What would you like to learn today?**\n\nType any topic or tap one of the subjects below!`,
        speech_text: `Hello ${currentName}! What would you like to learn today?`,
        analogy_card: {
          title: "🌸 Clean Slate Ready",
          description: "Choose any subject or ask any question to get started!"
        }
      });
      renderSuggestedChips([
        "⚛️ Physics: Newton's Laws of Motion",
        "📐 Math: Differentiation & Calculus",
        "🌿 Biology: Photosynthesis & Plants",
        "🧪 Chemistry: Organic Reactions",
        "💻 Computer Science & Programming"
      ]);
      showToast("Chat reset. Ready for new questions!", "info");
    });

    // Prompt Chips in Chat Stream
    document.getElementById("chipAnalogy")?.addEventListener("click", () => {
      sendChatMessage(`Teach me ${activeTopic} with an everyday real-world analogy.`);
    });
    document.getElementById("chipTraps")?.addEventListener("click", () => {
      sendChatMessage(`What is the #1 examiner trap that students lose marks on in ${activeTopic}?`);
    });
    document.getElementById("chipBlitz")?.addEventListener("click", () => {
      window.switchCanvasTab("blitz");
    });
  }

  // =========================================================================
  // APP BOOTSTRAP & CHAT HISTORY RESTORATION
  // =========================================================================
  document.addEventListener("DOMContentLoaded", () => {
    updateHUD();
    updateActiveTopicUI();
    updateDynamicRoadmap();
    initEventListeners();

    // RESTORE CHAT HISTORY IF EXISTS, OR SHOW INITIAL GREETING
    const box = document.getElementById("chatMessagesContainer");
    if (box) {
      if (conversationHistory && conversationHistory.length > 0) {
        // Rehydrate saved conversation
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
        // Friendly greeting asking: What do you want to learn today?
        const currentName = studentProfile.name || "there";
        appendLunaMessage({
          reply_text: `Hello **${currentName}**! 🌸 I am **Luna**, your personal AI tutor.\n\n**What would you like to learn today?**\n\nYou can ask about any subject, formula, or concept (or upload textbook photos with the 📷 button), or tap one of the popular topics below to begin!`,
          speech_text: `Hello ${currentName}! I am Luna, your personal AI tutor. What would you like to learn today?`,
          analogy_card: {
            title: "🌸 Ready Whenever You Are",
            description: "Tell me any topic in science, mathematics, engineering, or literature, and I'll break it down with everyday analogies!"
          }
        });
        renderSuggestedChips([
          "⚛️ Physics: Newton's Laws of Motion",
          "📐 Math: Differentiation & Calculus",
          "🌿 Biology: Photosynthesis & Plants",
          "🧪 Chemistry: Organic Reactions",
          "💻 Computer Science & Programming"
        ]);
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

    console.log("🌸 ClearMind Pro v17.0 — High-Yield Educational Engine Ready.");
  });
})();
