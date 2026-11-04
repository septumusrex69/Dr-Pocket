"""Whole organs and regions made of several part files (liver, heart, brain, right hand...),
taken from the BodyParts3D part-of tree, so search can find them as one thing.

Usage: python3 tools/build_groups.py <bodyparts3d download folder> public/models/index.json public/models/groups.json
"""
import collections
import json
import re
import sys

SRC, INDEX, OUT = sys.argv[1:4]
have = set(json.load(open(INDEX))['parts'])
names = {v['name'].lower() for v in json.load(open(INDEX))['parts'].values()}
grp = collections.defaultdict(set)
for line in open(f'{SRC}/partof_element_parts.txt', encoding='utf-8').read().splitlines()[1:]:
    _, n, f = line.split('\t')
    if f in have:
        grp[n].add(f)
SKIP = re.compile(r'^human body$|compartment|^content of|^body proper$|^body cavity|^vasculature of body$|system$|^immaterial|^physical|^region of|^subdivision|^organ with|^segment of', re.I)
out = {}
for n, ids in grp.items():
    if len(ids) < 2 or SKIP.search(n) or n.lower() in names:
        continue
    out[n[0].upper() + n[1:]] = sorted(ids)
json.dump(out, open(OUT, 'w'), separators=(',', ':'))
print(len(out), 'groups')
