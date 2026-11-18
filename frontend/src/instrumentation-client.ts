import { SHOWCASE_BUILD } from './app/lib/featureFlags';
import { installShowcase } from './app/lib/showcase';

// Runs before the app's modules, some of which fetch as soon as they load.
if (SHOWCASE_BUILD) installShowcase();
