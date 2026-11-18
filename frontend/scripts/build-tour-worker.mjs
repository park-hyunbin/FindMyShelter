import { cp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const frontend = new URL('../', import.meta.url);
const dist = new URL('dist/', frontend);
await mkdir(new URL('server/', dist), { recursive: true });
await mkdir(new URL('.openai/', dist), { recursive: true });
const client = new URL('client/', dist);
await mkdir(client, { recursive: true });
if (await realpath(client) !== join(await realpath(frontend), 'dist', 'client')) {
  throw new Error('Generated browser assets must stay inside frontend/dist/client.');
}
await rm(client, { recursive: true, force: true });
await cp(new URL('out/', frontend), client, { recursive: true });
for (const file of ['index.mjs', 'tour-protocol.mjs']) {
  await cp(new URL(`worker/${file}`, frontend), new URL(`server/${file === 'index.mjs' ? 'index.js' : file}`, dist));
}
await cp(new URL('.openai/hosting.json', frontend), new URL('.openai/hosting.json', dist));
await writeFile(new URL('server/wrangler.json', dist), JSON.stringify({
  name: 'find-my-shelter',
  main: './index.js',
  compatibility_date: '2026-05-15',
  assets: { directory: '../client', binding: 'ASSETS', html_handling: 'force-trailing-slash' },
  d1_databases: [{ binding: 'DB', database_name: 'shelter-tour', database_id: '00000000-0000-4000-8000-000000000000' }],
}, null, 2));
