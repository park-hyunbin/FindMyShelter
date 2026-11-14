import type { Metadata } from 'next';
import './globals.css';
import './brand-theme.css';
export const metadata: Metadata = {title:'Find My Shelter · 실제 GIS 데이터 샘플',description:'사용자 제공 광주시 건물 도형을 이용한 데이터 연결 샘플.'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="ko"><body>{children}</body></html>}
