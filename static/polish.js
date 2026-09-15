/* ClearMind interaction polish. No fetch, session, audio or math overrides. */
(function () {
  "use strict";

  function init() {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobile = window.matchMedia("(max-width: 767px)");
    const configs = [
      { id: "authModal", panel: ".modal-card", close: "closeAuthModalBtn", active: true, title: "Account access" },
      { id: "onboardingModal", panel: ".modal-card", close: "closeOnboardingBtn", active: true, title: "Academic setup" },
      { id: "profileModal", panel: ":scope > div", close: "closeProfileModal", title: "Study profile" },
      { id: "cmdPaletteModal", panel: ".cmd-palette-box", close: "cmdPaletteBackdrop", title: "Search commands" },
      { id: "shortcutsModal", panel: ":scope > div:not(#shortcutsModalBackdrop)", close: "closeShortcutsModal", title: "Keyboard shortcuts" }
    ];
    const dialogs = [];
    const visible = (el) => el && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden";

    configs.forEach((config) => {
      const modal = document.getElementById(config.id);
      const panel = modal && modal.querySelector(config.panel);
      if (!panel) return;
      panel.classList.add("cm-sheet-panel");
      panel.setAttribute("role", "dialog");
      if (!panel.hasAttribute("aria-label") && !panel.hasAttribute("aria-labelledby")) panel.setAttribute("aria-label", config.title);
      if (!panel.hasAttribute("tabindex")) panel.tabIndex = -1;
      const isOpen = () => config.active ? modal.classList.contains("active") : !modal.classList.contains("hidden");
      const close = () => {
        const button = document.getElementById(config.close);
        if (button && !button.disabled && isOpen()) button.click();
      };
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "cm-sheet-handle";
      handle.setAttribute("aria-label", "Close " + config.title.toLowerCase());
      const mark = document.createElement("span");
      mark.setAttribute("aria-hidden", "true");
      handle.append(mark);
      panel.prepend(handle);
      let gesture = null;
      let suppressClick = false;
      const resetDrag = () => {
        if (gesture) {
          panel.style.translate = gesture.translate;
          panel.style.willChange = gesture.willChange;
        }
        gesture = null;
      };
      handle.addEventListener("pointerdown", (event) => {
        if (!mobile.matches || !isOpen() || event.button !== 0) return;
        gesture = { id: event.pointerId, y: event.clientY, dy: 0, translate: panel.style.translate, willChange: panel.style.willChange };
        handle.setPointerCapture(event.pointerId);
        if (!reduced.matches) panel.style.willChange = "translate";
      });
      handle.addEventListener("pointermove", (event) => {
        if (!gesture || gesture.id !== event.pointerId) return;
        gesture.dy = Math.max(0, event.clientY - gesture.y);
        if (!reduced.matches) panel.style.translate = "0 " + Math.min(gesture.dy, 240) + "px";
      });
      handle.addEventListener("pointerup", (event) => {
        if (!gesture || gesture.id !== event.pointerId) return;
        const distance = gesture.dy;
        suppressClick = distance > 8;
        resetDrag();
        if (distance > 90) close();
        setTimeout(() => { suppressClick = false; }, 0);
      });
      handle.addEventListener("pointercancel", resetDrag);
      handle.addEventListener("lostpointercapture", resetDrag);
      handle.addEventListener("click", () => { if (!suppressClick) close(); });
      let wasOpen = false;
      let returnFocus = null;
      const sync = () => {
        const open = isOpen();
        panel.setAttribute("aria-modal", String(open));
        modal.setAttribute("aria-hidden", String(!open));
        if (open && !wasOpen) {
          returnFocus = document.activeElement;
          requestAnimationFrame(() => {
            if (!isOpen() || panel.contains(document.activeElement)) return;
            const first = panel.querySelector("input:not([type=hidden]), button:not(.cm-sheet-handle), [tabindex='0']");
            (visible(first) ? first : panel).focus({ preventScroll: true });
          });
        } else if (!open && wasOpen) {
          resetDrag();
          if (returnFocus && returnFocus.isConnected && visible(returnFocus)) returnFocus.focus({ preventScroll: true });
        }
        wasOpen = open;
        document.body.classList.toggle("cm-dialog-open", dialogs.some((d) => d.isOpen()));
      };
      dialogs.push({ panel, isOpen, close });
      new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ["class"] });
      sync();
    });

    document.addEventListener("keydown", (event) => {
      const dialog = dialogs.filter((d) => d.isOpen()).pop();
      if (!dialog) return;
      if (event.key === "Escape") { event.preventDefault(); dialog.close(); return; }
      if (event.key !== "Tab") return;
      const nodes = [...dialog.panel.querySelectorAll("button, input, select, textarea, a[href], [tabindex]")]
        .filter((el) => !el.disabled && el.tabIndex >= 0 && !el.closest("[inert]") && visible(el));
      const first = nodes[0] || dialog.panel;
      const last = nodes[nodes.length - 1] || dialog.panel;
      if (event.shiftKey && (document.activeElement === first || !dialog.panel.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.panel.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    });

    const labels = {
      headerProfileBtnMobile: "Open study profile", headerProfileBtn: "Open study profile",
      chatMicBtn: "Speak to Luna", chatSendBtn: "Send message", chatMessageInput: "Message Luna",
      languageSelect: "Tutor language", languageSelectMobile: "Tutor language",
      chatPhotoInput: "Upload textbook photo", resetChatBtn: "Start a new topic", quickFlashcardBtn: "Generate flashcards",
      closeAuthModalBtn: "Close account access", closeProfileModal: "Close study profile",
      closeOnboardingBtn: "Close academic setup", closeShortcutsModal: "Close keyboard shortcuts"
    };
    Object.entries(labels).forEach(([id, label]) => {
      const el = document.getElementById(id);
      if (el && !el.hasAttribute("aria-label")) el.setAttribute("aria-label", label);
    });
    const stream = document.getElementById("chatMessagesContainer");
    if (stream) { stream.setAttribute("role", "log"); stream.setAttribute("aria-live", "polite"); stream.setAttribute("aria-label", "Conversation with Luna"); }
    // Make the existing file-upload label keyboard-accessible without replacing it.
    const upload = document.querySelector("label[for=chatPhotoInput]");
    if (upload) {
      upload.tabIndex = 0;
      upload.setAttribute("role", "button");
      upload.setAttribute("aria-label", "Upload textbook photo");
      upload.addEventListener("keydown", (event) => {
        if (event.key === " " || event.key === "Enter") { event.preventDefault(); document.getElementById("chatPhotoInput")?.click(); }
      });
    }

    const navbar = document.getElementById("globalNavbar");
    if (navbar) {
      document.body.classList.add("cm-app");
      let frame = 0;
      const updateViewport = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
          document.documentElement.style.setProperty("--cm-viewport-height", Math.round(height) + "px");
          document.documentElement.style.setProperty("--cm-navbar-height", Math.ceil(navbar.getBoundingClientRect().height) + "px");
          document.body.classList.toggle("cm-keyboard-open", window.innerHeight - height > 120);
        });
      };
      window.visualViewport?.addEventListener("resize", updateViewport, { passive: true });
      window.addEventListener("resize", updateViewport, { passive: true });
      new ResizeObserver(updateViewport).observe(navbar);
      updateViewport();
    }
  }

  // Non-destructive overlays: retain all original nodes, IDs and listeners.
  // A ticket prevents an older request's finally block clearing a newer one.
  const states = new WeakMap();
  function clear(host, ticket) {
    const state = host && states.get(host);
    if (!state || (ticket && ticket !== state)) return;
    state.overlay.remove();
    host.classList.remove("cm-loading-host");
    if (state.busy === null) host.removeAttribute("aria-busy"); else host.setAttribute("aria-busy", state.busy);
    state.children.forEach(([el, inert]) => { el.inert = inert; });
    states.delete(host);
  }
  window.CMSkeleton = {
    show(host, lines = 3, label = "Preparing your study material") {
      if (!host) return null;
      clear(host);
      const overlay = document.createElement("div");
      overlay.className = "cm-loading-overlay";
      overlay.setAttribute("role", "status");
      overlay.setAttribute("aria-live", "polite");
      const caption = document.createElement("p");
      caption.className = "cm-loading-caption";
      caption.textContent = label;
      overlay.append(caption);
      for (let i = 0; i < Math.max(1, Math.min(Number(lines) || 3, 6)); i++) {
        const line = document.createElement("div");
        line.className = "cm-skeleton cm-skeleton-line";
        line.style.width = (100 - i * 9) + "%";
        line.setAttribute("aria-hidden", "true");
        overlay.append(line);
      }
      const state = { overlay, busy: host.getAttribute("aria-busy"), children: [...host.children].map((el) => [el, el.inert]) };
      state.children.forEach(([el]) => { el.inert = true; });
      host.classList.add("cm-loading-host");
      host.setAttribute("aria-busy", "true");
      host.append(overlay);
      states.set(host, state);
      return state;
    },
    clear
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
