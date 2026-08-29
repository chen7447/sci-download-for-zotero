// Shared outbound-request options. Zotero.HTTP.request defaults to a 30s
// timeout and auto-retries 429/5xx with growing delays capped at 1 hour —
// both unacceptable inside a mirror loop, where 503/429 answers are the
// common case. Every request from this plugin goes through here: fail fast
// and move on to the next mirror.
export const HTTP_TIMEOUT_MS = 10_000;

export function httpGet(url: string, options: Record<string, unknown> = {}) {
  return Zotero.HTTP.request("GET", url, {
    timeout: HTTP_TIMEOUT_MS,
    errorDelayMax: 0,
    ...options,
  });
}
