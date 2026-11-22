"""Bake the provided mascot parts sheet into the tour guide's textured GLB."""

import argparse
from dataclasses import dataclass
import io
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageDraw


@dataclass
class Section:
    pixels: np.ndarray
    left: np.ndarray
    right: np.ndarray
    x_origin: float
    width: float

    def sample(self, across, height):
        row = height * (len(self.left) - 1)
        lo = np.interp(row, np.arange(len(self.left)), self.left)
        hi = np.interp(row, np.arange(len(self.right)), self.right)
        col = np.rint((lo + hi + across * (hi - lo) * .95) / 2).astype(int)
        return self.pixels[np.rint(row).astype(int), col].astype(float)


def scan(image, box, color):
    pixels = np.asarray(image.crop(box), dtype=np.int16)
    red, green, blue = pixels.transpose(2, 0, 1)
    if color == 'yellow':
        mask = (red - green < 96) & (green - blue > 36) & (red - blue > 75) & (red > 100)
    elif color == 'blue':
        mask = (blue - red > 23) & (blue - green > 8) & (blue > 90)
    else:
        # The white pom is on an off-white background. Limit the mask to its tuft.
        yy, xx = np.indices(red.shape)
        mask = ((xx - 49) / 40) ** 2 + ((yy - 57) / 42) ** 2 <= 1
        mask &= (red - green < 16) & (blue - green < 11) & (red < 242) & (red > 145)
    rows = np.flatnonzero(np.sum(mask, axis=1) >= 4)
    if not len(rows):
        raise ValueError(f'No mascot silhouette in {box}')
    edges = np.array([(np.flatnonzero(mask[y])[0], np.flatnonzero(mask[y])[-1]) for y in rows])
    local_rows = np.arange(rows[0], rows[-1] + 1)
    left, right = [np.interp(local_rows, rows, edge) for edge in edges.T]
    # Preserve enclosed artwork (including white eyes) and extend the nearest
    # fabric past the silhouette so the source sheet cannot show at UV seams.
    silhouette = Image.fromarray(np.uint8(mask) * 128).copy()
    ImageDraw.floodfill(silhouette, (0, 0), 255)
    outside = np.asarray(silhouette) == 255
    for y in rows:
        missing = np.flatnonzero(outside[y])
        cloth = np.flatnonzero(~outside[y])
        if not len(cloth):
            continue
        insert = np.searchsorted(cloth, missing)
        before = cloth[np.maximum(0, insert - 1)]
        after = cloth[np.minimum(insert, len(cloth) - 1)]
        nearest = np.where(missing - before <= after - missing, before, after)
        pixels[y, missing] = pixels[y, nearest]
    return Section(pixels[local_rows], left, right, (min(left) + max(right)) / 2, max(right) - min(left))


def make_texture(front, rear, side, rest_color, texture_size):
    theta = np.linspace(-np.pi, np.pi, texture_size)[None, :]
    height = np.linspace(0, 1, texture_size)[:, None]
    across = np.broadcast_to(np.sin(theta), (texture_size, texture_size))
    front_rgb = front.sample(across, height)
    rear_rgb = rear.sample(-across, height) if rear else (
        np.array(rest_color) + (front.sample(np.full_like(across, -.72), height).mean(axis=2, keepdims=True) - 150) * .18
    )
    front_weight = np.clip((np.cos(theta) + .34) / .68, 0, 1)[..., None]
    rgb = front_rgb * front_weight + rear_rgb * (1 - front_weight)
    if side:
        side_sample = side.sample(np.broadcast_to(-np.cos(theta), across.shape), height)
        side_weight = (1 - np.abs(np.cos(theta)))[..., None] ** 3
        rgb = rgb * (1 - side_weight) + side_sample * side_weight
    output = io.BytesIO()
    Image.fromarray(np.uint8(np.clip(rgb, 0, 255)), 'RGB').save(output, format='JPEG', quality=90, optimize=True)
    return output.getvalue()


def loft(profile, width, height, depth, position, segments=48, rows=44, side=None, curved_arm=False, shoulder=None):
    # A closed horizontal loft follows the photographed width at each height.
    # The source control points meet the top and base at a single cap vertex.
    row = np.linspace(0, 1, rows + 1)
    def section(profile):
        grid = np.linspace(0, 1, len(profile.left))
        low = np.interp(row, grid, profile.left)
        high = np.interp(row, grid, profile.right)
        center = (low + high) / 2 - profile.x_origin
        radius = (high - low) / 2
        radius[1:-1] = radius[:-2] * .18 + radius[1:-1] * .64 + radius[2:] * .18
        radius[[0, -1]] = 0
        return center, radius

    center, radius = section(profile)
    theta = np.linspace(-np.pi, np.pi, segments + 1)
    x = (center[:, None] + radius[:, None] * np.sin(theta)) * width / profile.width
    y = np.broadcast_to((1 - row[:, None]) * height, x.shape)
    if side:
        z_center, z_radius = section(side)
        z = (-z_center[:, None] + z_radius[:, None] * np.cos(theta)) * depth / side.width
    else:
        z = radius[:, None] * depth / profile.width * np.cos(theta)
    if curved_arm:
        # Keep the shoulder near the body and curve the supporting hand around the toy.
        z += .24 * np.sin(row[:, None] * np.pi * .74)
    coordinates = np.stack((x, y, z), axis=2) + position
    if shoulder is not None:
        # The shoulder sits inside the torso. Preserve the shape of the hand.
        weight = np.clip(1 - row / .42, 0, 1) ** 2
        coordinates += weight[:, None, None] * (shoulder - coordinates[0, 0])
    normal = np.zeros_like(coordinates)
    tangent = np.roll(coordinates[:, :-1], -1, axis=1) - np.roll(coordinates[:, :-1], 1, axis=1)
    normal[1:-1, :-1] = np.cross(coordinates[2:, :-1] - coordinates[:-2, :-1], tangent[1:-1])
    normal[:, -1] = normal[:, 0]
    normal[0, :, 1], normal[-1, :, 1] = 1, -1
    normal /= np.maximum(np.linalg.norm(normal, axis=2, keepdims=True), 1e-9)
    uv = np.stack(np.meshgrid(np.linspace(0, 1, segments + 1), row), axis=2)
    indices = []
    stride = segments + 1
    for i in range(rows):
        for j in range(segments):
            a = i * stride + j
            if i:
                indices.extend((a, a + stride, a + 1))
            if i < rows - 1:
                indices.extend((a + 1, a + stride, a + stride + 1))
    return coordinates, normal, uv, np.asarray(indices, dtype='<u2')


def bake(sheet):
    parts = [
        ('Body', (80, 103, 484, 512), (530, 102, 939, 512), 'yellow',
         (1.02, 1.12, .68), (0, 0, 0), (227, 180, 36), 512),
        ('Left arm', (1010, 122, 1181, 277), None, 'yellow',
         (.36, .38, .29), (.425, .23, .205), (228, 185, 42), 256),
        ('Right arm', (1008, 298, 1178, 461), None, 'yellow',
         (.36, .37, .29), (-.43, .25, .22), (228, 185, 42), 256),
        ('Sky blue hat', (51, 624, 248, 915), None, 'blue',
         (.36, .47, .34), (-.174, .927, -.031), (91, 162, 180), 256),
        ('White pom-pom', (309, 708, 399, 814), None, 'white',
         (.16, .16, .16), (-.288, 1.350, -.031), (237, 233, 223), 128),
        ('Elephant plush', (485, 624, 776, 916), (807, 620, 1069, 917), 'blue',
         (.55, .52, .34), (-.445, .30, .43), (137, 151, 183), 384),
    ]
    model = {
        'asset': {'version': '2.0', 'generator': 'Find My Shelter parts-sheet baker'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'name': 'Plush Guide', 'children': []}],
        'meshes': [], 'accessors': [], 'bufferViews': [], 'images': [], 'textures': [], 'materials': [],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
    }
    blob = bytearray()

    def view(data):
        blob.extend(b'\0' * (-len(blob) % 4))
        entry = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data)}
        blob.extend(data)
        model['bufferViews'].append(entry)
        return len(model['bufferViews']) - 1

    def accessor(data, kind, integer=False, limits=False):
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[kind]
        data = data.reshape(-1, width).astype('<u2' if integer else '<f4')
        entry = {'bufferView': view(data.tobytes()), 'componentType': 5123 if integer else 5126,
                 'count': len(data), 'type': kind}
        if limits:
            entry.update(min=data.min(axis=0).tolist(), max=data.max(axis=0).tolist())
        model['accessors'].append(entry)
        return len(model['accessors']) - 1

    for index, (name, front_box, rear_box, color, dimensions, position, rgb, texture_size) in enumerate(parts):
        front = scan(sheet, front_box, color)
        rear = scan(sheet, rear_box, color) if rear_box else front if 'arm' in name else None
        side = rear if name == 'Elephant plush' else None
        segments, rows = (48, 44) if name in ('Body', 'Elephant plush') else (32, 30)
        shoulder = np.array([.285 if name == 'Left arm' else -.285, .624, .14]) if 'arm' in name else None
        points, normals, uv, indices = loft(front, *dimensions, position, segments, rows,
                                           side=side, curved_arm=name == 'Right arm', shoulder=shoulder)
        model['nodes'][0]['children'].append(len(model['nodes']))
        model['nodes'].append({'name': name, 'mesh': index})
        model['meshes'].append({'primitives': [{
            'attributes': {'POSITION': accessor(points, 'VEC3', limits=True),
                           'NORMAL': accessor(normals, 'VEC3'), 'TEXCOORD_0': accessor(uv, 'VEC2')},
            'indices': accessor(indices, 'SCALAR', integer=True), 'material': index,
        }]})
        model['images'].append({'bufferView': view(make_texture(front, rear if not side else None, side, rgb, texture_size)), 'mimeType': 'image/jpeg'})
        model['textures'].append({'source': index, 'sampler': 0})
        model['materials'].append({'name': name, 'pbrMetallicRoughness': {
            'baseColorTexture': {'index': index}, 'metallicFactor': 0, 'roughnessFactor': 1,
        }})

    model['animations'] = [{
        'name': 'Idle',
        'channels': [{'sampler': 0, 'target': {'node': 0, 'path': 'scale'}}],
        'samplers': [{'input': accessor(np.array([0, .9, 1.8, 2.7, 3.6]), 'SCALAR', limits=True),
                      'output': accessor(np.array([[1, 1, 1], [1.009, .989, 1.006], [1, 1, 1],
                                                   [.994, 1.01, .997], [1, 1, 1]]), 'VEC3'),
                      'interpolation': 'LINEAR'}],
    }]
    blob.extend(b'\0' * (-len(blob) % 4))
    model['buffers'] = [{'byteLength': len(blob)}]
    header = json.dumps(model, separators=(',', ':')).encode()
    header += b' ' * (-len(header) % 4)
    return (struct.pack('<4sII', b'glTF', 2, 28 + len(header) + len(blob))
            + struct.pack('<I4s', len(header), b'JSON') + header
            + struct.pack('<I4s', len(blob), b'BIN\0') + blob)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sheet', type=Path, help='Original 1448×1086 mascot parts sheet PNG')
    args = parser.parse_args()
    with Image.open(args.sheet) as image:
        if image.size != (1448, 1086):
            parser.error('Expected the original 1448×1086 parts sheet')
        asset = bake(image.convert('RGB'))
    output = Path(__file__).resolve().parents[1] / 'public/models/plush-guide.glb'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(asset)
