import type { Metadata } from 'next';
import './opo.css';

export const metadata: Metadata = {
  title: 'Find My Shelter · 나의 작은 세계를 발견하는 지도',
  description: '임장구역을 검색하고 실제 건물·DEM·도로 위에서 나의 보금자리를 탐험합니다.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
