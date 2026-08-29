// DOI handling shared by the dialog, smart extraction and later batch flows.
// Practical subset of the DOI Handbook syntax: registrant code 10. + 4-9
// digits + suffix made of the common URL-safe characters.
export const DOI_REGEX = /^10\.\d{4,9}\/[-._;()/:a-zA-Z0-9]+$/;

/** Trim input and strip common DOI URL prefixes (doi.org, dx.doi.org). */
export function normalizeDOI(input: string): string {
  return input.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
}

export type InputKind = "doi" | "pmid" | "title";

/**
 * Route smart-extract input to a lookup strategy. Deliberately looser than
 * DOI_REGEX: a full syntactic check happens before download; here a bare
 * `10.1234/` prefix is enough to pick the DOI path.
 */
export function classifyInput(raw: string): InputKind {
  const v = normalizeDOI(raw);
  if (/^10\.\d{4,9}\//.test(v)) return "doi";
  if (/^\d{6,9}$/.test(v)) return "pmid";
  return "title";
}
