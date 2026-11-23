export default function ShelterNav() {
  return <header className="shelter-nav">
    <div className="shelter-nav-mark">
      <span><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9"
        strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5M5.5 9v11h13V9M10 20v-6h4v6" /></svg></span>
      Find My Shelter
    </div>
    <nav className="shelter-nav-links" aria-label="임장 화면 바로가기">
      <a href="#explore-neighborhoods">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" /></svg>
        동네 지도
      </a>
      <a href="#tour-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.75" /><path d="m15 15 5 5" /></svg>
        조건 검색
      </a>
      <a href="#tour-candidates">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></svg>
        단지 목록
      </a>
    </nav>
  </header>;
}
