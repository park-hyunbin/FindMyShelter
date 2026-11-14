import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'우리 집 작은 숲 · Feng Shui Lab',description:'집과 동네를 천천히 알아가는 작은 탐험. 풍수·GIS 서비스 디자인 시안.'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="ko"><body>{children}</body></html>}
