import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { SciDownloadFetcher, FindPDFResult } from "./fetcher";
import { lookupCrossRef } from "./crossref";
import { smartExtract, ExtractedMeta } from "./metadata";
import {
  getMirrors,
  setMirrors,
  resetMirrors,
  getDefaultMirrors,
  getTargetCollectionId,
  setTargetCollectionId,
  getMirrorPriorities,
  setMirrorPriority,
} from "./prefs";

let _button: Element | null = null;
let _dialogOpen = false;
// ponytail: styles are per-document; track injected documents, not a single flag
const _styledDocs = new WeakSet<Document>();

const DOI_REGEX = /^10\.\d{4,9}\/[-._;()\/:a-zA-Z0-9]+$/;
export const ICON_URI = `chrome://${config.addonRef}/content/icons/download.svg`;

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

export function showDialog(win: Window, initialDOI?: string) {
  dbg(`showDialog start, open=${_dialogOpen}`);
  // Single-instance guard is per-window: remove any leftover overlay in THIS
  // window, so stale cross-window state never blocks a fresh open.
  _dialogOpen = false;
  win.document.getElementById("scidownload-overlay")?.remove();
  _dialogOpen = true;
  const doc = win.document;
  const isDark =
    doc.documentElement?.classList.contains("theme-dark") ||
    (win.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false);

  if (!_styledDocs.has(doc)) {
    injectDialogStyles(doc);
    _styledDocs.add(doc);
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

  // Smart extract row: DOI / PMID / title input + extract button
  const extractRow = h(doc, "div", { class: "scid-row scid-extract-row" });
  const extractInput = h(doc, "input", {
    id: "scid-extract",
    type: "text",
    placeholder: s("dialog-extract-placeholder"),
    class: "scid-input",
  }) as HTMLInputElement;
  extractRow.appendChild(extractInput);
  const extractBtn = h(doc, "button", {
    id: "scid-extract-btn",
    class: "scid-btn-extract",
    type: "button",
  }, s("dialog-extract")) as HTMLButtonElement;
  extractRow.appendChild(extractBtn);
  dialog.appendChild(extractRow);
  dialog.appendChild(h(doc, "div", { class: "scid-extract-tip" }, s("dialog-extract-tip")));

  // Filled fields from extraction
  const titleRow = h(doc, "div", { class: "scid-row" });
  titleRow.appendChild(h(doc, "label", { for: "scid-title" }, s("dialog-title-label")));
  const titleInput = h(doc, "input", {
    id: "scid-title",
    type: "text",
    class: "scid-input",
    readonly: "",
  }) as HTMLInputElement;
  titleRow.appendChild(titleInput);
  dialog.appendChild(titleRow);

  const infoRow = h(doc, "div", { class: "scid-row" });
  infoRow.appendChild(h(doc, "label", { for: "scid-info" }, s("dialog-info-label")));
  const infoInput = h(doc, "input", {
    id: "scid-info",
    type: "text",
    class: "scid-input",
    readonly: "",
  }) as HTMLInputElement;
  infoRow.appendChild(infoInput);
  dialog.appendChild(infoRow);

  const doiRow = h(doc, "div", { class: "scid-row" });
  const doiLabel = h(doc, "label", { for: "scid-doi" }, s("dialog-doi-label"));
  const reqStar = h(doc, "span", { class: "scid-req" }, "*");
  doiLabel.appendChild(reqStar);
  doiRow.appendChild(doiLabel);
  const doiInput = h(doc, "input", {
    id: "scid-doi",
    type: "text",
    placeholder: s("dialog-doi-placeholder"),
    class: "scid-input",
  }) as HTMLInputElement;
  doiRow.appendChild(doiInput);
  if (initialDOI) doiInput.value = initialDOI;
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
  const searchBtn = h(doc, "button", {
    id: "scid-search",
    class: "scid-btn-primary",
    type: "button",
  }, s("dialog-search")) as HTMLButtonElement;
  colRow.appendChild(searchBtn);
  dialog.appendChild(colRow);

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

  const mirrorContainer = h(doc, "div", {
    class: "scid-mirror-container",
  });
  dialog.appendChild(mirrorContainer);

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
  renderMirrorList(doc, mirrorContainer, getMirrors(), () => saveMirrorValues(mirrorContainer));
  restoreBtn.addEventListener("click", () => {
    resetMirrors();
    renderMirrorList(doc, mirrorContainer, getMirrors(), () => saveMirrorValues(mirrorContainer));
    setProgress(progressText, progressBar, "ok", "mirrors restored");
  });
  searchBtn.addEventListener("click", () => {
    void onSearch(win, doiInput, collectionSelect, mirrorContainer, progressText, progressBar, searchBtn);
  });
  doiInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      void onSearch(win, doiInput, collectionSelect, mirrorContainer, progressText, progressBar, searchBtn);
    }
  });
  extractBtn.addEventListener("click", () => {
    void onExtract(extractInput, titleInput, infoInput, doiInput, progressText, progressBar, extractBtn);
  });
  extractInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      void onExtract(extractInput, titleInput, infoInput, doiInput, progressText, progressBar, extractBtn);
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
.scid-input[readonly]{background:#f5f5f5;color:#555;}
.scid-dark .scid-input[readonly]{background:#1c1b22;color:#aaa;}
.scid-btn-extract{flex:none;padding:7px 14px;border:none;border-radius:4px;background:#1976d2;color:#fff;cursor:pointer;font-size:13px;}
.scid-btn-extract:hover{background:#1565c0;}
.scid-btn-extract:disabled{opacity:0.6;}
.scid-dark .scid-btn-extract{background:#64b5f6;color:#1c1b22;}
.scid-extract-tip{font-size:12px;color:#888;margin:-4px 0 10px 2px;}
.scid-dark .scid-extract-tip{color:#aaa;}
.scid-req{color:#d32f2f;margin-left:2px;}
.scid-help{flex:none;width:22px;height:22px;padding:0;border:1px solid #1976d2;border-radius:50%;background:#1976d2;color:#fff;cursor:pointer;font-size:13px;font-weight:700;line-height:20px;text-align:center;}
.scid-help:hover{background:#1565c0;}
.scid-dark .scid-help{background:#64b5f6;border-color:#64b5f6;color:#1c1b22;}
.scid-dark .scid-input{background:#1c1b22;}

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
.scid-mirror-container{max-height:200px;overflow-y:auto;border:1px solid #ccc;border-radius:4px;padding:4px;margin-bottom:8px;background:#fff;}
.scid-dark .scid-mirror-container{background:#2d2d2d;border-color:#555;}
.scid-mirror-row{display:flex;gap:4px;margin-bottom:4px;align-items:center;}
.scid-mirror-input{flex:1;border:1px solid #ccc;border-radius:3px;padding:4px 6px;font-size:13px;font-family:monospace;}
.scid-dark .scid-mirror-input{background:#3d3d3d;color:#e0e0e0;border-color:#555;}
.scid-mirror-status{flex-shrink:0;width:22px;text-align:center;font-size:13px;font-weight:bold;font-family:monospace;}
.scid-mirror-prio{flex-shrink:0;width:44px;height:26px;padding:0;border:1px solid #ccc;border-radius:4px;background:transparent;color:#999;cursor:pointer;font-size:13px;font-weight:bold;font-family:monospace;line-height:1;}
.scid-mirror-prio:hover{border-color:#1976d2;color:#1976d2;}
.scid-mirror-prio.on{background:#e8f5e9;color:#2e7d32;border-color:#a5d6a7;}
.scid-dark .scid-mirror-prio{background:#1c1b22;border-color:#555;color:#aaa;}
.scid-dark .scid-mirror-prio:hover{border-color:#64b5f6;color:#64b5f6;}
.scid-dark .scid-mirror-prio.on{background:#1b5e20;color:#a5d6a7;border-color:#2e7d32;}
.scid-mirror-hdr{display:flex;gap:4px;align-items:center;margin-bottom:4px;font-size:12px;color:#888;white-space:nowrap;}
.scid-dark .scid-mirror-hdr{color:#aaa;}
.scid-mirror-hdr-prio{width:44px;text-align:center;flex-shrink:0;}
.scid-mirror-hdr-addr{flex:1;}
.scid-mirror-hdr-status{width:22px;text-align:center;flex-shrink:0;}
.scid-btn-add,.scid-btn-del{width:28px;height:28px;border:1px solid #ccc;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.scid-btn-add{background:#e8f5e9;color:#2e7d32;border-color:#a5d6a7;}
.scid-btn-add:hover{background:#c8e6c9;}
.scid-dark .scid-btn-add{background:#1b5e20;color:#a5d6a7;border-color:#2e7d32;}
.scid-btn-del{background:#ffebee;color:#c62828;border-color:#ef9a9a;}
.scid-btn-del:hover{background:#ffcdd2;}
.scid-dark .scid-btn-del{background:#b71c1c;color:#ef9a9a;border-color:#c62828;}
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

// ponytail: builtin mirrors (by URL content) are not deletable; user-added ones are
function isDefaultMirror(url: string): boolean {
  const v = url.trim();
  return getDefaultMirrors().some((d) => d.trim() === v);
}

function saveMirrorValues(container: HTMLElement) {
  const inputs = container.querySelectorAll(".scid-mirror-input");
  const urls = Array.from(inputs)
    .map((inp) => (inp as HTMLInputElement).value.trim())
    .filter((s) => s.length > 0);
  setMirrors(urls);
}

// Priority-aware access order: prioritized mirrors (asc rank) first, then the
// rest (default 99) in original list order. orderIndexOf[k] = original index of
// the k-th mirror in `order`, used to map fetch statuses back to display rows.
function orderMirrors(
  mirrors: string[],
  prios: Record<string, number>,
): { order: string[]; orderIndexOf: number[] } {
  const items = mirrors.map((url, i) => ({
    url,
    i,
    p: prios[url.trim()] ?? 99,
  }));
  items.sort((a, b) => (a.p !== b.p ? a.p - b.p : a.i - b.i));
  return {
    order: items.map((x) => x.url),
    orderIndexOf: items.map((x) => x.i),
  };
}

function updatePriorityCell(cell: HTMLElement, prio: number | undefined) {
  cell.textContent = prio === undefined ? "＋" : String(prio);
  cell.classList.toggle("on", prio !== undefined);
}

// Renumbering on removal shifts other mirrors' priority down — refresh every
// priority button so the on-screen numbers match the stored (contiguous) set.
function refreshAllPriorityCells(container: HTMLElement) {
  const prios = getMirrorPriorities();
  container.querySelectorAll(".scid-mirror-prio").forEach((btn: Element) => {
    const row = (btn as HTMLElement).closest(".scid-mirror-row");
    const input = row?.querySelector(".scid-mirror-input") as HTMLInputElement | null;
    if (input) updatePriorityCell(btn as HTMLElement, prios[input.value.trim()]);
  });
}

function renderMirrorList(
  doc: Document,
  container: HTMLElement,
  mirrors: string[],
  onChange: () => void,
) {
  container.innerHTML = "";
  const count = mirrors.length;
  dbg(`renderMirrorList: ${count} mirrors`);

  // Column header
  const hdr = h(doc, "div", { class: "scid-mirror-hdr" });
  hdr.appendChild(h(doc, "span", { class: "scid-mirror-hdr-prio" }, "优先级"));
  hdr.appendChild(h(doc, "span", { class: "scid-mirror-hdr-addr" }, "镜像地址"));
  hdr.appendChild(h(doc, "span", { class: "scid-mirror-hdr-status" }, "状态"));
  container.appendChild(hdr);

  const prios = getMirrorPriorities();

  mirrors.forEach((mirror, i) => {
    const row = h(doc, "div", { class: "scid-mirror-row" });

    // Priority cell (button; click to toggle)
    const prioCell = h(doc, "button", {
      class: "scid-mirror-prio",
      type: "button",
      title: "点击设置/取消优先级",
    }) as HTMLButtonElement;
    updatePriorityCell(prioCell, prios[mirror.trim()]);
    prioCell.addEventListener("click", () => {
      const url = (input.value as string).trim();
      if (!url) return;
      const cur = getMirrorPriorities()[url];
      if (cur !== undefined) {
        setMirrorPriority(url, null);
      } else {
        const used = new Set(Object.values(getMirrorPriorities()));
        let p = 0;
        while (used.has(p)) p++;
        setMirrorPriority(url, p);
      }
      // Renumbering shifts other mirrors' numbers — refresh every cell.
      refreshAllPriorityCells(container);
    });
    row.appendChild(prioCell);

    const input = h(doc, "input", {
      class: "scid-mirror-input",
      type: "text",
      value: mirror,
    }) as HTMLInputElement;
    input.addEventListener("input", () => {
      updatePriorityCell(prioCell, getMirrorPriorities()[input.value.trim()]);
      onChange();
    });
    row.appendChild(input);

    const statusBox = doc.createElementNS(HTML_NS, "span") as HTMLElement;
    statusBox.className = "scid-mirror-status";
    statusBox.textContent = "[ ]";
    const sbStyle = statusBox.style;
    sbStyle.width = "22px";
    sbStyle.display = "inline-block";
    sbStyle.textAlign = "center";
    sbStyle.fontWeight = "bold";
    sbStyle.fontSize = "13px";
    sbStyle.fontFamily = "monospace";
    sbStyle.flexShrink = "0";
    row.appendChild(statusBox);

    // User-added mirrors (not matching any builtin default) are deletable
    if (!isDefaultMirror(mirror)) {
      const delBtn = h(doc, "button", {
        class: "scid-btn-del",
        type: "button",
      }, "−");
      delBtn.addEventListener("click", () => {
        setMirrorPriority(mirror, null);
        mirrors.splice(i, 1);
        renderMirrorList(doc, container, mirrors, onChange);
        onChange();
      });
      row.appendChild(delBtn);
    }

    // Add [+] button on the last row
    if (i === mirrors.length - 1) {
      const addBtn = h(doc, "button", {
        class: "scid-btn-add",
        type: "button",
      }, "+");
      addBtn.addEventListener("click", () => {
        mirrors.push("");
        renderMirrorList(doc, container, mirrors, onChange);
        const inputs = container.querySelectorAll(".scid-mirror-input");
        (inputs[inputs.length - 1] as HTMLInputElement).focus();
      });
      row.appendChild(addBtn);
    }

    container.appendChild(row);
  });

  // Empty state: still allow adding a mirror
  if (mirrors.length === 0) {
    const row = h(doc, "div", { class: "scid-mirror-row" });
    // blank priority cell placeholder
    row.appendChild(h(doc, "span", { class: "scid-mirror-prio" }));
    const input = h(doc, "input", {
      class: "scid-mirror-input",
      type: "text",
      value: "",
    }) as HTMLInputElement;
    input.addEventListener("input", onChange);
    row.appendChild(input);
    const statusBox = doc.createElementNS(HTML_NS, "span") as HTMLElement;
    statusBox.className = "scid-mirror-status";
    statusBox.textContent = "[ ]";
    const sbStyle = statusBox.style;
    sbStyle.width = "22px";
    sbStyle.display = "inline-block";
    sbStyle.textAlign = "center";
    sbStyle.fontWeight = "bold";
    sbStyle.fontSize = "13px";
    sbStyle.fontFamily = "monospace";
    sbStyle.flexShrink = "0";
    row.appendChild(statusBox);
    const addBtn = h(doc, "button", {
      class: "scid-btn-add",
      type: "button",
    }, "+");
    addBtn.addEventListener("click", () => {
      mirrors.push("");
      renderMirrorList(doc, container, mirrors, onChange);
      const inputs = container.querySelectorAll(".scid-mirror-input");
      (inputs[inputs.length - 1] as HTMLInputElement).focus();
    });
    row.appendChild(addBtn);
    container.appendChild(row);
  }
}

// ── Search & Download ──

async function onExtract(
  extractInput: HTMLInputElement,
  titleInput: HTMLInputElement,
  infoInput: HTMLInputElement,
  doiInput: HTMLInputElement,
  progressText: HTMLElement,
  progressBar: HTMLElement,
  extractBtn: HTMLButtonElement,
) {
  const raw = extractInput.value.trim();
  const s = getString;

  if (!raw) return setProgress(progressText, progressBar, "err", s("dialog-extract-empty"));

  extractBtn.disabled = true;
  setProgress(progressText, progressBar, "wait", s("dialog-extracting"), 10);
  try {
    const meta: ExtractedMeta | null = await smartExtract(raw);
    if (!meta || !meta.title) {
      setProgress(progressText, progressBar, "err", s("dialog-extract-fail"), 100);
      return;
    }
    titleInput.value = meta.title;
    infoInput.value = meta.info;
    if (meta.doi) doiInput.value = meta.doi;
    setProgress(progressText, progressBar, "ok", s("dialog-extract-ok"), 100);
  } catch (err) {
    ztoolkit.log("SciDownload: extract failed:", err);
    setProgress(progressText, progressBar, "err", s("dialog-extract-fail"), 100);
  } finally {
    extractBtn.disabled = false;
  }
}

async function onSearch(
  win: Window,
  doiInput: HTMLInputElement,
  collectionSelect: HTMLSelectElement,
  mirrorContainer: HTMLElement,
  progressText: HTMLElement,
  progressBar: HTMLElement,
  searchBtn: HTMLButtonElement,
) {
  const doi = doiInput.value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  const s = getString;

  if (!doi) return setProgress(progressText, progressBar, "err", s("dialog-doi-missing"));
  if (!DOI_REGEX.test(doi))
    return setProgress(progressText, progressBar, "err", s("dialog-doi-invalid"));

  saveMirrorValues(mirrorContainer);
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

    // Reset status cells to "[ ]" — untried mirrors stay visible.
    const statusDivs = mirrorContainer.querySelectorAll(".scid-mirror-status");
    statusDivs.forEach((el: Element) => {
      (el as HTMLElement).textContent = "[ ]";
      (el as HTMLElement).style.color = "";
    });

    // Step 2: find PDF — real-time per-mirror feedback, in priority order.
    const prios = getMirrorPriorities();
    const { order, orderIndexOf } = orderMirrors(mirrors, prios);
    const total = order.length;
    let tried = 0;
    const findResult = await SciDownloadFetcher.findPDFUrl(doi, order, (k, status) => {
      tried++;
      const disp = orderIndexOf[k];
      const div = statusDivs[disp] as HTMLElement | undefined;
      if (div) {
        if (status === "success") {
          div.textContent = "[✓]";
          div.style.color = "#2e7d32";
        } else {
          div.textContent = "[✗]";
          div.style.color = "#d32f2f";
        }
      }
      const pct = Math.min(65, 40 + (tried / total) * 25);
      setProgress(progressText, progressBar, "wait", `Sci-Hub ... (${tried}/${total})`, pct);
    });
    const pdfUrl = findResult.url;

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