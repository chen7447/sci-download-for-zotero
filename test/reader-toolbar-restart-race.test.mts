/**
 * Regression tests for the reader-toolbar restart race
 * (skill: zotero-reader-toolbar-restart-race).
 * node:test, NO Zotero: source assertions + mock stubs, direct import of
 * the real retrofitOpenReaders via tsx.
 * Run: npx tsx --test test/reader-toolbar-restart-race.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const SRC = join(import.meta.dirname, "..");

// globalThis.addon powers getString() inside createToolbarButton
(globalThis as { addon?: unknown }).addon = {
  data: {
    config: { addonRef: "scidownload" },
    locale: {
      current: { formatMessagesSync: () => [{ value: "Sci-Download" }] },
    },
  },
};

// Mock Zotero on globalThis before importing the real module
const realZotero = (globalThis as { Zotero?: unknown }).Zotero;

function stubZotero(readers: unknown[]) {
  (globalThis as { Zotero?: unknown }).Zotero = {
    Reader: { _readers: readers },
    debug: () => {},
    Items: { get: () => null },
  };
}

stubZotero([]);
const { retrofitOpenReaders } = await import("../src/modules/reader-toolbar");

// ── 1) Source assertions on hooks.ts (from the skill) ────────────────────
const hooks = readFileSync(join(SRC, "src", "hooks.ts"), "utf-8");
const body = hooks.slice(hooks.indexOf("async function onStartup"));

test("registerReaderToolbar runs before the first await in onStartup", () => {
  const registerIdx = body.indexOf("registerReaderToolbar()");
  const firstAwaitIdx = body.indexOf("await ");
  assert.ok(firstAwaitIdx < 0 || registerIdx < firstAwaitIdx);
});

test("retrofitOpenReaders appears at least twice in onStartup", () => {
  assert.ok((body.match(/retrofitOpenReaders\(\)/g) ?? []).length >= 2);
});

// ── 2) Behavior: mock Zotero.Reader._readers + DOM stubs ─────────────────

interface StubNode {
  tag?: string;
  id?: string;
  style: Record<string, string>;
  children: unknown[];
  append: (n: unknown) => void;
  addEventListener: (t: string, l: unknown) => void;
  setAttribute: (k: string, v: string) => void;
}

function makeEl(): StubNode {
  const el: StubNode = {
    style: {},
    children: [],
    append: (n) => el.children.push(n),
    addEventListener: () => {},
    setAttribute: () => {},
  };
  return el;
}

function makeDoc(container: StubNode | null, existingBtn = false) {
  return {
    querySelector: (sel: string) => {
      assert.equal(sel, ".toolbar .custom-sections");
      return container;
    },
    getElementById: (id: string) => (existingBtn ? { id } : null),
    createElement: (_tag: string) => makeEl(),
    defaultView: {},
  };
}

test("appends the button to a ready pdf reader", () => {
  const container = makeEl();
  const reader = {
    _type: "pdf",
    _iframeWindow: { document: makeDoc(container) },
    setToolbarPlaceholderWidth: () => {},
  };
  stubZotero([reader]);
  retrofitOpenReaders();
  assert.equal(container.children.length, 1);
});

test("skips readers whose toolbar is not rendered yet (event path covers them)", () => {
  const reader = { _type: "pdf", _iframeWindow: { document: makeDoc(null) } };
  stubZotero([reader]);
  retrofitOpenReaders(); // must not throw
});

test("skips readers without an iframe document", () => {
  stubZotero([{ _type: "pdf", _iframeWindow: {} }]);
  retrofitOpenReaders(); // must not throw
});

test("skips non-pdf readers", () => {
  const container = makeEl();
  const reader = {
    _type: "epub",
    _iframeWindow: { document: makeDoc(container) },
  };
  stubZotero([reader]);
  retrofitOpenReaders();
  assert.equal(container.children.length, 0);
});

test("is idempotent: second call does not append again", () => {
  const container = makeEl();
  const btn = makeEl();
  let btnInDoc = false;
  const doc = {
    ...makeDoc(container),
    getElementById: (id: string) => (btnInDoc ? { id } : null),
  };
  void btn;
  const reader = {
    _type: "pdf",
    _iframeWindow: { document: doc },
    setToolbarPlaceholderWidth: () => {},
  };
  stubZotero([reader]);
  // simulate: first append makes the button discoverable by id
  const origAppend = container.append.bind(container);
  container.append = (n: unknown) => {
    origAppend(n);
    btnInDoc = true;
  };
  retrofitOpenReaders();
  retrofitOpenReaders();
  assert.equal(container.children.length, 1);
});

test("treats real ReaderTab _type, and event-reader type, as pdf", () => {
  const container = makeEl();
  const reader = {
    // event-path proxy exposes .type (no _type)
    type: "pdf",
    _iframeWindow: { document: makeDoc(container) },
  };
  stubZotero([reader]);
  retrofitOpenReaders();
  assert.equal(container.children.length, 1);
});

test("event-reader with non-pdf type is skipped", () => {
  const container = makeEl();
  const reader = {
    type: "epub",
    _iframeWindow: { document: makeDoc(container) },
  };
  stubZotero([reader]);
  retrofitOpenReaders();
  assert.equal(container.children.length, 0);
});

test("ignores a non-array _readers list", () => {
  stubZotero([{ _readers: "not an array" }]);
  (globalThis as { Zotero?: unknown }).Zotero = {
    Reader: { _readers: undefined },
  };
  retrofitOpenReaders(); // must not throw
});

// restore
process.on("exit", () => {
  if (realZotero === undefined)
    delete (globalThis as { Zotero?: unknown }).Zotero;
  else (globalThis as { Zotero?: unknown }).Zotero = realZotero;
});
