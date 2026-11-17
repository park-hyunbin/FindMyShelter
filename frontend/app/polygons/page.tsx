import PolygonPreview from '../../components/PolygonPreview';

export const metadata = {
  title: 'Find My Shelter · 지역별 건물 폴리곤 검증',
  description: '송파와 오포의 실제 건물 폴리곤·높이 누락을 확인하는 QGIS 데이터 검증 화면입니다.',
};

export default function Page() {
  return <PolygonPreview />;
}
