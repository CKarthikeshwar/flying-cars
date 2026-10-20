import '@fontsource/chakra-petch/latin-400.css';
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/saira-extra-condensed/latin-600.css';
import '@fontsource/saira-extra-condensed/latin-700.css';
import '@fontsource/saira-extra-condensed/latin-800.css';
import { initPhysics } from './physics/world';
import { Game } from './game/Game';

async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing #app element');
  await initPhysics();
  new Game(container).start();
}

void boot();
