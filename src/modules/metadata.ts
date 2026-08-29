import { lookupCrossRef, CrossrefAuthor } from "./crossref";
import { httpGet, METADATA_UA } from "../utils/http";
import { classifyInput, normalizeDOI } from "../utils/doi";

// ponytail: three regexes, three public GETs, no framework
export interface ExtractedMeta {
  title: string;
  info: string;
  doi: string;
  /** title-search hit did not resemble the query — UI should warn */
  lowConfidence?: boolean;
}

// Below this token-overlap, a title-search result likely is a different paper
const LOW_CONFIDENCE_THRESHOLD = 0.5;

export async function smartExtract(
  input: string,
): Promise<ExtractedMeta | null> {
  const v = normalizeDOI(input);
  if (!v) return null;

  const kind = classifyInput(input);
  if (kind === "doi") return extractByDOI(v);
  if (kind === "pmid") return extractByPMID(v);
  return extractByTitle(v);
}

async function extractByDOI(doi: string): Promise<ExtractedMeta | null> {
  const m = await lookupCrossRef(doi);
  if (!m) return null;
  return {
    title: m.title,
    info: joinInfo([m.journal, formatYear(m.year), formatAuthors(m.authors)]),
    doi,
  };
}

async function extractByPMID(pmid: string): Promise<ExtractedMeta | null> {
  const data = await fetchJSON(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`,
  );
  const r = data?.result?.[pmid];
  if (!r?.title) return null;
  const doi =
    (r.articleids || []).find((a: { idtype: string }) => a.idtype === "doi")
      ?.value ?? "";
  const year = (r.pubdate || "").match(/\d{4}/)?.[0] ?? "";
  return {
    title: r.title,
    info: joinInfo([r.fulljournalname || "", year]),
    doi,
  };
}

async function extractByTitle(q: string): Promise<ExtractedMeta | null> {
  const data = await fetchJSON(
    `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(q)}&rows=1`,
  );
  const item = data?.message?.items?.[0];
  if (!item) return null;
  const title = item.title?.[0] || "";
  return {
    title,
    info: joinInfo([
      item["container-title"]?.[0] || "",
      formatYear(item.issued?.["date-parts"]?.[0]?.[0]),
    ]),
    doi: item.DOI || "",
    lowConfidence: titleSimilarity(q, title) < LOW_CONFIDENCE_THRESHOLD,
  };
}

/**
 * Token-overlap similarity between two titles: |shared tokens| / |smaller
 * token set|, case- and punctuation-insensitive. 1 = one title contains the
 * other's tokens, 0 = no overlap.
 */
export function titleSimilarity(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1),
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

function joinInfo(parts: (string | number)[]): string {
  return parts
    .filter((p) => p !== "" && p !== null && p !== undefined)
    .join(" · ");
}

function formatYear(y: unknown): string {
  const n = Number(y);
  return Number.isFinite(n) && n > 0 ? String(n) : "";
}

function formatAuthors(list: CrossrefAuthor[]): string {
  if (list.length === 0) return "";
  const names = list
    .slice(0, 3)
    .map((a) => a.family)
    .filter((n) => n)
    .join(", ");
  return list.length > 3 ? `${names} et al.` : names;
}

async function fetchJSON(url: string): Promise<any> {
  // Zotero.HTTP.request rejects on non-2xx; callers treat any throw as null.
  const resp = await httpGet(url, {
    headers: { "User-Agent": METADATA_UA },
  });
  return JSON.parse(resp.responseText ?? "null");
}

/**
 * Best-effort DOI lookup from a title (CrossRef bibliographic query, top hit).
 * Used by the batch flow and the reader button when an item has no DOI field.
 */
export async function lookupDOIByTitle(title: string): Promise<string> {
  try {
    const data = await fetchJSON(
      `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(title)}&rows=1`,
    );
    return String(data?.message?.items?.[0]?.DOI || "");
  } catch {
    return "";
  }
}
