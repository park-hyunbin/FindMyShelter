'use client';

import { useEffect, useState } from 'react';
import { evidenceLabels, songpaChecklist, type ChecklistView } from './data/songpa-checklist';
import { songpaComplex } from './data/regions';

const storageKey = 'find-my-shelter:visit-checklist:A13816002:v1';
const statusLabels = { pending: '아직 안 봄', reviewed: '살펴봄', visit: '현장에서 볼 것' };
type Status = keyof typeof statusLabels;
type RecordEntry = { status: Status; note: string };
type VisitRecords = Partial<Record<string, RecordEntry>>;
const emptyEntry: RecordEntry = { status: 'pending', note: '' };
const checks = songpaChecklist.flatMap(group => group.checks);
const noteLimit = 700;

function readRecords(): VisitRecords {
  try {
    const records: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}');
    if (!records || typeof records !== 'object' || Array.isArray(records)) return {};

    const saved: VisitRecords = {};
    for (const { id } of checks) {
      const entry = (records as Record<string, unknown>)[id];
      if (!entry || typeof entry !== 'object' || !('status' in entry) || !('note' in entry)) continue;
      if (typeof entry.note !== 'string') continue;
      const status = entry.status;
      if (status !== 'pending' && status !== 'reviewed' && status !== 'visit') continue;
      saved[id] = { status, note: entry.note.slice(0, noteLimit) };
    }
    return saved;
  } catch {
    return {};
  }
}

function hasRecord(entry: RecordEntry | undefined) {
  return Boolean(entry && (entry.status !== 'pending' || entry.note.trim()));
}

export default function SongpaChecklist({ onView, sceneReady }: {
  onView: (view: ChecklistView) => void;
  sceneReady: boolean;
}) {
  const [records, setRecords] = useState(readRecords);
  const [storageUnavailable, setStorageUnavailable] = useState(false);

  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key === storageKey || event.key === null) setRecords(readRecords());
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  function update(id: string, change: Partial<RecordEntry>) {
    const recent = storageUnavailable ? records : readRecords();
    const updated = { ...recent, [id]: { ...emptyEntry, ...recent[id], ...change } };
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(updated));
      setStorageUnavailable(false);
    } catch {
      setStorageUnavailable(true);
    }
    setRecords(updated);
  }

  function download() {
    const lines = [`${songpaComplex.name} 임장 체크리스트`, songpaComplex.address];
    for (const group of songpaChecklist) {
      lines.push('', group.title);
      for (const check of group.checks) {
        const entry = records[check.id] ?? emptyEntry;
        lines.push(`[${statusLabels[entry.status]}] ${check.title}`, check.finding);
        if (check.followUp) lines.push(`현장에서 확인 · ${check.followUp}`);
        if (entry.note.trim()) lines.push(`내 메모 · ${entry.note.trim()}`);
      }
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = '가락동부센트레빌-임장-체크리스트.txt';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const count = checks.filter(check => hasRecord(records[check.id])).length;

  return <section className="visit-checklist" aria-label="가락동부센트레빌 임장 체크리스트">
    <div className="checklist-progress">
      <span>{count}/{checks.length}개 항목에 기록</span>
      <button type="button" onClick={download}>체크리스트 받기</button>
    </div>
    {storageUnavailable && <p role="status">이 브라우저에서 저장할 수 없어요. 화면을 떠나기 전에 파일을 받아 주세요.</p>}
    {!storageUnavailable && <p className="checklist-save-note">기록은 이 브라우저에 저장돼요.</p>}
    {songpaChecklist.map(group => <section key={group.title} className="checklist-group">
      <h3>{group.title}</h3>
      {group.checks.map(check => {
        const entry = records[check.id] ?? emptyEntry;
        return <details key={check.id} className="checklist-item">
          <summary>
            <span>{check.title}</span>
            <small data-evidence={check.evidence}>{evidenceLabels[check.evidence]}</small>
            {hasRecord(entry) && <span className="checklist-mark" aria-label="기록 있음">✓</span>}
          </summary>
          <div className="checklist-content">
            <p>{check.finding}</p>
            {check.followUp && <p className="checklist-followup">{check.followUp}</p>}
            {check.views && <div className="checklist-views">
              {check.views.map(view => <button key={view.target} type="button" disabled={!sceneReady}
                onClick={() => onView(view.target)}>{view.label}</button>)}
            </div>}
            {check.sources && <ul className="checklist-sources">
              {check.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a></li>)}
            </ul>}
            <label className="checklist-field">
              <span>내 확인 상태</span>
              <select aria-label={`${check.title} 확인 상태`} value={entry.status}
                onChange={event => update(check.id, { status: event.target.value as Status })}>
                <option value="pending">{statusLabels.pending}</option>
                <option value="reviewed">{statusLabels.reviewed}</option>
                <option value="visit">{statusLabels.visit}</option>
              </select>
            </label>
            <label className="checklist-field">
              <span>내 임장 메모</span>
              <textarea aria-label={`${check.title} 임장 메모`} rows={2} maxLength={noteLimit} value={entry.note}
                onChange={event => update(check.id, { note: event.target.value })} />
            </label>
          </div>
        </details>;
      })}
    </section>)}
  </section>;
}
