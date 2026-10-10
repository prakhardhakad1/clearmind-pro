/**
 * ClearMind Pro - Access & Authentication Controller
 * Handles Sign In, Sign Up, Google SSO, User IDs (CMP-XXXXX),
 * Permanent Persona Persistence & Ephemeral Session Purging on Logout
 */

// Paste your Google Cloud OAuth Client ID below or store in localStorage as 'clearmind_google_client_id'
window.GOOGLE_CLIENT_ID = window.GOOGLE_CLIENT_ID || localStorage.getItem('clearmind_google_client_id') || '61854617680-nvv67578jejp9qo1kcaeshb5f31o3p69.apps.googleusercontent.com';

// Escapes all five HTML-significant characters. The common DOM textContent
// trick only covers & < >, which lets server data break out of HTML attributes.
window.cmEscape = function (value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

// Never call res.json() before checking res.ok: a non-JSON error body (a proxy
// 502 or framework 500 HTML page) throws and masks the real failure.
async function cmParseJson(res, fallbackMessage) {
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok) {
    throw new Error((data && data.detail) || fallbackMessage || 'Request failed.');
  }
  return data || {};
}

// Session token issued at login/register; authorizes the AI API calls.
window.cmSessionToken = function () {
  try {
    const raw = localStorage.getItem('clearmind_auth_user');
    return raw ? (JSON.parse(raw).session_token || '') : '';
  } catch (e) {
    return '';
  }
};

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

// Short-lived anonymous session for the public landing-page teaser. Cached in
// sessionStorage so we only mint one per tab.
window.cmGetGuestToken = async function () {
  try {
    const cached = sessionStorage.getItem('clearmind_guest_token');
    if (cached) return cached;
    const res = await fetch('/api/auth/guest', { method: 'POST' });
    if (!res.ok) return '';
    const data = await res.json();
    const token = data.session_token || '';
    if (token) sessionStorage.setItem('clearmind_guest_token', token);
    return token;
  } catch (e) {
    return '';
  }
};

window.AuthEngine = {
  currentUser: null,
  activeTab: 'signup', // 'signup' | 'signin'

  init() {
    this.checkSession();
    this.bindEvents();
    this.initGoogleGSI();

    // Auto-open modal if URL specifies login, signin, or signup
    const params = new URLSearchParams(window.location.search);
    if (params.has('login') || params.has('signin') || params.has('auth')) {
      setTimeout(() => this.openAuthModal('signin'), 150);
    } else if (params.has('signup')) {
      setTimeout(() => this.openAuthModal('signup'), 150);
    }
  },

  checkSession() {
    const saved = localStorage.getItem('clearmind_auth_user');
    if (saved) {
      try {
        const user = JSON.parse(saved);
        if (user) {
          this.currentUser = user;
        }
        this.updateNavUser();
      } catch (e) {
        this.currentUser = null;
      }
    }
  },

  initGoogleGSI() {
    const clientId = window.GOOGLE_CLIENT_ID;
    if (!clientId) return;

    let attempts = 0;
    const setupGSI = () => {
      if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
        try {
          google.accounts.id.initialize({
            client_id: clientId,
            callback: (response) => this.handleGoogleCredentialResponse(response),
            auto_select: false,
            cancel_on_tap_outside: true
          });
          console.log('✅ Google Identity Services (GSI) initialized with Client ID:', clientId);

          // Render official Google button if target container exists
          const container = document.getElementById('googleGsiBtnContainer');
          const customBtn = document.getElementById('googleAuthBtn');
          if (container) {
            google.accounts.id.renderButton(container, {
              type: 'standard',
              theme: 'outline',
              size: 'large',
              text: 'continue_with',
              shape: 'rectangular',
              logo_alignment: 'left',
              width: 340
            });
            if (customBtn) customBtn.classList.add('hidden');
          }
        } catch (err) {
          console.warn('Google GSI initialization error:', err);
        }
      } else if (attempts < 20) {
        attempts++;
        setTimeout(setupGSI, 200);
      }
    };

    setupGSI();
  },

  async handleGoogleCredentialResponse(response) {
    try {
      if (!response || !response.credential) {
        throw new Error('No Google credentials received from provider.');
      }

      const base64Url = response.credential.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));

      const payload = JSON.parse(jsonPayload);
      console.log('🎉 Google Account payload received:', payload.email);

      // Show signing in indicator
      const customBtn = document.getElementById('googleAuthBtn');
      if (customBtn) {
        customBtn.classList.remove('hidden');
        customBtn.disabled = true;
        customBtn.innerHTML = '<span class="inline-block animate-spin mr-2">⚙️</span> Signing in with Google...';
      }

      // Send the raw Google ID token so the SERVER can verify it. Never let the
      // backend trust a client-supplied email - that is an auth bypass.
      const syncRes = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: response.credential || '',
          name: payload.name || payload.given_name || 'Learner',
          email: payload.email,
          avatar: payload.picture || '',
          sub: payload.sub || ''
        })
      });

      if (syncRes.ok) {
        const data = await syncRes.json();
        this.currentUser = {
          user_id: data.user.user_id,
          name: data.user.name,
          email: data.user.email,
          avatar: data.user.avatar || payload.picture,
          role: data.user.role || 'student',
          session_token: data.session_token || '',
          isGuest: false,
          provider: 'google'
        };
        localStorage.setItem('clearmind_auth_user', JSON.stringify(this.currentUser));
        this.updateNavUser();
        this.closeAuthModal();

        // Ephemeral Session Wipe: Reset chat and study topics for fresh clean workspace
        localStorage.removeItem('clearmind_conv_history');
        localStorage.removeItem('clearmind_active_topic');
        localStorage.removeItem('clearmind_canvas_nodes');

        // Restore persistent persona and curriculum from backend DB
        if (data.profile) {
          localStorage.setItem('clearmind_profile', JSON.stringify(data.profile));
          if (data.profile.persona) {
            localStorage.setItem('clearmind_calibrated_persona', data.profile.persona);
          }
          localStorage.setItem('clearmind_setup_completed', 'true');
        }

        if (data.isNew && window.OnboardingWizard) {
          window.OnboardingWizard.open(this.currentUser);
        } else {
          window.location.href = '/classroom';
        }
      } else {
        const errData = await syncRes.json().catch(() => ({}));
        throw new Error(errData.detail || 'Google sign-in verification failed on server.');
      }
    } catch (err) {
      console.error('Google Sign-In Error:', err);
      this.showError(err.message || 'Google sign-in could not be completed. Please try again.');
      const customBtn = document.getElementById('googleAuthBtn');
      if (customBtn) {
        customBtn.disabled = false;
        customBtn.innerHTML = `
          <svg class="w-5 h-5 shrink-0" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          <span>Continue with Google</span>
        `;
      }
    }
  },

  triggerGoogleAuth() {
    if (window.GOOGLE_CLIENT_ID && typeof google !== 'undefined' && google.accounts && google.accounts.id) {
      const gsiBtn = document.querySelector('#googleGsiBtnContainer div[role="button"]');
      if (gsiBtn) {
        gsiBtn.click();
        return;
      }
      google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          console.warn('Google One Tap prompt skipped or not displayed, using developer simulator:', notification);
          this.simulateGoogleAuth();
        }
      });
    } else {
      this.simulateGoogleAuth();
    }
  },

  bindEvents() {
    document.querySelectorAll('[data-open-auth]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const mode = btn.getAttribute('data-open-auth') || 'signup';
        this.openAuthModal(mode);
      });
    });

    document.getElementById('closeAuthModalBtn')?.addEventListener('click', () => {
      this.closeAuthModal();
    });

    document.getElementById('authModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'authModal') this.closeAuthModal();
    });

    document.getElementById('tabAuthSignIn')?.addEventListener('click', () => this.switchTab('signin'));
    document.getElementById('tabAuthSignUp')?.addEventListener('click', () => this.switchTab('signup'));

    document.getElementById('googleAuthBtn')?.addEventListener('click', () => {
      this.triggerGoogleAuth();
    });

    document.querySelectorAll('#continueAsGuestBtn, #navGuestBtn, #heroGuestBtn, #mobileGuestBtn, [data-continue-guest]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.continueAsGuest();
      });
    });

    document.getElementById('authForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleFormSubmit();
    });
  },

  openAuthModal(mode = 'signup') {
    const modal = document.getElementById('authModal');
    if (modal) {
      modal.classList.add('active');
      this.switchTab(mode);
      this.clearError();
    }
  },

  closeAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('active');
  },

  switchTab(tab) {
    this.activeTab = tab;
    const signInTab = document.getElementById('tabAuthSignIn');
    const signUpTab = document.getElementById('tabAuthSignUp');
    const submitBtn = document.getElementById('authSubmitBtn');
    const nameGroup = document.getElementById('authNameGroup');
    this.clearError();

    if (tab === 'signin') {
      signInTab?.classList.add('active', 'bg-cyan-500/20', 'text-cyan-300', 'border', 'border-cyan-500/30');
      signInTab?.classList.remove('text-gray-400');
      signUpTab?.classList.remove('active', 'bg-cyan-500/20', 'text-cyan-300', 'border', 'border-cyan-500/30');
      signUpTab?.classList.add('text-gray-400');
      if (submitBtn) submitBtn.textContent = 'Sign In to ClearMind';
      if (nameGroup) nameGroup.style.display = 'none';
    } else {
      signUpTab?.classList.add('active', 'bg-cyan-500/20', 'text-cyan-300', 'border', 'border-cyan-500/30');
      signUpTab?.classList.remove('text-gray-400');
      signInTab?.classList.remove('active', 'bg-cyan-500/20', 'text-cyan-300', 'border', 'border-cyan-500/30');
      signInTab?.classList.add('text-gray-400');
      if (submitBtn) submitBtn.textContent = 'Create Free Account';
      if (nameGroup) nameGroup.style.display = 'block';
    }
  },

  showError(msg) {
    let errBanner = document.getElementById('authErrorBanner');
    if (!errBanner) {
      errBanner = document.createElement('div');
      errBanner.id = 'authErrorBanner';
      errBanner.className = 'mb-3 p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs text-center font-medium';
      const form = document.getElementById('authForm');
      if (form) form.insertBefore(errBanner, form.firstChild);
    }
    errBanner.textContent = msg;
    errBanner.style.display = 'block';
  },

  clearError() {
    const errBanner = document.getElementById('authErrorBanner');
    if (errBanner) errBanner.style.display = 'none';
  },

  async continueAsGuest() {
    this.clearError();
    
    const btn = document.getElementById('continueAsGuestBtn');
    if (btn) {
      btn.innerHTML = '<span class="inline-block animate-spin mr-2">⚡</span> Accessing Classroom...';
    }

    let existingUser = null;
    try {
      existingUser = JSON.parse(localStorage.getItem('clearmind_auth_user') || 'null');
    } catch (e) {
      existingUser = null;
    }

    let guestId = (existingUser && existingUser.user_id && existingUser.isGuest) 
      ? existingUser.user_id 
      : 'CMP-GUEST-' + Math.floor(10000 + Math.random() * 90000);
    let sessionToken = 'guest-session-' + Date.now();

    try {
      const res = await fetch('/api/auth/guest', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.session_token) sessionToken = data.session_token;
        if (data.user_id) guestId = data.user_id;
      }
    } catch (e) {
      // offline fallback
    }

    const guestUser = {
      user_id: guestId,
      name: (existingUser && existingUser.name && existingUser.isGuest) ? existingUser.name : 'Guest Scholar',
      email: 'guest@clearmind.local',
      role: 'guest',
      session_token: sessionToken,
      isGuest: true,
      provider: 'guest'
    };

    this.currentUser = guestUser;
    localStorage.setItem('clearmind_auth_user', JSON.stringify(guestUser));

    // Ensure setup bypass is configured so student jumps directly into Classroom
    localStorage.setItem('clearmind_setup_completed', 'true');

    // Ensure calibrated default subjects exist if profile is empty
    const existingProfile = localStorage.getItem('clearmind_profile');
    if (!existingProfile) {
      const defaultGuestProfile = {
        name: 'Guest Scholar',
        avatar: '⚡',
        grade: '12th / University',
        targetExam: 'Universal Concept Mastery',
        persona: 'Adaptive Socratic Mentor',
        subjects: [
          { id: 'cs', name: 'Computer Science & AI' },
          { id: 'math', name: 'Mathematics & Calculus' },
          { id: 'physics', name: 'Modern Physics' }
        ],
        user: { name: 'Guest Scholar', isGuest: true }
      };
      localStorage.setItem('clearmind_profile', JSON.stringify(defaultGuestProfile));
      if (!localStorage.getItem('clearmind_active_topic')) {
        localStorage.setItem('clearmind_active_topic', 'Computer Science & AI');
      }
    }

    this.updateNavUser();
    this.closeAuthModal();

    // Direct transition to the Classroom Cockpit
    setTimeout(() => {
      window.location.href = '/classroom';
    }, 100);
  },

  simulateGoogleAuth() {
    // Clean fallback: no hardcoded dummy data
    this.showError('Google Sign-In is initializing or unavailable. Please sign in with your email below.');
    this.switchTab('signin');
  },

  async handleFormSubmit() {
    const emailInput = document.getElementById('authEmailInput');
    const passwordInput = document.getElementById('authPasswordInput');
    const nameInput = document.getElementById('authNameInput');
    const submitBtn = document.getElementById('authSubmitBtn');

    const email = emailInput?.value.trim();
    const password = passwordInput?.value.trim();
    const name = nameInput?.value.trim();

    if (!email || !password) {
      this.showError('Please enter both your email and password.');
      return;
    }

    const emailRegex = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
    const isUid = /^CMP-[A-Za-z0-9]+$/i.test(email);

    if (this.activeTab === 'signup') {
      if (!name) {
        this.showError('Please enter your student name.');
        return;
      }
      if (!emailRegex.test(email) || !email.includes('.')) {
        this.showError('Please enter a valid email address (e.g. student@gmail.com or you@university.edu).');
        return;
      }
      const parts = email.split('@');
      if (parts.length !== 2 || !parts[1].includes('.')) {
        this.showError('Please enter a valid email address with a real domain (e.g. gmail.com).');
        return;
      }
      const tld = parts[1].split('.').pop();
      if (!tld || tld.length < 2 || !/^[a-zA-Z]+$/.test(tld)) {
        this.showError('Email must have a valid extension like .com, .edu, .org, or .in');
        return;
      }
      if (password.length < 6) {
        this.showError('Password must be at least 6 characters long.');
        return;
      }
    } else {
      if (!emailRegex.test(email) && !isUid) {
        this.showError('Please enter a valid email address or your CMP User ID.');
        return;
      }
      if (password.length < 6) {
        this.showError('Password must be at least 6 characters long.');
        return;
      }
    }

    this.clearError();
    const originalText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="inline-block animate-spin mr-2">⚙️</span> Authenticating...';
    }

    try {
      if (this.activeTab === 'signup') {
        // Sign Up with backend registration
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password })
        });

        const data = await cmParseJson(res, 'Registration failed. Please try again.');

        this.currentUser = {
          user_id: data.user.user_id,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role || 'student',
          session_token: data.session_token || '',
          isGuest: false,
          provider: 'email'
        };
        localStorage.setItem('clearmind_auth_user', JSON.stringify(this.currentUser));

        // Ephemeral Session Wipe: Reset chat and studied chapters for clean start
        localStorage.removeItem('clearmind_conv_history');
        localStorage.removeItem('clearmind_active_topic');
        localStorage.removeItem('clearmind_canvas_nodes');

        this.updateNavUser();
        this.closeAuthModal();

        // Launch Onboarding Wizard so persona and curriculum can be calibrated
        if (window.OnboardingWizard) {
          window.OnboardingWizard.open(this.currentUser);
        } else {
          window.location.href = '/?onboard=1';
        }

      } else {
        // Sign In with backend authentication
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const data = await cmParseJson(res, 'Invalid email or password.');

        this.currentUser = {
          user_id: data.user.user_id,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role || 'student',
          session_token: data.session_token || '',
          isGuest: false,
          provider: 'email'
        };
        localStorage.setItem('clearmind_auth_user', JSON.stringify(this.currentUser));

        // Restore permanent Persona & Curriculum from Backend DB
        if (data.profile) {
          localStorage.setItem('clearmind_profile', JSON.stringify(data.profile));
          if (data.profile.persona) {
            localStorage.setItem('clearmind_calibrated_persona', data.profile.persona);
          }
          localStorage.setItem('clearmind_setup_completed', 'true');
        }

        // CRITICAL PRIVACY & SESSION RULE:
        // Ephemeral Session Wipe on fresh login - conversation history and active chapters are purged
        localStorage.removeItem('clearmind_conv_history');
        localStorage.removeItem('clearmind_active_topic');
        localStorage.removeItem('clearmind_canvas_nodes');

        this.updateNavUser();
        this.closeAuthModal();

        // Navigate directly to classroom cockpit
        window.location.href = '/classroom';
      }
    } catch (err) {
      this.showError(err.message || 'An error occurred during authentication.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    }
  },

  logout() {
    // CRITICAL PRIVACY RULE:
    // Wipe ephemeral study session memory: studied topics, active chapters, and chat logs
    localStorage.removeItem('clearmind_auth_user');
    localStorage.removeItem('clearmind_conv_history');
    localStorage.removeItem('clearmind_active_topic');
    localStorage.removeItem('clearmind_canvas_nodes');
    sessionStorage.clear();

    this.currentUser = null;
    this.updateNavUser();

    // Redirect to home landing page
    if (window.location.pathname !== '/' && !window.location.pathname.endsWith('index.html')) {
      window.location.href = '/';
    } else {
      window.location.reload();
    }
  },

  updateNavUser() {
    const navBtn = document.getElementById('navAuthBtn');
    const heroBtn = document.getElementById('heroGetStartedBtn');
    const heroGuestBtn = document.getElementById('heroGuestBtn');
    const navGuestBtn = document.getElementById('navGuestBtn');

    if (this.currentUser) {
      const isGuest = !!this.currentUser.isGuest;
      const userBadge = isGuest ? '⚡ Guest Scholar' : '👤 ' + window.cmEscape(this.currentUser.name);
      const uid = this.currentUser.user_id ? ` • <span class="text-cyan-300 font-mono text-[10px]">${window.cmEscape(this.currentUser.user_id)}</span>` : '';

      if (navBtn) {
        navBtn.innerHTML = `<span>${userBadge}${uid}</span>`;
        navBtn.className = isGuest
          ? 'btn-secondary text-xs flex items-center gap-1.5 cursor-pointer border border-amber-400/40 bg-amber-500/10 text-amber-200'
          : 'btn-secondary text-xs flex items-center gap-1.5 cursor-pointer';
        navBtn.title = isGuest
          ? `Guest Scholar Mode (${this.currentUser.user_id})`
          : `Logged in as ${this.currentUser.email} (${this.currentUser.user_id || ''})`;
        navBtn.onclick = (e) => {
          e.preventDefault();
          this.showUserMenu(navBtn);
        };
      }

      if (heroBtn) {
        heroBtn.removeAttribute('data-open-auth');
        heroBtn.innerHTML = isGuest
          ? `<span>🎓</span> <span>Enter Classroom Cockpit</span>`
          : `<span>🚀</span> <span>Enter Classroom Cockpit</span>`;
        heroBtn.onclick = (e) => {
          e.preventDefault();
          window.location.href = '/classroom';
        };
      }

      if (heroGuestBtn) {
        if (isGuest) {
          heroGuestBtn.innerHTML = `<span>✨</span> <span>Create Account to Save</span>`;
          heroGuestBtn.onclick = (e) => {
            e.preventDefault();
            this.openAuthModal('signup');
          };
        } else {
          heroGuestBtn.style.display = 'none';
        }
      }

      if (navGuestBtn) {
        if (isGuest) {
          navGuestBtn.innerHTML = `<span>✨</span> <span>Save Progress</span>`;
          navGuestBtn.onclick = (e) => {
            e.preventDefault();
            this.openAuthModal('signup');
          };
        } else {
          navGuestBtn.style.display = 'none';
        }
      }
    } else {
      if (navBtn) {
        navBtn.innerHTML = 'Sign In';
        navBtn.className = 'btn-secondary text-xs';
        navBtn.onclick = (e) => {
          e.preventDefault();
          this.openAuthModal('signin');
        };
      }
      if (heroBtn) {
        heroBtn.setAttribute('data-open-auth', 'signup');
        heroBtn.innerHTML = `<span>🚀</span> <span>Get Started Free — Calibrate Profile</span>`;
        heroBtn.onclick = (e) => {
          e.preventDefault();
          this.openAuthModal('signup');
        };
      }
      if (heroGuestBtn) {
        heroGuestBtn.style.display = '';
        heroGuestBtn.innerHTML = `<span>⚡</span> <span>Continue as Guest (Instant Access)</span>`;
        heroGuestBtn.onclick = (e) => {
          e.preventDefault();
          this.continueAsGuest();
        };
      }
      if (navGuestBtn) {
        navGuestBtn.style.display = '';
        navGuestBtn.innerHTML = `<span>⚡</span> <span>Guest Access</span>`;
        navGuestBtn.onclick = (e) => {
          e.preventDefault();
          this.continueAsGuest();
        };
      }
    }
  },

  showUserMenu(anchorElem) {
    let menu = document.getElementById('authUserDropdownMenu');
    if (menu) {
      menu.remove();
      return;
    }

    menu = document.createElement('div');
    menu.id = 'authUserDropdownMenu';
    menu.className = 'fixed z-50 p-3 rounded-2xl bg-slate-900/95 border border-white/15 shadow-2xl backdrop-blur-xl text-xs space-y-2 min-w-[220px] animate-in fade-in zoom-in-95 duration-150';
    
    const rect = anchorElem.getBoundingClientRect();
    menu.style.top = (rect.bottom + 8) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';

    const isGuest = !!this.currentUser?.isGuest;

    menu.innerHTML = `
      <div class="pb-2 border-b border-white/10">
        <div class="font-bold text-white flex items-center gap-1.5">
          <span>${isGuest ? '⚡' : '👤'}</span>
          <span>${window.cmEscape(this.currentUser?.name || 'Student')}</span>
          ${isGuest ? '<span class="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[9px] font-bold uppercase tracking-wider">Guest Mode</span>' : ''}
        </div>
        <div class="text-[11px] text-slate-400 truncate">${window.cmEscape(this.currentUser?.email || '')}</div>
        <div class="mt-1 inline-block px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-800/80 text-[10px] font-mono font-bold text-cyan-300">
          ${window.cmEscape(this.currentUser?.user_id || 'CMP-STUDENT')}
        </div>
      </div>
      <a href="/classroom" class="flex items-center gap-2 p-1.5 rounded-xl hover:bg-white/10 text-slate-200 transition font-medium">
        <span>🎓</span> <span>Classroom Cockpit</span>
      </a>
      ${isGuest ? `
      <button type="button" id="dropdownUpgradeBtn" class="w-full text-left flex items-center gap-2 p-1.5 rounded-xl hover:bg-cyan-500/20 text-cyan-300 transition font-medium cursor-pointer">
        <span>✨</span> <span>Create Account (Save Progress)</span>
      </button>
      ` : ''}
      <button type="button" id="dropdownLogoutBtn" class="w-full text-left flex items-center gap-2 p-1.5 rounded-xl hover:bg-red-500/20 text-red-400 transition font-medium cursor-pointer">
        <span>🚪</span> <span>${isGuest ? 'Exit Guest Mode' : 'Log Out (Wipe Session)'}</span>
      </button>
    `;

    document.body.appendChild(menu);

    const closeHandler = (e) => {
      if (!menu.contains(e.target) && e.target !== anchorElem) {
        menu.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);

    document.getElementById('dropdownUpgradeBtn')?.addEventListener('click', () => {
      menu.remove();
      this.openAuthModal('signup');
    });

    document.getElementById('dropdownLogoutBtn')?.addEventListener('click', () => {
      menu.remove();
      this.logout();
    });
  }
};

window.ClearMindAuth = window.AuthEngine;

document.addEventListener('DOMContentLoaded', () => {
  window.AuthEngine.init();
});
