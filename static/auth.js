/**
 * ClearMind Pro - Access & Authentication Controller
 * Handles Sign In, Sign Up, Google SSO, and Continue as Guest
 */

window.AuthEngine = {
  currentUser: null,

  init() {
    this.checkSession();
    this.bindEvents();
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
      this.simulateGoogleAuth();
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
