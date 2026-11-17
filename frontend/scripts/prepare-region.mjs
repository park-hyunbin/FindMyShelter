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
for (const [script, output] of [['prepare-neighborhood.mjs', 'environment.geojson'], ['prepare-opo-terrain.mjs','terrain.json']]) {
  let exists = false;
  try { await access(new URL(`public/datasets/regions/${region}/${output}`, root)); exists = true; } catch {}
  if (exists && !force) { console.log(`Reuse ${region}/${output}; --refresh to rebuild`); continue; }
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
console.log(`${region}: building, road and DEM assets ready. Add the region to components/data/regions.ts after QA.`);
