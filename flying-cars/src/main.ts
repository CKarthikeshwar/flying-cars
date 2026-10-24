import '@fontsource/chakra-petch/latin-400.css';
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/saira-extra-condensed/latin-600.css';
import '@fontsource/saira-extra-condensed/latin-700.css';
import '@fontsource/saira-extra-condensed/latin-800.css';
import { initPhysics } from './physics/world';
import { Game } from './game/Game';
import { migrateOldSaves } from './game/migrate';
import { showUnsupported, webglAvailable } from './ui/unsupported';

/** The browser's storage, or null where it cannot be touched (private windows, blocked site data). */
function savedData(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing #app element');
  if (!webglAvailable()) {
    showUnsupported(container, 'webgl');
    return;
  }
  try {
    migrateOldSaves(savedData());
    await initPhysics();
    new Game(container).start();
  } catch (error) {
    console.error(error);
    showUnsupported(container, 'error');
  }
}

void boot();
