import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { showDialog } from "./dialog";
import { lookupDOIByTitle } from "./metadata";

const BTN_ID = "scidownload-reader-btn";
const PLACEHOLDER = 32;
// ponytail: Zotero 10 reader toolbar renders custom buttons inside the pdf.js
// iframe (resource:// sandbox), where chrome:// images fail to load. Inline the
// download.svg artwork as a data URI using currentColor so it renders reliably
// and follows the toolbar text color on any theme.
const ICON_DATA_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="5" y1="3" x2="5" y2="13"/>
    <polyline points="2 10 5 13 8 10"/>
    <path d="M2 16 h6"/>
    <path d="M2 16 v2.5"/>
    <path d="M8 16 v2.5"/>
  </g>
  <path fill="currentColor" d="M14 4.5 L21 6 L19 7.5 L23 9 L18 9.5 L18 14 L22 19 L16 17 L14 19 L12 16 L12 13 Q11 11 12 9 Z"/>
  <circle cx="17" cy="6.5" r="1" fill="#ffffff"/>
  <path fill="currentColor" d="M13 3 L17 2 L20 4 L18 5 L13 4 Z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" d="M12 4.5 Q17 7 21 4"/>
</svg>`);

type ReaderLike = {
  // event-path proxy exposes type/itemID; real ReaderTab exposes _type/_itemID
  type?: string;
  itemID?: number;
  _type?: string;
  _itemID?: number;
  setToolbarPlaceholderWidth?: (w: number) => Promise<void> | void;
  _iframeWindow?: { document?: Document };
};

type RenderToolbarEvent = {
  reader: ReaderLike;
  doc: Document;
  append: (...nodes: Array<Node | string>) => void;
};

type Handler = (event: RenderToolbarEvent) => void;

let onRenderToolbar: Handler | null = null;

function createToolbarButton(
  doc: Document,
  reader: ReaderLike,
): HTMLDivElement {
  const wrap = doc.createElement("div");
  wrap.style.cssText = "position:relative;display:flex;align-items:center;";
  const btn = doc.createElement("button");
  btn.id = BTN_ID;
  btn.type = "button";
  btn.className = "toolbar-button";
  btn.title = getString("dialog-title");
  btn.setAttribute("aria-label", getString("dialog-title"));
  // ponytail: inline data-URI svg with currentColor — renders in the pdf.js
  // iframe (no chrome:// dependency) and follows toolbar text color on any theme.
  btn.style.backgroundImage = `url('${ICON_DATA_URI}')`;
  btn.style.backgroundSize = "16px 16px";
  btn.style.backgroundPosition = "center";
  btn.style.backgroundRepeat = "no-repeat";
  btn.style.color = "currentColor";
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    // itemID on the event-path proxy, _itemID on a real ReaderTab (retrofit path)
    const itemID = reader.itemID ?? reader._itemID;
    const item = itemID ? Zotero.Items.get(itemID) || null : null;
    const doi = item?.getField("DOI") ?? "";
    if (doi) {
      showDialog(doc.defaultView as Window, doi);
      return;
    }
    // No DOI on the item: fall back to a CrossRef title lookup and prefill
    const title = String(item?.getField("title") || "");
    const win = doc.defaultView as Window;
    if (title) {
      void lookupDOIByTitle(title).then((found) =>
        showDialog(win, found || undefined),
      );
    } else {
      showDialog(win);
    }
  });
  wrap.append(btn);
  return wrap;
}

function renderToolbar(event: RenderToolbarEvent): void {
  const { reader, doc, append } = event;
  if (reader.type && reader.type !== "pdf") return;
  if (doc.getElementById(BTN_ID)) return; // idempotent
  append(createToolbarButton(doc, reader));
  void reader.setToolbarPlaceholderWidth?.(PLACEHOLDER);
}

/**
 * Append the button to readers that already exist and missed the one-shot
 * renderToolbar event (session-restored readers opened before/around plugin
 * registration). No-op when the list is empty or toolbars aren't rendered
 * yet — those still get the normal event path.
 */
export function retrofitOpenReaders(): void {
  const readers = (Zotero as unknown as { Reader?: { _readers?: unknown[] } })
    .Reader?._readers;
  if (!Array.isArray(readers)) return;
  for (const reader of readers) {
    if (!reader || typeof reader !== "object") continue;
    const r = reader as ReaderLike;
    if (r._type && r._type !== "pdf") continue; // epub/snapshot readers
    if (!r._type && r.type && r.type !== "pdf") continue;
    const doc = r._iframeWindow?.document;
    if (!doc) continue; // reader iframe not ready — event path will cover it
    try {
      // ⚠️ same container the event's append() uses: React renders
      // createElement(custom_sections) as div.custom-sections; several
      // instances coexist, so scope to the toolbar one.
      const container = doc.querySelector(".toolbar .custom-sections");
      if (!container) continue; // toolbar not rendered yet — wait for event
      if (doc.getElementById(BTN_ID)) continue; // idempotent
      container.append(createToolbarButton(doc, r));
      void r.setToolbarPlaceholderWidth?.(PLACEHOLDER);
    } catch {
      // retrofit failure degrades to the event path for new readers
    }
  }
}

export function registerReaderToolbar(): void {
  if (onRenderToolbar) return;
  onRenderToolbar = renderToolbar;
  const Reader = (
    Zotero as unknown as {
      Reader?: {
        registerEventListener: (
          type: string,
          handler: Handler,
          pluginID?: string,
        ) => void;
      };
    }
  ).Reader;
  Reader?.registerEventListener(
    "renderToolbar",
    onRenderToolbar,
    config.addonID,
  );
}

export function unregisterReaderToolbar(): void {
  if (!onRenderToolbar) return;
  const Reader = (
    Zotero as unknown as {
      Reader?: {
        unregisterEventListener: (type: string, handler: Handler) => void;
      };
    }
  ).Reader;
  Reader?.unregisterEventListener("renderToolbar", onRenderToolbar);
  onRenderToolbar = null;
}
