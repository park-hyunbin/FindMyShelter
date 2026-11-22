import snapshot from '../../public/datasets/schools/campuses.json';
import type { Point, Shape } from '../opo-data';

export const schoolStyles = {
  elementary: { label: '초등학교', mark: '초', wall: '#e7c9a8', glass: '#6d99a5', trim: '#fbecd4', roof: '#ad674d' },
  middle: { label: '중학교', mark: '중', wall: '#d6d7b5', glass: '#678d91', trim: '#f4ebd5', roof: '#73866d' },
  high: { label: '고등학교', mark: '고', wall: '#dbcbbd', glass: '#758da7', trim: '#f5ebdd', roof: '#757d95' },
} as const;

export type SchoolLevel = keyof typeof schoolStyles;
export type SchoolCampus = {
  id: number;
  name: string;
  level: SchoolLevel;
  anchor: Point;
  outline: Shape;
  field: { center: Point; outline: Shape; radiusM: number; sport: string | null; surface: string | null } | null;
};

export function schoolLevel(name: string): SchoolLevel | undefined {
  const normalized = name.replace(/\s/g, '');
  if (/초등(?:학)?교$/.test(normalized)) return 'elementary';
  if (/중학교$/.test(normalized)) return 'middle';
  if (/고등학교$/.test(normalized) && !/중[·ㆍ]?고등학교$/.test(normalized)) return 'high';
}

export function projectSchoolCampuses(project: (coordinate: number[]) => Point, origin: Point, worldExtent: number): SchoolCampus[] {
  const outline = (rings: number[][][]) => rings.map(ring => ring.slice(0, -1).map(project));
  return snapshot.campuses.flatMap(campus => {
    const level = schoolLevel(campus.name);
    const anchor = project(campus.anchor);
    if (!level || Math.hypot(anchor.x - origin.x, anchor.z - origin.z) > 950) return [];
    const boundary = outline(campus.rings);
    if (boundary[0].some(({ x, z }) => Math.abs(x) > worldExtent || Math.abs(z) > worldExtent)) return [];
    const field = campus.field && {
      center: project(campus.field.center),
      outline: outline(campus.field.rings),
      radiusM: campus.field.radiusM,
      sport: campus.field.sport,
      surface: campus.field.surface,
    };
    return [{ id: campus.id, name: campus.name, level, anchor, outline: boundary, field }];
  });
}
