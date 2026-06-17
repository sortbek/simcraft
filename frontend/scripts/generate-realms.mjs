// Fetches the WoW realm list from the simhammer.com Blizzard proxy and writes it
// to src/app/lib/realms.json, so the app bundles realms at build time instead of
// calling the API on every launch. Re-run when realms change:
//
//   npm run generate:realms
//
// The output is committed; builds use the committed copy (no network at build).
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SOURCE = 'https://simhammer.com/api/blizzard/realms';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'lib', 'realms.json');

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`Failed to fetch realms: ${res.status}`);
const data = await res.json();

const regions = data?.regions ?? {};
const counts = Object.entries(regions)
  .map(([r, list]) => `${r}:${list.length}`)
  .join(' ');

await writeFile(OUT, JSON.stringify(data, null, 2) + '\n');
console.log(`Wrote ${OUT} (${counts})`);
