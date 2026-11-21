// Offline regional environment builder. Run from any working directory.
// Buildings must pass the Python/QGIS pipeline first.
import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const region = process.argv[process.argv.indexOf('--region') + 1];
if (!process.argv.includes('--region') || !/^[a-z0-9_-]+$/.test(region)) throw new Error('Use --region <slug>');
const root = new URL('../', import.meta.url);
await access(new URL(`public/datasets/buildings/${region}/manifest.json`, root));
const force = process.argv.includes('--refresh');
const profile = await readFile(new URL(`../data/config/buildings/${region}.json`, root), 'utf8')
  .then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
const neighborhood = profile?.osm?.neighborhood;
if (neighborhood && !/^[a-z0-9-]+$/.test(neighborhood)) throw new Error('Invalid neighborhood ID');
for (const [script, output] of [['prepare-neighborhood.mjs', 'environment.geojson'], ['prepare-opo-terrain.mjs','terrain.json']]) {
  const shared = output === 'environment.geojson' && neighborhood;
  const directory = shared ? `neighborhoods/${neighborhood}` : `regions/${region}`;
  const asset = new URL(`public/datasets/${directory}/${output}`, root);
  const required = shared ? [asset, new URL('places.geojson', asset)] : [asset];
  const exists = await Promise.all(required.map(file => access(file).then(() => true, () => false)));
  if (exists.every(Boolean) && !force) {
    if (shared) {
      const prior = JSON.parse(await readFile(asset, 'utf8'));
      if (JSON.stringify(prior.metadata.bounds) !== JSON.stringify(profile.osm.bounds)) {
        throw new Error('Shared neighborhood bounds disagree; rebuild the neighborhood as a group');
      }
    }
    console.log(`Reuse ${directory}/${output}; --refresh to rebuild`);
    continue;
  }
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(`scripts/${script}`, root)), '--region', region],
      {cwd:fileURLToPath(root),stdio:'inherit'});
    child.on('error',reject); child.on('exit',code => code === 0 ? resolve() : reject(new Error(`${script}: exit ${code}`)));
  });
}
const read = async file => JSON.parse(await readFile(new URL(file, root),'utf8'));
const b = await read(`public/datasets/buildings/${region}/manifest.json`);
const t = await read(`public/datasets/regions/${region}/terrain.json`);
if (JSON.stringify(b.metadata.local_origin_xy) !== JSON.stringify(t.originEPSG5186)) throw new Error('Origin mismatch: refresh terrain after changing building region');
console.log(`${region}: building, road and DEM assets ready.`);
