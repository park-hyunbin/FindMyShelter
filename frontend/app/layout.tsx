import type { Metadata } from 'next';
import './opo.css';

export const metadata: Metadata = {
  title: 'Find My Shelter · 3D 온라인 임장',
  description: '실제 지형을 따라 동네를 걷고, 단지와 주변 자연환경의 일조·시야를 살펴보세요.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
