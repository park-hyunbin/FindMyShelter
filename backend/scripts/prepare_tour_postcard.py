"""Draw a lightweight oblique illustration from existing tour geometry."""
import argparse
import json
import math
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'frontend/public'
PROJECT = Transformer.from_crs(4326, 5186, always_xy=True).transform
ANGLE = math.radians(32)


def read(path):
    return json.loads(path.read_text())


def geometry(feature):
    return transform(PROJECT, shape(feature['geometry']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--region', choices=['opo', 'songpa'], required=True)
    region = parser.parse_args().region
    tour = PUBLIC / 'datasets/regions' / region
    buildings = PUBLIC / 'datasets/buildings' / region
    site_file = PUBLIC / 'opo-site.geojson' if region == 'opo' else tour / 'site.geojson'
    environment_file = PUBLIC / 'opo-environment.geojson' if region == 'opo' else tour / 'environment.geojson'
    name = '오포 롯데캐슬 포레스트' if region == 'opo' else '가락동부센트레빌'
    site = geometry(next(feature for feature in read(site_file)['features']
                         if feature['properties']['kind'] == 'boundary'))
    origin = site.centroid
    window = site.buffer(53).envelope
    height_overrides = {row['outlineId']: row['heightM'] for row in read(PUBLIC / 'opo-building-register.json')['towers']
                        } if region == 'opo' else {row['legacyId']: None for row in
                                                   read(ROOT / 'frontend/components/data/songpa-towers.json')}
    towers = []
    for chunk in read(buildings / 'manifest.json')['chunks']:
        for item in read(buildings / chunk['url'])['features']:
            identity = item['properties']['id']
            if identity in height_overrides:
                towers.append((geometry(item), height_overrides[identity] or item['properties']['height_m']))
    if len(towers) != len(height_overrides):
        raise ValueError(f'{region} postcard requires all tour tower footprints')

    def depth(x, y):
        return -(x - origin.x) * math.sin(ANGLE) - (y - origin.y) * math.cos(ANGLE)

    def view(x, y, height=0):
        return (360 + 2.4 * ((x - origin.x) * math.cos(ANGLE) - (y - origin.y) * math.sin(ANGLE)),
                250 + 1.28 * depth(x, y) - 2.15 * height)

    def points(coords, height=0):
        return ' '.join(f'{px:.1f},{py:.1f}' for px, py in (view(x, y, height) for x, y in coords))

    def parts(geom, kind):
        if geom.is_empty:
            return
        if geom.geom_type == kind:
            yield geom
        elif hasattr(geom, 'geoms'):
            for child in geom.geoms:
                yield from parts(child, kind)

    scene = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 390">',
             f'<title>{name} {len(towers)}개 동의 지도 일러스트</title>',
             '<rect width="720" height="390" fill="#dbdfc7"/>',
             f'<polygon points="{points(site.exterior.coords)}" fill="#eee5c6" stroke="#f7efd9" stroke-width="3"/>']
    for item in read(environment_file)['features']:
        kind = item['properties']['kind']
        if kind not in {'green', 'road'} or item['properties'].get('brunnel') == 'tunnel':
            continue
        geom = geometry(item)
        if not geom.intersects(window):
            continue
        clipped = geom.intersection(window).simplify(.5)
        for area in parts(clipped, 'Polygon') if kind == 'green' else ():
            scene.append(f'<polygon points="{points(area.exterior.coords)}" fill="#a9caaa"/>')
        for road in parts(clipped, 'LineString') if kind == 'road' else ():
            width = 3 if item['properties']['category'] == 'path' else 13
            scene.append(f'<polyline points="{points(road.coords)}" fill="none" stroke="#fcf4de" stroke-width="{width}" stroke-linejoin="round" stroke-linecap="round"/>')

    towers.sort(key=lambda row: depth(row[0].centroid.x, row[0].centroid.y))
    for geom, _ in towers:
        for outline in parts(geom, 'Polygon'):
            scene.append(f'<polygon points="{points(outline.exterior.coords)}" fill="#7f9e8d" opacity=".46" transform="translate(12 8)"/>')
    for geom, height in towers:
        for outline in parts(geom.simplify(.38), 'Polygon'):
            ring = list(outline.exterior.coords)
            faces = sorted(zip(ring, ring[1:]), key=lambda edge: sum(depth(*p) for p in edge))
            for edge in faces:
                near = depth(*edge[0]) < depth(*edge[1])
                corners = points(edge) + ' ' + points(edge[::-1], height)
                wall = '#bfcfbe' if near else '#f1dec1'
                scene.append(f'<polygon points="{corners}" fill="{wall}" stroke="#778f83" stroke-width="0.65"/>')
                if math.dist(*edge) >= 3.5:
                    for band in range(1, 7):
                        scene.append(f'<polyline points="{points(edge, height * band / 7)}" fill="none" stroke="#8b9e8f" stroke-opacity=".46" stroke-width="1"/>')
            roof = '#d4af8c' if region == 'opo' else '#fff4dc'
            scene.append(f'<polygon points="{points(ring, height)}" fill="{roof}" stroke="#829485" stroke-width="1.4"/>')
    target = tour / 'postcard.svg'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text('\n'.join(scene + ['</svg>', '']))


if __name__ == '__main__':
    main()
