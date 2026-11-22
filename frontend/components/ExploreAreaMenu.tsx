import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { tourMapAreas, type TourMapArea } from './VillageMap';

const areaGroups = new Map<string, TourMapArea[]>();
for (const area of tourMapAreas) {
  const [group] = area.name.split(' ', 1);
  const areas = areaGroups.get(group) ?? [];
  areas.push(area);
  areaGroups.set(group, areas);
}

export default function ExploreAreaMenu({ current, onSelect }: {
  current: TourMapArea;
  onSelect: (area: TourMapArea) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    activeOption.current?.focus();

    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [open]);

  function closeAndFocus() {
    setOpen(false);
    trigger.current?.focus();
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (!open && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    if (!open) {
      setOpen(true);
      return;
    }
    const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.explore-area-option'));
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Home') options[0]?.focus();
    else if (event.key === 'End') options.at(-1)?.focus();
    else {
      const shift = event.key === 'ArrowDown' ? 1 : -1;
      options[(index + shift + options.length) % options.length]?.focus();
    }
  }

  return <div className="explore-area-menu" ref={root} onKeyDown={navigate}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" ref={trigger} className="explore-area-trigger" aria-expanded={open}
      aria-controls="explore-area-options" aria-label={`탐험 지역 ${current.name}`}
      onClick={() => setOpen(value => !value)}>
      <svg viewBox="0 0 24 24" className="explore-area-pin" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M19 10c0 4.4-7 10-7 10s-7-5.6-7-10a7 7 0 1 1 14 0Z" />
        <circle cx="12" cy="10" r="2.2" />
      </svg>
      <span>{current.name}</span>
      <svg viewBox="0 0 12 12" className="explore-area-chevron" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="m2 4 4 4 4-4" />
      </svg>
    </button>
    <div id="explore-area-options" className="explore-area-options" hidden={!open}>
      {[...areaGroups].map(([group, areas]) => <div key={group} role="group" aria-label={group} className="explore-area-group">
        <p aria-hidden="true">{group}</p>
        {areas.map(area => {
          const selected = area.id === current.id;
          return <button key={area.id} ref={selected ? activeOption : undefined} type="button" className="explore-area-option"
            aria-current={selected || undefined} onClick={() => { onSelect(area); closeAndFocus(); }}>
            {area.name.slice(group.length).trim().replace(/^·\s*/, '')}
            {selected && <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="m3 8 3 3 7-7" />
            </svg>}
          </button>;
        })}
      </div>)}
    </div>
  </div>;
}
