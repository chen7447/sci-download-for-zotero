import { config } from "../../package.json";

const PREFS_PREFIX = config.prefsPrefix;

export function getPref(key: string): any {
  return Zotero.Prefs.get(`${PREFS_PREFIX}.${key}`, true);
}

export function setPref(key: string, value: any) {
  return Zotero.Prefs.set(`${PREFS_PREFIX}.${key}`, value, true);
}

export function clearPref(key: string) {
  return Zotero.Prefs.clear(`${PREFS_PREFIX}.${key}`, true);
}

// ── Sci-Hub mirror sites ──
// Bump DEFAULT_MIRRORS_VERSION whenever DEFAULT_MIRRORS changes.
// getMirrors() detects the mismatch and merges new defaults in.

const DEFAULT_MIRRORS = [
  "https://www.sci-hub.se",
  "https://www.sci-hub.st",
  "https://www.sci-hub.ru",
  "https://sci-hub.ee/",
  "https://sci-hub.ren/",
  "https://www.sci-hub.wf/",
  "https://www.sci-hub.yt/",
  "https://www.wellesu.com",
  "https://www.tesble.com",
  "https://www.et-fine.com",
];
const DEFAULT_MIRRORS_VERSION = 3;

export function getMirrors(): string[] {
  const raw = getPref("mirrors") as string | undefined;
  const existing = safeParseMirrors(raw); // null = unset/invalid
  const ver = getPref("mirrorsVersion") as number | undefined;

  // First run / parse failure / defaults changed → merge defaults in
  if (existing === null || ver !== DEFAULT_MIRRORS_VERSION) {
    const merged = mergeMirrors(DEFAULT_MIRRORS, existing ?? []);
    setPref("mirrors", JSON.stringify(merged));
    setPref("mirrorsVersion", DEFAULT_MIRRORS_VERSION);
    return merged;
  }
  return existing;
}

export function setMirrors(mirrors: string[]) {
  setPref("mirrors", JSON.stringify(mirrors));
}

export function resetMirrors() {
  setPref("mirrorsVersion", DEFAULT_MIRRORS_VERSION);
  setMirrors(DEFAULT_MIRRORS);
  clearPref("mirrorPriority");
}

// ── Mirror priorities ──
// Keyed by trimmed mirror URL; value = access rank (0 = first).
// Absent = no priority (default 99, access in original list order).

export function getMirrorPriorities(): Record<string, number> {
  const raw = getPref("mirrorPriority");
  if (typeof raw !== "string") return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

export function setMirrorPriority(url: string, prio: number | null) {
  const map = getMirrorPriorities();
  const key = url.trim();
  if (prio === null) {
    // Renumber on removal: priorities above the removed one shift down by 1,
    // keeping the set contiguous 0..k, so the next assignment is k+1.
    const removed = map[key];
    delete map[key];
    if (removed !== undefined) {
      for (const k of Object.keys(map)) {
        if (map[k] > removed) map[k]--;
      }
    }
  } else {
    map[key] = prio;
  }
  setPref("mirrorPriority", JSON.stringify(map));
}

export function getDefaultMirrors(): string[] {
  return [...DEFAULT_MIRRORS];
}

// ponytail: Set dedupe by trimmed URL, defaults first, user entries kept
function mergeMirrors(defaults: string[], existing: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [...defaults, ...existing]) {
    const key = url.trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(url);
    }
  }
  return out;
}

function safeParseMirrors(raw: string | undefined): string[] | null {
  if (raw === undefined || raw === null) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

// ── Target collection ──

export function getTargetCollectionId(): number | null {
  const id = getPref("collectionId") as number | undefined;
  return id ?? null;
}

export function setTargetCollectionId(id: number | null) {
  if (id === null) {
    clearPref("collectionId");
  } else {
    setPref("collectionId", id);
  }
}