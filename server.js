/**
 * ClearMind Pro — High-Performance Native Node Server & API Bridge
 * Serves all ClearMind Pro educational cockpits, AI study planner,
 * global leaderboard, teacher portal, parent oversight, and REST API endpoints.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const BASE_DIR = __dirname;
const STATIC_DIR = path.join(BASE_DIR, 'static');

// Auto-load .env if present
try {
  const envPath = path.join(BASE_DIR, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    lines.forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || '').trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    });
  }
} catch (e) {}

const PORT = process.env.PORT || 8000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
};

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:8000'}`);
  let pathname = parsedUrl.pathname;
  const query = Object.fromEntries(parsedUrl.searchParams);

  // --- API Endpoint Handlers ---
  if (pathname.startsWith('/api/')) {
    handleApiRequest(req, res, pathname, query);
    return;
  }

  // --- Route Mappings ---
  const routeMap = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/app': 'app.html',
    '/app.html': 'app.html',
    '/classroom': 'app.html',
    '/blitz': 'app.html',
    '/flashcards': 'app.html',
    '/analytics': 'app.html',
    '/motion': 'app.html',
    '/study-planner': 'study_planner.html',
    '/study_planner.html': 'study_planner.html',
    '/planner': 'study_planner.html',
    '/leaderboard': 'leaderboard.html',
    '/leaderboard.html': 'leaderboard.html',
    '/arena': 'leaderboard.html',
    '/teacher': 'teacher_portal.html',
    '/teacher.html': 'teacher_portal.html',
    '/teacher-portal': 'teacher_portal.html',
    '/teacher_portal.html': 'teacher_portal.html',
    '/parent': 'parent_dashboard.html',
    '/parent.html': 'parent_dashboard.html',
    '/parent-dashboard': 'parent_dashboard.html',
    '/parent_dashboard.html': 'parent_dashboard.html',
    '/admin': 'admin.html',
    '/admin.html': 'admin.html'
  };

  let targetFile = routeMap[pathname];

  if (!targetFile) {
    targetFile = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  }

  // Check if file exists in root or static/
  let filePath = path.join(BASE_DIR, targetFile);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(STATIC_DIR, targetFile);
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  } else {
    // Fallback to app.html or 404
    const fallbackPath = path.join(BASE_DIR, 'index.html');
    if (fs.existsSync(fallbackPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(fallbackPath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found - ClearMind Pro');
    }
  }
});

function callGeminiFlash(apiKey, prompt, systemInstruction) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: (systemInstruction ? systemInstruction + "\n\n" : "") + prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json"
      }
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 15000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const parsed = JSON.parse(data);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
              resolve(JSON.parse(cleaned));
              return;
            }
          }
          // Try fallback to gemini-1.5-flash
          tryFallbackModel(apiKey, prompt, systemInstruction, 'gemini-1.5-flash')
            .then(resolve)
            .catch(err => reject(new Error(`Gemini status ${res.statusCode}: ${data}`)));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (err) => {
      tryFallbackModel(apiKey, prompt, systemInstruction, 'gemini-1.5-flash')
        .then(resolve)
        .catch(() => reject(err));
    });

    req.write(postData);
    req.end();
  });
}

function tryFallbackModel(apiKey, prompt, systemInstruction, modelName) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: (systemInstruction ? systemInstruction + "\n\n" : "") + prompt }] }],
      generationConfig: { temperature: 0.4, responseMimeType: "application/json" }
    });
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: `/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: 15000
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
            resolve(JSON.parse(cleaned));
          } else {
            reject(new Error(`Fallback failed: ${data}`));
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function buildDynamicSchedule(examCode, dailyHours, archetype, notes) {
  const topicsMap = {
    jee: [
      { subject: "Physics", topic: "Rotational Dynamics & Moment of Inertia", color: "cyan", tier: "R1" },
      { subject: "Mathematics", topic: "Definite Integration & Area Under Curves", color: "violet", tier: "R2" },
      { subject: "Chemistry", topic: "Organic Reaction Mechanisms (SN1/SN2/E2)", color: "emerald", tier: "R1" },
      { subject: "Physics", topic: "Electromagnetic Induction & Lenz's Law", color: "cyan", tier: "R3" },
      { subject: "Mathematics", topic: "Differential Equations & Vectors", color: "violet", tier: "R2" },
      { subject: "Chemistry", topic: "Coordination Compounds & Crystal Field", color: "emerald", tier: "R1" },
      { subject: "Physics", topic: "Modern Physics: Dual Nature & Photoelectric", color: "cyan", tier: "R4" },
      { subject: "Mock Exam", topic: "Full 3-Hour Timed JEE Shift Simulation", color: "amber", tier: "Test" },
      { subject: "Chemistry", topic: "Chemical Thermodynamics & Gibbs Energy", color: "emerald", tier: "R3" },
      { subject: "Mathematics", topic: "Probability & Bayes' Theorem Mastery", color: "violet", tier: "R1" }
    ],
    neet: [
      { subject: "Biology", topic: "Human Physiology: Neural & Chemical Control", color: "rose", tier: "R1" },
      { subject: "Chemistry", topic: "Aldehydes, Ketones & Carboxylic Acids", color: "emerald", tier: "R2" },
      { subject: "Physics", topic: "Current Electricity & Kirchhoff's Circuit Laws", color: "cyan", tier: "R1" },
      { subject: "Biology", topic: "Molecular Genetics: Transcription & Translation", color: "rose", tier: "R3" },
      { subject: "Chemistry", topic: "Equilibrium: Ionic Solubility & Buffer pH", color: "emerald", tier: "R2" },
      { subject: "Physics", topic: "Ray & Wave Optics: Interference & Mirrors", color: "cyan", tier: "R2" },
      { subject: "Biology", topic: "Biotechnology Principles & Recombinant DNA", color: "rose", tier: "R4" },
      { subject: "Mock Exam", topic: "Full 720-Mark Timed NEET Speed Simulation", color: "amber", tier: "Test" }
    ],
    sat: [
      { subject: "SAT Math", topic: "Heart of Algebra & Systems of Linear Equations", color: "violet", tier: "R1" },
      { subject: "Reading & Writing", topic: "Craft, Structure & Rhetorical Synthesis", color: "cyan", tier: "R2" },
      { subject: "SAT Math", topic: "Advanced Math: Quadratics & Nonlinear Functions", color: "violet", tier: "R3" },
      { subject: "Reading & Writing", topic: "Information and Ideas: Command of Evidence", color: "cyan", tier: "R1" },
      { subject: "Practice Test", topic: "Full Digital SAT Adaptive Simulation Test", color: "amber", tier: "Test" }
    ]
  };

  const pool = topicsMap[examCode.toLowerCase()] || topicsMap.jee;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const times = ['09:00', '14:00', '18:00'];
  const schedule = [];

  let idx = 0;
  days.forEach((day, dIdx) => {
    const slotsToday = dailyHours >= 6 ? 3 : (dailyHours >= 4 ? 2 : 1);
    for (let s = 0; s < slotsToday; s++) {
      const item = pool[idx % pool.length];
      idx++;
      schedule.push({
        day: day,
        time: times[s % times.length],
        duration: Math.round((dailyHours / slotsToday) * 60),
        subject: item.subject,
        topic: item.topic,
        color: item.color,
        ebbinghausTier: item.tier
      });
    }
  });

  return {
    exam_name: `${examCode.toUpperCase()} High-Retention Syllabus Plan`,
    schedule: schedule,
    matrix: {
      q1: [
        { text: `${pool[0]?.subject || "Core"}: Critical Weak Topic Practice`, subject: pool[0]?.subject || "Physics" },
        { text: "Full Timed Mock Exam Review & Error Notebook", subject: "Review" }
      ],
      q2: [
        { text: "Deep Conceptual Theory Reading & Mind-Mapping", subject: pool[1]?.subject || "Math" },
        { text: "Ebbinghaus Flashcard Repetition Deck (Tier R3/R4)", subject: "Memory" }
      ],
      q3: [
        { text: "Re-organize Study Notes and Formula Sheet", subject: "Admin" },
        { text: "Check Exam Center Schedule & Registration", subject: "Logistics" }
      ],
      q4: [
        { text: "Passive Video Watching without Active Problem Solving", subject: "Low Yield" },
        { text: "Overthinking Unweighted Ancillary Subtopics", subject: "Distraction" }
      ]
    }
  };
}

async function handleApiRequest(req, res, pathname, query) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    let payload = {};
    try { if (body) payload = JSON.parse(body); } catch (e) {}

    res.setHeader('Content-Type', 'application/json');

    if (pathname === '/api/gemini/validate-key') {
      const testKey = (payload.key || '').trim();
      if (!testKey) {
        res.writeHead(400);
        res.end(JSON.stringify({ valid: false, error: "No API key provided" }));
        return;
      }
      try {
        const testRes = await callGeminiFlash(testKey, "Respond with JSON: {\"status\":\"ok\"}", "Output valid JSON");
        res.writeHead(200);
        res.end(JSON.stringify({ valid: true, message: "Google Gemini Flash connection verified successfully!", model: "Gemini 2.5 / 3.8 Flash" }));
      } catch (err) {
        res.writeHead(200);
        res.end(JSON.stringify({ valid: false, error: err.message || "Failed to reach Gemini API with provided key" }));
      }
      return;
    }

    if (pathname === '/api/study-plan/generate') {
      const examCode = payload.exam_code || 'jee';
      const dailyHours = parseFloat(payload.daily_hours) || 4;
      const archetype = payload.archetype || 'spaced_repetition';
      const notes = payload.notes || '';
      
      const apiKey = (req.headers['x-gemini-key'] || payload.api_key || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();

      if (apiKey && apiKey !== 'your_gemini_api_key_here') {
        try {
          const sysPrompt = `You are ClearMind Pro Cognitive Curriculum Architect.
Generate an optimal, personalized 7-day revision schedule (Monday to Sunday) and a 4-quadrant Eisenhower priority matrix for a student.
Format your response STRICTLY as a single valid JSON object matching this schema:
{
  "exam_name": "string",
  "ai_model": "Google Gemini 3.8 / 2.5 Flash",
  "strategic_rationale": "2-3 sentences explaining the cognitive load balancing and spaced repetition logic for this student",
  "schedule": [
    {
      "day": "Mon|Tue|Wed|Thu|Fri|Sat|Sun",
      "time": "09:00|11:00|14:00|16:00|18:00|20:00",
      "duration": 90,
      "subject": "Physics|Chemistry|Mathematics|Biology|Computer Science|SAT Math|Reading",
      "topic": "Specific topic name",
      "color": "cyan|emerald|violet|amber|rose",
      "ebbinghausTier": "R1|R2|R3|R4|Test"
    }
  ],
  "matrix": {
    "q1": [{"text": "string", "subject": "string"}],
    "q2": [{"text": "string", "subject": "string"}],
    "q3": [{"text": "string", "subject": "string"}],
    "q4": [{"text": "string", "subject": "string"}]
  }
}`;

          const userPrompt = `Target Exam: ${examCode.toUpperCase()}
Daily Capacity: ${dailyHours} hours/day
Student Archetype: ${archetype}
Student Focus/Weak Points: ${notes || "Comprehensive high-yield coverage"}
Create between 10 to 18 realistic study sessions spread across the week with optimal cognitive spacing.`;

          const aiResult = await callGeminiFlash(apiKey, userPrompt, sysPrompt);

          if (aiResult && aiResult.schedule && Array.isArray(aiResult.schedule)) {
            res.writeHead(200);
            res.end(JSON.stringify({
              success: true,
              is_real_ai: true,
              model: "Google Gemini 3.8 / 2.5 Flash (Live AI Model)",
              exam_name: aiResult.exam_name || `${examCode.toUpperCase()} AI Schedule`,
              strategic_rationale: aiResult.strategic_rationale || "Optimized for circadian focus peaks and Ebbinghaus memory intervals.",
              schedule: aiResult.schedule,
              matrix: aiResult.matrix || buildDynamicSchedule(examCode, dailyHours, archetype, notes).matrix,
              generated_at: new Date().toISOString()
            }));
            return;
          }
        } catch (aiErr) {
          console.warn("Live Gemini API call failed, falling back to algorithmic synthesis:", aiErr.message);
        }
      }

      // High-retention Algorithmic Syllabus Fallback
      const dynamicPlan = buildDynamicSchedule(examCode, dailyHours, archetype, notes);
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        is_real_ai: false,
        model: "ClearMind Cognitive Algorithmic Engine",
        tip: "Enter your free Google Gemini API Key in the top navigation bar to activate Live Gemini 3.8 Generative AI reasoning!",
        exam_name: dynamicPlan.exam_name,
        strategic_rationale: "Synthesized based on syllabus domain weightings and circadian focus blocks.",
        schedule: dynamicPlan.schedule,
        matrix: dynamicPlan.matrix,
        generated_at: new Date().toISOString()
      }));
    } else if (pathname === '/api/leaderboard/rankings') {
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        total_active: 14820,
        rankings: [
          { rank: 1, name: "Devin Thorne", school: "MIT Campus", country: "US", flag: "🇺🇸", xp: 28450, acc: 98.4, streak: 38, tier: "Grandmaster" },
          { rank: 2, name: "Aria Chen", school: "Raffles Inst.", country: "ASIA", flag: "🇸🇬", xp: 25120, acc: 96.2, streak: 29, tier: "Master" },
          { rank: 3, name: "Kavya Sharma", school: "IIT Bombay", country: "IN", flag: "🇮🇳", xp: 22900, acc: 95.0, streak: 24, tier: "Diamond" },
          { rank: 4, name: "Marcus Vance", school: "Stanford", country: "US", flag: "🇺🇸", xp: 21800, acc: 94.2, streak: 22, tier: "Diamond" }
        ]
      }));
    } else if (pathname === '/api/battle/matchmake') {
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        match_id: `duel_${Date.now()}`,
        opponent: { name: "Kenji Sato", school: "University of Tokyo", elo: 1850, flag: "🇯🇵" },
        questions_count: 5,
        time_per_question_seconds: 15
      }));
    } else if (pathname === '/api/teacher/classes') {
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        classes: [
          { id: "phys101", name: "AP Physics C (Section A)", enrolled: 34, avg_mastery: 84.2 },
          { id: "chem202", name: "Organic Chemistry Honors", enrolled: 28, avg_mastery: 79.5 },
          { id: "calc303", name: "Calculus BC Advanced", enrolled: 31, avg_mastery: 88.1 }
        ]
      }));
    } else if (pathname === '/api/parent/digest') {
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        digest: {
          student_name: payload.student_name || "Alex Rivera",
          headline_summary: "Alex logged 28.5 hours with a 14-day streak, achieving 91.4% accuracy across Calculus and Physics!",
          weekly_study_hours: 28.5,
          top_strength: "Exceptional mastery in Differential Equations and Faraday's Law.",
          area_needing_encouragement: "Encourage 30 minutes earlier bedtime on Tuesday evenings for memory consolidation."
        }
      }));
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, message: "ClearMind Pro API active", endpoint: pathname }));
    }
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n=============================================================`);
  console.log(`   ClearMind Pro — Multi-Modal AI Educational Ecosystem      `);
  console.log(`=============================================================`);
  console.log(`  [*] Running on: http://localhost:${PORT}`);
  console.log(`  [*] Network URL: http://127.0.0.1:${PORT}`);
  console.log(`  [*] Classroom:   http://localhost:${PORT}/app`);
  console.log(`  [*] Planner:     http://localhost:${PORT}/study-planner`);
  console.log(`  [*] Leaderboard: http://localhost:${PORT}/leaderboard`);
  console.log(`  [*] Teacher:     http://localhost:${PORT}/teacher`);
  console.log(`  [*] Parents:     http://localhost:${PORT}/parent`);
  console.log(`=============================================================\n`);
});
