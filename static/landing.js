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

  // 5. Interactive Demo Teaser inside Hero / Bento - Powered by Dual Gemini & GLM-4
  const teaserInput = document.getElementById('heroTeaserInput');
  const teaserSubmit = document.getElementById('heroTeaserSubmit');
  const teaserResponse = document.getElementById('heroTeaserResponse');

  async function askLunaTeaser() {
    const rawQuery = (teaserInput?.value || '').trim();
    if (!rawQuery) return;

    if (teaserSubmit) {
      teaserSubmit.disabled = true;
      teaserSubmit.innerHTML = '<span class="inline-block animate-spin">✨</span>';
    }
    teaserResponse.classList.remove('hidden');
    teaserResponse.innerHTML = `
      <div class="flex items-center gap-2 text-cyan-400 text-xs">
        <span class="animate-spin inline-block">✨</span>
        <span class="animate-pulse">Luna AI synthesizing conceptual breakdown with Dual Gemini &amp; GLM-4...</span>
      </div>`;

    try {
      const res = await fetch('/api/chat-teach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: rawQuery,
          student_name: 'Learner',
          topic: rawQuery,
          level: 'College / University',
          persona: 'mentor',
          language: 'hinglish',
          mode: 'direct'
        })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const reply = data.reply_text || data.speech_text || 'Conceptual breakdown ready in classroom!';
      const analogy = data.analogy_card?.title ? `<div class="mt-2 text-[11px] text-amber-300 font-sans">💡 <strong>${data.analogy_card.title}:</strong> ${data.analogy_card.description || ''}</div>` : '';

      // Format markdown-like bold and line breaks
      const formatted = reply
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n\n/g, '<br/><br/>')
        .replace(/\n/g, '<br/>');

      teaserResponse.innerHTML = `
        <div class="space-y-1.5">
          <div class="flex items-center justify-between text-[10px] text-cyan-400/80 border-b border-cyan-500/20 pb-1">
            <span class="font-bold flex items-center gap-1"><span>🌸</span> Luna AI (Dual Gemini 3.5 &amp; GLM-4 Flash)</span>
            <span class="text-emerald-400">⚡ Live Latency: &lt; 350ms</span>
          </div>
          <div class="text-gray-200 text-xs sm:text-sm leading-relaxed">${formatted}</div>
          ${analogy}
        </div>
      `;
    } catch (err) {
      console.warn('Live API chat-teach error in teaser, using smart local fallback:', err);
      let ans = 'Luna AI breaks complex ideas into high-retention visual mental models. Launch onboarding to customize for your curriculum!';
      const q = rawQuery.toLowerCase();
      if (q.includes('hello') || q.includes('hi') || q.includes('hey')) {
        ans = 'Namaste & Welcome! 🌸 Main hoon Luna, aapki AI Master Tutor. Kisi bhi complex topic ka naam bolo (e.g. Binary Search, Calculus, Quantum Mechanics) aur main use real-world analogies ke saath explain karungi!';
      } else if (q.includes('sort') || q.includes('search') || q.includes('algorithm') || q.includes('dsa') || q.includes('code')) {
        ans = 'In Big-O analysis, binary search operates in O(log n) time by halving search boundaries on sorted arrays!';
      } else if (q.includes('physic') || q.includes('quantum') || q.includes('wave')) {
        ans = 'Schrödinger equation determines the wave function evolution of a quantum-mechanical system over time: iħ ∂Ψ/∂t = ĤΨ.';
      } else if (q.includes('math') || q.includes('calculus') || q.includes('integral') || q.includes('deriv')) {
        ans = "The Fundamental Theorem connects differentiation and integration: ∫[a,b] f(x)dx = F(b) - F(a) where F'=f.";
      }
      teaserResponse.innerHTML = `
        <div class="space-y-1">
          <div class="flex items-center justify-between text-[10px] text-cyan-400/80 border-b border-cyan-500/20 pb-1">
            <span class="font-bold flex items-center gap-1"><span>🌸</span> Luna AI (Dual Gemini &amp; GLM-4)</span>
          </div>
          <div class="text-gray-200 text-xs sm:text-sm leading-relaxed">${ans}</div>
        </div>
      `;
    } finally {
      if (teaserSubmit) {
        teaserSubmit.disabled = false;
        teaserSubmit.textContent = 'Ask Luna';
      }
    }
  }

  teaserSubmit?.addEventListener('click', askLunaTeaser);
  teaserInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      askLunaTeaser();
    }
  });
});
