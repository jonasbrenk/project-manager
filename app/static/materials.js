/* Project-material domain helpers. This module has no project-screen state:
 * callers provide file metadata and decide how to present outcomes. */
window.PM = window.PM || {};

window.PM.materials = (() => {
  const FILE_CACHE = "project-manager-files-v1";
  const fileUrl = (projectId, fileId) => `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`;
  const cacheMarker = (projectId, fileId) => `pm_file_cached_${projectId}_${fileId}`;
  const formatSize = size => {
    const bytes = Number(size) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  const typeLabel = file => {
    const name = String(file.name || "").toLowerCase();
    if (name.endsWith(".pdf")) return "PDF";
    if (name.endsWith(".md") || name.endsWith(".markdown")) return "MD";
    if (name.endsWith(".html") || name.endsWith(".htm")) return "HTML";
    if (/\.(doc|docx|odt)$/.test(name)) return "DOC";
    if (/\.(xls|xlsx|csv)$/.test(name)) return "SHEET";
    if (/\.(ppt|pptx)$/.test(name)) return "SLIDE";
    if (/\.(png|jpe?g|gif|webp|svg|avif)$/.test(name)) return "IMAGE";
    return "FILE";
  };
  const isImage = file => /^image\//.test(String(file.content_type || "")) || /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(String(file.name || ""));
  const iconHtml = (file, url, unavailable = false) => {
    if (isImage(file) && !unavailable) return `<img class="file-image-preview" src="${window.PM.html.escape(url)}" alt="">`;
    const extension = (String(file.name || "").split(".").pop() || "file").toUpperCase().slice(0, 5);
    const label = extension === String(file.name || "").toUpperCase() ? "FILE" : extension;
    const type = typeLabel(file);
    const color = { PDF: "#dc2626", DOC: "#2563eb", SHEET: "#16a34a", SLIDE: "#ea580c", HTML: "#e34f26", MD: "#6b7280" }[type] || "#6366f1";
    return `<svg class="file-type-icon" viewBox="0 0 48 48" role="img" aria-label="${window.PM.html.escape(label)} file"><path fill="${color}" d="M11 4h17l9 9v27a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Z"/><path fill="rgba(255,255,255,.28)" d="M28 4v9h9Z"/><text x="24" y="32" text-anchor="middle" fill="white" font-size="8" font-weight="800" font-family="Arial, sans-serif">${window.PM.html.escape(label)}</text></svg>`;
  };
  const list = project => [
    ...(project.files || []).map(file => ({ ...file, ownerProjectId: project.id, ownerProjectName: "" })),
    ...(project.file_links || []).map(file => ({ ...file, id: file.source_file_id, ownerProjectId: file.source_project_id, ownerProjectName: file.source_project_name, linkId: file.id })),
  ];
  const cached = async url => "caches" in window && Boolean(await (await caches.open(FILE_CACHE)).match(url));
  const toggleOfflineCopy = async (url, offline) => {
    if (!("caches" in window)) return "unsupported";
    const cache = await caches.open(FILE_CACHE);
    if (await cache.match(url)) { await cache.delete(url); return "removed"; }
    if (offline) return "offline";
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not download file");
    await cache.put(url, response.clone());
    return "saved";
  };
  const open = async (url, offline) => {
    if (!offline || await cached(url)) { window.open(url, "_blank"); return true; }
    return false;
  };
  const share = async (url, name, contentType) => {
    const absoluteUrl = new URL(url, location.origin).href;
    const response = await fetch(absoluteUrl);
    if (!response.ok) throw new Error("Could not load file");
    const blob = await response.blob();
    const file = new File([blob], name, { type: contentType || blob.type });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return "shared"; }
    if (navigator.share) { await navigator.share({ title: name, url: absoluteUrl }); return "shared"; }
    await navigator.clipboard?.writeText(absoluteUrl);
    return "copied";
  };
  return { FILE_CACHE, fileUrl, cacheMarker, formatSize, typeLabel, isImage, iconHtml, list, cached, toggleOfflineCopy, open, share };
})();
