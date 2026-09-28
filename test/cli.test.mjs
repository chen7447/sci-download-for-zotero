import process from "node:process";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const bundle = await build({
  stdin: {
    contents:
      'export * from "./src/modules/api"; export * from "./src/modules/fetcher";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const api = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const prefs = new Map([
  ["extensions.zotero.scidownload.apiToken", "test-token"],
]);
const items = new Map();
let nextID = 1;
let imports = [];
class Item {
  constructor() {
    this.id = nextID++;
    this.key = String(this.id).padStart(8, "A");
    this.fields = {};
    this.collections = [];
    this.attachments = [];
  }
  getField(k) {
    return this.fields[k] ?? "";
  }
  setField(k, v) {
    this.fields[k] = v;
  }
  setCreators() {}
  isRegularItem() {
    return true;
  }
  getCollections() {
    return this.collections;
  }
  addToCollection(id) {
    this.collections.push(id);
  }
  getAttachments() {
    return this.attachments;
  }
  async saveTx() {
    items.set(this.id, this);
  }
}
globalThis.ztoolkit = { log() {} };
globalThis.Zotero = {
  Server: { Endpoints: {} },
  Prefs: { get: (k) => prefs.get(k), set: (k, v) => prefs.set(k, v) },
  Libraries: {
    userLibraryID: 1,
    get: (id) =>
      [1, 2].includes(id) ? { editable: true, filesEditable: true } : null,
  },
  Collections: {
    getByLibraryAndKey: (id, k) =>
      id === 2 && k === "COLLECT2" ? { id: 20 } : false,
    get: (id) => (id === 20 ? { libraryID: 2 } : false),
  },
  Items: {
    get: (id) => items.get(id) ?? false,
    getByLibraryAndKey: (id, k) =>
      [...items.values()].find((i) => i.libraryID === id && i.key === k) ??
      false,
  },
  Item,
  Search: class {
    conditions = {};
    addCondition(k, op, v) {
      this.conditions[k] = v;
    }
    async search() {
      return [...items.values()]
        .filter(
          (i) =>
            i.isRegularItem?.() &&
            i.libraryID === Number(this.conditions.libraryID) &&
            i.getField("DOI") === this.conditions.DOI &&
            !i.deleted,
        )
        .map((i) => i.id);
    }
  },
  HTTP: {
    request: async (_method, url) => ({
      responseText: JSON.stringify({
        message: url.includes("query.bibliographic")
          ? { items: [{ DOI: "10.1234/resolved" }] }
          : { title: ["Test paper"] },
      }),
    }),
  },
  Attachments: {
    importFromURL: async (options) => {
      imports.push(options);
      const a = {
        id: nextID++,
        key: "PDFKEY01",
        isAttachment: () => true,
        attachmentContentType: "application/pdf",
      };
      items.set(a.id, a);
      items.get(options.parentItemID).attachments.push(a.id);
      return a;
    },
  },
};
api.registerDownloadEndpoint();
const endpoint = new globalThis.Zotero.Server.Endpoints[
  "/scidownload/download"
]();
const call = (data, headers = { authorization: "Bearer test-token" }) =>
  endpoint.init({ data, headers });
api.SciDownloadFetcher.findPDFUrl = async (doi) =>
  doi.endsWith("missing") ? null : "https://example.org/test.pdf";

test("auth, input and collection validation happen before downloads", async () => {
  assert.equal((await call({ dois: ["10.1234/test"] }, {}))[0], 403);
  assert.equal(
    (
      await call(
        { dois: ["10.1234/test"] },
        { authorization: "Bearer test-token", origin: "https://example.org" },
      )
    )[0],
    403,
  );
  for (const data of [
    null,
    {},
    { dois: ["bad"] },
    { itemKeys: ["bad"] },
    { dois: ["10.1234/test"], collectionKey: "MISSING1" },
    { dois: ["10.1234/test"], libraryID: 999 },
  ])
    assert.equal((await call(data))[0], 400);
  assert.equal(imports.length, 0);
});

test("mixed batch preserves order, continues after failure and skips repeated DOI", async () => {
  const [code, , body] = await call({
    dois: ["10.1234/ok", "10.1234/missing", "10.1234/ok"],
    itemKeys: ["MISSING1"],
  });
  assert.equal(code, 200);
  assert.deepEqual(
    JSON.parse(body).results.map((r) => r.status),
    ["downloaded", "not_found", "skipped", "failed"],
  );
  assert.equal(imports.length, 1);
});

test("item key targets the requested group-library parent even without DOI", async () => {
  const item = new Item();
  item.libraryID = 2;
  await item.saveTx();
  item.setField("title", "Test paper");
  const [, , firstBody] = await call({ itemKeys: [item.key], libraryID: 2 });
  const result = JSON.parse(firstBody).results[0];
  assert.equal(result.status, "downloaded");
  assert.equal(result.itemKey, item.key);
  assert.equal(imports.at(-1).parentItemID, item.id);
  assert.equal(imports.at(-1).libraryID, 2);
  const [, , body] = await call({
    itemKeys: [item.key],
    libraryID: 2,
    collectionKey: "COLLECT2",
  });
  assert.equal(JSON.parse(body).results[0].status, "skipped");
  assert.deepEqual(item.collections, [20]);
});

test("simultaneous batches get 409; lock releases after completion", async () => {
  const original = api.SciDownloadFetcher.findPDFUrl;
  let finish;
  let started;
  const ready = new Promise((r) => (started = r));
  api.SciDownloadFetcher.findPDFUrl = () => {
    started();
    return new Promise((r) => (finish = r));
  };
  const pending = call({ dois: ["10.1234/slow"] });
  await ready;
  assert.equal((await call({ dois: ["10.1234/other"] }))[0], 409);
  finish(null);
  await pending;
  api.SciDownloadFetcher.findPDFUrl = original;
  assert.equal((await call({ dois: ["10.1234/missing"] }))[0], 200);
});

function cli(args, token = "test-token") {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["bin/sci-download.mjs", ...args], {
      env: { ...process.env, SCI_DOWNLOAD_TOKEN: token },
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
test("CLI sends batches to HTTP, returns JSON and meaningful exit codes", async () => {
  let request;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    request = { path: req.url, headers: req.headers, body: JSON.parse(raw) };
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        results: [{ status: "downloaded" }, { status: "not_found" }],
      }),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const result = await cli([
      "download",
      "10.1234/a",
      "10.1234/b",
      "--item-key",
      "ABCDEFG1",
      "--item-key",
      "ABCDEFG2",
      "--port",
      String(server.address().port),
    ]);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).results.length, 2);
    assert.equal(request.path, "/scidownload/download");
    assert.equal(request.headers.authorization, "Bearer test-token");
    assert.deepEqual(request.body.dois, ["10.1234/a", "10.1234/b"]);
    assert.deepEqual(request.body.itemKeys, ["ABCDEFG1", "ABCDEFG2"]);
    assert.equal(
      (
        await cli(
          [
            "download",
            "10.1234/a",
            "--token-file",
            "/nonexistent/scidownload-token",
          ],
          "",
        )
      ).code,
      2,
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});
