/**
 * ClearMind Pro - 3x Upgraded Adaptive Academic Onboarding Controller
 * Multi-step intelligent wizard with dynamic academic branching,
 * student identity integration, AI teaching persona selection,
 * reactive Luna speech bubble, holographic cockpit calibration, and confetti launch.
 */

window.OnboardingWizard = {
  currentStep: 1,
  totalSteps: 5,
  academicDb: null,
  profile: {
    user: { name: 'Prakhar', isGuest: true },
    identity: 'school',
    subDetails: {},
    subjects: [],
    persona: 'mentor', // mentor, strict, polymath
    learningStyles: ['visual', 'socratic'],
    dailyRhythm: '30m', // 15m, 30m, 60m
    pacing: 'accelerated',
    targetGoal: 'Semester Finals & Core Mastery',
    calibratedAt: null
  },

  async init() {
    await this.loadAcademicDb();
    this.bindEvents();
  },

  async loadAcademicDb() {
    try {
      const res = await fetch('./academic_db.json');
      if (res.ok) {
        this.academicDb = await res.json();
      } else {
        throw new Error('Fallback to default');
      }
    } catch (e) {
      console.warn('Loading fallback academic data:', e);
      this.academicDb = this.getFallbackDb();
    }
  },

  getFallbackDb() {
    return {
      school: {
        grades: [
          { id: 'class_9', label: 'Class 9 (High School)' },
          { id: 'class_10', label: 'Class 10 (Board Exam)' },
          { id: 'class_11', label: 'Class 11 (Senior Secondary)' },
          { id: 'class_12', label: 'Class 12 (Board Prep)' }
        ],
        streams: {
          science_pcm: { label: 'Science (PCM)', subjects: ['Physics', 'Chemistry', 'Mathematics', 'Computer Science'] },
          science_pcb: { label: 'Science (PCB / NEET)', subjects: ['Physics', 'Chemistry', 'Biology', 'English'] },
          commerce: { label: 'Commerce', subjects: ['Accountancy', 'Business Studies', 'Economics', 'Applied Math'] },
          humanities: { label: 'Arts & Humanities', subjects: ['History', 'Political Science', 'Psychology', 'Sociology'] }
        },
        general_subjects: ['Mathematics', 'Science', 'Social Studies', 'English']
      },
      college: {
        programs: [
          { id: 'btech_cse', label: 'B.Tech / B.E. - Computer Science & Engineering', subjects: ['Data Structures & Algorithms', 'Operating Systems', 'Database Management', 'Computer Networks', 'AI & Machine Learning'] },
          { id: 'btech_ece', label: 'B.Tech / B.E. - Electronics & Communication', subjects: ['Signals & Systems', 'Digital Circuit Design', 'Microprocessors', 'VLSI Design'] },
          { id: 'medical_mbbs', label: 'MBBS / Medical Sciences', subjects: ['Human Gross Anatomy', 'Medical Physiology', 'Biochemistry', 'Pharmacology'] },
          { id: 'commerce_bcom_bba', label: 'B.Com / BBA / Finance', subjects: ['Financial Accounting', 'Corporate Finance', 'Marketing', 'Business Law'] }
        ],
        years: ['1st Year (Freshman)', '2nd Year (Sophomore)', '3rd Year (Junior)', '4th Year (Senior)']
      },
      self_learner: {
        domains: [
          { id: 'ai_ml', label: 'AI, LLMs & Machine Learning', subjects: ['Prompt Engineering & Agents', 'Machine Learning Fundamentals', 'PyTorch & Neural Networks', 'NLP & Transformers'] },
          { id: 'fullstack', label: 'Modern Full-Stack Development', subjects: ['FastAPI & Async Python', 'React & Next.js', 'System Design & Scalability', 'PostgreSQL & Databases'] },
          { id: 'finance', label: 'Economics & Quantitative Finance', subjects: ['Financial Modeling', 'Algorithmic Trading', 'Macroeconomics', 'Risk Management'] }
        ]
      },
      parent: {
        focusAreas: [
          { id: 'foundation_math', label: 'Foundation Mathematics & Mental Math', subjects: ['Basic Arithmetic & Fractions', 'Word Problems', 'Visual Geometry', 'Logic Puzzles'] },
          { id: 'foundation_science', label: 'Science Curiosities & Experiments', subjects: ['Solar System & Planets', 'Human Body & Health', 'Plant Life & Ecosystems'] }
        ]
      }
    };
  },

  bindEvents() {
    document.querySelectorAll('[data-open-onboarding]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.open(window.AuthEngine?.currentUser || { name: 'Prakhar', isGuest: true });
      });
    });

    document.getElementById('closeOnboardingBtn')?.addEventListener('click', () => {
      this.close();
    });

    document.getElementById('onboardingBackBtn')?.addEventListener('click', () => {
      this.prevStep();
    });

    document.getElementById('mobileHeaderBackBtn')?.addEventListener('click', () => {
      this.prevStep();
    });

    document.getElementById('onboardingNextBtn')?.addEventListener('click', () => {
      this.nextStep();
    });

    // Step 1: Identity Cards
    document.querySelectorAll('.identity-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const id = card.getAttribute('data-identity');
        if (id) this.selectIdentity(id);
      });
    });

    // Step 4: User Name Input (Live Speech Bubble Reaction)
    const nameInput = document.getElementById('onboardingUserNameInput');
    nameInput?.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      this.profile.user.name = val || 'Learner';
      this.updateLunaBubble();
    });

    // Step 4: Persona Selection Cards (Supports all 6 AI Personas)
    document.querySelectorAll('#personaOptions .persona-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const p = card.getAttribute('data-persona');
        if (p) this.selectPersona(p);
      });
    });

    // Step 3: Add Custom Subject
    document.getElementById('addSubjectBtn')?.addEventListener('click', () => {
      this.addCustomSubject();
    });
    document.getElementById('customSubjectInput')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.addCustomSubject();
      }
    });

    // Step 5: Launch Button
    document.getElementById('launchClearMindBtn')?.addEventListener('click', () => {
      this.launchApp();
    });
  },

  selectIdentity(identity) {
    this.profile.identity = identity;
    document.querySelectorAll('.identity-card').forEach(c => {
      if (c.getAttribute('data-identity') === identity) {
        c.classList.add('selected');
      } else {
        c.classList.remove('selected');
      }
    });
    const otherInput = document.getElementById('otherIdentityInputContainer');
    if (identity === 'other') {
      otherInput?.classList.remove('hidden');
    } else {
      otherInput?.classList.add('hidden');
    }
  },

  selectPersona(persona) {
    this.profile.persona = persona;
    document.querySelectorAll('#personaOptions .persona-card').forEach(c => {
      if (c.getAttribute('data-persona') === persona) {
        c.classList.add('selected');
      } else {
        c.classList.remove('selected');
      }
    });
    this.updateLunaBubble();
  },

  open(user) {
    if (user && user.name && user.name !== 'Guest Learner') {
      this.profile.user = user;
    } else {
      this.profile.user = { name: 'Prakhar', isGuest: true };
    }

    const nameInput = document.getElementById('onboardingUserNameInput');
    if (nameInput) nameInput.value = this.profile.user.name;

    const modal = document.getElementById('onboardingModal');
    if (modal) {
      modal.classList.add('active');
      this.currentStep = 1;
      this.renderStep(1);
    }
  },

  close() {
    const modal = document.getElementById('onboardingModal');
    if (modal) modal.classList.remove('active');
  },

  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
      this.renderStep(this.currentStep);
    }
  },

  nextStep() {
    if (this.validateStep(this.currentStep)) {
      if (this.currentStep < this.totalSteps) {
        this.currentStep++;
        this.renderStep(this.currentStep);
      } else {
        this.launchApp();
      }
    }
  },

  validateStep(step) {
    if (step === 1) {
      if (this.profile.identity === 'other') {
        const val = document.getElementById('customIdentityInput')?.value.trim();
        if (!val) {
          alert('Please enter your learning domain or goal.');
          return false;
        }
        this.profile.subDetails.customRole = val;
      }
      return true;
    }
    if (step === 2) {
      this.harvestStep2Data();
      return true;
    }
    if (step === 3) {
      if (!this.profile.subjects || this.profile.subjects.length === 0) {
        alert('Please select or add at least one subject.');
        return false;
      }
      return true;
    }
    if (step === 4) {
      const nameVal = document.getElementById('onboardingUserNameInput')?.value.trim();
      if (nameVal) {
        this.profile.user.name = nameVal;
      }
      return true;
    }
    return true;
  },

  updateLunaBubble() {
    const bubbleText = document.getElementById('lunaBubbleText');
    if (!bubbleText) return;

    const name = this.profile.user?.name || 'Learner';
    const persona = this.profile.persona || 'mentor';

    const personaGreetings = {
      mentor: `Hey ${name}! I'm configured as your Encouraging Mentor. I'll guide you step-by-step with warm encouragement and intuitive real-world analogies. Let's conquer your syllabus together!`,
      strict: `Understood, ${name}. Strict Examiner mode engaged. I will challenge your logic, test subtle edge cases, and eliminate exam blind spots with zero fluff.`,
      polymath: `Welcome, ${name}. Operating in First-Principles mode. We will derive core laws from scratch, emphasizing mathematical rigor and fundamental scientific proofs.`,
      socratic: `Greetings, ${name}. Socratic Guide active. I won't just hand you answers; I'll ask probing questions that empower you to discover the breakthrough insight yourself!`,
      hacker: `Let's crack this syllabus, ${name}! Blitz Exam Hacker ready. We'll bypass low-yield theory and drill high-yield patterns, formula shortcuts, and speed tricks.`,
      feynman: `Hey ${name}! Feynman ELI5 mode engaged. Forget dry academic jargon—we'll break down even the toughest concepts into crystal-clear intuition anyone can grasp.`
    };

    bubbleText.textContent = personaGreetings[persona] || personaGreetings.mentor;
  },

  renderStep(step) {
    const percent = ((step - 1) / (this.totalSteps - 1)) * 100;
    const progressFill = document.getElementById('onboardingProgressBar');
    if (progressFill) progressFill.style.width = percent + '%';

    const stepTitles = [
      'Step 1 of 5 • Tier & Identity',
      'Step 2 of 5 • Stream & Program',
      'Step 3 of 5 • Syllabus Radar',
      'Step 4 of 5 • AI Teaching Persona',
      'Step 5 of 5 • Neural Cockpit'
    ];
    const stepBadge = document.getElementById('onboardingStepBadge');
    if (stepBadge) stepBadge.textContent = stepTitles[step - 1] || ('Step ' + step + ' of ' + this.totalSteps);

    for (let i = 1; i <= this.totalSteps; i++) {
      const el = document.getElementById('onboardingStep' + i);
      if (el) el.classList.add('hidden');
    }

    const currentEl = document.getElementById('onboardingStep' + step);
    if (currentEl) currentEl.classList.remove('hidden');

    const backBtn = document.getElementById('onboardingBackBtn');
    const mobileBackBtn = document.getElementById('mobileHeaderBackBtn');
    const nextBtn = document.getElementById('onboardingNextBtn');
    const launchBtn = document.getElementById('launchClearMindBtn');

    if (backBtn) backBtn.style.display = step === 1 ? 'none' : 'inline-flex';
    if (mobileBackBtn) mobileBackBtn.style.display = step === 1 ? 'none' : 'inline-flex';

    if (step === this.totalSteps) {
      if (nextBtn) nextBtn.style.display = 'none';
      if (launchBtn) launchBtn.style.display = 'inline-flex';
      this.renderCalibrationSummary();
    } else {
      if (nextBtn) {
        nextBtn.style.display = 'inline-flex';
        nextBtn.textContent = step === this.totalSteps - 1 ? 'Review Calibration Cockpit →' : 'Continue →';
      }
      if (launchBtn) launchBtn.style.display = 'none';
    }

    if (step === 1) {
      this.selectIdentity(this.profile.identity || 'school');
    } else if (step === 2) {
      this.populateStep2AcademicTree();
    } else if (step === 3) {
      this.populateStep3Subjects();
    } else if (step === 4) {
      this.selectPersona(this.profile.persona || 'mentor');
    }
  },

  populateStep2AcademicTree() {
    const container = document.getElementById('academicTreeContainer');
    if (!container) return;
    const identity = this.profile.identity;
    let html = '';

    if (identity === 'school') {
      const grades = this.academicDb?.school?.grades || [];
      html = '<div class="space-y-4">' +
        '<div><label class="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Select Grade / Class</label>' +
        '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2" id="schoolGradeOptions">' +
        grades.map((g, idx) => '<button type="button" class="academic-chip-btn p-3 rounded-xl border border-white/10 bg-white/5 hover:border-cyan-500/50 text-left transition-all ' + (idx === 4 || (grades.length <= 4 && idx === 0) ? 'active border-cyan-500 bg-cyan-500/10' : '') + '" data-grade="' + g.id + '"><div class="text-xs sm:text-sm font-semibold text-white">' + (g.label || g.name || g.id) + '</div></button>').join('') +
        '</div></div>' +
        '<div id="schoolStreamContainer" class="pt-2"><label class="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Select Stream / Track</label>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2" id="schoolStreamOptions"></div></div>' +
        '</div>';
      container.innerHTML = html;
      this.bindSchoolEvents();

    } else if (identity === 'college') {
      const programs = this.academicDb?.college?.programs || this.academicDb?.college?.degrees || [];
      html = '<div class="space-y-4">' +
        '<div><label class="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Degree / Program</label>' +
        '<select id="collegeDegreeSelect" class="w-full bg-slate-900/90 border border-white/15 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-cyan-500">' +
        programs.map(d => '<option value="' + d.id + '">' + (d.label || d.name) + '</option>').join('') +
        '</select></div>' +
        '<div><label class="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Current Academic Year</label>' +
        '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2" id="collegeYearOptions"></div></div>' +
        '</div>';
      container.innerHTML = html;
      this.bindCollegeEvents();

    } else if (identity === 'self_learner') {
      const domains = this.academicDb?.self_learner?.domains || [];
      html = '<div class="space-y-4"><label class="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Select Primary Learning Track</label>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3" id="selfLearnerDomainOptions">' +
        domains.map((d, idx) => '<div class="domain-card p-4 rounded-xl border border-white/10 bg-white/5 hover:border-cyan-500/50 cursor-pointer transition-all ' + (idx === 0 ? 'selected border-cyan-500 bg-cyan-500/10' : '') + '" data-domain="' + d.id + '"><div class="text-sm font-bold text-white mb-1">' + (d.label || d.name) + '</div><div class="text-xs text-gray-400">' + (d.subjects || []).join(' • ') + '</div></div>').join('') +
        '</div></div>';
      container.innerHTML = html;
      this.bindSelfLearnerEvents();

    } else if (identity === 'parent') {
      const focusAreas = this.academicDb?.parent?.focusAreas || this.academicDb?.parent?.focus_areas || [];
      html = '<div class="space-y-4">' +
        '<div><label class="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Student Grade / Level</label>' +
        '<input type="text" id="parentStudentGradeInput" placeholder="e.g. 8th Grade" value="8th Grade" class="w-full bg-slate-900/90 border border-white/15 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-cyan-500" /></div>' +
        '<div><label class="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Primary Focus Area</label>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3" id="parentFocusOptions">' +
        focusAreas.map((f, idx) => '<div class="parent-focus-card p-4 rounded-xl border border-white/10 bg-white/5 hover:border-cyan-500/50 cursor-pointer transition-all ' + (idx === 0 ? 'selected border-cyan-500 bg-cyan-500/10' : '') + '" data-focus="' + f.id + '"><div class="text-sm font-bold text-white mb-1">' + (f.label || f.name) + '</div><div class="text-xs text-gray-400">' + (f.subjects || []).join(' • ') + '</div></div>').join('') +
        '</div></div></div>';
      container.innerHTML = html;
      this.bindParentEvents();

    } else {
      html = '<div class="space-y-4">' +
        '<div><label class="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Learning Goal or Target Curriculum</label>' +
        '<input type="text" id="otherCurriculumInput" placeholder="e.g. Competitive Coding, UPSC, CFA" value="Self-Directed Mastery" class="w-full bg-slate-900/90 border border-white/15 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-cyan-500" /></div>' +
        '<div><label class="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Target Horizon</label>' +
        '<div class="grid grid-cols-3 gap-2">' +
        '<button type="button" class="horizon-pill p-3 rounded-xl border border-white/10 bg-white/5 active text-xs font-semibold text-center text-white" data-horizon="30days">30 Days Sprint</button>' +
        '<button type="button" class="horizon-pill p-3 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-center text-white" data-horizon="90days">3 Months Deep</button>' +
        '<button type="button" class="horizon-pill p-3 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-center text-white" data-horizon="ongoing">Continuous</button>' +
        '</div></div></div>';
      container.innerHTML = html;
      this.bindOtherEvents();
    }
  },

  bindSchoolEvents() {
    const grades = this.academicDb?.school?.grades || [];
    const streamsObj = this.academicDb?.school?.streams || {};
    const streamKeys = Object.keys(streamsObj);

    const updateStreams = (gradeId) => {
      const streamContainer = document.getElementById('schoolStreamOptions');
      if (!streamContainer) return;

      const isSenior = gradeId === 'class_11' || gradeId === 'class_12';
      let availableStreams = [];
      if (isSenior && streamKeys.length > 0) {
        availableStreams = streamKeys.map(k => ({ key: k, label: streamsObj[k].label }));
      } else {
        availableStreams = [{ key: 'general', label: 'General Foundation Curriculum' }];
      }

      streamContainer.innerHTML = availableStreams.map((s, idx) => '<button type="button" class="stream-chip-btn p-3 rounded-xl border border-white/10 bg-white/5 hover:border-cyan-500/50 text-left transition-all ' + (idx === 0 ? 'active border-cyan-500 bg-cyan-500/10' : '') + '" data-stream="' + s.key + '"><div class="text-xs font-semibold text-white">' + s.label + '</div></button>').join('');

      streamContainer.querySelectorAll('.stream-chip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          streamContainer.querySelectorAll('.stream-chip-btn').forEach(b => b.classList.remove('active', 'border-cyan-500', 'bg-cyan-500/10'));
          btn.classList.add('active', 'border-cyan-500', 'bg-cyan-500/10');
          this.profile.subDetails.stream = btn.getAttribute('data-stream');
        });
      });
      this.profile.subDetails.stream = availableStreams[0]?.key || 'general';
    };

    document.querySelectorAll('#schoolGradeOptions .academic-chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#schoolGradeOptions .academic-chip-btn').forEach(b => b.classList.remove('active', 'border-cyan-500', 'bg-cyan-500/10'));
        btn.classList.add('active', 'border-cyan-500', 'bg-cyan-500/10');
        const gid = btn.getAttribute('data-grade');
        this.profile.subDetails.grade = gid;
        updateStreams(gid);
      });
    });

    const initialBtn = document.querySelector('#schoolGradeOptions .academic-chip-btn.active') || document.querySelector('#schoolGradeOptions .academic-chip-btn');
    if (initialBtn) {
      initialBtn.classList.add('active', 'border-cyan-500', 'bg-cyan-500/10');
      this.profile.subDetails.grade = initialBtn.getAttribute('data-grade');
      updateStreams(this.profile.subDetails.grade);
    }
  },

  bindCollegeEvents() {
    const programs = this.academicDb?.college?.programs || this.academicDb?.college?.degrees || [];
    const collegeYears = this.academicDb?.college?.years || ['1st Year (Freshman)', '2nd Year (Sophomore)', '3rd Year (Junior)', '4th Year (Senior)'];
    const select = document.getElementById('collegeDegreeSelect');
    const yearContainer = document.getElementById('collegeYearOptions');

    const updateYears = (degId) => {
      const prog = programs.find(d => d.id === degId) || programs[0] || { id: 'btech_cse', label: 'B.Tech CSE' };
      const years = prog.years || collegeYears;
      if (!yearContainer) return;

      yearContainer.innerHTML = years.map((y, idx) => '<button type="button" class="year-chip-btn p-3 rounded-xl border border-white/10 bg-white/5 hover:border-cyan-500/50 text-center transition-all ' + (idx === 2 || (years.length === 1 && idx === 0) ? 'active border-cyan-500 bg-cyan-500/10' : '') + '" data-year="' + y + '"><div class="text-xs font-semibold text-white">' + y + '</div></button>').join('');

      yearContainer.querySelectorAll('.year-chip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          yearContainer.querySelectorAll('.year-chip-btn').forEach(b => b.classList.remove('active', 'border-cyan-500', 'bg-cyan-500/10'));
          btn.classList.add('active', 'border-cyan-500', 'bg-cyan-500/10');
          this.profile.subDetails.year = btn.getAttribute('data-year');
        });
      });

      const activeBtn = yearContainer.querySelector('.year-chip-btn.active') || yearContainer.querySelector('.year-chip-btn');
      if (activeBtn) {
        activeBtn.classList.add('active', 'border-cyan-500', 'bg-cyan-500/10');
        this.profile.subDetails.year = activeBtn.getAttribute('data-year');
      }
      this.profile.subDetails.degree = prog.label || prog.name;
      this.profile.subDetails.degreeId = prog.id;
    };

    select?.addEventListener('change', () => updateYears(select.value));
    if (select && select.value) updateYears(select.value);
  },

  bindSelfLearnerEvents() {
    const cards = document.querySelectorAll('#selfLearnerDomainOptions .domain-card');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('selected', 'border-cyan-500', 'bg-cyan-500/10'));
        card.classList.add('selected', 'border-cyan-500', 'bg-cyan-500/10');
        this.profile.subDetails.domain = card.getAttribute('data-domain');
      });
    });
    this.profile.subDetails.domain = cards[0]?.getAttribute('data-domain') || 'ai_ml';
  },

  bindParentEvents() {
    const cards = document.querySelectorAll('#parentFocusOptions .parent-focus-card');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('selected', 'border-cyan-500', 'bg-cyan-500/10'));
        card.classList.add('selected', 'border-cyan-500', 'bg-cyan-500/10');
        this.profile.subDetails.focus = card.getAttribute('data-focus');
      });
    });
    this.profile.subDetails.focus = cards[0]?.getAttribute('data-focus') || 'foundation_math';
  },

  bindOtherEvents() {
    const pills = document.querySelectorAll('.horizon-pill');
    pills.forEach(pill => {
      pill.addEventListener('click', () => {
        pills.forEach(p => p.classList.remove('active', 'border-cyan-500', 'bg-cyan-500/10'));
        pill.classList.add('active', 'border-cyan-500', 'bg-cyan-500/10');
        this.profile.subDetails.horizon = pill.getAttribute('data-horizon');
      });
    });
    this.profile.subDetails.horizon = '30days';
  },

  harvestStep2Data() {
    const identity = this.profile.identity;
    if (identity === 'school') {
      const activeGrade = document.querySelector('#schoolGradeOptions .academic-chip-btn.active');
      const activeStream = document.querySelector('#schoolStreamOptions .stream-chip-btn.active');
      this.profile.subDetails.grade = activeGrade ? activeGrade.querySelector('div')?.textContent.trim() : 'Class 11';
      this.profile.subDetails.stream = activeStream ? activeStream.getAttribute('data-stream') : 'science_pcm';
    } else if (identity === 'college') {
      const select = document.getElementById('collegeDegreeSelect');
      const activeYear = document.querySelector('#collegeYearOptions .year-chip-btn.active');
      const selectedOpt = select && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
      this.profile.subDetails.degreeId = select?.value || 'btech_cse';
      this.profile.subDetails.degree = selectedOpt ? selectedOpt.text : 'B.Tech CSE';
      this.profile.subDetails.year = activeYear ? activeYear.textContent.trim() : '3rd Year';
    } else if (identity === 'parent') {
      const gradeInput = document.getElementById('parentStudentGradeInput');
      this.profile.subDetails.studentGrade = gradeInput?.value.trim() || '8th Grade';
    } else if (identity === 'other') {
      const currInput = document.getElementById('otherCurriculumInput');
      this.profile.subDetails.curriculum = currInput?.value.trim() || 'Specialized Track';
    }
  },

  populateStep3Subjects() {
    let autoSubjects = [];
    const identity = this.profile.identity;

    if (identity === 'school') {
      const stream = this.profile.subDetails.stream || 'science_pcm';
      autoSubjects = this.academicDb?.school?.streams?.[stream]?.subjects || 
                     this.academicDb?.school?.stream_subjects?.[stream] || 
                     this.academicDb?.school?.general_subjects || 
                     ['Physics', 'Chemistry', 'Mathematics', 'Computer Science'];
    } else if (identity === 'college') {
      const degId = this.profile.subDetails.degreeId || 'btech_cse';
      const programs = this.academicDb?.college?.programs || this.academicDb?.college?.degrees || [];
      const degObj = programs.find(d => d.id === degId) || programs[0];
      autoSubjects = degObj?.subjects || ['Data Structures & Algorithms', 'Operating Systems', 'Database Management', 'Computer Networks'];
    } else if (identity === 'self_learner') {
      const domId = this.profile.subDetails.domain || 'ai_ml';
      const domains = this.academicDb?.self_learner?.domains || [];
      const domObj = domains.find(d => d.id === domId) || domains[0];
      autoSubjects = domObj?.subjects || ['Full-Stack Architecture', 'APIs & Databases', 'System Design'];
    } else if (identity === 'parent') {
      const focId = this.profile.subDetails.focus || 'foundation_math';
      const focusAreas = this.academicDb?.parent?.focusAreas || this.academicDb?.parent?.focus_areas || [];
      const focObj = focusAreas.find(f => f.id === focId) || focusAreas[0];
      autoSubjects = focObj?.subjects || ['Foundational Math', 'Intuitive Science', 'Logical Reasoning'];
    } else {
      autoSubjects = ['Core Concepts', 'Advanced Problem Solving', 'Applied Synthesis'];
    }

    this.profile.subjects = autoSubjects.map((s, idx) => ({
      name: s,
      priority: idx === 0 ? 'high' : idx === 1 ? 'med' : 'normal'
    }));

    this.renderSubjectList();
  },

  renderSubjectList() {
    const container = document.getElementById('subjectListContainer');
    if (!container) return;

    if (this.profile.subjects.length === 0) {
      container.innerHTML = '<div class="p-6 text-center text-sm text-gray-400 bg-white/5 rounded-2xl border border-dashed border-white/10">No subjects selected. Add one below!</div>';
      return;
    }

    container.innerHTML = this.profile.subjects.map((sub, idx) => {
      const isHigh = sub.priority === 'high';
      const isMed = sub.priority === 'med';
      const isNormal = sub.priority === 'normal';

      const priorityIcon = isHigh ? '🔴' : isMed ? '🟡' : '🔵';
      const priorityLabel = isHigh ? 'High Priority • Intensive Focus' : isMed ? 'Medium Priority • Standard Pace' : 'Normal Priority • Foundation';
      const priorityColor = isHigh ? 'text-red-400' : isMed ? 'text-amber-400' : 'text-blue-400';

      return (
        '<div class="p-3 sm:p-4 rounded-2xl border border-white/10 bg-slate-900/80 hover:border-cyan-500/40 transition-all space-y-2.5 shadow-md shadow-black/30">' +
          // Row 1: Subject Icon + Full-width Title + Dedicated Delete Button
          '<div class="flex items-start justify-between gap-3">' +
            '<div class="flex items-start gap-2.5 min-w-0 flex-1">' +
              '<span class="text-base shrink-0 mt-0.5">' + priorityIcon + '</span>' +
              '<div class="min-w-0 flex-1">' +
                '<div class="text-sm sm:text-base font-bold text-white leading-snug break-words">' + sub.name + '</div>' +
                '<div class="text-[11px] font-semibold ' + priorityColor + ' mt-0.5">' + priorityLabel + '</div>' +
              '</div>' +
            '</div>' +
            '<button type="button" class="w-8 h-8 rounded-xl bg-white/5 hover:bg-red-500/20 active:scale-95 text-gray-400 hover:text-red-400 flex items-center justify-center text-xs transition-all shrink-0 touch-scale" title="Remove" onclick="window.OnboardingWizard.removeSubject(' + idx + ')">✕</button>' +
          '</div>' +

          // Row 2: Full-width Segmented Priority Toggle (Wide Touch Targets for Android)
          '<div class="grid grid-cols-3 gap-1 bg-black/60 p-1 rounded-xl border border-white/10">' +
            '<button type="button" class="py-2 px-1 rounded-lg text-center font-bold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-1 touch-scale ' + (isHigh ? 'bg-red-500 text-white shadow-md shadow-red-500/30' : 'text-gray-400 hover:text-white') + '" onclick="window.OnboardingWizard.setPriority(' + idx + ', \'high\')">' +
              '<span>🔴</span> High' +
            '</button>' +
            '<button type="button" class="py-2 px-1 rounded-lg text-center font-bold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-1 touch-scale ' + (isMed ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30' : 'text-gray-400 hover:text-white') + '" onclick="window.OnboardingWizard.setPriority(' + idx + ', \'med\')">' +
              '<span>🟡</span> Med' +
            '</button>' +
            '<button type="button" class="py-2 px-1 rounded-lg text-center font-bold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-1 touch-scale ' + (isNormal ? 'bg-blue-500 text-white shadow-md shadow-blue-500/30' : 'text-gray-400 hover:text-white') + '" onclick="window.OnboardingWizard.setPriority(' + idx + ', \'normal\')">' +
              '<span>🔵</span> Normal' +
            '</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  },

  setPriority(index, priority) {
    if (this.profile.subjects[index]) {
      this.profile.subjects[index].priority = priority;
      this.renderSubjectList();
    }
  },

  removeSubject(index) {
    this.profile.subjects.splice(index, 1);
    this.renderSubjectList();
  },

  addCustomSubject() {
    const input = document.getElementById('customSubjectInput');
    const name = input?.value.trim();
    if (!name) return;

    if (this.profile.subjects.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      alert('This subject is already in your list!');
      return;
    }

    this.profile.subjects.push({
      name: name,
      priority: 'high'
    });

    if (input) input.value = '';
    this.renderSubjectList();
  },

  renderCalibrationSummary() {
    const card = document.getElementById('calibrationSummaryCard');
    if (!card) return;

    const studentName = this.profile.user?.name || 'Prakhar';
    const identity = this.profile.identity;
    let headerDetail = '';

    const streamMap = {
      'general': 'General Foundation',
      'science_pcm': 'Science (PCM)',
      'science_pcb': 'Science (PCB)',
      'commerce': 'Commerce & Economics',
      'arts': 'Humanities & Social Sciences'
    };

    if (identity === 'school') {
      const rawStream = this.profile.subDetails.stream || 'general';
      const cleanStream = streamMap[rawStream] || rawStream;
      headerDetail = (this.profile.subDetails.grade || 'Class 10') + ' • ' + cleanStream;
    } else if (identity === 'college') {
      headerDetail = (this.profile.subDetails.degree || 'B.Tech CSE') + ' (' + (this.profile.subDetails.year || '3rd Year') + ')';
    } else if (identity === 'self_learner') {
      headerDetail = 'Self-Learner • ' + (this.profile.subDetails.domain || 'AI_ML').toUpperCase();
    } else if (identity === 'parent') {
      headerDetail = 'Parent / Student: ' + (this.profile.subDetails.studentGrade || '8th Grade');
    } else {
      headerDetail = this.profile.subDetails.curriculum || 'Custom Curriculum';
    }

    const highSubjects = this.profile.subjects.filter(s => s.priority === 'high');
    const medSubjects = this.profile.subjects.filter(s => s.priority === 'med');
    const normalSubjects = this.profile.subjects.filter(s => s.priority === 'normal');

    const personaLabels = {
      mentor: { title: 'Encouraging Mentor', desc: 'Metaphorical Guidance' },
      strict: { title: 'Strict Examiner', desc: 'Rigor & Edge Cases' },
      polymath: { title: 'First-Principles', desc: 'Formal Proofs' },
      socratic: { title: 'Socratic Guide', desc: 'Active Inquisitor' },
      hacker: { title: 'Exam Hacker', desc: 'High-Yield Speed' },
      feynman: { title: 'Feynman ELI5', desc: 'Intuitive Models' }
    };
    const currentPersona = personaLabels[this.profile.persona] || personaLabels.mentor;

    const rhythmLabel = this.profile.dailyRhythm === '15m' ? '15m Micro' : this.profile.dailyRhythm === '60m' ? '60m+ Sprint' : '30m Focus';

    const stylesLabel = this.profile.learningStyles.map(s => {
      if (s === 'visual') return '📊 Visual Mind Maps';
      if (s === 'socratic') return '💬 Socratic Probing';
      if (s === 'cheat_sheets') return '⚡ 60s Cheatsheets';
      if (s === 'quiz_first') return '🎯 Practice First';
      return s;
    }).join(' • ');

    card.innerHTML = 
      '<div class="holographic-glow p-4 sm:p-6 relative overflow-hidden backdrop-blur-2xl rounded-2xl">' +
        // Ambient background glow
        '<div class="absolute -top-20 -right-20 w-48 h-48 rounded-full bg-cyan-500/15 blur-3xl pointer-events-none"></div>' +
        '<div class="absolute -bottom-20 -left-20 w-48 h-48 rounded-full bg-blue-600/15 blur-3xl pointer-events-none"></div>' +

        // Header
        '<div class="flex items-center justify-between gap-3 border-b border-white/10 pb-4 mb-4">' +
          '<div class="flex items-center gap-3">' +
            '<div class="w-11 h-11 rounded-xl bg-gradient-to-tr from-cyan-500/30 to-blue-600/30 border border-cyan-400/50 flex items-center justify-center text-xl shadow-lg shadow-cyan-500/20 shrink-0">' +
              '⚡' +
            '</div>' +
            '<div class="min-w-0">' +
              '<div class="flex items-center gap-2 flex-wrap">' +
                '<h4 class="text-base sm:text-lg font-black text-white tracking-tight truncate">' + studentName + '\'s Cognitive Cockpit</h4>' +
                '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">' +
                  '● READY' +
                '</span>' +
              '</div>' +
              '<p class="text-xs text-cyan-300 font-mono mt-0.5 truncate">' + headerDetail + '</p>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Bento Metrics Grid (2x2 on mobile, 4-col on desktop!)
        '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-4">' +
          '<div class="p-3 rounded-xl border border-cyan-500/30 bg-cyan-500/5 flex flex-col justify-between">' +
            '<div class="text-[10px] font-mono text-gray-400 uppercase tracking-wider">AI Persona</div>' +
            '<div class="text-xs font-bold text-white mt-1">' + currentPersona.title + '</div>' +
            '<div class="text-[10px] text-cyan-400 mt-0.5 truncate">' + currentPersona.desc + '</div>' +
          '</div>' +

          '<div class="p-3 rounded-xl border border-white/10 bg-white/[0.03] flex flex-col justify-between">' +
            '<div class="text-[10px] font-mono text-gray-400 uppercase tracking-wider">Syllabus Radar</div>' +
            '<div class="text-xs font-bold text-white mt-1">' + this.profile.subjects.length + ' Subjects</div>' +
            '<div class="text-[10px] mt-0.5 flex items-center gap-1 font-semibold">' +
              '<span class="text-red-400">' + highSubjects.length + ' High</span> • <span class="text-amber-400">' + medSubjects.length + ' Med</span>' +
            '</div>' +
          '</div>' +

          '<div class="p-3 rounded-xl border border-white/10 bg-white/[0.03] flex flex-col justify-between">' +
            '<div class="text-[10px] font-mono text-gray-400 uppercase tracking-wider">Memory Retention</div>' +
            '<div class="text-xs font-bold text-emerald-400 mt-1">SM-2 Spaced</div>' +
            '<div class="text-[10px] font-mono text-gray-400 mt-0.5">R = e^(-t/S)</div>' +
          '</div>' +

          '<div class="p-3 rounded-xl border border-white/10 bg-white/[0.03] flex flex-col justify-between">' +
            '<div class="text-[10px] font-mono text-gray-400 uppercase tracking-wider">Cognitive Engine</div>' +
            '<div class="text-xs font-bold text-cyan-300 mt-1">Gemini & GLM-4</div>' +
            '<div class="text-[10px] text-gray-400 mt-0.5">Low-Latency Neural</div>' +
          '</div>' +
        '</div>' +

        // Calibrated Subjects Pills
        '<div class="p-3 rounded-xl border border-white/10 bg-black/40">' +
          '<div class="text-[10px] font-mono text-gray-400 uppercase tracking-wider mb-2">Tracked Priority Curriculum:</div>' +
          '<div class="flex flex-wrap gap-1.5">' +
            this.profile.subjects.map(s => 
              '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border ' + 
              (s.priority === 'high' ? 'bg-red-500/15 border-red-500/30 text-red-300' : s.priority === 'med' ? 'bg-amber-500/15 border-amber-500/30 text-amber-300' : 'bg-blue-500/15 border-blue-500/30 text-blue-300') + 
              '"><span>' + (s.priority === 'high' ? '🔴' : s.priority === 'med' ? '🟡' : '🔵') + '</span><span>' + s.name + '</span></span>'
            ).join('') +
          '</div>' +
        '</div>' +
      '</div>';
  },

  launchApp() {
    this.profile.calibratedAt = new Date().toISOString();
    this.profile.name = this.profile.user?.name || 'Prakhar';
    
    const personaAvatars = {
      mentor: '🎓',
      strict: '⚡',
      polymath: '🔬',
      socratic: '💡',
      hacker: '🚀',
      feynman: '🧠'
    };
    this.profile.avatar = personaAvatars[this.profile.persona] || '🎓';

    const streamMap = {
      'general': 'General',
      'science_pcm': 'Science (PCM)',
      'science_pcb': 'Science (PCB)',
      'commerce': 'Commerce',
      'arts': 'Humanities'
    };
    if (this.profile.identity === 'school') {
      const g = this.profile.subDetails?.grade ? this.profile.subDetails.grade.replace('_', ' ').toUpperCase() : 'Class 12';
      const s = streamMap[this.profile.subDetails?.stream] || this.profile.subDetails?.stream || 'Science';
      this.profile.level = `${g} • ${s}`;
    } else if (this.profile.identity === 'college') {
      this.profile.level = `${this.profile.subDetails?.degree || 'B.Tech'} (${this.profile.subDetails?.year || '1st Year'})`;
    } else if (this.profile.identity === 'self_learner') {
      this.profile.level = `Self-Learner • ${(this.profile.subDetails?.domain || 'General').toUpperCase()}`;
    } else {
      this.profile.level = this.profile.subDetails?.curriculum || 'Standard Prep';
    }
    
    if (this.profile.persona === 'socratic') {
      localStorage.setItem('clearmind_teaching_mode', 'socratic');
    } else {
      localStorage.setItem('clearmind_teaching_mode', 'direct');
    }

    localStorage.setItem('clearmind_profile', JSON.stringify(this.profile));
    localStorage.setItem('clearmind_calibrated_persona', this.profile.persona);
    localStorage.setItem('clearmind_setup_completed', 'true');
    if (this.profile.subjects && this.profile.subjects.length > 0) {
      const topSubject = this.profile.subjects[0].name || this.profile.subjects[0];
      if (typeof topSubject === 'string') {
        localStorage.setItem('clearmind_active_topic', topSubject);
      }
    }

    const telemetry = JSON.parse(localStorage.getItem('clearmind_onboarding_analytics') || '[]');
    telemetry.push({
      timestamp: this.profile.calibratedAt,
      studentName: this.profile.user?.name,
      identity: this.profile.identity,
      subDetails: this.profile.subDetails,
      persona: this.profile.persona,
      dailyRhythm: this.profile.dailyRhythm,
      subjectCount: this.profile.subjects.length,
      highPriorityCount: this.profile.subjects.filter(s => s.priority === 'high').length,
      learningStyles: this.profile.learningStyles,
      pacing: this.profile.pacing,
      targetGoal: this.profile.targetGoal,
      isGuest: this.profile.user?.isGuest
    });
    localStorage.setItem('clearmind_onboarding_analytics', JSON.stringify(telemetry));

    // 1. Trigger Celebratory Confetti Burst!
    if (window.confetti) {
      try {
        window.confetti({
          particleCount: 80,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#06b6d4', '#3b82f6', '#10b981', '#a855f7', '#f59e0b']
        });
      } catch (err) {
        console.warn('Confetti burst trigger:', err);
      }
    }

    const btn = document.getElementById('launchClearMindBtn');
    if (btn) {
      btn.innerHTML = '<span class="animate-spin inline-block mr-2">⚙️</span> Connecting Neural Engine...';
      btn.disabled = true;
    }

    setTimeout(() => {
      const summaryCard = document.getElementById('calibrationSummaryCard');
      if (summaryCard) {
        const personaTitles = {
          mentor: 'Encouraging Mentor',
          strict: 'Strict Examiner',
          polymath: 'First-Principles Polymath',
          socratic: 'Socratic Guide',
          hacker: 'Blitz Exam Hacker',
          feynman: 'Feynman (ELI5)'
        };
        const personaTitle = personaTitles[this.profile.persona] || 'AI Tutor';

        summaryCard.innerHTML = 
          '<div class="text-center py-8 px-4">' +
            '<div class="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-3xl mx-auto mb-4 animate-bounce shadow-lg shadow-emerald-500/20">🎉</div>' +
            '<h3 class="text-2xl sm:text-3xl font-black text-white tracking-tight mb-2">Welcome aboard, ' + (this.profile.user?.name || 'Learner') + '!</h3>' +
            '<p class="text-xs sm:text-sm text-gray-300 max-w-md mx-auto mb-6">Luna AI is calibrated to your syllabus with the <strong class="text-cyan-300">' + personaTitle + '</strong> pedagogical persona.</p>' +
            '<div class="flex flex-col sm:flex-row items-center justify-center gap-3">' +
              '<a href="/classroom" class="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-500 text-slate-950 font-black text-sm shadow-xl shadow-cyan-500/30 hover:scale-105 active:scale-[0.98] transition-all text-center">Enter Classroom Cockpit 🚀</a>' +
              '<button type="button" onclick="window.OnboardingWizard.close()" class="w-full sm:w-auto px-5 py-3 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-semibold text-gray-300 transition-all">Explore Landing Page</button>' +
            '</div>' +
          '</div>';
      }
      if (btn) btn.style.display = 'none';
      const backBtn = document.getElementById('onboardingBackBtn');
      if (backBtn) backBtn.style.display = 'none';

      // Auto-redirect to classroom after celebratory moment
      setTimeout(() => {
        window.location.href = '/classroom';
      }, 1800);
    }, 650);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.OnboardingWizard.init();
});
