import { useEffect, useState } from 'react';

type Geometry = 'complete' | 'partial' | 'outline_pending' | 'register_pending';

export const geometryLabels: Record<Geometry, string> = {
  complete: '전 주동 윤곽 연결',
  partial: '일부 주동 윤곽 연결',
  outline_pending: '주동 윤곽 연결 대기',
  register_pending: '건축물대장 연결 대기',
};

type CatalogEntry = {
  kaptCode: string;
  district: string;
  name: string;
  address: string | null;
  geometry: Geometry;
  tour: { region: string; walkingRoutes: number; walkingRoutesWithElevation: number } | null;
};

type Catalog = {
  snapshotDate: string;
  registerMonth: string;
  footprintDate: string;
  complexes: CatalogEntry[];
};

export function useSeoulCatalog(enabled: boolean) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [catalogFailed, setCatalogFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const request = new AbortController();
    fetch('/datasets/seoul-tour-catalog.json', { signal: request.signal })
      .then(response => {
        if (!response.ok) throw new Error('Catalog request failed');
        return response.json() as Promise<Catalog>;
      })
      .then(setCatalog)
      .catch(() => { if (!request.signal.aborted) setCatalogFailed(true); });
    return () => request.abort();
  }, [enabled]);

  return { catalog, catalogFailed };
}
