/* ===========================================================================
   ClearMind Pro — Polish behaviours
   ---------------------------------------------------------------------------
   Additive only. Attaches NEW listeners; never removes or overrides anything.
   Wrapped in try/catch so a failure here can never break the app.

   1. Swipe-to-dismiss for the mobile bottom sheets.
   2. window.CMSkeleton — a helper for shimmer placeholders.
   =========================================================================== */
(function () {
  "use strict";

  try {
    /* ---------- 1. Swipe-to-dismiss bottom sheets ------------------------ */
    var SHEETS = ["profileModal", "authModal", "onboardingModal", "cmdPaletteModal", "shortcutsModal"];
    var THRESHOLD = 110; // px of downward drag required to dismiss
    var AXIS_LOCK = 12;  // px before we decide the gesture is vertical

    function isMobileSheet() {
      return window.matchMedia("(max-width: 767px)").matches &&
             window.matchMedia("(pointer: coarse)").matches;
    }

    function panelOf(modal) {
      // Mirror the CSS: first element child that is not a dedicated backdrop.
      var kids = modal.children;
      for (var i = 0; i < kids.length; i++) {
        var el = kids[i];
        if (el.id && el.id.toLowerCase().indexOf("backdrop") !== -1) continue;
        return el;
      }
      return kids[0] || modal;
    }

    function closeControl(modal) {
      var sel = '[data-close-modal], [data-close], [id*="close" i], [id*="Close"]';
      var el = modal.querySelector(sel);
      // Never pick the modal container itself as its own close button.
      return (el && el !== modal) ? el : null;
    }

    SHEETS.forEach(function (id) {
      var modal = document.getElementById(id);
      if (!modal) return;

      var startY = null, startX = null, dragging = false;

      modal.addEventListener("touchstart", function (e) {
        if (!isMobileSheet() || e.touches.length !== 1) return;
        var t = e.touches[0];
        startY = t.clientY;
        startX = t.clientX;
        dragging = false;
      }, { passive: true });

      modal.addEventListener("touchmove", function (e) {
        if (startY === null || !isMobileSheet()) return;
        var t = e.touches[0];
        var dy = t.clientY - startY;
        var dx = Math.abs(t.clientX - startX);

        // Only take over the gesture once it is clearly vertical AND the sheet
        // is scrolled to the top. Otherwise the user is just scrolling content.
        if (!dragging && dy > AXIS_LOCK && dy > dx) {
          var panel = panelOf(modal);
          if (panel && panel.scrollTop > 0) { startY = null; return; }
          dragging = true;
        }

        if (dragging && dy > 0) {
          var p = panelOf(modal);
          if (p) {
            p.style.transition = "none";
            p.style.transform = "translateY(" + dy + "px)";
          }
          if (e.cancelable) e.preventDefault();
        }
      }, { passive: false });

      modal.addEventListener("touchend", function (e) {
        if (startY === null) return;
        var dy = (e.changedTouches[0] ? e.changedTouches[0].clientY : startY) - startY;
        var panel = panelOf(modal);
        startY = null;

        if (panel) {
          panel.style.transition = "";
          panel.style.transform = "";
        }

        if (dragging && dy > THRESHOLD) {
          var btn = closeControl(modal);
          if (btn) {
            btn.click();
          } else if (panel) {
            // No dedicated close control: nudge it out and hide the container.
            panel.style.transition = "transform .2s ease-in";
            panel.style.transform = "translateY(100%)";
            setTimeout(function () {
              panel.style.transition = "";
              panel.style.transform = "";
              modal.classList.add("hidden");
            }, 200);
          }
        }
        dragging = false;
      }, { passive: true });
    });

    /* ---------- 2. Skeleton helper ---------------------------------------- */
    // window.CMSkeleton.show(el, 3)  -> replaces contents with shimmer lines
    // window.CMSkeleton.clear(el)    -> restores
    window.CMSkeleton = {
      show: function (el, lines) {
        if (!el) return;
        if (!el.dataset.cmSkeletonHtml) el.dataset.cmSkeletonHtml = el.innerHTML;
        var n = Math.max(1, Math.min(lines || 3, 6));
        var html = "";
        for (var i = 0; i < n; i++) {
          html += '<div class="cm-skeleton cm-skeleton-line" style="width:' +
                  (100 - i * 11) + '%"></div>';
        }
        el.innerHTML = html;
      },
      clear: function (el) {
        if (!el) return;
        if (el.dataset.cmSkeletonHtml !== undefined) {
          el.innerHTML = el.dataset.cmSkeletonHtml;
          delete el.dataset.cmSkeletonHtml;
        }
      }
    };
  } catch (err) {
    // Polish must never break the product.
    if (window.console) console.warn("[polish] disabled:", err);
  }
})();
