#!/usr/bin/env node
import process from "node:process";
import console from "node:console";
const { fetch, AbortSignal } = globalThis;
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "token-file": {
        type: "string",
        default: join(homedir(), ".config", "sci-download", "token"),
      },
      "item-key": { type: "string", multiple: true },
      doi: { type: "string", multiple: true },
      library: { type: "string" },
      collection: { type: "string" },
      port: { type: "string", default: "23119" },
      timeout: { type: "string", default: "3600" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(`Usage: sci-download download [DOI ...] [options]
  --doi DOI          Add a DOI (repeatable)
  --item-key KEY     Fill PDF on an existing item (repeatable)
  --library ID       Local Zotero library ID (default: My Library)
  --collection KEY   Add items to this collection in the target library
  --port PORT        Zotero local server port (default: 23119)
  --timeout SECONDS  HTTP wait limit (default: 3600)
  --json             Accepted for clarity; output is always JSON
  --token-file PATH  Token file (default: ~/.config/sci-download/token)
Set SCI_DOWNLOAD_TOKEN or save the token to the file above. Token preference:
extensions.zotero.scidownload.apiToken, available from
Zotero Settings → Advanced → Config Editor. Zotero must be running.
Exit: 0 all downloaded/skipped; 1 any failed/not_found; 2 request/CLI error.`);
  } else {
    if (positionals.shift() !== "download")
      throw new Error("Expected 'download'; use --help");
    const dois = [...positionals, ...(values.doi ?? [])];
    const itemKeys = values["item-key"] ?? [];
    if (!dois.length && !itemKeys.length)
      throw new Error("Provide DOI(s) or --item-key");
    const port = Number(values.port);
    const timeout = Number(values.timeout);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Invalid port");
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 86400)
      throw new Error("Timeout must be 1–86400 seconds");
    const libraryID =
      values.library === undefined ? undefined : Number(values.library);
    if (
      libraryID !== undefined &&
      (!Number.isSafeInteger(libraryID) || libraryID < 1)
    )
      throw new Error("Invalid library ID");
    let token = process.env.SCI_DOWNLOAD_TOKEN;
    if (!token) {
      try {
        token = readFileSync(values["token-file"], "utf8").trim();
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (!token) throw new Error("Set SCI_DOWNLOAD_TOKEN; use --help for setup");
    const response = await fetch(
      `http://127.0.0.1:${port}/scidownload/download`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          dois,
          itemKeys,
          libraryID,
          collectionKey: values.collection,
        }),
        signal: AbortSignal.timeout(Math.ceil(timeout * 1000)),
        redirect: "error",
      },
    );
    if (!response.ok)
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const result = await response.json();
    if (!Array.isArray(result.results))
      throw new Error("Invalid response from plugin");
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.results.every((r) =>
      ["downloaded", "skipped"].includes(r.status),
    )
      ? 0
      : 1;
  }
} catch (error) {
  console.error(
    JSON.stringify({
      error: error.message,
      hint: "Check Zotero is running and the plugin is installed. A timeout/disconnect does not cancel a batch already accepted by Zotero.",
    }),
  );
  process.exitCode = 2;
}
