import { CrossRefMetadata } from "./crossref";
import { httpGet } from "../utils/http";

// ponytail: single-attempt per mirror, no retry abstraction
const PDF_NOT_FOUND_REGEXES = [
  /Please try to search again using DOI/im,
  /статья не найдена в базе/im,
];

// Mirrors fingerprint clients; keep the same UA used by zotero-scipdf so the
// article page (not a block page) is served.
const MIRROR_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 11_3_1 like Mac OS X) AppleWebKit/603.1.30 " +
  "(KHTML, like Gecko) Version/10.0 Mobile/14E304 Safari/602.1";

export type MirrorStatus =
  | "success" // verified %PDF- payload found
  | "failed" // responded, but no usable PDF link (incl. captcha pages)
  | "notfound" // explicit "article not in database" answer (or 404)
  | "error" // network problem, timeout, or non-404 HTTP error
  | "skipped"; // aborted mid-race, or never attempted

export class SciDownloadFetcher {
  // Mirrors are tried in parallel within each window; the first mirror to
  // yield a verified PDF wins and the rest of its window is aborted.
  private static readonly RACE_WINDOW = 3;

  /**
   * Try mirrors in order, `RACE_WINDOW` at a time. Return the first PDF URL
   * found, or null.
   * `onMirror` fires as each mirror settles, so the UI can render status in
   * real time. `isCancelled` is polled between windows; when it returns true
   * the loop stops without further requests.
   */
  static async findPDFUrl(
    doi: string,
    mirrors: string[],
    onMirror?: (i: number, status: MirrorStatus) => void,
    isCancelled?: () => boolean,
  ): Promise<string | null> {
    // Default "skipped": mirrors never attempted (cancelled run, or a race
    // won before reaching them) surface as skipped in the UI.
    const statuses: MirrorStatus[] = new Array(mirrors.length).fill("skipped");
    const report = (i: number, s: MirrorStatus) => {
      if (statuses[i] === s) return;
      statuses[i] = s;
      onMirror?.(i, s);
    };

    for (let start = 0; start < mirrors.length; start += this.RACE_WINDOW) {
      if (isCancelled?.()) break;

      const batch: number[] = [];
      for (
        let i = start;
        i < Math.min(mirrors.length, start + this.RACE_WINDOW);
        i++
      ) {
        batch.push(i);
      }

      // When one mirror wins, the rest of the window is aborted; their
      // rejections must not be mistaken for network errors.
      let batchCancelled = false;
      const cancels: Array<() => void> = [];

      const attempts = batch.map(async (i) => {
        const base = mirrors[i];
        try {
          const url = this.mirrorUrl(base, doi);
          ztoolkit.log(`SciDownload: trying ${url}`);
          const resp = await httpGet(url, {
            responseType: "document",
            headers: { "User-Agent": MIRROR_UA },
            cancellerReceiver: (c: () => void) => cancels.push(c),
          });

          // Try to extract PDF URL from #pdf iframe
          const pdfSrc = (resp.responseXML as Document | null)
            ?.querySelector("#pdf")
            ?.getAttribute("src");
          if (pdfSrc) {
            const pdfUrl = new URL(pdfSrc, url);
            pdfUrl.protocol = "https:";
            pdfUrl.hash = ""; // strip fragment like #view=FitH
            // Captcha / block pages are served at the iframe URL too; only a
            // real %PDF- payload counts as success.
            if (!(await this.looksLikePdf(pdfUrl.href))) {
              ztoolkit.log(`SciDownload: non-PDF payload at ${pdfUrl.href}`);
              return { i, status: "failed" as const };
            }
            return { i, url: pdfUrl.href, status: "success" as const };
          }

          // No #pdf iframe: an explicit "not found" page or anything else
          const body = resp.responseXML?.querySelector("body");
          if (body && this.pdfNotAvailable(body)) {
            ztoolkit.log(`SciDownload: PDF not available at ${url}`);
            return { i, status: "notfound" as const };
          }
          return { i, status: "failed" as const };
        } catch (err) {
          ztoolkit.log(`SciDownload: mirror ${base} failed:`, err);
          const status: MirrorStatus = batchCancelled
            ? "skipped"
            : (err as any)?.status === 404
              ? "notfound"
              : "error";
          return { i, status };
        }
      });

      const batchWinner = await new Promise<string | null>((resolveBatch) => {
        let remaining = batch.length;
        let winner: string | null = null;
        for (const p of attempts) {
          void p.then((r) => {
            if (r.url && !winner) {
              winner = r.url;
              batchCancelled = true;
              for (const c of cancels) c();
            }
            report(r.i, r.url ? "success" : r.status);
            if (winner) resolveBatch(winner);
            else if (--remaining === 0) resolveBatch(null);
          });
        }
      });

      if (batchWinner) return batchWinner;
    }
    return null;
  }

  private static mirrorUrl(base: string, doi: string): string {
    return base.endsWith("/") ? `${base}${doi}` : `${base}/${doi}`;
  }

  /**
   * Lightweight content check for a candidate PDF URL: fetch the first kilobyte
   * (Range; servers that ignore it answer with the full body) and look for the
   * %PDF- signature, tolerating junk bytes before it as Acrobat does.
   */
  private static async looksLikePdf(url: string): Promise<boolean> {
    try {
      const resp = await httpGet(url, {
        responseType: "arraybuffer",
        headers: { "User-Agent": MIRROR_UA, Range: "bytes=0-1023" },
      });
      const buf = resp.response as ArrayBuffer;
      if (!buf || buf.byteLength < 5) return false;
      const head = new TextDecoder("latin1").decode(
        new Uint8Array(buf, 0, Math.min(1024, buf.byteLength)),
      );
      return head.includes("%PDF-");
    } catch {
      return false;
    }
  }

  /**
   * Whether the item already carries a PDF attachment. Checked before every
   * import so re-downloading never stacks a second copy of the same PDF.
   */
  static hasPdfAttachment(item: Zotero.Item): boolean {
    try {
      const ids = item.getAttachments() as number[];
      return ids.some((id) => {
        const a = Zotero.Items.get(id);
        return !!a && (a as any).attachmentContentType === "application/pdf";
      });
    } catch {
      return false;
    }
  }

  /**
   * Download PDF from url and attach to Zotero.
   * If an item with the given DOI exists, attach to it; otherwise create a new item.
   */
  static async attachPdfToZotero(
    pdfUrl: string,
    doi: string,
    metadata: CrossRefMetadata | null,
    collectionId: number | null,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // C1: Search entire library for DOI, then check collection
      let targetItem: Zotero.Item | null = null;
      const existingItem = await this.findItemByDOI(doi);

      if (existingItem) {
        // Check if item is already in the selected collection
        const collections = existingItem.getCollections() as number[];
        if (collectionId !== null && collections.includes(collectionId)) {
          targetItem = existingItem;
        } else if (collectionId === null) {
          // No collection selected → use the found item
          targetItem = existingItem;
        }
        // If collectionId is set but item is NOT in that collection → fall through to create new
      }

      if (!targetItem) {
        // C2: Create new item (no match in selected collection, or no match at all)
        const item = new Zotero.Item("journalArticle");
        item.setField("DOI", doi);
        if (metadata) {
          item.setField("title", metadata.title);
          if (metadata.year) item.setField("date", String(metadata.year));
          item.setField("publicationTitle", metadata.journal);
          item.setField("publisher", metadata.publisher);
          if (metadata.volume) item.setField("volume", metadata.volume);
          if (metadata.issue) item.setField("issue", metadata.issue);
          if (metadata.pages) item.setField("pages", metadata.pages);
          if (metadata.authors.length > 0) {
            const creators: any[] = metadata.authors.map((a) => ({
              firstName: a.given,
              lastName: a.family,
              creatorType: "author" as const,
            }));
            item.setCreators(creators);
          }
        } else {
          item.setField("title", `DOI: ${doi}`);
        }

        // Save and add to selected collection
        if (collectionId !== null) {
          item.addToCollection(collectionId);
        }
        await item.saveTx();
        targetItem = item;
      }

      // D: Attach PDF, but never stack a second copy on an item that has one
      if (this.hasPdfAttachment(targetItem)) {
        return { success: true, message: "dialog-pdf-exists" };
      }
      await Zotero.Attachments.importFromURL({
        url: pdfUrl,
        parentItemID: targetItem.id,
        libraryID: targetItem.libraryID as number,
        title: targetItem.getField("title") || doi,
        contentType: "application/pdf",
        referrer: "",
        cookieSandbox: null,
        resolve: false,
      });

      return {
        success: true,
        message:
          existingItem && targetItem === existingItem
            ? "dialog-item-exists"
            : "dialog-item-created",
      };
    } catch (err) {
      ztoolkit.log("SciDownload: attach failed:", err);
      return { success: false, message: "dialog-download-fail" };
    }
  }

  /**
   * Find an existing Zotero item by DOI field, searching the entire library.
   */
  private static async findItemByDOI(doi: string): Promise<Zotero.Item | null> {
    try {
      const s = new Zotero.Search();
      s.addCondition("DOI", "is", doi);
      s.addCondition("libraryID", "is", "1"); // My Library
      const ids = await s.search();
      if (ids && ids.length > 0) {
        const it = Zotero.Items.get(ids[0]);
        return it || null;
      }
      return null;
    } catch {
      return null;
    }
  }

  private static pdfNotAvailable(body?: Element | null): boolean {
    const innerHTML = (body as HTMLElement)?.innerHTML as string | undefined;
    if (!innerHTML || innerHTML.trim() === "") return true;
    return PDF_NOT_FOUND_REGEXES.some((r) => r.test(innerHTML));
  }
}
