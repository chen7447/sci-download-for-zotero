import { createZToolkit } from "./utils/ztoolkit";
import { initLocale } from "./utils/locale";
import { installToolbarButton, uninstallToolbarButton } from "./modules/dialog";
import {
  registerReaderToolbar,
  unregisterReaderToolbar,
} from "./modules/reader-toolbar";
import { getMirrors } from "./modules/prefs";
import {
  registerItemContextMenu,
  unregisterItemContextMenu,
} from "./modules/batch";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // First call merges new default mirrors into the saved list (version bump)
  // and writes prefs, so no separate first-run init is needed.
  getMirrors();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  registerReaderToolbar();

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
