import { Button } from 'animal-island-ui';
import type { RegionId } from './data/regions';

type Village = { id: RegionId; name: string; district: string; note?: string };

export default function VillageMap({ villages, selected, onSelect }: {
  villages: Village[];
  selected: RegionId;
  onSelect: (id: RegionId) => void;
}) {
  const mapVillages = villages.filter(village => !village.id.startsWith('seoul-a'));
  const catalogVillages = villages.filter(village => village.id.startsWith('seoul-a'));
  return <div className="village-map-and-list">
    {mapVillages.length > 0 && <div className="village-map">
    <svg className="village-landscape" viewBox="0 0 700 400" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <pattern id="map-paper" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1" fill="#6c8b4a" opacity=".18" />
        </pattern>
        <g id="map-pine">
          <ellipse cy="12" rx="12" ry="4" fill="#789671" opacity=".23" />
          <path d="M-2 3h4v10h-4z" fill="#997958" />
          <path d="M0-24 9-7 6-7 13 5H-13l7-12h-3z" fill="#729468" />
          <path d="M0-24 1 5h-14l7-12h-3z" fill="#8eaf7d" />
        </g>
        <g id="map-tree">
          <ellipse cy="10" rx="11" ry="4" fill="#789671" opacity=".25" />
          <path d="M-2-3h4v14h-4z" fill="#aa8664" />
          <path d="M-12-6a12 10 0 1 1 24 0 12 9 0 1 1-24 0" fill="#7ea576" />
          <path d="M-12-6a10 9 0 0 1 20-4c-1 8-8 11-19 8z" fill="#9aba8d" />
        </g>
      </defs>
      <rect width="700" height="400" fill="#e8ecd2" />
      <rect width="700" height="400" fill="url(#map-paper)" />
      <path d="M-20 90C87 21 171 9 230 65c38 40 23 88-47 109C87 204 43 172-20 230Z" fill="#c9d7a9" />
      <path d="M-10 120c110-50 158-76 200-53 48 25 33 59-15 77-68 24-139 13-190 52" fill="none" stroke="#a4bb80" strokeWidth="2" />
      <path d="M-10 147c133-67 180-66 195-48 18 19 1 36-64 42-51 4-91 18-132 47" fill="none" stroke="#adbf88" strokeWidth="2" />
      <path d="M356-12c-70 62-80 110-54 175s81 114 123 251h78c-40-124-98-177-123-238-24-63-11-113 45-188Z" fill="#a7c9bb" />
      <path d="M387-12c-58 65-63 120-37 181s77 124 117 243" stroke="#cde2d3" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M445 398c-40-114-95-166-124-227-29-63-11-116 41-178" stroke="#91b8ab" strokeWidth="2" fill="none" opacity=".65" />
      <path d="M704 307c-46-49-123-62-180-21-43 31-18 64-6 126h186Z" fill="#c8d6ad" />
      <path d="M35 318c81-15 113-69 165-98 51-28 97-18 143-22 74-6 87-53 168-52 72 1 116 37 186 23" stroke="#c0ab82" strokeWidth="18" fill="none" strokeLinecap="round" />
      <path d="M35 318c81-15 113-69 165-98 51-28 97-18 143-22 74-6 87-53 168-52 72 1 116 37 186 23" stroke="#fff2cc" strokeWidth="13" fill="none" strokeLinecap="round" />
      <path d="M35 318c81-15 113-69 165-98 51-28 97-18 143-22 74-6 87-53 168-52 72 1 116 37 186 23" stroke="#c6a877" strokeWidth="1.7" strokeDasharray="4 12" fill="none" strokeLinecap="round" />
      <g transform="translate(79 63)"><use href="#map-pine" /><use href="#map-pine" x="29" y="12" /><use href="#map-tree" x="66" y="-3" /></g>
      <g transform="translate(602 263)"><use href="#map-tree" /><use href="#map-tree" x="28" y="-15" /><use href="#map-pine" x="51" y="10" /></g>
      <g transform="translate(220 332)"><use href="#map-tree" /><use href="#map-tree" x="22" y="12" /></g>
      <g transform="translate(526 93)"><use href="#map-tree" /><use href="#map-pine" x="75" y="12" /></g>
      <g fill="#d5a470">
        <path d="m54 246 3 4 4-3-3 5 3 3-5-1-3 4v-5l-5-2 5-1z" />
        <path d="m267 292 3 5 5-3-3 4 3 5-5-2-3 3v-5l-4-1 4-2z" />
        <path d="m576 345 3 5 5-3-3 4 3 5-5-2-3 3v-5l-4-1 4-2z" />
      </g>
    </svg>
    <span className="village-map-label">동네 탐험 지도</span>
    <div className="village-pins" role="group" aria-label="지도에서 단지 선택">
      {mapVillages.map((village, index) => <div key={village.id} className={`village-stop village-stop-${village.id}`}>
        <span className="village-stop-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <Button className="village-pin" aria-pressed={selected === village.id} aria-controls="village-details"
          onClick={() => onSelect(village.id)} aria-label={`${village.name} 단지 선택`}>
          <span className="village-pin-district">{village.district}</span>
          <strong>{village.name}</strong>
          {village.note && <span className="village-pin-note">{village.note}</span>}
        </Button>
      </div>)}
    </div>
    <span className="village-map-caption">탐험용 그림 · 실제 위치와 거리는 달라요</span>
    </div>}
    {catalogVillages.length > 0 && <div className="village-catalog" role="group" aria-label="서울 단지 선택">
      {catalogVillages.map(village => <Button key={village.id} className="village-pin" aria-pressed={selected === village.id}
        aria-controls="village-details" onClick={() => onSelect(village.id)} aria-label={`${village.name} 단지 선택`}>
        <span className="village-pin-district">{village.district}</span><strong>{village.name}</strong>
        {village.note && <span className="village-pin-note">{village.note}</span>}
      </Button>)}
    </div>}
  </div>;
}
