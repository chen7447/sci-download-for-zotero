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

const DEFAULT_MIRRORS = [
  "https://sci-hub.se/",
  "https://sci-hub.st/",
  "https://sci-hub.ru/",
  "https://sci-hub.ee/",
  "https://sci-hub.ren/",
];

export function getMirrors(): string[] {
  const raw = getPref("mirrors") as string | undefined;
  if (!raw) return [...DEFAULT_MIRRORS];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length > 0 ? arr : [...DEFAULT_MIRRORS];
  } catch {
    return [...DEFAULT_MIRRORS];
  }
}

export function setMirrors(mirrors: string[]) {
  setPref("mirrors", JSON.stringify(mirrors));
}

export function resetMirrors() {
  setMirrors(DEFAULT_MIRRORS);
}

export function getDefaultMirrors(): string[] {
  return [...DEFAULT_MIRRORS];
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