"""Bake the supplied resident designs as independent skin, garment and accessory surfaces."""

import json
import math
from pathlib import Path
import struct

import numpy as np


FABRIC = {
    'rose': ('#e3a09d', '#bc787d', '#f1e1cc'),
    'royal': ('#a8c7d8', '#7eabbd', '#e3c89e'),
    'sprout': ('#4c4b46', '#64635b', '#7c8869'),
    'scarlet': ('#b65346', '#913e34', '#535047'),
    'reader': ('#92b8cc', '#6e95ac', '#8b9870'),
    'sleepy': ('#9bbfd9', '#739bb9', '#f0e2ce'),
}
SKIN, HAIR, SHOE = '#f6d3ad', '#4a352b', '#49372e'
INK = '#422c26'


def rgb(hex_color):
    srgb = np.array([int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    return np.rint(255 * np.where(srgb <= .04045, srgb / 12.92, ((srgb + .055) / 1.055) ** 2.4))


def unit(vector):
    return vector / np.linalg.norm(vector)


def axes(direction):
    y = unit(direction)
    z = unit(np.cross([1, 0, 0] if abs(y[0]) < .8 else [0, 0, 1], y))
    return np.array([np.cross(y, z), y, z])


class Resident:
    def __init__(self):
        self.positions = []
        self.indices = []
        self.colors = []
        self.joints = []

    def add(self, points, triangles, color, joint):
        offset = len(self.positions)
        self.positions.extend(points)
        self.indices.extend(np.asarray(triangles) + offset)
        self.colors.extend([rgb(color)] * len(points))
        self.joints.extend([joint] * len(points))

    def loft(self, rings, color, center=(0, 0, 0), basis=None, joint=0, power=1, sides=24):
        angles = np.arange(sides) * math.tau / sides
        circle = np.array([np.cos(angles), np.sin(angles)])
        circle = np.sign(circle) * np.abs(circle) ** power
        points = np.concatenate([np.column_stack((circle[0] * x, np.full(sides, y), circle[1] * z + forward))
                                 for y, x, z, forward in rings])
        # Share vertices around the seam and close both ends with single vertices.
        points = np.vstack((points, [0, rings[0][0], rings[0][3]], [0, rings[-1][0], rings[-1][3]]))
        triangles = []
        count = len(rings) * sides
        for j in range(sides):
            k = (j + 1) % sides
            triangles.extend([(count, j, k), (count + 1, count - sides + k, count - sides + j)])
            for row in range(len(rings) - 1):
                a, b = row * sides + j, row * sides + k
                triangles.extend([(a, a + sides, b), (b, a + sides, b + sides)])
        self.add(points @ basis + center if basis is not None else points + center, triangles, color, joint)

    def volume(self, center, radii, color, *, direction=None, joint=0, power=1, sides=24):
        x, y, z = radii
        rings = [(y * math.sin(a), x * math.cos(a) ** power, z * math.cos(a) ** power, 0)
                 for a in np.linspace(-1.50, 1.50, 15)]
        basis = axes(np.asarray(direction)) if direction is not None else None
        self.loft(rings, color, center, basis, joint, power, sides)

    def limb(self, start, end, radius, depth, color):
        start, end = np.array(start), np.array(end)
        self.volume((start + end) / 2, (radius, np.linalg.norm(end - start) / 2, depth),
                    color, direction=end - start, power=.73)

    def cord(self, anchors, radius, color, joint=0, depth=None, closed=False):
        # Interpolate the strap without breaking it where it wraps over the shoulder.
        controls = np.asarray(anchors)
        path = []
        for i in range(len(controls) if closed else len(controls) - 1):
            a, b, c, d = [controls[j % len(controls) if closed else np.clip(j, 0, len(controls) - 1)]
                          for j in range(i - 1, i + 3)]
            for t in np.linspace(0, 1, 5, endpoint=False):
                path.append(.5 * (2 * b + (c - a) * t +
                           (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t ** 3))
        if not closed:
            path.append(controls[-1])
        path = np.asarray(path)
        points, triangles = [], []
        sides = 10
        for i, point in enumerate(path):
            prior, following = (i - 1) % len(path), (i + 1) % len(path)
            if not closed:
                prior, following = max(0, i - 1), min(len(path) - 1, i + 1)
            tangent = unit(path[following] - path[prior])
            normal = np.cross(tangent, [0, 0, 1])
            if np.linalg.norm(normal) < 1e-6:
                normal = np.cross(tangent, [0, 1, 0])
            normal = unit(normal)
            binormal = np.cross(normal, tangent)
            points.extend(point + math.cos(a) * radius * normal + math.sin(a) * (depth or radius) * binormal
                          for a in np.arange(sides) * math.tau / sides)
            if i == len(path) - 1 and not closed:
                break
            next_row = following * sides
            for j in range(sides):
                k = (j + 1) % sides
                a, b = i * sides + j, i * sides + k
                triangles.extend([(a, next_row + j, b), (b, next_row + j, next_row + k)])
        self.add(points, triangles, color, joint)

    def emblem(self, outline, center, size, thickness, color):
        points = [np.array(center) + [x * size * scale, y * size * scale, z]
                  for scale, z in [(1, 0), (.82, thickness)] for x, y in outline]
        count = len(outline)
        points.append(np.array(center) + [0, 0, thickness * 1.10])
        triangles = []
        for i in range(count):
            j = (i + 1) % count
            triangles.extend([(i, j, count + i), (j, count + j, count + i), (count + i, count + j, 2 * count)])
        self.add(points, triangles, color, 0)

    def hair(self, name, face_y):
        # A continuous cap with a curved part and a folded-under edge at the hairline.
        sides, rows = 72, 21
        angles = np.arange(sides) * math.tau / sides - math.pi
        front = np.abs(angles)
        part_angle = {'reader': -.30, 'scarlet': .24}.get(name, .10)
        edge = np.interp(front, [0, .28, .62, .96, 1.33, 1.55, 2.10, math.pi],
                         [1.15, 1.23, 1.35, 1.44, 1.63, 1.76, 1.93, 2.09])
        edge -= .19 * np.exp(-((angles - part_angle) / .24) ** 2)
        edge += .048 * np.sin(angles * 3 + part_angle)
        if name == 'royal':
            edge += .43 * np.exp(-((front - 1.59) / .58) ** 2)
        center = np.array([0, face_y + .032, .026])
        radii = np.array([.292, .307, .242])
        points, triangles, tones = [], [], []
        for row in range(rows + 1):
            t = min((row + 1) / rows, 1)
            phi = edge * t
            # Ridges follow the sweep from the off-centre part toward each temple.
            sweep = angles + .49 * t ** 1.5 * np.sin(angles - part_angle)
            groove = (.61 * np.cos(sweep * 10 + t * 1.7 * np.sin(angles)) +
                      .29 * np.cos(sweep * 17 - t * 1.8) + .10 * np.cos(sweep * 26))
            part = np.exp(-((angles - part_angle * t) / .075) ** 2) * np.sin(math.pi * t)
            depth = 1 + (.023 * groove * (1 - t * .58) - .019 * part) * np.sin(phi)
            depth += .02 * np.sin(phi) * np.exp(-((angles - part_angle - .34) / .47) ** 2)
            width = 1 + max(0, t - .70) * .14
            if row == rows:
                depth *= .94
            directions = np.column_stack((np.sin(phi) * np.sin(angles), np.cos(phi),
                                          np.sin(phi) * np.cos(angles)))
            points.extend(center + directions * radii * [width, 1, width] * depth[:, None])
            tint = 1 + (.30 * groove - .25 * part) * np.sin(phi)
            tones.extend(np.clip(rgb(HAIR) * tint[:, None], 0, 255))
        for row in range(rows):
            for j in range(sides):
                a, b = row * sides + j, row * sides + (j + 1) % sides
                triangles.extend([(a, a + sides, b), (b, a + sides, b + sides)])
        crown = len(points)
        points.append(center + [0, radii[1], 0])
        tones.append(rgb(HAIR))
        triangles.extend((crown, j, (j + 1) % sides) for j in range(sides))
        self.add(points, triangles, HAIR, 0)
        self.colors[-len(points):] = tones


def make_resident(name):
    figure = Resident()
    volume, cord = figure.volume, figure.cord
    shirt, seam, pants = FABRIC[name]
    asleep = name == 'sleepy'
    skirt = name in ('rose', 'royal')
    face_y = .74 if asleep else 1.08

    def face_depth(x, y):
        latitude = math.sqrt(1 - (y / .286) ** 2) ** .91
        longitude = math.sqrt(1 - (abs(x) / (.275 * latitude)) ** (2 / .91)) ** .91
        return .026 + .224 * latitude * longitude

    def stitch(points, radius, color):
        cord([(x, face_y + y, face_depth(x, y) + .001) for x, y in points], radius, color)

    if not asleep:
        # The neck, shoulders, cuffs and wrists overlap in neutral pose.
        figure.loft([(.29, .215 if skirt else .182, .122, 0), (.31, .235 if skirt else .186, .14, 0),
                     (.39, .219 if skirt else .177, .153, 0), (.51, .184, .14, 0),
                     (.62, .191, .136, 0), (.69, .179, .118, 0), (.736, .076, .075, 0)], shirt, power=.84)
        volume((0, .749, 0), (.083, .093, .078), SKIN)
        cord([(.084 * math.cos(a), .731, .079 * math.sin(a) + .009)
              for a in np.arange(12) * math.tau / 12], .018, seam, closed=True)
        if skirt:
            cord([(.225 * math.cos(a), .315, .133 * math.sin(a)) for a in np.arange(16) * math.tau / 16],
                 .013, seam, closed=True)
        for i, side in enumerate((-1, 1), 1):
            x = side * .095
            volume((x, .215, 0), (.074, .147, .073), pants, joint=i, power=.7, sides=20)
            if skirt:
                volume((x, .117, .005), (.061, .075, .064), '#fff5e8', joint=i, power=.71, sides=20)
            volume((x, .060, .042), (.084, .060, .119), SHOE, joint=i, power=.62, sides=20)
            figure.limb((side * .137, .655, 0), (side * .276, .403, .031), .066, .067, shirt)
            figure.limb((side * .242, .485, .026), (side * .278, .408, .038), .057, .057, seam)
            volume((side * .282, .405, .047), (.047, .064, .043), SKIN, direction=(side * .46, -.87, 0))
            volume((side * .259, .422, .071), (.025, .033, .024), SKIN, sides=14)

    volume((0, face_y, .026), (.275, .286, .224), SKIN, power=.91)
    for side in (-1, 1):
        volume((side * .258, face_y - .05, .018), (.050, .063, .044), SKIN)
        volume((side * .266, face_y - .05, .049), (.027, .036, .012), '#e6ab93')
    figure.hair(name, face_y)
    for side in (-1, 1):
        x = side * .098
        if asleep:
            stitch([(x - .030, .010), (x, -.005), (x + .030, .010)], .009, INK)
        else:
            eye = face_depth(x, .013)
            volume((x, face_y + .013, eye), (.022, .028, .013), INK, sides=16)
            volume((x - .005, face_y + .021, eye + .011), (.005, .006, .003), '#fff3df', sides=12)
            stitch([(x - .027, .068), (x, .076), (x + .024, .068)], .006, HAIR)
        cheek = side * .167
        volume((cheek, face_y - .056, face_depth(cheek, -.056) - .004), (.029, .020, .009),
               '#e7a18e', sides=16)

    volume((0, face_y - .032, .245), (.024, .024, .023), '#efbd9f', sides=16)
    stitch([(-.047, -.080), (-.027, -.094), (0, -.091), (.026, -.095), (.047, -.079)], .007, INK)

    if name == 'rose':
        # Rear shell and facing seam wrap over the hair and down under the jaw.
        volume((0, 1.103, -.125), (.315, .339, .228), shirt, power=.84)
        cord([(.282 * math.cos(a), 1.089 + .311 * math.sin(a), .088 + .086 * abs(math.cos(a)))
              for a in np.arange(20) * math.tau / 20], .035, shirt, closed=True)
        for side in (-1, 1):
            volume((side * .299, 1.073, -.013), (.075, .145, .091), shirt, direction=(-side * .39, 1, -.21))
        star = [(r * math.cos(a), r * math.sin(a)) for i, a in enumerate(np.linspace(math.pi / 2, math.pi / 2 + math.tau, 10, endpoint=False))
                for r in [1 if i % 2 == 0 else .47]]
        figure.emblem(star, (0, .642, .135), .061, .019, '#f4c862')
    elif name == 'royal':
        figure.loft([(1.366, .124, .090, 0), (1.379, .138, .102, 0), (1.436, .146, .094, 0)],
                    '#e9b954', center=(0, 0, -.032))
        crown = [(-1, -.53), (1, -.53), (1.18, .69), (.50, .20), (0, 1), (-.50, .20), (-1.18, .69)]
        figure.emblem(crown, (0, 1.436, .058), .12, .018, '#f4cd6b')
        volume((0, 1.439, .081), (.024, .035, .017), '#c86155')
        heart = [(-.78, .20), (-.40, -.33), (0, -.70), (.40, -.33), (.78, .20), (.65, .63), (.31, .72),
                 (0, .49), (-.31, .72), (-.65, .63)]
        figure.emblem(heart, (0, .588, .136), .064, .015, '#e99d9a')
    elif name == 'sprout':
        figure.limb((.13, 1.312, -.01), (.207, 1.469, -.014), .017, .018, HAIR)
        volume((.132, 1.367, .023), (.044, .072, .032), '#9fc4d8', direction=(-.70, 1, 0))
        volume((.233, 1.371, .024), (.045, .065, .031), '#9fc4d8', direction=(.72, 1, 0))
        volume((.180, 1.366, .042), (.027, .031, .026), '#83aec6')
        for y in (.52, .59):
            volume((0, y, .147), (.015, .015, .008), '#c9ac73')
    elif name == 'scarlet':
        cord([(.179 * math.cos(a), .423, .153 * math.sin(a)) for a in np.arange(16) * math.tau / 16],
             .025, '#593b2e', closed=True)
        cord([(-.032, .401, .178), (.032, .401, .178), (.032, .448, .178), (-.032, .448, .178)],
             .010, '#e5b55f', closed=True)
        figure.emblem([(-1, 0), (0, -1), (1, 0), (0, 1)], (0, .656, .127), .054, .018, '#f1dbc4')
    elif name == 'reader':
        for side in (-1, 1):
            cord([(side * .100 + .070 * math.cos(a), face_y + .020 + .057 * math.sin(a),
                   .255 - max(0, abs(side * .100 + .070 * math.cos(a)) - .11) * .39)
                  for a in np.arange(14) * math.tau / 14], .010, '#563e32', closed=True)
            cord([(side * .164, face_y + .034, .236), (side * .229, face_y + .043, .149),
                  (side * .260, face_y + .036, .059)], .008, '#563e32')
        cord([(-.037, face_y + .027, .253), (0, face_y + .036, .259), (.037, face_y + .027, .253)], .008, '#563e32')
        volume((.183, .405, .107), (.112, .112, .087), '#755846', direction=(-.22, 1, 0), power=.62)
        volume((.193, .443, .161), (.110, .064, .044), '#916e52', direction=(-.22, 1, 0), power=.55)
        cord([(.112, .436, .174), (.142, .409, .199), (.214, .400, .205),
              (.265, .421, .184)], .006, '#c6996d')
        volume((.192, .426, .208), (.014, .012, .005), '#dfb879')
        cord([(.167, .422, .189), (.059, .501, .164), (-.047, .615, .144), (-.144, .693, .095),
              (-.158, .701, -.025), (-.130, .656, -.125), (-.027, .525, -.153), (.138, .412, -.081),
              (.234, .403, .070)], .022, '#684c39', depth=.009)
        volume((-.072, .604, .153), (.025, .019, .008), '#bd976e', direction=(.68, -.72, 0))
    else:
        volume((0, .489, -.103), (.379, .343, .150), seam, power=.67)
        volume((0, .261, .053), (.352, .255, .230), shirt, power=.65)
        cord([(-.293, .378, .122), (-.168, .430, .236), (0, .415, .266),
              (.161, .431, .233), (.288, .378, .120)], .019, '#b5d2e7')
    return figure


def bake():
    model = {'asset': {'version': '2.0', 'generator': 'Find My Shelter resident collection',
                       'extras': {'designSource': 'Resident turnaround and costume sheet provided by the project owner'}},
             'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [], 'skins': [],
             'accessors': [], 'bufferViews': [], 'materials': [{'name': 'Matte dyed fabric and skin',
             'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': .92}}]}
    blob = bytearray()

    def accessor(values, kind, dtype, limits=False, normalized=False):
        data = np.asarray(values, dtype=dtype)
        blob.extend(b'\0' * (-len(blob) % 4))
        view = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': data.nbytes}
        model['bufferViews'].append(view)
        blob.extend(data.tobytes())
        element = {'bufferView': len(model['bufferViews']) - 1, 'count': len(data), 'type': kind,
                   'componentType': {'f4': 5126, 'u1': 5121, 'u2': 5123}[data.dtype.str[-2:]]}
        if limits:
            element.update(min=data.min(axis=0).tolist(), max=data.max(axis=0).tolist())
        if normalized:
            element['normalized'] = True
        model['accessors'].append(element)
        return len(model['accessors']) - 1

    for name in FABRIC:
        mesh = make_resident(name)
        points, triangles = np.array(mesh.positions), np.array(mesh.indices)
        edges = points[triangles[:, 1:]] - points[triangles[:, :1]]
        triangle_normals = np.cross(edges[:, 0], edges[:, 1])
        normals = np.zeros_like(points)
        for corner in range(3):
            np.add.at(normals, triangles[:, corner], triangle_normals)
        normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-8)

        root = len(model['nodes'])
        model['scenes'][0]['nodes'].append(root)
        node = {'name': f'npc_{name}', 'mesh': len(model['meshes'])}
        model['nodes'].append(node)
        attributes = {'POSITION': accessor(points, 'VEC3', '<f4', limits=True),
                      'NORMAL': accessor(normals, 'VEC3', '<f4'),
                      'COLOR_0': accessor(np.column_stack((mesh.colors, np.full(len(points), 255))), 'VEC4', 'u1', normalized=True)}
        if name != 'sleepy':
            legs = [(-.095, .30, 0), (.095, .30, 0)]
            for i, position in enumerate(legs):
                model['nodes'].append({'name': f'leg_{name}_{i}', 'translation': list(position)})
            model['nodes'].append({'name': f'rig_{name}', 'children': [root + 1, root + 2]})
            bind = np.repeat(np.eye(4)[None, :, :], 3, axis=0)
            bind[1:, 3, :3] = -np.array(legs)
            node.update(skin=len(model['skins']), children=[root + 3])
            model['skins'].append({'joints': [root + 3, root + 1, root + 2], 'skeleton': root + 3,
                                   'inverseBindMatrices': accessor(bind.reshape(3, 16), 'MAT4', '<f4')})
            attributes['JOINTS_0'] = accessor(np.column_stack((mesh.joints, np.zeros((len(points), 3)))), 'VEC4', 'u1')
            attributes['WEIGHTS_0'] = accessor(np.tile([255, 0, 0, 0], (len(points), 1)), 'VEC4', 'u1', normalized=True)
        model['meshes'].append({'primitives': [{'attributes': attributes, 'material': 0,
                                'indices': accessor(triangles.ravel(), 'SCALAR', '<u2')}]})

    blob.extend(b'\0' * (-len(blob) % 4))
    model['buffers'] = [{'byteLength': len(blob)}]
    header = json.dumps(model, separators=(',', ':')).encode()
    header += b' ' * (-len(header) % 4)
    return (struct.pack('<4sII', b'glTF', 2, 28 + len(header) + len(blob))
            + struct.pack('<I4s', len(header), b'JSON') + header
            + struct.pack('<I4s', len(blob), b'BIN\0') + blob)


if __name__ == '__main__':
    output = Path(__file__).resolve().parents[1] / 'public/models/neighborhood-residents.glb'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(bake())
