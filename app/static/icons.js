/* Persistent standard/custom icon collection shared by both screen pickers. */
window.PM = window.PM || {};
window.PM.icons = (() => {
  const KEY = "project_manager_standard_icons";
  const createStore = (defaults, legacyValues = new Set()) => {
    let values = [];
    const load = () => {
      try {
        const saved = JSON.parse(localStorage.getItem(KEY) || "null");
        const custom = Array.isArray(saved) ? saved.filter(icon => {
          const value = String(icon?.value || "").trim();
          return value && !legacyValues.has(value) && !defaults.some(item => item.value === value);
        }).map(icon => ({ label: String(icon.label || "Custom").trim() || "Custom", value: String(icon.value).trim(), removable: true })) : [];
        values = [...defaults, ...custom];
      } catch { values = [...defaults]; }
      return values;
    };
    const save = () => localStorage.setItem(KEY, JSON.stringify(values));
    const add = (value, label = "Custom") => {
      const normalized = String(value || "").trim();
      if (!normalized || values.some(icon => String(icon.value).trim() === normalized)) return;
      values.unshift({ label: String(label || "Custom").trim() || "Custom", value: normalized, removable: true });
      save();
    };
    return { load, save, add, get values() { return values; } };
  };
  return { createStore };
})();
