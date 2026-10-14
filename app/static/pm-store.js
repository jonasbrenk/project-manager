/* Local-first project store. Every project lives on this device and every
 * edit is saved here first, so the app works the same with or without the
 * server. Changes sync in the background: the server merges each one against
 * the version it was based on, so edits from several devices are combined
 * instead of overwriting each other. */
(() => {
  const PREFIX = "pm2:";
  const DOC = id => `${PREFIX}doc:${id}`;
  const BASE = id => `${PREFIX}base:${id}`;
  const PENDING = `${PREFIX}pending`;
  const TRASH = `${PREFIX}trash`;
  const REVISION = `${PREFIX}revision`;
  const SYNCED = `${PREFIX}synced`;
  const MIGRATED = `${PREFIX}migrated`;
  const SYNC_TIMEOUT = 15000;
  const SYNC_INTERVAL = 30000;

  const listeners = new Set();
  let syncTimer = null;
  let running = null;
  let again = false;
  let failures = 0;

  const readJson = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const now = () => new Date().toISOString();
  const newId = () => (crypto.randomUUID?.() || `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`).replace(/-/g, "");

  const secondsLeft = deadline => {
    if (!deadline) return null;
    const time = new Date(deadline).getTime();
    return Number.isNaN(time) ? null : Math.floor((time - Date.now()) / 1000);
  };
  const countSteps = steps => (steps || []).reduce((count, step) => {
    const nested = countSteps(step.children);
    return { total: count.total + 1 + nested.total, done: count.done + Number(!!step.done) + nested.done };
  }, { total: 0, done: 0 });

  // Derived values are computed on read, so stored documents never go stale.
  const stripStep = ({ seconds_left, ...step }) => ({ ...step, children: (step.children || []).map(stripStep) });
  const strip = ({ seconds_left, task_total, task_done, ...project }) => ({ ...project, steps: (project.steps || []).map(stripStep) });
  const enrichStep = step => ({ ...step, seconds_left: secondsLeft(step.deadline), children: (step.children || []).map(enrichStep) });
  const enrich = project => project && { ...project, seconds_left: secondsLeft(project.deadline), steps: (project.steps || []).map(enrichStep) };
  const summarize = project => {
    const tasks = countSteps(project.steps);
    return { ...project, task_total: tasks.total, task_done: tasks.done };
  };
  // Compares content only: the server orders keys differently and stamps a
  // new updated_at, neither of which is worth redrawing the screen for.
  const canonical = value => JSON.stringify(value, (key, item) => (
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).filter(name => name !== "updated_at").sort().map(name => [name, item[name]]))
      : item
  ));
  const sortKey = project => [project.finished ? 1 : 0, project.seconds_left ?? Number.POSITIVE_INFINITY];

  const localIds = () => {
    const ids = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(`${PREFIX}doc:`)) ids.push(key.slice(`${PREFIX}doc:`.length));
    }
    return ids;
  };

  function list() {
    return localIds()
      .map(id => enrich(readJson(DOC(id), null)))
      .filter(Boolean)
      .sort((a, b) => {
        const [aFinished, aLeft] = sortKey(a);
        const [bFinished, bLeft] = sortKey(b);
        return aFinished - bFinished || aLeft - bLeft;
      });
  }

  function emit(ids, source) {
    const detail = { ids: [...ids], source };
    listeners.forEach(listener => { try { listener(detail); } catch (error) { console.error(error); } });
  }

  // Pending marks are written before the document: a crash in between only
  // re-sends an unchanged document, it can never silently drop an edit.
  function markPending(id, deleted = false) {
    const pending = readJson(PENDING, {});
    pending[id] = { rev: (pending[id]?.rev || 0) + 1, deleted };
    writeJson(PENDING, pending);
  }

  function save(project) {
    const stored = { ...strip(project), updated_at: now() };
    markPending(stored.id);
    writeJson(DOC(stored.id), stored);
    scheduleSync();
    return enrich(stored);
  }

  function create(fields) {
    const timestamp = now();
    return save({ links: [], steps: [], files: [], file_links: [], finished: false, ...fields, id: newId(), created_at: timestamp });
  }

  function remove(id) {
    markPending(id, true);
    localStorage.removeItem(DOC(id));
    scheduleSync();
  }

  function settle(result, changes, sentRevs) {
    const pending = readJson(PENDING, {});
    const editedSince = id => !!pending[id] && pending[id].rev !== sentRevs[id];
    const changed = new Set();
    let trashChanged = false;

    if (Array.isArray(result.projects)) {
      const serverIds = new Set();
      for (const incoming of result.projects) {
        serverIds.add(incoming.id);
        if (editedSince(incoming.id)) continue;
        const next = strip(incoming);
        const current = readJson(DOC(incoming.id), null);
        if (!current || canonical(current) !== canonical(next)) changed.add(incoming.id);
        writeJson(DOC(incoming.id), next);
        writeJson(BASE(incoming.id), next);
      }
      for (const id of localIds()) {
        if (serverIds.has(id) || editedSince(id)) continue;
        localStorage.removeItem(DOC(id));
        localStorage.removeItem(BASE(id));
        changed.add(id);
      }
      const trash = result.deleted_items || [];
      if (canonical(trash) !== canonical(readJson(TRASH, []))) trashChanged = true;
      writeJson(TRASH, trash);
    }

    for (const change of changes) {
      const id = change.project_id;
      if (!pending[id]) continue;
      if (pending[id].rev === sentRevs[id]) {
        delete pending[id];
        if (change.op === "delete") localStorage.removeItem(BASE(id));
      } else if (change.op === "upsert") {
        // Edited again while this sync was in flight: the next sync merges
        // the newer edits against what the server has already received.
        writeJson(BASE(id), change.project);
      }
    }
    writeJson(PENDING, pending);
    localStorage.setItem(REVISION, String(result.revision ?? ""));
    localStorage.setItem(SYNCED, "1");
    if (changed.size || trashChanged) emit(changed, "sync");
  }

  async function runSync() {
    const pending = readJson(PENDING, {});
    const sentRevs = {};
    const changes = [];
    for (const [id, entry] of Object.entries(pending)) {
      sentRevs[id] = entry.rev;
      if (entry.deleted) changes.push({ op: "delete", project_id: id });
      else {
        const project = readJson(DOC(id), null);
        if (project) changes.push({ op: "upsert", project_id: id, project, base: readJson(BASE(id), null) });
      }
    }
    const revision = Number(localStorage.getItem(REVISION)) || null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT);
    let response;
    try {
      response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes, revision: localStorage.getItem(SYNCED) ? revision : null }),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      error.network = true;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`Sync failed (${response.status})`);
    settle(await response.json(), changes, sentRevs);
  }

  const withLock = task => navigator.locks?.request ? navigator.locks.request("pm-sync", task) : task();

  function sync() {
    if (running) {
      again = true;
      return running;
    }
    clearTimeout(syncTimer);
    if (!navigator.onLine) {
      window.pmReportConnection?.(false);
      return Promise.resolve(false);
    }
    running = (async () => {
      try {
        do {
          again = false;
          await withLock(runSync);
        } while (again);
        failures = 0;
        window.pmReportConnection?.(true);
        return true;
      } catch (error) {
        failures += 1;
        if (error.network) window.pmReportConnection?.(false);
        scheduleSync(Math.min(30000, 2000 * 2 ** (failures - 1)));
        return false;
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function scheduleSync(delay = 300) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, delay);
  }

  // One-time import of the previous offline cache and its queued edits.
  function migrate() {
    if (localStorage.getItem(MIGRATED)) return;
    try {
      const oldKeys = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith("pm_project_") && key !== "pm_project_summaries") oldKeys.push(key);
      }
      for (const key of oldKeys) {
        const project = readJson(key, null);
        if (!project?.id || localStorage.getItem(DOC(project.id))) continue;
        writeJson(DOC(project.id), strip(project));
        writeJson(BASE(project.id), strip(project));
      }
      for (const change of readJson("pm_offline_changes_v1", [])) {
        if (!change?.project_id) continue;
        if (change.op === "delete") {
          markPending(change.project_id, true);
          localStorage.removeItem(DOC(change.project_id));
        } else if (change.op === "upsert" && change.project) {
          markPending(change.project_id);
          writeJson(DOC(change.project_id), strip(change.project));
          localStorage.removeItem(BASE(change.project_id));
        }
      }
      [...oldKeys, "pm_project_summaries", "pm_offline_changes_v1"].forEach(key => localStorage.removeItem(key));
      localStorage.setItem(MIGRATED, "1");
    } catch { }
  }

  migrate();
  navigator.storage?.persist?.().catch(() => {});

  window.addEventListener("storage", event => {
    if (event.key?.startsWith(`${PREFIX}doc:`)) emit([event.key.slice(`${PREFIX}doc:`.length)], "tab");
  });
  window.addEventListener("online", () => sync());
  window.addEventListener("pmconnectionchange", event => { if (!event.detail.offline) sync(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });
  window.addEventListener("pageshow", event => { if (event.persisted) sync(); });
  setInterval(() => { if (document.visibilityState === "visible") sync(); }, SYNC_INTERVAL);
  setTimeout(sync, 0);

  window.pmStore = {
    get: id => enrich(readJson(DOC(id), null)),
    list,
    summaries: () => list().map(summarize),
    save,
    create,
    remove,
    trash: () => readJson(TRASH, []),
    hasSynced: () => !!localStorage.getItem(SYNCED),
    pendingCount: () => Object.keys(readJson(PENDING, {})).length,
    sync,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
})();
