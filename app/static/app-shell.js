/* Shared meta-line component: renders deadline/status as an iOS-style
   secondary text line ("Due 14 Mar · 3d 4h left") identically on all pages. */
window.pmMeta = (() => {
  const esc = value => String(value).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]
  ));

  function compactDate(value) {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return null;
    const month = dt.toLocaleDateString([], { month: "long" });
    const year = dt.getFullYear() !== new Date().getFullYear() ? ` ${dt.getFullYear()}` : "";
    const date = `${dt.getDate()}. ${month}${year}`;
    if (!dt.getHours() && !dt.getMinutes()) return date;
    return `${date}, ${dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  function timeLeft(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h left`;
    if (h > 0) return `${h}h ${m}m left`;
    return `${m}m left`;
  }

  function items({ deadline = null, secondsLeft = null, finished = false } = {}) {
    const list = [];
    const date = deadline ? compactDate(deadline) : null;
    if (date) list.push(`<span class="project-meta-item">📅 ${esc(date)}</span>`);
    if (finished) {
      list.push(`<span class="project-meta-item meta-success">✓ Finished</span>`);
    } else if (secondsLeft == null) {
      if (!date) list.push(`<span class="project-meta-item">No deadline</span>`);
    } else if (secondsLeft <= 0) {
      list.push(`<span class="project-meta-item meta-danger">◷ Overdue</span>`);
    } else {
      const soon = secondsLeft <= 7 * 86400;
      list.push(`<span class="project-meta-item${soon ? " meta-warning" : ""}">◷ ${esc(timeLeft(secondsLeft))}</span>`);
    }
    return list;
  }

  function wrap(list) {
    if (!list.length) return "";
    return `<div class="project-meta-line">${list.join(`<span class="project-meta-separator">•</span>`)}</div>`;
  }

  return { line: opts => wrap(items(opts)), items, wrap };
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

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pmInitScroll);
else pmInitScroll();
