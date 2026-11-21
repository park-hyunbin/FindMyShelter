"""Build repeatable station and park walks from connected OpenStreetMap ways."""

import argparse
import heapq
import json
import math
from collections import defaultdict
from datetime import date
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Point, Polygon, shape


ROOT = Path(__file__).resolve().parents[2]
REGIONS = ROOT / 'frontend/public/datasets/regions'
PROJECT = Transformer.from_crs(4326, 5186, always_xy=True).transform
WALKWAYS = {'footway', 'path', 'pedestrian', 'steps'}
LOCAL_ROADS = {'residential', 'living_street', 'unclassified', 'tertiary', 'service'}
RESTRICTED = {'no', 'private', 'customers', 'destination', 'delivery', 'permit'}
WALK_ALLOWED = {'yes', 'designated', 'permissive'}


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def tagged_walkway(tags):
    return tags['highway'] in WALKWAYS or (tags['highway'] == 'cycleway' and tags.get('foot') == 'designated')


def walk_graph(ways, projected, *, site_radius):
    graph = defaultdict(list)
    for way in ways.values():
        tags = way.get('tags', {})
        highway = tags.get('highway')
        if not highway or tags.get('foot') in RESTRICTED:
            continue
        if tags.get('access') in RESTRICTED and tags.get('foot') not in WALK_ALLOWED:
            continue
        if (tags.get('area') == 'yes' or tags.get('motorroad') == 'yes' or tags.get('expressway') == 'yes'
                or tags.get('location') == 'underground' or tags.get('tunnel', 'no') != 'no'):
            continue
        mapped = tagged_walkway(tags)
        if not mapped and highway not in LOCAL_ROADS:
            continue
        if not mapped and tags.get('service') in {'driveway', 'parking_aisle'} and tags.get('foot') not in WALK_ALLOWED:
            continue
        crossing = tags.get('footway') == 'crossing' or tags.get('crossing') in {'marked', 'traffic_signals'}
        for a, b in zip(way['nodes'], way['nodes'][1:]):
            if a not in projected or b not in projected:
                continue
            if max(math.dist(projected[a], site_radius[0]), math.dist(projected[b], site_radius[0])) > site_radius[1]:
                continue
            length = math.dist(projected[a], projected[b])
            if length == 0:
                continue
            graph[a].append((b, way['id'], length, mapped, crossing, highway == 'steps'))
            graph[b].append((a, way['id'], length, mapped, crossing, highway == 'steps'))
    return graph


def station_nodes(spec, nodes, projected, graph):
    node = nodes[spec['node']]
    tags = node.get('tags', {})
    name = (tags.get('description:ko') or tags.get('description') or tags.get('name') or '').replace(' ', '')
    if tags.get('railway') != 'subway_entrance' or spec['name'].replace(' ', '') not in name:
        raise ValueError(f"Station exit identity changed for {spec['name']}")
    if spec['node'] in graph:
        return {spec['node']: 0}
    point = projected[spec['node']]
    candidates = {key: math.dist(point, projected[key]) for key, edges in graph.items() if any(edge[3] for edge in edges)}
    return {key: distance for key, distance in candidates.items() if distance <= 15}


def park_nodes(spec, ways, projected, graph):
    park = ways[spec['way']]
    tags = park.get('tags', {})
    if tags.get('leisure') != 'park' or tags.get('name') != spec['name'] or park['nodes'][0] != park['nodes'][-1]:
        raise ValueError(f"Park outline identity changed for {spec['name']}")
    boundary = Polygon([projected[node] for node in park['nodes']])
    if not boundary.is_valid:
        raise ValueError(f"Invalid park outline for {spec['name']}")
    zone = boundary.boundary.buffer(15)
    return {node: boundary.distance(point) for node in graph if zone.covers(point := Point(projected[node]))
            and any(mapped and not crossing for _, _, _, mapped, crossing, _ in graph[node])}


def route_tree(graph, destinations):
    costs = {node: gap * 10 for node, gap in destinations.items()}
    queue = [(cost, node) for node, cost in costs.items()]
    heapq.heapify(queue)
    next_edge = {}
    while queue:
        cost, node = heapq.heappop(queue)
        if cost != costs[node]:
            continue
        for neighbor, way, length, mapped, crossing, steps in graph[node]:
            penalty = 1 if mapped else 3.4
            candidate = cost + length * penalty
            if candidate >= costs.get(neighbor, math.inf):
                continue
            costs[neighbor] = candidate
            next_edge[neighbor] = (node, way, length, mapped, crossing, steps)
            heapq.heappush(queue, (candidate, neighbor))
    return costs, next_edge


def choose_start(graph, projected, boundary, roadside, costs):
    exterior = Polygon(boundary.exterior)
    border = exterior.boundary
    nearby = border.buffer(32).difference(exterior)
    candidates = []
    for node, edges in graph.items():
        point = Point(projected[node])
        if not nearby.covers(point) or not all(node in result and result[node] < 2700 for result in costs):
            continue
        routes = sum(result[node] for result in costs)
        gap = border.distance(point)
        labelled = any(edge[3] for edge in edges)
        score = routes + gap * 7 + point.distance(roadside) * 0.25 + (0 if labelled else 90)
        candidates.append((score, node, gap))
    if not candidates:
        raise ValueError('No shared exterior start connects the selected destinations')
    _, node, distance = min(candidates)
    return node, round(distance, 1)


def describe_route(spec, start, next_edge, destination, coordinates):
    cursor = start
    edges = []
    while cursor in next_edge:
        to, way, length, mapped, crossing, steps = next_edge[cursor]
        edges.append((cursor, to, way, length, mapped, crossing, steps))
        cursor = to
    if not edges or cursor not in destination:
        raise ValueError(f"No actual mapped route to {spec['name']}")
    segments = []
    crossings = {}
    for first, last, way, _, mapped, crossing, _ in edges:
        if segments and segments[-1]['mappedWalkway'] == mapped:
            segments[-1]['coordinates'].append(coordinates[last])
        else:
            segments.append({'mappedWalkway': mapped, 'coordinates': [coordinates[first], coordinates[last]]})
        if crossing and way not in crossings:
            crossings[way] = {'wayId': way, 'coordinate': [(a + b) / 2 for a, b in zip(coordinates[first], coordinates[last])]}
    marker_type, reference = ('node', spec['node']) if 'node' in spec else ('way', spec['way'])
    return {
        'id': spec['id'], 'name': spec['name'], 'endLabel': spec['endLabel'],
        'referenceSource': f'https://www.openstreetmap.org/{marker_type}/{reference}',
        'end': coordinates[cursor], 'segments': segments, 'wayIds': list(dict.fromkeys(edge[2] for edge in edges)),
        'lengthM': round(sum(edge[3] for edge in edges)),
        'walkwayM': round(sum(edge[3] for edge in edges if edge[4])),
        'gapM': round(destination[cursor], 1) or None, 'crossings': list(crossings.values()),
        'stepWays': len({edge[2] for edge in edges if edge[6]}),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('region')
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('--retrieved', type=date.fromisoformat, required=True)
    args = parser.parse_args()
    catalog = read(ROOT / 'frontend/components/data/seoul-scenes.generated.json')
    entry = next((row for row in catalog if row['id'] == args.region), None)
    if not entry:
        parser.error('Select a generated Seoul region')
    profile = read(ROOT / f'data/config/buildings/{args.region}.json')
    folder = REGIONS / args.region
    neighborhood = profile['osm'].get('neighborhood')
    context = REGIONS.parent / 'neighborhoods' / neighborhood if neighborhood else folder
    elements = read(args.snapshot)['elements']
    nodes = {item['id']: item for item in elements if item['type'] == 'node'}
    ways = {item['id']: item for item in elements if item['type'] == 'way'}
    coordinates = {key: [node['lon'], node['lat']] for key, node in nodes.items()}
    projected = {key: PROJECT(*point) for key, point in coordinates.items()}
    feature = read(folder / 'site.geojson')['features'][0]
    boundary = shape(feature['geometry'])
    boundary = Polygon([PROJECT(*point) for point in boundary.exterior.coords],
                       [[PROJECT(*point) for point in ring.coords] for ring in boundary.interiors])
    graph = walk_graph(ways, projected, site_radius=(PROJECT(*entry['lookAt']), entry['radius']))
    specs = profile['walking']
    targets = [station_nodes(spec, nodes, projected, graph) if 'node' in spec else park_nodes(spec, ways, projected, graph)
               for spec in specs]
    for spec, target in zip(specs, targets):
        if not target:
            raise ValueError(f"No mapped path at {spec['name']}")
    trees = [route_tree(graph, target) for target in targets]
    start, distance = choose_start(graph, projected, boundary, Point(PROJECT(*entry['roadside'])),
                                   [costs for costs, _ in trees])
    routes = [describe_route(spec, start, next_edge, target, coordinates)
              for spec, (_, next_edge), target in zip(specs, trees, targets)]
    result = {
        'source': read(context / 'streets.json')['metadata']['source'], 'start': coordinates[start], 'startNode': start,
        'startLabel': '단지 경계 가까운 지도상 출발점', 'boundaryDistanceM': distance,
        'retrieved': args.retrieved.isoformat(), 'routes': routes,
    }
    (folder / 'access.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    for route in routes:
        print(f"{route['name']} · {route['lengthM']}m · mapped {route['walkwayM']}m")


if __name__ == '__main__':
    main()
