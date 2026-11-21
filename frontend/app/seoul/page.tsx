import type { Metadata } from 'next';
import SeoulCatalog from './SeoulCatalog';
import './seoul.css';

export const metadata: Metadata = {
  title: '서울 아파트 임장 목록 · Find My Shelter',
  description: '서울의 아파트를 구와 단지명으로 찾고, 3D 임장과 경로 자료가 준비된 곳을 확인하세요.',
};

export default function SeoulPage() {
  return <main className="seoul-catalog">
    <header className="seoul-catalog-header">
      <a href="/">Find My Shelter</a>
    </header>
    <h1>서울 아파트 임장 목록</h1>
    <p className="seoul-catalog-intro">단지를 찾아보고 3D 장면과 보행 경로가 준비된 곳에 들어가 보세요.</p>
    <SeoulCatalog />
  </main>;
}
