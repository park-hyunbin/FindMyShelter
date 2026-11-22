"""Adapt Cartoon Townsfolk v1.0's CF_Woman.glb for the Find My Shelter game."""

import argparse
import io
import json
from pathlib import Path
import struct

from PIL import Image


def prepare(source: bytes) -> bytes:
    if source[:8] != b'glTF\x02\x00\x00\x00':
        raise ValueError('Expected a Binary glTF 2.0 model')
    json_length, = struct.unpack_from('<I', source, 12)
    data = json.loads(source[20:20 + json_length])
    binary = bytearray(source[28 + json_length:])

    material, = data['materials']
    base = material['pbrMetallicRoughness']['baseColorTexture']
    texture = data['textures'][base['index']]
    image = data['images'][texture['source']]
    view = data['bufferViews'][image['bufferView']]
    start = view.get('byteOffset', 0)
    palette = [
        ((198, 134, 86), '#e6b18e'),  # skin
        ((244, 200, 79), '#77513d'),  # hair
        ((255, 126, 182), '#a4b996'),  # knit top
        ((52, 179, 168), '#cda086'),  # skirt
        ((236, 75, 67), '#8e6352'),  # shoes and hair clip
        ((255, 159, 159), '#edaa98'),  # cheeks
        ((255, 255, 255), '#fcf3e4'),  # collar and details
        ((168, 67, 60), '#794943'),  # mouth
    ]
    colors = {old: bytes.fromhex(new[1:]) for old, new in palette}
    atlas = Image.open(io.BytesIO(binary[start:start + view['byteLength']])).convert('RGB')
    atlas.putdata([tuple(colors.get(pixel, pixel)) for pixel in atlas.getdata()])
    image_file = io.BytesIO()
    atlas.save(image_file, format='PNG', optimize=True)
    view.update(byteOffset=len(binary), byteLength=image_file.tell())
    binary.extend(image_file.getvalue())
    material.pop('emissiveTexture', None)
    material.pop('emissiveFactor', None)
    base['index'] = texture['source'] = 0
    data['textures'], data['images'] = [texture], [image]
    material['pbrMetallicRoughness'] = {'baseColorTexture': base, 'roughnessFactor': .96, 'metallicFactor': 0}

    idle, = [clip for clip in data['animations'] if clip['name'] == 'Idle']
    head, = [i for i, node in enumerate(data['nodes']) if node.get('name') == 'Head']
    data['nodes'][head]['scale'] = [1.16, 1.16, 1.16]
    idle['channels'] = [channel for channel in idle['channels']
                        if channel['target'] != {'node': head, 'path': 'scale'}]
    data['animations'] = [idle]

    selected = sorted({channel['sampler'] for channel in idle['channels']})
    for channel in idle['channels']:
        channel['sampler'] = selected.index(channel['sampler'])
    idle['samplers'] = [idle['samplers'][index] for index in selected]
    references = [(skin, 'inverseBindMatrices') for skin in data['skins']]
    for mesh in data['meshes']:
        for primitive in mesh['primitives']:
            references.append((primitive, 'indices'))
            references.extend((primitive['attributes'], key) for key in primitive['attributes'])
    references.extend((sampler, key) for sampler in idle['samplers'] for key in ('input', 'output'))
    selected = sorted({obj[key] for obj, key in references})
    for obj, key in references:
        obj[key] = selected.index(obj[key])
    data['accessors'] = [data['accessors'][index] for index in selected]

    packed = bytearray()
    views = data['bufferViews']
    data['bufferViews'] = []
    selected_views = {}
    for obj in [*data['accessors'], image]:
        index = obj['bufferView']
        if index not in selected_views:
            source_view = views[index]
            offset = source_view.get('byteOffset', 0)
            packed.extend(b'\0' * (-len(packed) % 4))
            selected_views[index] = len(data['bufferViews'])
            data['bufferViews'].append({**source_view, 'byteOffset': len(packed)})
            packed.extend(binary[offset:offset + source_view['byteLength']])
        obj['bufferView'] = selected_views[index]
    binary = packed + b'\0' * (-len(packed) % 4)
    data['buffers'][0]['byteLength'] = len(binary)
    header = json.dumps(data, separators=(',', ':')).encode()
    header += b' ' * (-len(header) % 4)
    return (struct.pack('<4sII', b'glTF', 2, 28 + len(header) + len(binary))
            + struct.pack('<I4s', len(header), b'JSON') + header
            + struct.pack('<I4s', len(binary), b'BIN\0') + binary)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Original CF_Woman.glb from the author’s archive')
    args = parser.parse_args()
    output = Path(__file__).resolve().parents[1] / 'public/models/tour-guide.glb'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(prepare(args.source.read_bytes()))


if __name__ == '__main__':
    main()
