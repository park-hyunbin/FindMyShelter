import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [region, windowDirectory, snapshot] = process.argv.slice(2);
if (!/^seoul-a\d{8}$/.test(region ?? '') || !windowDirectory || !snapshot) {
  throw new Error('Use <seoul-a… region> <building window directory> <OSM snapshot.json>');
}
const input = pathToFileURL(`${resolve(windowDirectory)}/`);
const assets = new URL(`../public/datasets/buildings/${region}/`, import.meta.url);
const sceneFiles = new URL(`../public/datasets/regions/${region}/`, import.meta.url);
const registry = new URL('../components/data/seoul-scenes.generated.json', import.meta.url);
const read = async file => JSON.parse(await readFile(file, 'utf8'));
const profile = await read(new URL(`../../data/config/buildings/${region}.json`, import.meta.url));
const manifest = await read(new URL('web/manifest.json', input));
const inputConfig = await read(new URL('config.json', input));
if (!profile.catalog || inputConfig.region !== region || manifest.region !== region || profile.kapt_code !== inputConfig.kapt_code) {
  throw new Error('The region and its prepared building window do not match');
}
const registered = new Map();
await mkdir(new URL('chunks/', assets), { recursive: true });
for (const chunk of manifest.chunks) {
  const source = new URL(`web/${chunk.url}`, input);
  const content = await readFile(source);
  if (!/^chunks\/[a-f0-9]{64}\.geojson$/.test(chunk.url) ||
      createHash('sha256').update(content).digest('hex') !== chunk.sha256) {
    throw new Error('The prepared building chunk failed integrity verification');
  }
  await copyFile(source, new URL(chunk.url, assets));
}
const sourceGeometry = await read(new URL('buildings.geojson', input));
for (const feature of sourceGeometry.features) {
  const row = feature.properties;
  if (row.kaptCode === inputConfig.kapt_code && row.dong) registered.set(row.id, `${row.dong}동`);
}
if (registered.size !== profile.catalog.towerCount) throw new Error('An apartment tower is missing from the building window');

// Published provenance names the source, without embedding the local checkout path.
manifest.quality.source = manifest.quality.provenance.footprintSource;
delete manifest.version;
manifest.version = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
await writeFile(new URL('manifest.json', assets), `${JSON.stringify(manifest)}\n`);

function run(name, ...args) {
  return new Promise((resolveRun, reject) => {
    const script = fileURLToPath(new URL(name, import.meta.url));
    const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolveRun() : reject(new Error(`${name} exited with ${code}`)));
  });
}

await run('prepare-opo-streets.mjs', '--region', region, resolve(snapshot));
await run('prepare-region.mjs', '--region', region);

const graph = await read(new URL('streets.json', sceneFiles));
const [lng, lat] = manifest.metadata.center_lnglat;
const cos = Math.cos(lat * Math.PI / 180);
const candidates = graph.roads.filter(road => road.motor && !road.bridge && road.name === profile.catalog.roadName);
let start;
for (const road of candidates) for (let i = 1; i < road.coordinates.length; i++) {
  const [ax, ay] = road.coordinates[i - 1];
  const [bx, by] = road.coordinates[i];
  const dx = (bx - ax) * cos, dy = by - ay;
  const length2 = dx * dx + dy * dy;
  if (!length2) continue;
  const t = Math.max(0, Math.min(1, (((lng - ax) * cos) * dx + (lat - ay) * dy) / length2));
  const point = [ax + (bx - ax) * t, ay + dy * t];
  const distance = Math.hypot((point[0] - lng) * cos, point[1] - lat) * 111200;
  if (!start || distance < start.distance) start = { point, distance };
}
if (!start || start.distance > manifest.metadata.radius_m) throw new Error('No primary street for this complex within the model');

const entries = await read(registry).catch(error => {
  if (error.code === 'ENOENT') return [];
  throw error;
});
const entry = {
  id: region, ...profile.catalog, kaptCode: inputConfig.kapt_code,
  count: manifest.count, radius: manifest.metadata.radius_m, roadside: start.point, lookAt: [lng, lat],
  towers: Object.fromEntries(registered),
  layers: await Promise.all(['pavement.json', 'road-markings.json', 'pedestrian-signals.json'].map(async file => {
    try {
      await access(new URL(file, sceneFiles));
      return file;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  })).then(results => results.filter(Boolean)),
  outlineSource: manifest.quality.provenance.footprintSource,
  registerSource: manifest.quality.provenance.registerSource,
};
const catalog = [...entries.filter(previous => previous.id !== region), entry].sort((a, b) => a.id.localeCompare(b.id));
const temporary = new URL(`${registry.href}.tmp`);
await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`);
await rename(temporary, registry);
console.log(`${entry.name}: ${registered.size} towers, ${entry.count} buildings, ${Math.round(start.distance)}m from centre to initial street`);
