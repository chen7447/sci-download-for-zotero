import { createZToolkit } from "./utils/ztoolkit";
import { initLocale } from "./utils/locale";
import { installToolbarButton, uninstallToolbarButton } from "./modules/dialog";
import {
  registerReaderToolbar,
  unregisterReaderToolbar,
} from "./modules/reader-toolbar";
import { setMirrors, getDefaultMirrors } from "./modules/prefs";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // Initialize defaults if not set
  const mirrorsPref = Zotero.Prefs.get(
    "extensions.zotero.scidownload.mirrors",
    true,
  );
  if (!mirrorsPref) {
    setMirrors(getDefaultMirrors());
  }

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
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  uninstallToolbarButton();
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  uninstallToolbarButton();
  unregisterReaderToolbar();
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
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
