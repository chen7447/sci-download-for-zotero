import { downloadPaper, DownloadResult } from "./download";
import { getPref, setPref } from "./prefs";
import { DOI_REGEX, normalizeDOI } from "../utils/doi";

const PATH = "/scidownload/download";
let busy = false;
const reply = (code: number, body: unknown) => [
  code,
  "application/json",
  JSON.stringify(body),
];
const keyPattern = /^[A-Z0-9]{8}$/;

class DownloadEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(request: { headers: Record<string, string>; data: unknown }) {
    const token = getPref("apiToken");
    if (
      request.headers.origin ||
      !token ||
      request.headers.authorization !== `Bearer ${token}`
    ) {
      return reply(403, { error: "Invalid API token or browser request" });
    }
    if (busy)
      return reply(409, { error: "A download batch is already running" });
    const data = request.data as {
      dois?: unknown;
      itemKeys?: unknown;
      libraryID?: unknown;
      collectionKey?: unknown;
    } | null;
    if (!data || typeof data !== "object" || Array.isArray(data))
      return reply(400, { error: "Expected a JSON object" });
    const dois = data.dois ?? [];
    const itemKeys = data.itemKeys ?? [];
    if (
      !Array.isArray(dois) ||
      !Array.isArray(itemKeys) ||
      dois.some(
        (d) => typeof d !== "string" || !DOI_REGEX.test(normalizeDOI(d)),
      ) ||
      itemKeys.some((k) => typeof k !== "string" || !keyPattern.test(k)) ||
      dois.length + itemKeys.length < 1 ||
      dois.length + itemKeys.length > 100
    ) {
      return reply(400, { error: "Provide 1–100 valid dois/itemKeys" });
    }
    const libraryID = data.libraryID ?? Zotero.Libraries.userLibraryID;
    if (
      typeof libraryID !== "number" ||
      !Number.isSafeInteger(libraryID) ||
      libraryID < 1
    )
      return reply(400, { error: "Invalid libraryID" });
    const library = Zotero.Libraries.get(libraryID);
    if (!library || !library.editable || !library.filesEditable)
      return reply(400, {
        error: "Library does not allow item and file writes",
      });
    let collectionId: number | null = null;
    if (data.collectionKey !== undefined) {
      if (
        typeof data.collectionKey !== "string" ||
        !keyPattern.test(data.collectionKey)
      )
        return reply(400, { error: "Invalid collectionKey" });
      const collection = Zotero.Collections.getByLibraryAndKey(
        libraryID,
        data.collectionKey,
      );
      if (!collection)
        return reply(400, { error: "Collection not found in target library" });
      collectionId = collection.id;
    }
    busy = true;
    try {
      const results: (DownloadResult & { input: string })[] = [];
      for (const doi of dois) {
        results.push({
          input: doi,
          ...(await downloadPaper({ doi, libraryID, collectionId })),
        });
      }
      for (const key of itemKeys) {
        const item = Zotero.Items.getByLibraryAndKey(libraryID, key);
        if (!item || item.deleted || !item.isRegularItem()) {
          results.push({
            input: key,
            status: "failed",
            message: "Regular item not found in target library",
          });
          continue;
        }
        results.push({
          input: key,
          ...(await downloadPaper({ item, libraryID, collectionId })),
        });
      }
      return reply(200, { results });
    } catch (error) {
      return reply(500, { error: String(error) });
    } finally {
      busy = false;
    }
  }
}

export function registerDownloadEndpoint() {
  if (!getPref("apiToken")) {
    const bytes = new Uint8Array(32);
    Zotero.getMainWindow().crypto.getRandomValues(bytes);
    setPref(
      "apiToken",
      Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
    );
  }
  Zotero.Server.Endpoints[PATH] = DownloadEndpoint;
}

export function unregisterDownloadEndpoint() {
  delete Zotero.Server.Endpoints[PATH];
}
