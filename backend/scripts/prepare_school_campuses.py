"""Extract named school grounds and mapped sports fields from an Overpass snapshot."""
import argparse
import json
from pathlib import Path

from pyproj import Transformer
from shapely import maximum_inscribed_circle
from shapely.geometry import Polygon
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'frontend/public/datasets/schools/campuses.json'
PROJECT = Transformer.from_crs(4326, 5186, always_xy=True).transform
UNPROJECT = Transformer.from_crs(5186, 4326, always_xy=True).transform


def coordinate(x, y):
    return [round(x, 7), round(y, 7)]


def rings(polygon):
    return [[coordinate(x, y) for x, y in ring.coords] for ring in (polygon.exterior, *polygon.interiors)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    args = parser.parse_args()
    snapshot = json.loads(args.snapshot.read_text(encoding='utf-8'))
    if snapshot.get('remark'):
        raise ValueError(snapshot['remark'])
    schools, pitches = [], []
    for way in snapshot['elements']:
        tags = way['tags']
        points = [(point['lon'], point['lat']) for point in way.get('geometry', [])]
        if len(points) < 4 or points[0] != points[-1]:
            continue
        polygon = Polygon(points)
        if not polygon.is_valid:
            continue
        entry = way['id'], tags, polygon, transform(PROJECT, polygon)
        if tags.get('amenity') == 'school' and tags.get('name'):
            schools.append(entry)
        elif tags.get('leisure') == 'pitch' and entry[3].area >= 600:
            pitches.append(entry)

    campuses = []
    for osm_id, tags, shape, projected in sorted(schools):
        anchor = shape.representative_point()
        candidates = [(area.area, pitch_id, pitch_tags, polygon, area) for pitch_id, pitch_tags, polygon, area in pitches
                      if projected.covers(area)]
        field = None
        if candidates:
            _, pitch_id, pitch_tags, polygon, area = max(candidates, key=lambda item: item[0])
            circle = maximum_inscribed_circle(area, tolerance=.25)
            x, y = UNPROJECT(*circle.coords[0])
            field = {'id': pitch_id, 'rings': rings(polygon), 'center': coordinate(x, y),
                     'radiusM': round(circle.length, 2), 'sport': pitch_tags.get('sport'),
                     'surface': pitch_tags.get('surface')}
        campuses.append({'id': osm_id, 'name': tags['name'], 'rings': rings(shape),
                         'anchor': coordinate(anchor.x, anchor.y), 'field': field})

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({
        'source': 'https://overpass-api.de/',
        'attribution': '© OpenStreetMap contributors',
        'license': 'https://opendatacommons.org/licenses/odbl/1-0/',
        'snapshot': snapshot['osm3s']['timestamp_osm_base'],
        'campuses': campuses,
    }, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'{len(campuses)} campuses, {sum(campus["field"] is not None for campus in campuses)} mapped sports fields')


if __name__ == '__main__':
    main()
