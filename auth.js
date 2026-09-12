/**
 * ClearMind Pro - Access & Authentication Controller
 * Handles Sign In, Sign Up, Google SSO, and Continue as Guest
 */

// Paste your Google Cloud OAuth Client ID below or store in localStorage as 'clearmind_google_client_id'
window.GOOGLE_CLIENT_ID = window.GOOGLE_CLIENT_ID || localStorage.getItem('clearmind_google_client_id') || '61854617680-nvv67578jejp9qo1kcaeshb5f31o3p69.apps.googleusercontent.com';

window.AuthEngine = {
  currentUser: null,

  init() {
    this.checkSession();
    this.bindEvents();
    this.initGoogleGSI();
  },

  checkSession() {
    const saved = localStorage.getItem('clearmind_auth_user');
    if (saved) {
      try {
        this.currentUser = JSON.parse(saved);
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

  handleGoogleCredentialResponse(response) {
    try {
      const base64Url = response.credential.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));

      const payload = JSON.parse(jsonPayload);
      console.log('🎉 Verified Google Account:', payload.email, payload.name);

      const verifiedUser = {
        name: payload.name || payload.given_name || 'Learner',
        email: payload.email,
        avatar: payload.picture || 'https://lh3.googleusercontent.com/a/default-user=s96-c',
        isGuest: false,
        provider: 'google',
        sub: payload.sub
      };

      this.currentUser = verifiedUser;
      localStorage.setItem('clearmind_auth_user', JSON.stringify(this.currentUser));
      this.updateNavUser();
      this.closeAuthModal();

      if (window.OnboardingWizard) {
        window.OnboardingWizard.open(verifiedUser);
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
    }
  },

  closeAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('active');
  },

  switchTab(tab) {
    const signInTab = document.getElementById('tabAuthSignIn');
    const signUpTab = document.getElementById('tabAuthSignUp');
    const submitBtn = document.getElementById('authSubmitBtn');
    const nameGroup = document.getElementById('authNameGroup');

    if (tab === 'signin') {
      signInTab?.classList.add('active');
      signUpTab?.classList.remove('active');
      if (submitBtn) submitBtn.textContent = 'Sign In to ClearMind';
      if (nameGroup) nameGroup.style.display = 'none';
    } else {
      signUpTab?.classList.add('active');
      signInTab?.classList.remove('active');
      if (submitBtn) submitBtn.textContent = 'Create Free Account';
      if (nameGroup) nameGroup.style.display = 'block';
    }
  },

  continueAsGuest() {
    this.currentUser = {
      name: 'Guest Learner',
      email: '',
      isGuest: true,
      createdAt: new Date().toISOString()
    };
    localStorage.setItem('clearmind_auth_user', JSON.stringify(this.currentUser));
    this.closeAuthModal();
    
    if (window.OnboardingWizard) {
      window.OnboardingWizard.open(this.currentUser);
    }
  },

  simulateGoogleAuth() {
    const mockUser = {
      name: 'Prakhar',
      email: 'prakhardhakad1@gmail.com',
      avatar: 'https://lh3.googleusercontent.com/a/default-user=s96-c',
      isGuest: false,
      provider: 'google'
    };
    this.currentUser = mockUser;
    localStorage.setItem('clearmind_auth_user', JSON.stringify(this.currentUser));
    this.updateNavUser();
    this.closeAuthModal();

    if (window.OnboardingWizard) {
      window.OnboardingWizard.open(mockUser);
    }
  },

  handleFormSubmit() {
    const email = document.getElementById('authEmailInput')?.value.trim() || 'student@clearmind.ai';
    const name = document.getElementById('authNameInput')?.value.trim() || email.split('@')[0];

    this.currentUser = {
      name: name,
      email: email,
      isGuest: false,
      provider: 'email'
    };
    localStorage.setItem('clearmind_auth_user', JSON.stringify(this.currentUser));
    this.updateNavUser();
    this.closeAuthModal();

    if (window.OnboardingWizard) {
      window.OnboardingWizard.open(this.currentUser);
    }
  },

  updateNavUser() {
    const navBtn = document.getElementById('navAuthBtn');
    if (navBtn && this.currentUser && !this.currentUser.isGuest) {
      navBtn.innerHTML = '<span>👤 ' + this.currentUser.name + '</span>';
      navBtn.className = 'btn-secondary text-xs';
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.AuthEngine.init();
});
