import { lookupCrossRef, CrossRefMetadata, CrossrefAuthor } from "./crossref";

// ponytail: single-attempt per mirror, no retry abstraction
const PDF_NOT_FOUND_REGEXES = [
  /Please try to search again using DOI/im,
  /статья не найдена в базе/im,
];

export interface FindPDFResult {
  url: string | null;
  /** per-mirror status, aligned with the input mirrors array */
  statuses: ("untested" | "failed" | "success")[];
}

export class SciDownloadFetcher {
  /**
   * Try mirrors in order. Return the first PDF URL found, or null,
   * plus per-mirror status for UI feedback.
   */
  static async findPDFUrl(doi: string, mirrors: string[]): Promise<FindPDFResult> {
    const statuses: ("untested" | "failed" | "success")[] =
      new Array(mirrors.length).fill("untested");

    for (let i = 0; i < mirrors.length; i++) {
      const base = mirrors[i];
      try {
        const url = base.endsWith("/") ? `${base}${doi}` : `${base}/${doi}`;
        ztoolkit.log(`SciDownload: trying ${url}`);

        const resp = await Zotero.HTTP.request("GET", url, {
          responseType: "document",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 11_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/10.0 Mobile/14E304 Safari/602.1",
          },
        });

        if (resp.status !== 200) {
          statuses[i] = "failed";
          continue;
        }

        // Try to extract PDF URL from #pdf iframe
        if (resp.responseXML) {
          const pdfSrc = (resp.responseXML as Document)
            .querySelector("#pdf")
            ?.getAttribute("src");
          if (pdfSrc) {
            const pdfUrl = new URL(pdfSrc, url);
            pdfUrl.protocol = "https:";
            pdfUrl.hash = ""; // strip fragment like #view=FitH
            statuses[i] = "success";
            return { url: pdfUrl.href, statuses };
          }
        }

        // Check if PDF not available
        const body = resp.responseXML?.querySelector("body");
        if (body && this.pdfNotAvailable(body)) {
          ztoolkit.log(`SciDownload: PDF not available at ${url}`);
          statuses[i] = "failed";
          continue;
        }

        // Reached here: response OK but no PDF found → mark failed
        statuses[i] = "failed";
      } catch (err) {
        ztoolkit.log(`SciDownload: mirror ${base} failed:`, err);
        statuses[i] = "failed";
        continue;
      }
    }
    return { url: null, statuses };
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
          item.setField("date", String(metadata.year));
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
        item.setField("extra", `DOI: ${doi}`);

        // Save and add to selected collection
        if (collectionId !== null) {
          item.addToCollection(collectionId);
        }
        await item.saveTx();
        targetItem = item;
      }

      // D: Attach PDF with resolve:false to skip auto-matching
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
        message: existingItem && targetItem === existingItem ? "dialog-item-exists" : "dialog-item-created",
      };
    } catch (err) {
      ztoolkit.log("SciDownload: attach failed:", err);
      return { success: false, message: "dialog-download-fail" };
    }
  }

  /**
   * Find an existing Zotero item by DOI field, searching the entire library.
   */
  private static async findItemByDOI(
    doi: string,
  ): Promise<Zotero.Item | null> {
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