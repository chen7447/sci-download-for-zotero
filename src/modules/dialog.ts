import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { SciDownloadFetcher } from "./fetcher";
import { lookupCrossRef } from "./crossref";
import {
  getMirrors,
  setMirrors,
  getDefaultMirrors,
  getTargetCollectionId,
  setTargetCollectionId,
} from "./prefs";

let _button: Element | null = null;
let _dialogOpen = false;
let _styleInjected = false;

const DOI_REGEX = /^10\.\d{4,9}\/[-._;()\/:a-zA-Z0-9]+$/;
const ICON_URI = `chrome://${config.addonRef}/content/icons/download.svg`;

const HTML_NS = "http://www.w3.org/1999/xhtml";

function dbg(msg: string) {
  const line = `[Sci-Download] ${msg}`;
  try {
    Zotero.debug(line);
  } catch {
    // ignore
  }
  try {
    ztoolkit.log(line);
  } catch {
    // ignore
  }
}

function dumpErr(where: string, err: unknown) {
  dbg(`${where}: ${String(err)}`);
  const stack = (err as { stack?: string } | null)?.stack;
  if (stack) dbg(stack);
}

function h(doc: Document, tag: string, attrs: Record<string, string> = {}, text?: string): HTMLElement {
  const el = doc.createElementNS(HTML_NS, tag) as HTMLElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

function findInsertPoint(doc: Document): { parent: Element; before: Element | null } | null {
  const search =
    doc.getElementById("zotero-tb-search") ||
    doc.querySelector("#zotero-tb-search");
  if (search?.parentElement) {
    return { parent: search.parentElement, before: search };
  }
  const addBtn = doc.getElementById("zotero-tb-add") || doc.querySelector("#zotero-tb-add");
  if (addBtn?.parentElement) {
    return { parent: addBtn.parentElement, before: null };
  }
  const toolbar =
    doc.getElementById("zotero-items-toolbar") ||
    doc.getElementById("zotero-toolbar") ||
    doc.querySelector("#zotero-items-toolbar, #zotero-toolbar");
  if (toolbar) return { parent: toolbar, before: null };
  return null;
}

function createToolbarButton(doc: Document): Element {
  const xul = (doc as any).createXULElement;
  const btn: Element =
    typeof xul === "function" ? xul.call(doc, "toolbarbutton") : doc.createElement("toolbarbutton");
  btn.id = "scidownload-toolbar-btn";
  btn.setAttribute("class", "zotero-tb-button");
  btn.setAttribute("tooltiptext", getString("dialog-title"));
  btn.setAttribute("label", "");
  btn.setAttribute("image", ICON_URI);
  return btn;
}

// ── Toolbar button ──

export function installToolbarButton(win: Window) {
  if (_button) {
    dbg("toolbar button already installed, skip");
    return;
  }
  try {
    const doc = win.document;
    const point = findInsertPoint(doc);
    if (!point) {
      dbg(
        "toolbar not found. ids sample: " +
          ["zotero-tb-search", "zotero-tb-add", "zotero-items-toolbar", "zotero-toolbar"]
            .map((id) => `${id}=${!!doc.getElementById(id)}`)
            .join(", "),
      );
      return;
    }

    const btn = createToolbarButton(doc);
    const open = (ev?: Event) => {
      ev?.preventDefault?.();
      dbg(`button ${ev?.type || "open"}`);
      try {
        showDialog(win);
      } catch (err) {
        dumpErr("showDialog", err);
        _dialogOpen = false;
      }
    };
    btn.addEventListener("command", open);
    btn.addEventListener("click", open);

    if (point.before) {
      point.parent.insertBefore(btn, point.before);
      dbg(`toolbar button inserted before #${point.before.id || point.before.tagName}`);
    } else {
      point.parent.appendChild(btn);
      dbg(`toolbar button appended to #${point.parent.id || point.parent.tagName}`);
    }
    _button = btn;
  } catch (err) {
    dbg(`installToolbarButton failed: ${err}`);
  }
}

export function uninstallToolbarButton() {
  _button?.remove();
  _button = null;
}

// ── Dialog ──

function showDialog(win: Window) {
  dbg(`showDialog start, open=${_dialogOpen}`);
  if (_dialogOpen) {
    const existing = win.document.getElementById("scidownload-overlay");
    if (existing) {
      dbg("dialog already open");
      return;
    }
    dbg("stale open flag, reset");
    _dialogOpen = false;
  }
  _dialogOpen = true;
  const doc = win.document;
  const isDark =
    doc.documentElement?.classList.contains("theme-dark") ||
    (win.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false);

  if (!_styleInjected) {
    injectDialogStyles(doc);
    _styleInjected = true;
  }

  const s = getString;
  const overlay = h(doc, "div", { id: "scidownload-overlay", class: "scid-overlay" });
  const dialog = h(doc, "div", {
    class: isDark ? "scid-dialog scid-dark" : "scid-dialog",
  });

  const hdr = h(doc, "div", { class: "scid-hdr" });
  hdr.appendChild(h(doc, "b", {}, s("dialog-title")));
  const closeBtn = h(doc, "button", { class: "scid-close", type: "button" }, "✕");
  hdr.appendChild(closeBtn);
  dialog.appendChild(hdr);

  const doiRow = h(doc, "div", { class: "scid-row" });
  doiRow.appendChild(h(doc, "label", { for: "scid-doi" }, s("dialog-doi-label")));
  const doiInput = h(doc, "input", {
    id: "scid-doi",
    type: "text",
    placeholder: s("dialog-doi-placeholder"),
    class: "scid-input",
  }) as HTMLInputElement;
  doiRow.appendChild(doiInput);
  const doiHelp = h(doc, "button", {
    class: "scid-help",
    type: "button",
    title: s("dialog-doi-help"),
  }, "?") as HTMLButtonElement;
  doiRow.appendChild(doiHelp);
  dialog.appendChild(doiRow);

  const colRow = h(doc, "div", { class: "scid-row" });
  colRow.appendChild(h(doc, "label", { for: "scid-collection" }, s("dialog-collection-label")));
  const collectionSelect = h(doc, "select", {
    id: "scid-collection",
    class: "scid-input",
  }) as HTMLSelectElement;
  colRow.appendChild(collectionSelect);
  dialog.appendChild(colRow);

  const searchWrap = h(doc, "div", { class: "scid-search-wrap" });
  const searchBtn = h(doc, "button", {
    id: "scid-search",
    class: "scid-btn-primary",
    type: "button",
  }, s("dialog-search")) as HTMLButtonElement;
  searchWrap.appendChild(searchBtn);
  dialog.appendChild(searchWrap);

  dialog.appendChild(h(doc, "hr", { class: "scid-hr" }));

  const mirrorHdr = h(doc, "div", { class: "scid-mirror-hdr" });
  mirrorHdr.appendChild(h(doc, "label", { for: "scid-mirrors" }, s("dialog-mirror-label")));
  const restoreBtn = h(doc, "button", {
    id: "scid-restore",
    class: "scid-btn-sm",
    type: "button",
  }, s("dialog-restore")) as HTMLButtonElement;
  mirrorHdr.appendChild(restoreBtn);
  dialog.appendChild(mirrorHdr);

  const mirrorTextarea = h(doc, "textarea", {
    id: "scid-mirrors",
    class: "scid-textarea",
    rows: "6",
    placeholder: s("dialog-mirror-placeholder"),
  }) as HTMLTextAreaElement;
  dialog.appendChild(mirrorTextarea);

  const progressWrap = h(doc, "div", { class: "scid-progress-wrap" });
  const progressBar = h(doc, "div", { id: "scid-progress-bar", class: "scid-progress-bar" });
  const progressText = h(doc, "div", { id: "scid-progress-text", class: "scid-progress-text" });
  progressWrap.appendChild(progressBar);
  progressWrap.appendChild(progressText);
  dialog.appendChild(progressWrap);

  const footer = h(doc, "div", { class: "scid-footer" });
  const scihubLink = h(doc, "a", {
    id: "scid-scihub-link",
    href: "#",
    class: "scid-link",
  }, s("dialog-scihub-link"));
  footer.appendChild(scihubLink);
  dialog.appendChild(footer);

  overlay.appendChild(dialog);
  overlay.addEventListener("click", (e: Event) => {
    if (e.target === overlay) closeDialog();
  });

  const host = doc.documentElement || doc.body;
  if (!host) throw new Error("no document host");
  host.appendChild(overlay);
  dbg("overlay appended");

  closeBtn.addEventListener("click", closeDialog);
  doiHelp.addEventListener("click", () => {
    Zotero.launchURL("https://www.ablesci.com/post/detail?id=9VP4Vw");
  });
  scihubLink.addEventListener("click", (e: Event) => {
    e.preventDefault();
    Zotero.launchURL("https://tool.yovisun.com/scihub/");
  });

  fillCollectionSelect(doc, collectionSelect);
  mirrorTextarea.value = getMirrors().join("\n");
  mirrorTextarea.addEventListener("change", () => saveMirrors(mirrorTextarea));
  mirrorTextarea.addEventListener("blur", () => saveMirrors(mirrorTextarea));
  restoreBtn.addEventListener("click", () => {
    mirrorTextarea.value = getDefaultMirrors().join("\n");
    saveMirrors(mirrorTextarea);
    setProgress(progressText, progressBar, "ok", "mirrors restored");
  });
  searchBtn.addEventListener("click", () => {
    void onSearch(win, doiInput, collectionSelect, mirrorTextarea, progressText, progressBar, searchBtn);
  });
  doiInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      void onSearch(win, doiInput, collectionSelect, mirrorTextarea, progressText, progressBar, searchBtn);
    }
  });
  doiInput.focus();

  function closeDialog() {
    _dialogOpen = false;
    overlay.remove();
    dbg("dialog closed");
  }
}

// ── Styles ──

function injectDialogStyles(doc: Document) {
  const style = doc.createElementNS(HTML_NS, "style");
  style.textContent = `
.scid-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;}
.scid-dialog{background:#fff;color:#1a1a1a;border-radius:8px;padding:20px 24px;width:520px;max-width:92vw;max-height:86vh;overflow-y:auto;box-shadow:0 8px 30px rgba(0,0,0,0.35);font-size:13px;font-family:system-ui,sans-serif;}
.scid-dark{background:#2b2a33;color:#f0f0f0;border:1px solid #555;}
.scid-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;}
.scid-hdr b{font-size:15px;}
.scid-close{border:none;background:transparent;cursor:pointer;font-size:16px;color:inherit;}
.scid-row{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
.scid-row label{white-space:nowrap;}
.scid-input{flex:1;padding:6px 8px;border:1px solid #999;border-radius:4px;background:#fff;color:inherit;}
.scid-help{flex:none;width:22px;height:22px;padding:0;border:1px solid #1976d2;border-radius:50%;background:#1976d2;color:#fff;cursor:pointer;font-size:13px;font-weight:700;line-height:20px;text-align:center;}
.scid-help:hover{background:#1565c0;}
.scid-dark .scid-help{background:#64b5f6;border-color:#64b5f6;color:#1c1b22;}
.scid-dark .scid-input{background:#1c1b22;}
.scid-search-wrap{display:flex;justify-content:flex-end;margin-bottom:10px;}
.scid-btn-primary{padding:8px 22px;border:none;border-radius:4px;background:#2e7d32;color:#fff;cursor:pointer;font-size:14px;}
.scid-btn-primary:disabled{opacity:0.6;}
.scid-hr{border:none;border-top:1px solid #ddd;margin:12px 0;}
.scid-dark .scid-hr{border-color:#555;}
.scid-mirror-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}
.scid-btn-sm{padding:3px 10px;border:1px solid #999;border-radius:4px;background:transparent;color:inherit;cursor:pointer;}
.scid-textarea{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #999;border-radius:4px;background:#fff;color:inherit;resize:vertical;}
.scid-dark .scid-textarea{background:#1c1b22;}
.scid-progress-wrap{margin-top:12px;min-height:32px;}
.scid-progress-bar{height:4px;border-radius:2px;background:#e0e0e0;overflow:hidden;transition:width .3s;}
.scid-dark .scid-progress-bar{background:#555;}
.scid-progress-bar-fill{height:100%;border-radius:2px;background:#2e7d32;width:0%;transition:width .4s;}
.scid-dark .scid-progress-bar-fill{background:#4caf50;}
.scid-progress-text{font-size:12px;margin-top:4px;min-height:16px;}
.scid-footer{display:flex;justify-content:flex-end;margin-top:8px;}
.scid-link{color:#1976d2;text-decoration:none;cursor:pointer;}
.scid-dark .scid-link{color:#64b5f6;}
`;
  (doc.head || doc.documentElement)!.appendChild(style);
}

// ── Collection dropdown ──

function fillCollectionSelect(doc: Document, select: HTMLSelectElement) {
  const collections: any[] = (Zotero.Collections as any).getByLibrary(1, true) || [];
  const byParent = new Map<number, any[]>();
  for (const c of collections) {
    const key = (c as any).parentID || 0;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  const flat: { id: number; name: string; depth: number }[] = [];
  const walk = (parentID: number, depth: number) => {
    const kids = (byParent.get(parentID) || []).sort((a: any, b: any) =>
      a.name.localeCompare(b.name),
    );
    for (const k of kids) {
      flat.push({ id: k.id, name: k.name, depth });
      walk(k.id, depth + 1);
    }
  };
  walk(0, 0);

  const saved = getTargetCollectionId();
  const opt = h(doc, "option", { value: "" }, getString("dialog-collection-default"));
  select.appendChild(opt);
  for (const c of flat) {
    select.appendChild(h(doc, "option", { value: String(c.id) }, "　".repeat(c.depth) + c.name));
  }
  if (saved !== null && flat.some((f) => f.id === saved)) {
    select.value = String(saved);
  }
  select.addEventListener("change", () => {
    const v = select.value;
    setTargetCollectionId(v === "" ? null : Number(v));
  });
}

function saveMirrors(textarea: HTMLTextAreaElement) {
  const urls = textarea.value
    .split(/\r?\n/)
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);
  setMirrors(urls);
}

// ── Search & Download ──

async function onSearch(
  win: Window,
  doiInput: HTMLInputElement,
  collectionSelect: HTMLSelectElement,
  mirrorTextarea: HTMLTextAreaElement,
  progressText: HTMLElement,
  progressBar: HTMLElement,
  searchBtn: HTMLButtonElement,
) {
  const doi = doiInput.value.trim();
  const s = getString;

  if (!doi) return setProgress(progressText, progressBar, "err", s("dialog-doi-missing"));
  if (!DOI_REGEX.test(doi))
    return setProgress(progressText, progressBar, "err", s("dialog-doi-invalid"));

  saveMirrors(mirrorTextarea);
  const mirrors = getMirrors();
  if (mirrors.length === 0)
    return setProgress(progressText, progressBar, "err", s("dialog-mirror-empty"));

  const collectionId =
    collectionSelect.value === "" ? null : Number(collectionSelect.value);

  searchBtn.disabled = true;
  setProgress(progressText, progressBar, "wait", s("dialog-downloading"), 0);

  try {
    // Step 1: CrossRef
    setProgress(progressText, progressBar, "wait", "CrossRef ...", 15);
    const metadata = await lookupCrossRef(doi);

    // Step 2: find PDF
    setProgress(progressText, progressBar, "wait", "Sci-Hub ...", 40);
    const pdfUrl = await SciDownloadFetcher.findPDFUrl(doi, mirrors);
    if (!pdfUrl) {
      setProgress(progressText, progressBar, "err", s("dialog-no-pdf"), 100);
      return;
    }

    // Step 3: download & attach
    setProgress(progressText, progressBar, "wait", "Downloading...", 65);
    const result = await SciDownloadFetcher.attachPdfToZotero(
      pdfUrl,
      doi,
      metadata,
      collectionId,
    );
    const msg = result.success ? s(result.message as any) : s(result.message as any);
    setProgress(progressText, progressBar, result.success ? "ok" : "err", msg, 100);
  } catch (err) {
    ztoolkit.log("SciDownload: search failed:", err);
    setProgress(progressText, progressBar, "err", s("dialog-download-fail"), 100);
  } finally {
    searchBtn.disabled = false;
  }
}

// ── Progress bar ──

function setProgress(
  textEl: HTMLElement,
  barEl: HTMLElement,
  type: "wait" | "ok" | "err",
  msg: string,
  pct?: number,
) {
  textEl.textContent = msg;
  textEl.style.color = type === "err" ? "#d32f2f" : type === "ok" ? "#2e7d32" : "#1976d2";

  // Build or reuse the fill bar
  let fill = barEl.firstChild as HTMLElement | null;
  if (!fill) {
    fill = barEl.ownerDocument!.createElement("div");
    fill.className = "scid-progress-bar-fill";
    barEl.appendChild(fill);
  }
  fill.style.width = (pct ?? (type === "err" ? 100 : type === "ok" ? 100 : 30)) + "%";
  fill.style.background = type === "err" ? "#d32f2f" : type === "ok" ? "#2e7d32" : "#1976d2";
}