const notices = [
  ['Animal Island UI', 'animal-island-ui', 'MIT · Copyright © 2026 guokaigdg'],
  ['Naive Icons', 'naive-icons', 'MIT'],
  ['classnames', 'classnames', 'MIT'],
  ['Day.js', 'dayjs', 'MIT'],
  ['Nunito', 'nunito', 'SIL Open Font License 1.1'],
  ['Noto Sans SC', 'noto-sans-sc', 'SIL Open Font License 1.1'],
] as const;

export default function LicensesPage() {
  return <main style={{ minHeight: '100dvh', padding: '2rem max(1.25rem, calc((100vw - 760px) / 2))',
    background: '#f6f3e7', color: '#293b30', lineHeight: 1.65 }}>
    <a href="/">← Find My Shelter</a>
    <h1>오픈소스 라이선스</h1>
    <p>아래는 메인 화면의 Animal Island UI와 함께 제공되는 코드 및 글꼴의 라이선스입니다.</p>
    <p><a href="https://github.com/guokaigdg/animal-island-ui">Animal Island UI 소스 ↗</a></p>
    <ul>{notices.map(([name, path, notice]) => <li key={path}>
      <strong>{name}</strong> · {notice} · <a href={`/licenses/${path}.txt`}>전체 라이선스 원문</a>
    </li>)}</ul>
  </main>;
}
