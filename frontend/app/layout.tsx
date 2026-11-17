import type { Metadata } from 'next';
import './opo.css';

export const metadata: Metadata = {
  title: 'Find My Shelter · 오포 3D 임장',
  description: '오포 롯데캐슬 포레스트와 주변 자연환경을 둘러보고 두 지점의 실외 일조를 비교합니다.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
