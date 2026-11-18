import type { Metadata } from 'next';
import './opo.css';

export const metadata: Metadata = {
  title: 'Find My Shelter · 3D 온라인 임장',
  description: '매매 예산과 생활 조건으로 단지를 비교하고, 실제 지형을 따라 3D로 임장해 보세요.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
