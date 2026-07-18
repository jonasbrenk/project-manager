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

  const ICON_CAL = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="16" rx="3.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>`;
  const ICON_CLOCK = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`;
  const ICON_CHECK = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 5 5L19 7"/></svg>`;
  const ICON_ALERT = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v9"/><circle cx="12" cy="18.4" r="1.3" fill="currentColor" stroke="none"/></svg>`;

  const dateSpan = (date, cls = "") => `<span class="meta-date${cls}">${ICON_CAL}${esc(date)}</span>`;
  const chip = (icon, label, cls = "") => `<span class="meta-chip${cls}">${icon}${esc(label)}</span>`;

  function line({ deadline = null, secondsLeft = null, finished = false } = {}) {
    const date = deadline ? relativeDate(deadline) : null;
    let left = "";
    let right = "";
    if (finished) {
      left = date ? dateSpan(date) : "";
      right = chip(ICON_CHECK, "Finished", " chip-success");
    } else if (!date) {
      left = `<span class="meta-date">${ICON_CAL}No deadline</span>`;
    } else if (secondsLeft != null && secondsLeft <= 0) {
      left = dateSpan(date, " meta-danger");
      right = chip(ICON_ALERT, "Overdue", " chip-danger");
    } else {
      const soon = secondsLeft != null && secondsLeft <= 86400;
      left = dateSpan(date, soon ? " meta-warning" : "");
      if (secondsLeft != null) right = chip(ICON_CLOCK, timeLeft(secondsLeft), soon ? " chip-warning" : "");
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
  let ticking = false;
  let dirty = true;
  const fullHeights = new Map();
  const collapseRanges = new Map();

  const headers = () => scroller.querySelectorAll(".project-hero, .landing-header");
  const collapsibles = () => scroller.querySelectorAll(".project-hero .project-description, .project-hero .project-meta-line");

  // Measure each header's expanded (p = 0) height so it can be reserved.
  function measure() {
    fullHeights.clear();
    collapseRanges.clear();
    const list = [...headers()];
    for (const h of list) h.style.setProperty("--condense", "0");
    for (const el of collapsibles()) el.style.maxHeight = "";
    for (const h of list) {
      fullHeights.set(h, h.offsetHeight);
    }
    for (const h of list) h.style.setProperty("--condense", "1");
    for (const el of collapsibles()) el.style.maxHeight = "0px";
    for (const h of list) {
      // Match each pixel of collapse to one pixel of scroll. A fixed range
      // made long descriptions collapse ahead of the content beneath them.
      collapseRanges.set(h, Math.max(1, fullHeights.get(h) - h.offsetHeight));
      h.style.removeProperty("--condense");
    }
    for (const el of collapsibles()) el.style.maxHeight = "";
    dirty = false;
  }

  function update() {
    ticking = false;
    if (dirty) measure();
    const y = scroller.scrollTop;
    root.classList.toggle("is-scrolled", y > 2);
    const range = Math.max(1, ...collapseRanges.values());
    const p = Math.min(1, Math.max(0, y / range));
    root.style.setProperty("--condense", p.toFixed(4));
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

/* Sheets dismiss by dragging down from their grab-handle area, like native
   iOS sheets. Dismissal clicks the sheet's own close control so each page's
   close logic (form reset etc.) runs. */
function pmInitSheetDismiss() {
  const SHEETS = ".modal, .modal-panel, .settings-modal, .icon-picker-panel";
  let sheet = null;
  let startY = 0;
  let dy = 0;
  let dragging = false;

  document.addEventListener("touchstart", e => {
    sheet = null;
    if (matchMedia("(min-width: 621px)").matches) return;
    const s = e.target.closest(SHEETS);
    if (!s) return;
    if (e.touches[0].clientY - s.getBoundingClientRect().top > 64) return;
    if (e.target.closest("input, textarea, select")) return;
    sheet = s;
    startY = e.touches[0].clientY;
    dy = 0;
    dragging = false;
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!sheet) return;
    dy = e.touches[0].clientY - startY;
    if (!dragging && dy > 10) dragging = true;
    if (dragging) {
      sheet.style.transition = "none";
      sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
    }
  }, { passive: true });

  document.addEventListener("touchend", () => {
    if (!sheet) return;
    const s = sheet;
    sheet = null;
    if (!dragging) return;
    s.style.transition = "transform .28s cubic-bezier(.2, .8, .2, 1)";
    if (dy > 110) {
      s.style.transform = "translateY(110%)";
      setTimeout(() => {
        s.querySelector('[aria-label="Close"], .panel-x')?.click();
        s.style.transform = "";
        s.style.transition = "";
      }, 170);
    } else {
      s.style.transform = "";
    }
  }, { passive: true });
}

/* Shared swipe engine: any `.swipe-row` (wrapper of `.swipe-actions` +
   `.swipe-target` foreground) swipes left to reveal its complete action set,
   iOS style. Pointer devices use the three-dot menu instead. */
function pmInitSwipe() {
  let row = null;
  let startX = 0;
  let startY = 0;
  let offset = 0;
  let width = 0;
  let active = false;
  let direction = null;
  let openRow = null;
  let suppressClick = false;

  const target = r => r.querySelector(".swipe-target");
  const disabled = () => typeof window.pmSwipeDisabled === "function" && window.pmSwipeDisabled();

  if (matchMedia("(pointer: coarse)").matches) {
    document.documentElement.classList.add("swipe-enabled");
  }

  function close() {
    if (!openRow) return;
    const t = target(openRow);
    if (t) t.style.transform = "";
    openRow.classList.remove("swipe-preparing");
    openRow.classList.remove("swipe-actions-visible");
    openRow.classList.remove("swipe-open");
    openRow = null;
  }
  window.pmSwipeClose = close;

  document.addEventListener("touchstart", e => {
    document.documentElement.classList.add("swipe-enabled");
    suppressClick = false;
    const r = e.target.closest(".swipe-row");
    if (openRow && r !== openRow) close();
    row = r && !disabled() ? r : null;
    if (!row) return;
    // Make the foreground solid before actions are ever allowed to paint.
    row.classList.add("swipe-preparing");
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    offset = 0;
    active = false;
    direction = null;
    width = row.querySelector(".swipe-actions")?.offsetWidth || 0;
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!row) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!direction && Math.max(Math.abs(dx), Math.abs(dy)) > 10) {
      direction = Math.abs(dx) > Math.abs(dy) * 1.2 ? "horizontal" : "vertical";
    }
    if (direction !== "horizontal" || !width) return;
    if (!active && Math.abs(dx) > 12) active = true;
    if (!active) return;
    e.preventDefault();
    const base = row === openRow ? -width : 0;
    offset = Math.min(0, Math.max(-width - 24, base + dx));
    const t = target(row);
    if (t) t.style.transform = `translateX(${offset}px)`;
    row.classList.add("dragging");
    if (Math.abs(offset) > 2) {
      const activeRow = row;
      requestAnimationFrame(() => {
        if (activeRow === row || activeRow === openRow) activeRow.classList.add("swipe-actions-visible");
      });
    }
  }, { passive: false });

  document.addEventListener("touchend", () => {
    if (!row) return;
    row.classList.remove("dragging");
    if (active) {
      const t = target(row);
      if (offset < -width / 2) {
        if (t) t.style.transform = `translateX(${-width}px)`;
        row.classList.add("swipe-open");
        openRow = row;
      } else {
        if (t) t.style.transform = "";
        row.classList.remove("swipe-preparing");
        row.classList.remove("swipe-actions-visible");
        row.classList.remove("swipe-open");
        if (openRow === row) openRow = null;
      }
      suppressClick = true;
    } else row.classList.remove("swipe-preparing");
    row = null;
    active = false;
    direction = null;
  }, { passive: true });

  document.addEventListener("touchcancel", () => {
    if (row) {
      row.classList.remove("dragging");
      row.classList.remove("swipe-preparing");
      row.classList.remove("swipe-actions-visible");
    }
    row = null;
    active = false;
    direction = null;
  }, { passive: true });

  document.addEventListener("click", e => {
    if (suppressClick) {
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (openRow && !e.target.closest(".swipe-actions")) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }, true);
}

/* Sheets open without forcing a field into focus. On mobile, programmatic
   focus opens the keyboard and lets WebKit paint a distracting native ring.
   Keep the return target for accessibility; users focus a field by tapping it. */
window.pmSheetOpened = sheet => {
  if (!sheet) return;
  sheet._pmReturnFocus = document.activeElement;
};

window.pmSheetClosed = sheet => {
  const target = sheet?._pmReturnFocus;
  if (target?.isConnected) requestAnimationFrame(() => target.focus({ preventScroll: true }));
};

document.addEventListener("keydown", event => {
  if (event.key !== "Tab") return;
  const sheets = [...document.querySelectorAll('[aria-modal="true"]')]
    .filter(sheet => sheet.getClientRects().length && getComputedStyle(sheet).visibility !== "hidden");
  const sheet = sheets.at(-1);
  if (!sheet) return;
  const focusable = [...sheet.querySelectorAll('button:not([disabled]), [href], input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(element => element.getClientRects().length);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

function pmInit() {
  pmInitScroll();
  pmInitEdgeBack();
  pmInitSheetDismiss();
  pmInitSwipe();
  pmInitOfflineStatus();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/offline-service-worker.js").catch(() => {});
  }
}

function pmInitOfflineStatus() {
  const status = document.createElement("span");
  status.className = "connection-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  (document.querySelector(".nav-actions") || document.body).prepend(status);
  let offline = !navigator.onLine;
  let wasOffline = offline;
  let restoredTimer = null;
  let probeTimer = null;
  let probeToken = 0;

  const offlineIcon = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.7 5.2A12.2 12.2 0 0 1 12 5c5.5 0 9.7 4.7 10 7-.6 1.1-1.5 2.2-2.5 3.1M6.3 6.3A13.2 13.2 0 0 0 2 12c.8 1.6 2.1 3 3.7 4.1M9.5 12.2a4 4 0 0 1 5.1.2M12 19h.01"/></svg><span class="sr-only">Offline</span>`;
  const onlineIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.1a12.1 12.1 0 0 1 16 0M6.8 12.1a8 8 0 0 1 10.4 0M9.7 15.2a4 4 0 0 1 4.6 0M12 19.2h.01"/></svg><span class="sr-only">Back online</span>`;

  const update = nextOffline => {
    const changed = offline !== nextOffline;
    offline = nextOffline;
    document.documentElement.toggleAttribute("data-offline", offline);
    clearTimeout(restoredTimer);
    if (offline) {
      status.hidden = false;
      status.className = "connection-status is-offline";
      status.innerHTML = offlineIcon;
      wasOffline = true;
    } else if (wasOffline) {
      status.hidden = false;
      status.className = "connection-status is-online";
      status.innerHTML = onlineIcon;
      wasOffline = false;
      restoredTimer = setTimeout(() => { status.hidden = true; }, 1800);
    } else status.hidden = true;
    if (changed) window.dispatchEvent(new CustomEvent("pmconnectionchange", { detail: { offline } }));
  };

  const probe = async () => {
    const token = ++probeToken;
    clearTimeout(probeTimer);
    if (!navigator.onLine) {
      update(true);
      probeTimer = setTimeout(probe, 6000);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
      if (token !== probeToken) return;
      update(!response.ok);
    } catch {
      if (token !== probeToken) return;
      update(true);
    } finally {
      clearTimeout(timeout);
      if (token !== probeToken) return;
      probeTimer = setTimeout(probe, offline ? 6000 : 45000);
    }
  };
  window.addEventListener("online", probe);
  window.addEventListener("offline", () => probe());
  update(offline);
  probe();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pmInit);
else pmInit();
