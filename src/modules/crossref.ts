// ponytail: one fetch call, no error handling abstraction
import { httpGet } from "../utils/http";

export interface CrossrefAuthor {
  given: string;
  family: string;
}

export interface CrossRefMetadata {
  title: string;
  authors: CrossrefAuthor[];
  journal: string;
  year: number;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher: string;
}

export async function lookupCrossRef(
  doi: string,
): Promise<CrossRefMetadata | null> {
  try {
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
    const resp = await httpGet(url, {
      headers: { "User-Agent": "Zotero-SciDownload/0.1" },
    });
    // Zotero.HTTP.request rejects on non-2xx; the catch below reports null.
    const data = JSON.parse(resp.responseText ?? "");
    const msg = data?.message;
    if (!msg) return null;

    const title = msg.title?.[0] || "";
    const authors: CrossrefAuthor[] = (msg.author || []).map((a: any) => ({
      given: a.given || "",
      family: a.family || "",
    }));
    const journal = msg["container-title"]?.[0] || "";
    const year =
      msg["published-print"]?.["date-parts"]?.[0]?.[0] ||
      msg["published-online"]?.["date-parts"]?.[0]?.[0] ||
      msg["issued"]?.["date-parts"]?.[0]?.[0] ||
      0;
    const volume = msg.volume || "";
    const issue = msg.issue || "";
    const pages = msg.page || "";
    const publisher = msg.publisher || "";

    return { title, authors, journal, year, volume, issue, pages, publisher };
  } catch {
    return null;
  }
}
