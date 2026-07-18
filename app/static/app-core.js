/* Shared, dependency-free primitives for every screen. Page controllers stay
 * focused on their feature state while this module owns presentation basics. */
window.PM = window.PM || {};

window.PM.html = (() => {
  const escape = (value = "") => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const normalize = (value = "") => String(value).replaceAll("-->", "→");
  const isImageUrl = (value = "") => /^(?:https?:\/\/|\/static\/).+\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i.test(String(value).trim());
  const icon = (value, fallback = "📌", alt = "icon") => {
    const source = String(value || fallback).trim();
    return isImageUrl(source)
      ? `<img src="${escape(source)}" alt="${escape(alt)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;" />`
      : escape(source || fallback);
  };
  return { escape, normalize, isImageUrl, icon };
})();

window.PM.time = (() => {
  const formatDeadline = deadline => {
    if (!deadline) return "No deadline";
    const date = new Date(deadline);
    return Number.isNaN(date.getTime()) ? "Invalid deadline" : date.toLocaleString([], {
      year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  };
  const formatRemaining = (seconds, { commas = false, short = false } = {}) => {
    if (seconds == null) return "No deadline";
    if (seconds <= 0) return "Deadline passed";
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const separator = commas ? ", " : " ";
    if (days > 0) return `${days}d${separator}${hours}h${short ? "" : " left"}`;
    if (hours > 0) return `${hours}h${separator}${minutes}${short ? "m" : "m left"}`;
    return short ? `${minutes}m` : `${minutes}${commas ? " min" : "m"} left`;
  };
  const dueSoon = seconds => seconds != null && seconds > 0 && seconds <= 7 * 86400;
  return { formatDeadline, formatRemaining, dueSoon };
})();

window.PM.theme = (() => {
  const KEY = "pm_theme_mode";
  const resolve = requested => requested === "light" || requested === "dark"
    ? requested
    : (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const apply = (requested, persist = false) => {
    const theme = resolve(requested);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f2f2f7" : "#0b1020");
    if (persist) localStorage.setItem(KEY, theme);
    return theme;
  };
  return { KEY, apply, toggle: () => apply(document.documentElement.dataset.theme === "light" ? "dark" : "light", true) };
})();
