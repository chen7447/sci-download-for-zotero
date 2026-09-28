import {
  registerDownloadEndpoint,
  unregisterDownloadEndpoint,
} from "./modules/api";
import { createZToolkit } from "./utils/ztoolkit";
import { initLocale } from "./utils/locale";
import { installToolbarButton, uninstallToolbarButton } from "./modules/dialog";
import {
  registerReaderToolbar,
  retrofitOpenReaders,
  unregisterReaderToolbar,
} from "./modules/reader-toolbar";
import { getMirrors } from "./modules/prefs";
import {
  registerItemContextMenu,
  unregisterItemContextMenu,
} from "./modules/batch";

async function onStartup() {
  // Must register before ANY await: session-restored readers open right after
  // uiReadyPromise and fire the one-shot renderToolbar event — register later
  // and the event is missed forever (button never appears until next open).
  unregisterReaderToolbar();
  registerReaderToolbar();
  retrofitOpenReaders();

  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  retrofitOpenReaders();

  // First call merges new default mirrors into the saved list (version bump)
  // and writes prefs, so no separate first-run init is needed.
  getMirrors();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  retrofitOpenReaders(); // catch readers opened during init

  registerDownloadEndpoint();
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();
  Zotero.debug("[Sci-Download] onMainWindowLoad");
  installToolbarButton(win);
  registerItemContextMenu(win);
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  uninstallToolbarButton(_win);
  unregisterItemContextMenu(_win);
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  unregisterDownloadEndpoint();
  uninstallToolbarButton();
  unregisterItemContextMenu();
  unregisterReaderToolbar();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
