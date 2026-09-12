/**
 * ClearMind Pro - Access & Authentication Controller
 * Handles Sign In, Sign Up, Google SSO, User IDs (CMP-XXXXX),
 * Permanent Persona Persistence & Ephemeral Session Purging on Logout
 */

// Paste your Google Cloud OAuth Client ID below or store in localStorage as 'clearmind_google_client_id'
window.GOOGLE_CLIENT_ID = window.GOOGLE_CLIENT_ID || localStorage.getItem('clearmind_google_client_id') || '61854617680-nvv67578jejp9qo1kcaeshb5f31o3p69.apps.googleusercontent.com';

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
        // Guest mode is temporarily disabled - purge legacy guest session
        if (user && user.isGuest) {
          localStorage.removeItem('clearmind_auth_user');
          this.currentUser = null;
        } else {
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
      const base64Url = response.credential.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));

      const payload = JSON.parse(jsonPayload);
      console.log('🎉 Verified Google Account:', payload.email, payload.name);

      // Call backend Google SSO endpoint to register/retrieve user_id and persistent persona
      const syncRes = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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

        if (data.isNew) {
          if (window.OnboardingWizard) {
            window.OnboardingWizard.open(this.currentUser);
          } else {
            window.location.href = '/?onboard=1';
          }
        } else {
          // Restore persistent persona and curriculum from backend DB
          if (data.profile) {
            localStorage.setItem('clearmind_profile', JSON.stringify(data.profile));
            if (data.profile.persona) {
              localStorage.setItem('clearmind_calibrated_persona', data.profile.persona);
            }
            localStorage.setItem('clearmind_setup_completed', 'true');
          }
          window.location.href = '/classroom';
        }
      } else {
        throw new Error('Google SSO backend verification failed');
      }
    } catch (err) {
      console.error('Failed to parse Google JWT credential:', err);
      this.simulateGoogleAuth();
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

    document.getElementById('continueAsGuestBtn')?.addEventListener('click', () => {
      this.continueAsGuest();
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

  continueAsGuest() {
    // Guest access is temporarily disabled
    this.showError('Guest access is currently paused. Please sign in with Google or Email.');
    this.openAuthModal('signup');
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

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || 'Registration failed. Please try again.');
        }

        this.currentUser = {
          user_id: data.user.user_id,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role || 'student',
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

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || 'Invalid email or password.');
        }

        this.currentUser = {
          user_id: data.user.user_id,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role || 'student',
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
    const navGuestBtn = document.getElementById('navGuestBtn');

    if (this.currentUser && !this.currentUser.isGuest) {
      const userIdBadge = this.currentUser.user_id ? ` • <span class="text-cyan-300 font-mono text-[10px]">${this.currentUser.user_id}</span>` : '';
      if (navBtn) {
        navBtn.innerHTML = `<span>👤 ${this.currentUser.name}${userIdBadge}</span>`;
        navBtn.className = 'btn-secondary text-xs flex items-center gap-1.5 cursor-pointer';
        navBtn.title = `Logged in as ${this.currentUser.email} (${this.currentUser.user_id || ''})`;
        navBtn.onclick = (e) => {
          e.preventDefault();
          this.showUserMenu(navBtn);
        };
      }
      if (heroBtn) {
        heroBtn.removeAttribute('data-open-auth');
        heroBtn.innerHTML = `<span>🚀</span> <span>Enter Classroom Cockpit</span>`;
        heroBtn.onclick = (e) => {
          e.preventDefault();
          window.location.href = '/classroom';
        };
      }
      if (navGuestBtn) {
        navGuestBtn.style.display = 'none';
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
        heroBtn.onclick = null;
      }
      if (navGuestBtn) {
        navGuestBtn.style.display = '';
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

    menu.innerHTML = `
      <div class="pb-2 border-b border-white/10">
        <div class="font-bold text-white">${this.currentUser?.name || 'Student'}</div>
        <div class="text-[11px] text-slate-400 truncate">${this.currentUser?.email || ''}</div>
        <div class="mt-1 inline-block px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-800/80 text-[10px] font-mono font-bold text-cyan-300">
          ${this.currentUser?.user_id || 'CMP-STUDENT'}
        </div>
      </div>
      <a href="/classroom" class="flex items-center gap-2 p-1.5 rounded-xl hover:bg-white/10 text-slate-200 transition font-medium">
        <span>🎓</span> <span>Classroom Cockpit</span>
      </a>
      <button type="button" id="dropdownLogoutBtn" class="w-full text-left flex items-center gap-2 p-1.5 rounded-xl hover:bg-red-500/20 text-red-400 transition font-medium cursor-pointer">
        <span>🚪</span> <span>Log Out (Wipe Session)</span>
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

    document.getElementById('dropdownLogoutBtn')?.addEventListener('click', () => {
      menu.remove();
      this.logout();
    });
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.AuthEngine.init();
});
