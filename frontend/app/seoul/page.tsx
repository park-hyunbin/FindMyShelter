import type { Metadata } from 'next';
import ShelterHome from '../../components/ShelterHome';

export const metadata: Metadata = {
  title: '서울 아파트 임장 목록 · Find My Shelter',
  description: '서울의 아파트를 구와 단지명으로 찾고, 3D 임장과 경로 자료가 준비된 곳을 확인하세요.',
};

export default function SeoulPage() {
  return <ShelterHome initialQuery="서울" />;
}
