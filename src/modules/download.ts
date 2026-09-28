import { DOI_REGEX, normalizeDOI } from "../utils/doi";
import { SciDownloadFetcher } from "./fetcher";
import { lookupCrossRef } from "./crossref";
import { lookupDOIByTitle } from "./metadata";
import { getOrderedMirrors } from "./prefs";

export interface DownloadResult {
  status: "downloaded" | "skipped" | "not_found" | "failed";
  doi?: string;
  itemKey?: string;
  attachmentKey?: string;
  message?: string;
}

export async function downloadPaper(options: {
  doi?: string;
  item?: Zotero.Item;
  libraryID: number;
  collectionId: number | null;
}): Promise<DownloadResult> {
  const { item, libraryID, collectionId } = options;
  let doi = normalizeDOI(options.doi ?? String(item?.getField("DOI") || ""));
  try {
    if (item && SciDownloadFetcher.hasPdfAttachment(item)) {
      if (
        collectionId !== null &&
        !item.getCollections().includes(collectionId)
      ) {
        item.addToCollection(collectionId);
        await item.saveTx();
      }
      return { status: "skipped", itemKey: item.key, doi };
    }
    if (!doi && item)
      doi = await lookupDOIByTitle(String(item.getField("title") || ""));
    if (!DOI_REGEX.test(doi)) throw new Error("No valid DOI available");
    // Check before network work, so repeated DOI requests also skip existing PDFs.
    if (!item) {
      const existing = await SciDownloadFetcher.findItemByDOI(doi, libraryID);
      if (existing && existing.isRegularItem()) {
        return downloadPaper({ ...options, doi, item: existing });
      }
    }
    const metadata = await lookupCrossRef(doi);
    const pdfUrl = await SciDownloadFetcher.findPDFUrl(
      doi,
      getOrderedMirrors().order,
    );
    if (!pdfUrl) return { status: "not_found", doi, itemKey: item?.key };
    const result = await SciDownloadFetcher.attachPdfToZotero(
      pdfUrl,
      doi,
      metadata,
      collectionId,
      item?.id,
      libraryID,
    );
    return {
      status: !result.success
        ? "failed"
        : result.message === "dialog-pdf-exists"
          ? "skipped"
          : "downloaded",
      doi,
      itemKey: result.itemKey ?? item?.key,
      attachmentKey: result.attachmentKey,
      message: result.message,
    };
  } catch (error) {
    return {
      status: "failed",
      doi,
      itemKey: item?.key,
      message: String(error),
    };
  }
}
