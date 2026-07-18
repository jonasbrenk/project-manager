/* Small offline write-ahead log.  It deliberately stores complete project
 * snapshots: on reconnect the newest timestamp wins, rather than attempting
 * a surprising field-level merge. */
(() => {
  const KEY = "pm_offline_changes_v1";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
  const write = changes => localStorage.setItem(KEY, JSON.stringify(changes.slice(-100)));
  const now = () => new Date().toISOString();
  const queue = change => {
    // Keep every operation as an audit trail. Full snapshots still make the
    // eventual sync deterministic: the latest timestamp simply wins.
    const changes = read();
    changes.push({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, changed_at: now(), ...change });
    write(changes);
  };
  const offline = () => document.documentElement.hasAttribute("data-offline") || !navigator.onLine;
  async function flush() {
    if (offline()) return false;
    const changes = read();
    if (!changes.length) return true;
    try {
      const response = await fetch("/api/offline-changes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes }) });
      if (!response.ok) return false;
      const accepted = new Set((await response.json()).accepted || []);
      write(read().filter(change => !accepted.has(change.id)));
      return true;
    } catch { return false; }
  }
  window.pmOffline = { offline, queueProject(project) { const updated = { ...project, updated_at: now() }; queue({ op: "upsert", project_id: updated.id, project: updated }); return updated; }, queueDelete(projectId) { queue({ op: "delete", project_id: projectId }); }, flush };
  window.addEventListener("pmconnectionchange", event => { if (!event.detail.offline) flush(); });
  window.addEventListener("online", flush);
  setTimeout(flush, 0);
})();
