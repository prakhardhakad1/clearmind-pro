/**
 * ClearMind Pro — Advanced Cognitive Study Planner Engine
 * Module: study_planner.js
 * Comprehensive Exam Syllabi, Circadian Energy Mapping, Spaced Repetition Scheduling Algorithms
 */

(function (global) {
  'use strict';

  // --- Comprehensive Global Exam Syllabi Database ---
  const EXAM_SYLLABI_REGISTRY = {
    jee: {
      name: "JEE Advanced & Mains (India / Engineering)",
      durationDays: 180,
      totalWeight: 300,
      domains: [
        {
          domain: "Physics",
          topics: [
            { id: "p1", title: "Rotational Mechanics & Moment of Inertia", weight: 9, difficulty: "hard", hoursNeeded: 18 },
            { id: "p2", title: "Electrostatics & Gauss's Law", weight: 8, difficulty: "medium", hoursNeeded: 14 },
            { id: "p3", title: "Electromagnetic Induction & AC Circuits", weight: 8, difficulty: "hard", hoursNeeded: 16 },
            { id: "p4", title: "Wave Optics & Interference", weight: 6, difficulty: "medium", hoursNeeded: 12 },
            { id: "p5", title: "Thermodynamics & Kinetic Theory of Gases", weight: 7, difficulty: "medium", hoursNeeded: 12 },
            { id: "p6", title: "Modern Physics & Dual Nature of Matter", weight: 9, difficulty: "easy", hoursNeeded: 10 },
            { id: "p7", title: "Fluid Dynamics & Surface Tension", weight: 5, difficulty: "medium", hoursNeeded: 10 },
            { id: "p8", title: "Simple Harmonic Motion & Waves", weight: 6, difficulty: "medium", hoursNeeded: 12 }
          ]
        },
        {
          domain: "Chemistry",
          topics: [
            { id: "c1", title: "Organic Reaction Mechanisms (SN1, SN2, E1, E2)", weight: 10, difficulty: "hard", hoursNeeded: 20 },
            { id: "c2", title: "Coordination Compounds & Crystal Field Theory", weight: 8, difficulty: "medium", hoursNeeded: 14 },
            { id: "c3", title: "Chemical Thermodynamics & Gibbs Free Energy", weight: 8, difficulty: "hard", hoursNeeded: 16 },
            { id: "c4", title: "Chemical Kinetics & Rate Laws", weight: 7, difficulty: "medium", hoursNeeded: 12 },
            { id: "c5", title: "p-Block & d-Block Elements", weight: 8, difficulty: "medium", hoursNeeded: 15 },
            { id: "c6", title: "Electrochemistry & Nernst Equation", weight: 7, difficulty: "medium", hoursNeeded: 12 },
            { id: "c7", title: "Aldehydes, Ketones & Carboxylic Acids", weight: 9, difficulty: "hard", hoursNeeded: 18 },
            { id: "c8", title: "Atomic Structure & Quantum Numbers", weight: 6, difficulty: "easy", hoursNeeded: 8 }
          ]
        },
        {
          domain: "Mathematics",
          topics: [
            { id: "m1", title: "Definite Integration & Area Under Curves", weight: 10, difficulty: "hard", hoursNeeded: 22 },
            { id: "m2", title: "Differential Equations & Orthogonal Trajectories", weight: 8, difficulty: "medium", hoursNeeded: 14 },
            { id: "m3", title: "Matrices, Determinants & System of Linear Eq", weight: 8, difficulty: "medium", hoursNeeded: 12 },
            { id: "m4", title: "Probability & Bayes' Theorem", weight: 9, difficulty: "hard", hoursNeeded: 18 },
            { id: "m5", title: "Vectors and 3D Analytical Geometry", weight: 9, difficulty: "medium", hoursNeeded: 16 },
            { id: "m6", title: "Permutations, Combinations & Binomial Theorem", weight: 7, difficulty: "hard", hoursNeeded: 15 },
            { id: "m7", title: "Complex Numbers & De Moivre's Theorem", weight: 8, difficulty: "hard", hoursNeeded: 16 },
            { id: "m8", title: "Coordinate Geometry (Conic Sections: Parabola, Ellipse)", weight: 9, difficulty: "hard", hoursNeeded: 20 }
          ]
        }
      ]
    },
    neet: {
      name: "NEET / MCAT (Pre-Med Biology & Chemistry)",
      durationDays: 150,
      totalWeight: 720,
      domains: [
        {
          domain: "Biology",
          topics: [
            { id: "b1", title: "Human Physiology: Cardiovascular & Nervous System", weight: 12, difficulty: "hard", hoursNeeded: 24 },
            { id: "b2", title: "Genetics: Mendelian Inheritance & Molecular Basis", weight: 14, difficulty: "hard", hoursNeeded: 26 },
            { id: "b3", title: "Biotechnology: Principles and Recombinant DNA", weight: 9, difficulty: "medium", hoursNeeded: 14 },
            { id: "b4", title: "Plant Physiology & Photosynthesis (C3/C4/CAM)", weight: 10, difficulty: "hard", hoursNeeded: 18 },
            { id: "b5", title: "Cell Biology & Cell Cycle Division", weight: 8, difficulty: "easy", hoursNeeded: 10 },
            { id: "b6", title: "Ecology, Ecosystem Dynamics & Biodiversity", weight: 9, difficulty: "medium", hoursNeeded: 14 },
            { id: "b7", title: "Reproduction in Organisms & Flowering Plants", weight: 8, difficulty: "medium", hoursNeeded: 12 }
          ]
        },
        {
          domain: "Chemistry",
          topics: [
            { id: "nc1", title: "Biomolecules, Amino Acids & Peptide Bonds", weight: 8, difficulty: "medium", hoursNeeded: 12 },
            { id: "nc2", title: "Hydrocarbons, Alkyl Halides & Elimination", weight: 9, difficulty: "medium", hoursNeeded: 16 },
            { id: "nc3", title: "Equilibrium: Ionic & Solubility Products", weight: 9, difficulty: "hard", hoursNeeded: 18 },
            { id: "nc4", title: "Solutions & Colligative Properties", weight: 7, difficulty: "medium", hoursNeeded: 12 }
          ]
        },
        {
          domain: "Physics",
          topics: [
            { id: "np1", title: "Current Electricity & Circuits", weight: 8, difficulty: "medium", hoursNeeded: 14 },
            { id: "np2", title: "Ray & Wave Optics", weight: 9, difficulty: "medium", hoursNeeded: 16 },
            { id: "np3", title: "Gravitation & Kepler's Laws", weight: 6, difficulty: "easy", hoursNeeded: 8 },
            { id: "np4", title: "Thermodynamics & Heat Engines", weight: 7, difficulty: "medium", hoursNeeded: 12 }
          ]
        }
      ]
    },
    sat: {
      name: "Digital SAT (College Board)",
      durationDays: 60,
      totalWeight: 1600,
      domains: [
        {
          domain: "Math",
          topics: [
            { id: "sm1", title: "Heart of Algebra: Linear Equations & Inequalities", weight: 10, difficulty: "easy", hoursNeeded: 10 },
            { id: "sm2", title: "Advanced Math: Quadratics, Polynomials & Exponents", weight: 10, difficulty: "medium", hoursNeeded: 14 },
            { id: "sm3", title: "Problem Solving & Data Analysis: Ratios, Probability", weight: 8, difficulty: "medium", hoursNeeded: 12 },
            { id: "sm4", title: "Geometry & Trigonometry: Circle Theorems & SOH CAH TOA", weight: 7, difficulty: "hard", hoursNeeded: 14 }
          ]
        },
        {
          domain: "Reading and Writing",
          topics: [
            { id: "sr1", title: "Information & Ideas: Central Ideas, Inferences", weight: 10, difficulty: "medium", hoursNeeded: 12 },
            { id: "sr2", title: "Craft and Structure: Vocabulary in Context, Text Structure", weight: 9, difficulty: "medium", hoursNeeded: 12 },
            { id: "sr3", title: "Expression of Ideas: Rhetorical Synthesis & Transitions", weight: 9, difficulty: "easy", hoursNeeded: 10 },
            { id: "sr4", title: "Standard English Conventions: Boundaries, Modifiers", weight: 10, difficulty: "medium", hoursNeeded: 12 }
          ]
        }
      ]
    },
    ap: {
      name: "AP Calculus BC & Physics C",
      durationDays: 90,
      totalWeight: 5,
      domains: [
        {
          domain: "AP Calculus BC",
          topics: [
            { id: "apc1", title: "Limits & Continuity (Epsilon-Delta & L'Hopital)", weight: 7, difficulty: "medium", hoursNeeded: 10 },
            { id: "apc2", title: "Techniques of Integration (Parts, Partial Fractions)", weight: 10, difficulty: "hard", hoursNeeded: 18 },
            { id: "apc3", title: "Parametric Equations, Polar Coordinates & Vectors", weight: 9, difficulty: "hard", hoursNeeded: 16 },
            { id: "apc4", title: "Infinite Sequences and Series (Taylor/Maclaurin)", weight: 12, difficulty: "hard", hoursNeeded: 22 }
          ]
        },
        {
          domain: "AP Physics C Mechanics",
          topics: [
            { id: "app1", title: "Kinematics with Calculus Differential Equations", weight: 8, difficulty: "medium", hoursNeeded: 12 },
            { id: "app2", title: "Newton's Laws & Drag Force Differential Analysis", weight: 9, difficulty: "hard", hoursNeeded: 15 },
            { id: "app3", title: "Conservation of Energy & Potential Energy Curves", weight: 8, difficulty: "medium", hoursNeeded: 12 },
            { id: "app4", title: "Oscillations & Physical Pendulums", weight: 7, difficulty: "medium", hoursNeeded: 10 }
          ]
        }
      ]
    }
  };

  // --- Circadian Cognitive Energy Mapping ---
  // Models student alertness through day to schedule cognitively demanding topics at peak alertness
  const CIRCADIAN_CHRONOTYPES = {
    morning_lark: {
      peakHours: [8, 9, 10, 11],
      dipHours: [13, 14, 15],
      secondaryPeak: [16, 17, 18],
      windDownHours: [21, 22, 23]
    },
    intermediate: {
      peakHours: [10, 11, 12],
      dipHours: [14, 15],
      secondaryPeak: [17, 18, 19, 20],
      windDownHours: [22, 23]
    },
    night_owl: {
      peakHours: [14, 15, 16, 19, 20, 21, 22],
      dipHours: [8, 9],
      secondaryPeak: [23, 0],
      windDownHours: [2, 3]
    }
  };

  /**
   * Calculates optimal slot difficulty assignment based on user chronotype
   */
  function getOptimalDifficultyForHour(hour, chronotype = 'intermediate') {
    const profile = CIRCADIAN_CHRONOTYPES[chronotype] || CIRCADIAN_CHRONOTYPES.intermediate;
    if (profile.peakHours.includes(hour)) {
      return 'hard'; // High cognitive load (Calculus, Quantum Mech, Proofs)
    } else if (profile.dipHours.includes(hour)) {
      return 'easy'; // Low cognitive load (Flashcard drill, Error log review, Video)
    } else {
      return 'medium'; // Moderate cognitive load (Problem solving, Homework)
    }
  }

  // --- Spaced Repetition (SuperMemo SM-2 & Ebbinghaus) Scheduler ---
  class SpacedRepetitionEngine {
    constructor() {
      this.intervals = [1, 3, 7, 14, 30, 60, 120]; // In days
    }

    /**
     * Compute next review timestamp based on response grade (0 to 5)
     * grade 5: Perfect recall without hesitation
     * grade 4: Correct after brief hesitation
     * grade 3: Correct with serious difficulty
     * grade 2: Incorrect; where the correct one seemed easy to recall
     * grade 1: Incorrect; remembered upon seeing answer
     * grade 0: Complete blackout
     */
    calculateNextReview(item, grade) {
      let repetitions = item.repetitions || 0;
      let easeFactor = item.easeFactor || 2.5;
      let interval = item.interval || 1;

      if (grade >= 3) {
        if (repetitions === 0) {
          interval = 1;
        } else if (repetitions === 1) {
          interval = 6;
        } else {
          interval = Math.round(interval * easeFactor);
        }
        repetitions++;
      } else {
        repetitions = 0;
        interval = 1;
      }

      // Update EF using SM-2 formula: EF' = EF + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
      easeFactor = easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
      if (easeFactor < 1.3) easeFactor = 1.3;

      const nextReviewDate = new Date();
      nextReviewDate.setDate(nextReviewDate.getDate() + interval);

      return {
        repetitions,
        easeFactor: parseFloat(easeFactor.toFixed(2)),
        interval,
        nextReviewDate: nextReviewDate.toISOString(),
        retentionProbability: Math.min(0.99, Math.max(0.4, 1 - (0.1 / easeFactor)))
      };
    }

    getForgettingCurveRetention(elapsedDays, stability) {
      // Retention R = e^(-t / S)
      return Math.exp(-elapsedDays / Math.max(1, stability));
    }
  }

  // --- Automated AI Schedule Generator ---
  class AiStudyPlanSynthesizer {
    constructor() {
      this.smEngine = new SpacedRepetitionEngine();
    }

    synthesizePlan(options) {
      const {
        examCode = 'jee',
        dailyHours = 4,
        chronotype = 'intermediate',
        targetDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      } = options;

      const exam = EXAM_SYLLABI_REGISTRY[examCode] || EXAM_SYLLABI_REGISTRY.jee;
      const allTopics = [];
      exam.domains.forEach(d => {
        d.topics.forEach(t => {
          allTopics.push({ ...t, domain: d.domain });
        });
      });

      // Sort by weight desc
      allTopics.sort((a, b) => b.weight - a.weight);

      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const standardSlots = [
        { time: '09:00', hour: 9, duration: 120 },
        { time: '11:00', hour: 11, duration: 90 },
        { time: '14:00', hour: 14, duration: 90 },
        { time: '16:00', hour: 16, duration: 60 },
        { time: '18:00', hour: 18, duration: 90 },
        { time: '20:00', hour: 20, duration: 60 }
      ];

      const weeklySchedule = [];
      let topicIdx = 0;

      days.forEach(day => {
        let hoursAccumulated = 0;

        standardSlots.forEach(slot => {
          if (hoursAccumulated >= dailyHours) return;

          const optimalDiff = getOptimalDifficultyForHour(slot.hour, chronotype);
          const topic = allTopics[topicIdx % allTopics.length];
          topicIdx++;

          const domainColors = {
            Physics: 'cyan',
            Chemistry: 'emerald',
            Mathematics: 'violet',
            Biology: 'rose',
            Math: 'violet',
            'Reading and Writing': 'cyan',
            'AP Calculus BC': 'violet',
            'AP Physics C Mechanics': 'cyan'
          };

          const color = domainColors[topic.domain] || 'cyan';

          weeklySchedule.push({
            id: `gen_${day}_${slot.time}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            day,
            time: slot.time,
            duration: Math.min(slot.duration, (dailyHours - hoursAccumulated) * 60),
            subject: topic.domain,
            topic: topic.title,
            color,
            completed: false,
            ebbinghausTier: 'R1',
            difficulty: topic.difficulty,
            optimalCognitiveFit: topic.difficulty === optimalDiff
          });

          hoursAccumulated += slot.duration / 60;
        });
      });

      return {
        examName: exam.name,
        totalTopicsPlanned: allTopics.length,
        weeklySchedule,
        generatedAt: new Date().toISOString()
      };
    }
  }

  // --- Export module to window/global scope ---
  global.ClearMindStudyPlanner = {
    EXAM_SYLLABI_REGISTRY,
    CIRCADIAN_CHRONOTYPES,
    SpacedRepetitionEngine,
    AiStudyPlanSynthesizer,
    getOptimalDifficultyForHour
  };

  console.info('ClearMind Pro Study Planner Subsystem Initialized.');
})(typeof window !== 'undefined' ? window : this);
