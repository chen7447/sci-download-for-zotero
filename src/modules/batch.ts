import { getString } from "../utils/locale";
import { DOI_REGEX, normalizeDOI } from "../utils/doi";
import { SciDownloadFetcher } from "./fetcher";
import { lookupCrossRef } from "./crossref";
import { lookupDOIByTitle } from "./metadata";
import { getOrderedMirrors } from "./prefs";

// The item context menu is a plain XUL menuitem appended to #zotero-itemmenu
// (toolkit v5 dropped MenuManager), tracked per window like the toolbar button.
const MENU_ID = "scidownload-item-menu";
const _menus = new Map<Window, Element>();

export function registerItemContextMenu(win: Window) {
  if (_menus.has(win)) return;
  const doc = win.document;
  const popup = doc.getElementById("zotero-itemmenu");
  if (!popup) return;
  const xul = (doc as any).createXULElement;
  const menuitem: Element =
    typeof xul === "function"
      ? xul.call(doc, "menuitem")
      : doc.createElement("menuitem");
  menuitem.id = MENU_ID;
  menuitem.setAttribute("label", getString("menu-download-pdfs"));
  menuitem.addEventListener("command", () => {
    void batchDownloadSelected();
  });
  popup.appendChild(menuitem);
  _menus.set(win, menuitem);
}

export function unregisterItemContextMenu(win?: Window) {
  if (win) {
    _menus.get(win)?.remove();
    _menus.delete(win);
    return;
  }
  for (const el of _menus.values()) el.remove();
  _menus.clear();
}

type BatchOutcome = "ok" | "skippedPdf" | "noPdf" | "failed";

interface BatchStats {
  ok: number;
  skippedPdf: number;
  noPdf: number;
  failed: number;
}

async function batchDownloadSelected() {
  const pane = Zotero.getActiveZoteroPane();
  if (!pane) return;
  const items = ((pane as any).getSelectedItems?.() || []).filter(
    (it: any) =>
      it && typeof it.isRegularItem === "function" && it.isRegularItem(),
  );
  if (items.length === 0) {
    const pw = new ztoolkit.ProgressWindow(getString("dialog-title"), {
      closeOnClick: true,
    });
    pw.createLine({ text: getString("batch-no-items") });
    pw.show();
    pw.startCloseTimer(3000);
    return;
  }

  const collectionId = getSelectedCollectionId(pane);
  const pw = new ztoolkit.ProgressWindow(getString("dialog-title"), {
    closeOnClick: false,
  });
  pw.createLine({
    text: getString("batch-downloading"),
    progress: 0,
  });
  pw.show();

  const stats: BatchStats = { ok: 0, skippedPdf: 0, noPdf: 0, failed: 0 };
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const title = String(item.getField("title") || "");
    pw.changeLine({
      text: `${i + 1}/${items.length} ${title}`,
      progress: Math.round((i / items.length) * 100),
    });
    try {
      stats[await downloadForItem(item, collectionId)]++;
    } catch (err) {
      ztoolkit.log("SciDownload: batch item failed:", err);
      stats.failed++;
    }
  }

  pw.changeLine({
    text: getString("batch-summary", {
      args: {
        ok: stats.ok,
        skip: stats.skippedPdf,
        no: stats.noPdf,
        fail: stats.failed,
      },
    }),
    progress: 100,
  });
  pw.startCloseTimer(5000);
}

function getSelectedCollectionId(pane: any): number | null {
  try {
    const col = pane.getSelectedCollection?.();
    return col && col.id ? col.id : null;
  } catch {
    return null;
  }
}

async function downloadForItem(
  item: any,
  collectionId: number | null,
): Promise<BatchOutcome> {
  // Library-level idempotence: an item that already has a PDF is never
  // re-downloaded, in any flow that reuses attachPdfToZotero.
  if (SciDownloadFetcher.hasPdfAttachment(item)) return "skippedPdf";

  let doi = normalizeDOI(String(item.getField("DOI") || ""));
  if (!doi) {
    const title = String(item.getField("title") || "");
    if (title) doi = await lookupDOIByTitle(title);
  }
  if (!doi || !DOI_REGEX.test(doi)) return "failed";

  const metadata = await lookupCrossRef(doi);
  const { order } = getOrderedMirrors();
  const pdfUrl = await SciDownloadFetcher.findPDFUrl(doi, order);
  if (!pdfUrl) return "noPdf";

  const result = await SciDownloadFetcher.attachPdfToZotero(
    pdfUrl,
    doi,
    metadata,
    collectionId,
    // Prefer the selected item among same-DOI duplicates so the PDF lands
    // where the user is looking
    item.id as number,
  );
  if (!result.success) return "failed";
  return result.message === "dialog-pdf-exists" ? "skippedPdf" : "ok";
}
