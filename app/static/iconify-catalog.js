(() => {
  const API_BASE = "https://api.iconify.design";
  const cache = new Map();

  function iconUrl(iconName) {
    const separator = String(iconName).indexOf(":");
    if (separator < 1) return "";
    const prefix = iconName.slice(0, separator);
    const name = iconName.slice(separator + 1);
    return `${API_BASE}/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`;
  }

  async function search(query) {
    const normalized = String(query || "").trim().toLocaleLowerCase();
    if (normalized.length < 2) return [];
    if (cache.has(normalized)) return cache.get(normalized);

    const request = fetch(`${API_BASE}/search?query=${encodeURIComponent(normalized)}&limit=48`)
      .then(response => {
        if (!response.ok) throw new Error("Icon search failed");
        return response.json();
      })
      .then(data => (Array.isArray(data.icons) ? data.icons : []).map(name => ({ name, url: iconUrl(name) })).filter(icon => icon.url))
      .catch(error => {
        cache.delete(normalized);
        throw error;
      });

    cache.set(normalized, request);
    return request;
  }

  window.IconifyCatalog = { search, iconUrl };
})();
