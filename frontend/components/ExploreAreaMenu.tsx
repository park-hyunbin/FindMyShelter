import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { tourMapAreas, type TourMapArea } from './VillageMap';

const storageKey = 'find-my-shelter:recent-regions';
const areasById = new Map(tourMapAreas.map(area => [area.id, area]));
const recommendations = ['opo', 'songpa'];
const compact = (value: string) => value.normalize('NFC').replace(/\s+/g, '').toLowerCase();

function highlight(text: string, terms: string[]) {
  if (!terms.length) return text;
  const pattern = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pieces = text.split(new RegExp(`(${pattern})`, 'i'));
  return pieces.map((piece, index) => index % 2 ? <mark key={index}>{piece}</mark> : piece);
}

export default function ExploreAreaMenu({ current, onSelect }: {
  current: TourMapArea;
  onSelect: (area: TourMapArea) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const panelId = baseId + '-panel';
  const listId = baseId + '-list';
  const terms = query.normalize('NFC').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = tourMapAreas.filter(area => terms.every(term =>
    [area.name, area.label, area.group, ...area.aliases].some(value => compact(value).includes(term))));
  const featured = [...new Set([...recent, ...recommendations])];
  const group = (label: string, ids: string[]) => ({
    label, areas: ids.flatMap(id => { const area = areasById.get(id); return area ? [area] : []; }),
  });
  const sections = terms.length ? [{ label: '검색 결과', areas: matches }] : [
    group('최근 선택', recent),
    group('추천 탐험 지역', recommendations.filter(id => !recent.includes(id))),
    { label: '지원 지역', areas: tourMapAreas.filter(area => !featured.includes(area.id)) },
  ];
  const options = sections.flatMap(section => section.areas);
  const optionId = (id: string) => `${baseId}-region-${id}`;

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [open]);

  function show() {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      if (Array.isArray(stored)) setRecent([...new Set(stored.filter((id): id is string =>
        typeof id === 'string' && areasById.has(id)))].slice(0, 3));
    } catch { /* The selector still works without browser storage. */ }
    setQuery('');
    setActiveId(null);
    setOpen(true);
  }

  function closeAndFocus() {
    setOpen(false);
    trigger.current?.focus();
  }

  function choose(area: TourMapArea) {
    const next = [area.id, ...recent.filter(id => id !== area.id)].slice(0, 3);
    setRecent(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Optional persistence. */ }
    onSelect(area);
    closeAndFocus();
  }

  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const index = options.findIndex(area => area.id === activeId);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[index] ?? (terms.length ? options[0] : undefined);
      if (option) choose(option);
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && options.length) {
      event.preventDefault();
      const nextIndex = index < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1)
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      const next = options[nextIndex].id;
      setActiveId(next);
      document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' });
    }
  }

  return <div className="explore-area-menu" ref={root}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" ref={trigger} className="explore-area-trigger" aria-expanded={open}
      aria-controls={panelId} aria-label={`탐험 지역 ${current.name}`}
      onClick={() => open ? setOpen(false) : show()}
      onKeyDown={event => { if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); show(); } }}>
      <svg viewBox="0 0 24 24" className="explore-area-pin" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M19 10c0 4.4-7 10-7 10s-7-5.6-7-10a7 7 0 1 1 14 0Z" />
        <circle cx="12" cy="10" r="2.2" />
      </svg>
      <span>{current.name}</span>
      <svg viewBox="0 0 12 12" className="explore-area-chevron" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="m2 4 4 4 4-4" />
      </svg>
    </button>
    <div id={panelId} className="explore-area-options" hidden={!open}>
      {open && <>
        <label className="explore-area-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" />
          </svg>
          <input ref={input} role="combobox" aria-label="탐험 지역 검색" aria-expanded="true"
            aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={activeId ? optionId(activeId) : undefined}
            autoComplete="off" placeholder="송파, 잠실, 경기 광주, 신현…"
            value={query} onChange={event => { setQuery(event.target.value); setActiveId(null); }} onKeyDown={navigate} />
        </label>
        <div id={listId} role="listbox" aria-label="지원 탐험 지역" className="explore-area-results">
          {sections.filter(section => section.areas.length > 0).map(({ label, areas }) =>
            <div key={label} role="group" aria-label={label} className="explore-area-group">
              <p aria-hidden="true">{label}</p>
              {areas.map(area => <div key={area.id} id={optionId(area.id)} role="option"
                className="explore-area-option" aria-selected={activeId === area.id || (!activeId && current.id === area.id)}
                data-current={current.id === area.id || undefined} data-active={activeId === area.id || undefined}
                onMouseDown={event => event.preventDefault()} onClick={() => choose(area)}>
                <span><small>{highlight(area.group, terms)}</small><strong>{highlight(area.label, terms)}</strong></span>
                {area.id === current.id && <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path d="m3 8 3 3 7-7" />
                </svg>}
              </div>)}
            </div>)}
        </div>
        {options.length === 0 && <p className="explore-area-empty" role="status">지원하는 지역이 없어요.</p>}
      </>}
    </div>
  </div>;
}
