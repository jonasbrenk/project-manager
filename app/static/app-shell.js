/* Runs a DOM mutation inside a View Transition so list changes (hide/show,
   delete, reorder) animate smoothly; falls back to an instant update. Rows
   with a unique view-transition-name morph between positions. */
window.pmAnimate = fn => {
  if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.startViewTransition(fn);
  } else {
    fn();
  }
};

/* Shared meta-line component: iOS-style secondary line, identical on all
   pages. Relative date on the left ("Tomorrow, 18:30"), remaining time on
   the right ("3d 4h"), colored by urgency: red overdue, orange < 24h. */
window.pmMeta = (() => {
  const esc = value => String(value).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]
  ));

  function relativeDate(value) {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return null;
    const now = new Date();
    const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dayDiff = Math.round((startOfDay(dt) - startOfDay(now)) / 86400000);
    let date;
    if (dayDiff === 0) date = "Today";
    else if (dayDiff === 1) date = "Tomorrow";
    else if (dayDiff === -1) date = "Yesterday";
    else if (dayDiff > 1 && dayDiff < 7) date = dt.toLocaleDateString([], { weekday: "long" });
    else {
      const year = dt.getFullYear() !== now.getFullYear() ? ` ${dt.getFullYear()}` : "";
      date = `${dt.getDate()}. ${dt.toLocaleDateString([], { month: "long" })}${year}`;
    }
    if (dt.getHours() || dt.getMinutes()) {
      date += `, ${dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }
    return date;
  }

  function timeLeft(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function line({ deadline = null, secondsLeft = null, finished = false } = {}) {
    const date = deadline ? relativeDate(deadline) : null;
    let left = "";
    let right = "";
    if (finished) {
      left = date ? `<span class="meta-date">${esc(date)}</span>` : "";
      right = `<span class="meta-countdown meta-success">✓ Finished</span>`;
    } else if (!date) {
      left = `<span class="meta-date">No deadline</span>`;
    } else if (secondsLeft != null && secondsLeft <= 0) {
      left = `<span class="meta-date meta-danger">${esc(date)}</span>`;
      right = `<span class="meta-countdown meta-danger">Overdue</span>`;
    } else {
      const soon = secondsLeft != null && secondsLeft <= 86400;
      left = `<span class="meta-date${soon ? " meta-warning" : ""}">${esc(date)}</span>`;
      if (secondsLeft != null) right = `<span class="meta-countdown${soon ? " meta-warning" : ""}">${esc(timeLeft(secondsLeft))}</span>`;
    }
    if (!left && !right) return "";
    return `<div class="project-meta-line">${left}${right}</div>`;
  }

  return { line };
})();

/* Drives the iOS-style header behavior. The headers condense linearly with
   scroll: `--condense` on <html> scrubs from 0 to 1 across the first RANGE px,
   so the compression tracks the finger exactly — no thresholds, no jumping.
   Collapsible hero rows (description, meta line) are height-interpolated in
   JS because their natural height is content-dependent. */
function pmInitScroll() {
  const scroller = document.getElementById("appScroll");
  if (!scroller) return;
  const root = document.documentElement;
  const RANGE = 56;
  let ticking = false;
  let dirty = true;
  const fullHeights = new Map();

  const headers = () => scroller.querySelectorAll(".project-hero, .landing-header");
  const collapsibles = () => scroller.querySelectorAll(".project-hero .project-description, .project-hero .project-meta-line");

  // Measure each header's expanded (p = 0) height so it can be reserved.
  function measure() {
    fullHeights.clear();
    const list = [...headers()];
    for (const h of list) h.style.setProperty("--condense", "0");
    for (const el of collapsibles()) el.style.maxHeight = "";
    for (const h of list) {
      fullHeights.set(h, h.offsetHeight);
      h.style.removeProperty("--condense");
    }
    dirty = false;
  }

  function update() {
    ticking = false;
    const y = scroller.scrollTop;
    root.classList.toggle("is-scrolled", y > 2);
    const p = Math.min(1, Math.max(0, y / RANGE));
    root.style.setProperty("--condense", p.toFixed(4));
    if (dirty) measure();
    for (const el of collapsibles()) {
      el.style.maxHeight = `${el.scrollHeight * (1 - p)}px`;
      el.style.opacity = Math.max(0, 1 - p * 1.4).toFixed(3);
    }
    // Compressing a sticky header shrinks the document, which would pull the
    // scroll position back and cancel the very scroll driving the compression
    // (jumping). Reserve the lost height as margin so scroll geometry is
    // completely unaffected by the animation.
    for (const h of headers()) {
      const full = fullHeights.get(h) || 0;
      h.style.marginBottom = `${Math.max(0, full - h.offsetHeight)}px`;
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  scroller.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", () => { dirty = true; onScroll(); });
  // Pages re-render content via innerHTML; re-measure and re-apply.
  new MutationObserver(() => { dirty = true; onScroll(); }).observe(scroller, { childList: true, subtree: true });
  update();
}

/* iOS edge-swipe back: drag from the left screen edge to slide the page
   away and navigate back. Only active on pages with a back link. */
function pmInitEdgeBack() {
  const surface = document.getElementById("appScroll");
  if (!surface || !document.querySelector(".back-link")) return;
  let startX = null;
  let startY = 0;
  let dx = 0;
  let active = false;

  function goBack() {
    if (document.referrer.startsWith(location.origin) && history.length > 1) history.back();
    else location.href = "/";
  }

  window.addEventListener("touchstart", e => {
    const t = e.touches[0];
    startX = t.clientX <= 28 ? t.clientX : null;
    startY = t.clientY;
    dx = 0;
    active = false;
  }, { passive: true });

  window.addEventListener("touchmove", e => {
    if (startX == null) return;
    const t = e.touches[0];
    dx = t.clientX - startX;
    const dy = Math.abs(t.clientY - startY);
    if (!active && dx > 14 && dx > dy * 1.4) active = true;
    if (active) {
      surface.style.transition = "none";
      surface.style.transform = `translateX(${Math.max(0, dx)}px)`;
    }
  }, { passive: true });

  window.addEventListener("touchend", () => {
    if (startX == null) return;
    surface.style.transition = "transform .28s cubic-bezier(.2, .8, .2, 1)";
    if (active && dx > 90) {
      surface.style.transform = "translateX(100vw)";
      setTimeout(goBack, 130);
    } else {
      surface.style.transform = "";
    }
    startX = null;
    active = false;
  }, { passive: true });

  // Restore the surface when returning via back/forward cache.
  window.addEventListener("pageshow", () => {
    surface.style.transition = "none";
    surface.style.transform = "";
  });
}

function pmInit() {
  pmInitScroll();
  pmInitEdgeBack();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pmInit);
else pmInit();
