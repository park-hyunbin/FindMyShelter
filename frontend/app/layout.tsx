import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './theme.css';
import './opo.css';

export const metadata: Metadata = {
  title: 'Find My Shelter · 3D 온라인 임장',
  description: '매매 예산과 생활 조건으로 단지를 비교하고, 실제 지형을 따라 3D로 임장해 보세요.',
};

const dongdong = localFont({
  src: './fonts/Cafe24Dongdong.ttf',
  variable: '--font-dongdong',
  weight: '400',
  display: 'swap',
  preload: false,
});

const galmuri = localFont({
  src: './fonts/Galmuri11-Bold.woff2',
  variable: '--font-galmuri',
  weight: '700',
  display: 'swap',
  preload: false,
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ko" className={`${dongdong.variable} ${galmuri.variable}`}><body>{children}</body></html>;
}
