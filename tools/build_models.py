"""Turn the BodyParts3D part files into one web-ready model file per body system.

Usage: python3 tools/build_models.py <bodyparts3d download folder> <parts.json> <output folder>

Each part is simplified to fit its system's triangle budget, turned to Y-up metres
(BodyParts3D is Z-up millimetres, front = -Y), and written as a named node so the app can
look up its name. Run tools/pack_models.sh afterwards to compress the files.
"""
import json
import os
import sys

import fast_simplification
import numpy as np
import trimesh

SRC, PARTS, OUT = sys.argv[1:4]
OBJ = os.path.join(SRC, 'raw', 'isa_BP3D_4.0_obj_99')
os.makedirs(OUT, exist_ok=True)

# Triangle budget per system for the whole body.
BUDGET = {
    'muscles': 320_000, 'skeleton': 220_000, 'veins': 130_000, 'arteries': 130_000,
    'nerves': 110_000, 'gut': 100_000, 'skin': 70_000, 'senses': 40_000, 'lungs': 60_000,
    'heart': 60_000, 'joints': 40_000, 'cartilage': 30_000,
}
MIN_FACES = 60


def load(fj):
    v, f = [], []
    with open(os.path.join(OBJ, fj + '.obj'), encoding='utf-8', errors='replace') as fh:
        for line in fh:
            if line.startswith('v '):
                v.append([float(x) for x in line.split()[1:4]])
            elif line.startswith('f '):
                idx = [int(x.split('/')[0]) - 1 for x in line.split()[1:]]
                for k in range(1, len(idx) - 1):
                    f.append([idx[0], idx[k], idx[k + 1]])
    v = np.asarray(v, dtype=np.float64)
    # Z-up millimetres, front = -Y  ->  Y-up metres, front = +Z
    v = np.column_stack([v[:, 0], v[:, 2], -v[:, 1]]) / 1000.0
    return v, np.asarray(f, dtype=np.int64)


data = json.load(open(PARTS))
by_sys = {}
for p in data['parts']:
    by_sys.setdefault(p['sys'], []).append(p)

index = {'systems': [], 'parts': {}}
for sysd in data['systems']:
    key = sysd['key']
    parts = by_sys.get(key, [])
    if not parts:
        continue
    meshes = {p['file']: load(p['file']) for p in parts}
    total = sum(len(f) for _, f in meshes.values())
    ratio = min(1.0, BUDGET.get(key, total) / total)
    scene = trimesh.Scene()
    kept = 0
    for p in parts:
        v, f = meshes[p['file']]
        if len(f) == 0:
            continue
        target = max(min(len(f), MIN_FACES), int(len(f) * ratio))
        if target < len(f):
            v, f = fast_simplification.simplify(v.astype(np.float32), f.astype(np.int32),
                                                target_reduction=1 - target / len(f))
        m = trimesh.Trimesh(vertices=v, faces=f, process=False)
        scene.add_geometry(m, node_name=p['file'], geom_name=p['file'])
        lo, hi = v.min(axis=0), v.max(axis=0)
        index['parts'][p['file']] = {'name': p['name'], 'sys': key,
                                     'b': [round(float(x), 4) for x in (*lo, *hi)]}
        kept += len(f)
    path = os.path.join(OUT, key + '.glb')
    scene.export(path)
    index['systems'].append({'key': key, 'label': sysd['label'], 'file': key + '.glb',
                             'parts': len(parts), 'triangles': kept})
    print(f'{key:10s} {len(parts):4d} parts  {total:8d} -> {kept:7d} triangles  '
          f'{os.path.getsize(path) / 1e6:6.1f} MB')

json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), separators=(',', ':'))
