/* Shared HTTP boundary for screen controllers. */
window.PM = window.PM || {};
window.PM.api = (() => {
  const request = (url, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (options.json !== undefined) {
      headers.set("Content-Type", "application/json");
      options = { ...options, body: JSON.stringify(options.json) };
      delete options.json;
    }
    if (typeof options.body === "string" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(url, { ...options, headers });
  };
  const json = async (url, options = {}) => {
    const response = await request(url, options);
    if (!response.ok) throw new Error(await response.text() || "Request failed");
    return response.headers.get("content-type")?.includes("application/json") ? response.json() : null;
  };
  return { request, json };
})();
