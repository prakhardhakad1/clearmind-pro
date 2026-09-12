/**
 * ClearMind Pro - Landing Page Interactive Script
 * Handles FAQ accordion, navigation scroll effects, mobile drawer, and feature card interactions.
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Navigation Scroll Effect
  const navbar = document.getElementById('mainNavbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
      navbar?.classList.add('nav-scrolled');
    } else {
      navbar?.classList.remove('nav-scrolled');
    }
  });

  // 2. Mobile Menu Toggle
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileMenuDrawer = document.getElementById('mobileMenuDrawer');
  const closeMobileMenuBtn = document.getElementById('closeMobileMenuBtn');

  mobileMenuBtn?.addEventListener('click', () => {
    mobileMenuDrawer?.classList.remove('hidden');
  });

  closeMobileMenuBtn?.addEventListener('click', () => {
    mobileMenuDrawer?.classList.add('hidden');
  });

  document.querySelectorAll('#mobileMenuDrawer a').forEach(link => {
    link.addEventListener('click', () => {
      mobileMenuDrawer?.classList.add('hidden');
    });
  });

  // 3. FAQ Accordion
  document.querySelectorAll('.faq-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const content = item?.querySelector('.faq-content');
      const icon = item?.querySelector('.faq-icon');
      const isOpen = item?.classList.contains('active');

      // Close other accordions
      document.querySelectorAll('.faq-item').forEach(other => {
        if (other !== item) {
          other.classList.remove('active');
          const otherContent = other.querySelector('.faq-content');
          const otherIcon = other.querySelector('.faq-icon');
          if (otherContent) otherContent.style.maxHeight = null;
          if (otherIcon) otherIcon.style.transform = 'rotate(0deg)';
        }
      });

      if (isOpen) {
        item.classList.remove('active');
        if (content) content.style.maxHeight = null;
        if (icon) icon.style.transform = 'rotate(0deg)';
      } else {
        item.classList.add('active');
        if (content) content.style.maxHeight = content.scrollHeight + 'px';
        if (icon) icon.style.transform = 'rotate(180deg)';
      }
    });
  });

  // 4. Smooth Anchor Scroll
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        targetEl.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // 5. Interactive Demo Teaser inside Hero / Bento
  const teaserInput = document.getElementById('heroTeaserInput');
  const teaserSubmit = document.getElementById('heroTeaserSubmit');
  const teaserResponse = document.getElementById('heroTeaserResponse');

  const cannedAnswers = {
    'dsa': 'In Big-O analysis, binary search operates in O(log n) time by halving search boundaries on sorted arrays!',
    'physics': 'Schrödinger equation determines the wave function evolution of a quantum-mechanical system over time: iħ ∂Ψ/∂t = ĤΨ.',
    'calculus': 'The Fundamental Theorem connects differentiation and integration: ∫[a,b] f(x)dx = F(b) - F(a) where F\'=f.',
    'default': 'Luna AI breaks complex ideas into high-retention visual mental models. Launch onboarding to customize for your curriculum!'
  };

  teaserSubmit?.addEventListener('click', () => {
    const query = (teaserInput?.value || '').toLowerCase();
    if (!query) return;

    teaserResponse.classList.remove('hidden');
    teaserResponse.innerHTML = '<span class="text-cyan-400 animate-pulse">Luna AI thinking...</span>';

    setTimeout(() => {
      let ans = cannedAnswers.default;
      if (query.includes('sort') || query.includes('search') || query.includes('algorithm') || query.includes('dsa') || query.includes('code')) {
        ans = cannedAnswers.dsa;
      } else if (query.includes('physic') || query.includes('quantum') || query.includes('wave')) {
        ans = cannedAnswers.physics;
      } else if (query.includes('math') || query.includes('calculus') || query.includes('integral') || query.includes('deriv')) {
        ans = cannedAnswers.calculus;
      }
      teaserResponse.innerHTML = `<strong>Luna AI:</strong> ${ans}`;
    }, 450);
  });
});
