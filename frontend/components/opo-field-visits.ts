import { useEffect, useRef, useState } from 'react';
import type { FloodView } from './data/songpa-flood';

const storageKey = 'find-my-shelter:field-visits:A13816002:v1';
export const fieldVisitNoteLimit = 700;

export type FieldScene =
  | { kind: 'winter'; pointId: string; date: string; minute: number }
  | { kind: 'home'; routeId: string; stopId: string }
  | { kind: 'school-gate'; routeId: string }
  | { kind: 'drainage'; stopId: string; view: FloodView; year: string }
  | { kind: 'facade'; viewId: string };

export type FieldVisit = {
  scene: FieldScene;
  place: string;
  finding: string;
  plannedAt: string;
  note: string;
};

type VisitDraft = Pick<FieldVisit, 'scene' | 'place' | 'finding'> & { note?: string };
type VisitChange = Partial<Pick<FieldVisit, 'plannedAt' | 'note'>>;

export function fieldSceneId(scene: FieldScene) {
  switch (scene.kind) {
    case 'winter': return `winter:${scene.pointId}:${scene.date}:${scene.minute}`;
    case 'home': return `home:${scene.routeId}:${scene.stopId}`;
    case 'school-gate': return `school-gate:${scene.routeId}`;
    case 'drainage': return `drainage:${scene.stopId}:${scene.view}:${scene.year}`;
    case 'facade': return `facade:${scene.viewId}`;
  }
}

function dateValue(value: unknown, includeTime = false): value is string {
  if (typeof value !== 'string' || !(includeTime ? /^\d{4}-\d\d-\d\dT\d\d:\d\d$/ : /^\d{4}-\d\d-\d\d$/).test(value)) return false;
  const timestamp = Date.parse(includeTime ? `${value}:00Z` : `${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().startsWith(value);
}

function validScene(value: unknown): value is FieldScene {
  if (!value || typeof value !== 'object') return false;
  const scene = value as Partial<FieldScene>;
  if (scene.kind === 'winter') {
    return typeof scene.pointId === 'string' && dateValue(scene.date) && typeof scene.minute === 'number'
      && Number.isInteger(scene.minute) && scene.minute >= 0 && scene.minute < 1440;
  }
  if (scene.kind === 'facade') return typeof scene.viewId === 'string' && scene.viewId.length > 0;
  if (scene.kind === 'school-gate') return typeof scene.routeId === 'string' && scene.routeId.length > 0;
  if (scene.kind === 'drainage') return typeof scene.stopId === 'string' && typeof scene.view === 'string'
    && ['closest', 'area', 'forecast', 'slope', 'pond', 'river'].includes(scene.view)
    && typeof scene.year === 'string' && /^20\d{2}$/.test(scene.year);
  return scene.kind === 'home' && typeof scene.routeId === 'string' && typeof scene.stopId === 'string';
}

function readVisits() {
  let raw;
  try { raw = window.localStorage.getItem(storageKey); } catch { return null; }
  let result: unknown;
  try { result = JSON.parse(raw ?? '[]'); } catch { return []; }
  if (!Array.isArray(result)) return [];

  const visits = new Map<string, FieldVisit>();
  for (const item of result) {
    if (!item || typeof item !== 'object') continue;
    const { scene, place, finding, plannedAt, note } = item as Partial<FieldVisit>;
    if (!validScene(scene) || typeof place !== 'string' || typeof finding !== 'string') continue;
    visits.set(fieldSceneId(scene), {
      scene, place, finding, plannedAt: dateValue(plannedAt, true) ? plannedAt : '',
      note: typeof note === 'string' ? note.slice(0, fieldVisitNoteLimit) : '',
    });
  }
  return [...visits.values()];
}

export function useFieldVisits(enabled: boolean) {
  const [visits, setVisits] = useState<FieldVisit[]>(() => enabled ? readVisits() ?? [] : []);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const temporary = useRef<FieldVisit[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    function sync(event: StorageEvent) {
      if (event.key !== null && event.key !== storageKey) return;
      const latest = readVisits();
      if (latest && !temporary.current) setVisits(latest);
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [enabled]);

  function write(change: (current: FieldVisit[]) => FieldVisit[]) {
    const next = change(temporary.current ?? readVisits() ?? visits);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      temporary.current = null;
      setStorageUnavailable(false);
    } catch {
      temporary.current = next;
      setStorageUnavailable(true);
    }
    setVisits(next);
  }

  function save(draft: VisitDraft) {
    const id = fieldSceneId(draft.scene);
    write(current => current.some(visit => fieldSceneId(visit.scene) === id)
      ? current : [...current, { ...draft, plannedAt: '', note: draft.note?.slice(0, fieldVisitNoteLimit) ?? '' }]);
  }

  function update(scene: FieldScene, change: VisitChange) {
    const id = fieldSceneId(scene);
    write(current => current.map(visit => fieldSceneId(visit.scene) === id ? { ...visit, ...change } : visit));
  }

  function remove(scene: FieldScene) {
    const id = fieldSceneId(scene);
    write(current => current.filter(visit => fieldSceneId(visit.scene) !== id));
  }

  return { visits, save, update, remove, storageUnavailable };
}

export type FieldVisits = ReturnType<typeof useFieldVisits>;
