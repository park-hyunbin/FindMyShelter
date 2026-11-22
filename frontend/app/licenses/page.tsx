const notices = [
  ['Animal Island UI', 'animal-island-ui', 'MIT · Copyright © 2026 guokaigdg'],
  ['Naive Icons', 'naive-icons', 'MIT'],
  ['classnames', 'classnames', 'MIT'],
  ['Day.js', 'dayjs', 'MIT'],
  ['Nunito', 'nunito', 'SIL Open Font License 1.1'],
  ['Noto Sans SC', 'noto-sans-sc', 'SIL Open Font License 1.1'],
  ['카페24 동동', 'cafe24-dongdong', 'SIL Open Font License 1.1 · Copyright © Cafe24 Corp.'],
  ['갈무리 11 Bold', 'galmuri', 'SIL Open Font License 1.1 · Copyright © 2019–2025 Lee Minseo'],
] as const;

export default function LicensesPage() {
  return <main style={{ minHeight: '100dvh', padding: '2rem max(1.25rem, calc((100vw - 760px) / 2))',
    background: 'var(--cream)', color: 'var(--ink)', lineHeight: 1.65 }}>
    <a href="/">← Find My Shelter</a>
    <h1>오픈소스 라이선스</h1>
    <p>아래는 서비스에 포함된 코드, 글꼴, 3D 애니메이션의 라이선스입니다.</p>
    <p><a href="https://github.com/guokaigdg/animal-island-ui">Animal Island UI 소스 ↗</a></p>
    <ul>{notices.map(([name, path, notice]) => <li key={path}>
      <strong>{name}</strong> · {notice} · <a href={`/licenses/${path}.txt`}>전체 라이선스 원문</a>
    </li>)}</ul>
    <p><strong>KayKit Adventurers Character Pack</strong> · Kay Lousberg · CC0 1.0 Universal<br />
      탐험 캐릭터에 Idle과 Walking_A 모션을 적용했습니다.{' '}
      <a href="https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0">제작자 원본</a>
      {' · '}<a href="/licenses/kaykit-tour-avatar.txt">에셋 출처 및 라이선스</a>
    </p>
    <p><strong>노란 인형 임장 안내원</strong><br />
      제공된 캐릭터 파츠 시트를 바탕으로 안내원 모델과 정지 모션을 제작했습니다.
    </p>
    <p><strong>동네 주민</strong><br />
      제공된 주민 시트의 완성 모습과 교체 의상을 바탕으로 제작했습니다.
    </p>
  </main>;
}
