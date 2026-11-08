"""Draw the structures BodyParts3D lacks (labrum, cruciate ligaments, menisci, joint cartilage,
spinal cord, nerve roots, ankle ligaments...) from the bones around them, so they sit in the
right place on this body. Every one is an approximate shape and is marked as drawn.

Usage: python3 tools/build_added.py <bodyparts3d download folder> <output folder>
Run after build_models.py (it reads and extends <output folder>/index.json), then pack_models.sh.
"""
import json
import os
import sys

import numpy as np
import trimesh
from scipy.spatial import cKDTree

SRC, OUT = sys.argv[1:3]
OBJ = os.path.join(SRC, 'raw', 'isa_BP3D_4.0_obj_99')
index = json.load(open(os.path.join(OUT, 'index.json')))
index['parts'] = {k: v for k, v in index['parts'].items() if v.get('sys') != 'added'}  # safe to re-run
BYNAME = {v['name']: k for k, v in index['parts'].items()}
UP = np.array([0.0, 1.0, 0.0])
FRONT = np.array([0.0, 0.0, 1.0])

COLOR = {
    'ligament': '#C9DCE4', 'tendon': '#C9DCE4', 'labrum': '#1FA88A', 'meniscus': '#2BA6A0',
    'cartilage': '#6FB4E6', 'nerve': '#F2C33A', 'cord': '#F5D25A',
}


def load(name):
    """A BodyParts3D part as a trimesh in Y-up metres (same transform as build_models.py)."""
    fj = BYNAME[name]
    v, f = [], []
    with open(os.path.join(OBJ, fj + '.obj'), encoding='utf-8', errors='replace') as fh:
        for line in fh:
            if line.startswith('v '):
                v.append([float(x) for x in line.split()[1:4]])
            elif line.startswith('f '):
                ix = [int(x.split('/')[0]) - 1 for x in line.split()[1:]]
                for k in range(1, len(ix) - 1):
                    f.append([ix[0], ix[k], ix[k + 1]])
    v = np.asarray(v)
    v = np.column_stack([v[:, 0], v[:, 2], -v[:, 1]]) / 1000.0
    return trimesh.Trimesh(v, np.asarray(f), process=True)


_cache = {}


def bone(name):
    if name not in _cache:
        _cache[name] = load(name)
    return _cache[name]


def unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


def smooth_path(pts, n=40):
    """Catmull-Rom through the points, resampled to n points."""
    pts = np.asarray(pts, float)
    if len(pts) == 2:
        return np.linspace(pts[0], pts[1], n)
    p = np.vstack([pts[0] * 2 - pts[1], pts, pts[-1] * 2 - pts[-2]])
    out = []
    segs = len(pts) - 1
    for i in range(segs):
        p0, p1, p2, p3 = p[i], p[i + 1], p[i + 2], p[i + 3]
        for t in np.linspace(0, 1, max(2, n // segs), endpoint=(i == segs - 1)):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    return np.asarray(out)


def sweep(path, rx, ry=None, ref=None, closed=False, sides=14, taper=None):
    """A tube along the path with an elliptical cross-section (rx across ref, ry along it).
    rx/ry may be arrays (one per path point). taper narrows the ends."""
    path = np.asarray(path, float)
    n = len(path)
    rx = np.broadcast_to(np.asarray(rx, float), (n,)).copy()
    ry = rx.copy() if ry is None else np.broadcast_to(np.asarray(ry, float), (n,)).copy()
    if taper:
        k = np.minimum(np.arange(n), np.arange(n)[::-1]) / max(1, taper)
        s = np.clip(0.35 + 0.65 * k, 0, 1)
        rx, ry = rx * s, ry * s
    verts, faces = [], []
    prev_normal = None
    for i in range(n):
        if closed:
            t = unit(path[(i + 1) % n] - path[i - 1])
        else:
            t = unit(path[min(i + 1, n - 1)] - path[max(i - 1, 0)])
        r = ref if ref is not None else (prev_normal if prev_normal is not None else UP)
        r = np.asarray(r(i) if callable(r) else r, float)
        nrm = unit(r - t * np.dot(r, t))
        if np.linalg.norm(nrm) < 1e-6:
            nrm = unit(np.cross(t, FRONT))
        prev_normal = nrm
        bin_ = np.cross(t, nrm)
        for k in range(sides):
            a = 2 * np.pi * k / sides
            verts.append(path[i] + bin_ * np.cos(a) * rx[i] + nrm * np.sin(a) * ry[i])
    rings = n if closed else n - 1
    for i in range(rings):
        j = (i + 1) % n
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            c, d = j * sides + k, j * sides + (k + 1) % sides
            faces += [[a, c, b], [b, c, d]]
    if not closed:  # caps
        for end, rev in ((0, True), (n - 1, False)):
            ci = len(verts)
            verts.append(path[end])
            for k in range(sides):
                a, b = end * sides + k, end * sides + (k + 1) % sides
                faces.append([ci, b, a] if rev else [ci, a, b])
    return trimesh.Trimesh(np.asarray(verts), np.asarray(faces), process=False)


def shell(b, partner, within, thickness=0.0018, extra=None):
    """Cartilage: the faces of bone b within `within` metres of the partner, lifted off the bone."""
    d, _ = cKDTree(partner.vertices).query(b.vertices)
    keep = d < within
    if extra is not None:
        keep &= extra(b.vertices, b.vertex_normals)
    fmask = keep[b.faces].all(axis=1)
    if fmask.sum() < 10:
        return None
    sub = b.submesh([np.where(fmask)[0]], append=True)
    sub.vertices = sub.vertices + sub.vertex_normals * thickness
    return sub


def side_x(side):
    """Unit x pointing medially (towards the body's midline) for that side: right is -x."""
    return 1.0 if side == 'Right' else -1.0


def rim_loop(patch_pts, toward, grow=0.0015, lift=0.0015, bins=48):
    """Closed loop around the edge of a joint surface (glenoid, acetabulum), in its own plane."""
    c = patch_pts.mean(axis=0)
    u, s, vt = np.linalg.svd(patch_pts - c)
    nrm = vt[2]
    if np.dot(nrm, toward - c) < 0:
        nrm = -nrm
    e1, e2 = vt[0], vt[1]
    rel = patch_pts - c
    ang = np.arctan2(rel @ e2, rel @ e1)
    rad = np.hypot(rel @ e1, rel @ e2)
    radius = np.zeros(bins)
    for i in range(bins):
        a0, a1 = -np.pi + 2 * np.pi * i / bins, -np.pi + 2 * np.pi * (i + 1) / bins
        m = (ang >= a0) & (ang < a1)
        radius[i] = rad[m].max() if m.any() else np.nan
    good = ~np.isnan(radius)
    radius = np.interp(np.arange(bins), np.where(good)[0], radius[good], period=bins)
    radius = np.convolve(np.r_[radius[-2:], radius, radius[:2]], np.ones(5) / 5, 'valid')
    pts = []
    for i in range(bins):
        a = -np.pi + 2 * np.pi * (i + 0.5) / bins
        pts.append(c + (e1 * np.cos(a) + e2 * np.sin(a)) * (radius[i] + grow) + nrm * lift)
    return np.asarray(pts), nrm


def push_out(path, bones, clearance=0.0025, keep_ends=True):
    """Move any point of a path that is inside (or touching) a bone to just outside its surface,
    so a drawn ligament lies on the bones instead of through them."""
    path = np.array(path, float)
    rng = range(1, len(path) - 1) if keep_ends else range(len(path))
    for b in bones:
        pts = path[list(rng)]
        inside = b.contains(pts)
        cp, dist, tri = trimesh.proximity.closest_point(b, pts)
        nrm = b.face_normals[tri]
        for k, i in enumerate(rng):
            if inside[k] or dist[k] < clearance:
                path[i] = cp[k] + nrm[k] * clearance
    # smooth the result a little so the pushed points do not kink the band
    if len(path) > 4:
        sm = path.copy()
        sm[1:-1] = (path[:-2] + 2 * path[1:-1] + path[2:]) / 4
        path = sm
    return path


added = []  # (name, kind, mesh)


def add(name, kind, mesh):
    if mesh is not None and len(mesh.faces):
        added.append((name, kind, mesh))


# ---------------------------------------------------------------- shoulder
for side in ('Right', 'Left'):
    sc, hu = bone(f'{side} scapula'), bone(f'{side} humerus')
    d, _ = cKDTree(hu.vertices).query(sc.vertices)
    glen = sc.vertices[d < 0.006]
    head_c = hu.vertices[cKDTree(glen).query(hu.vertices)[0] < 0.02].mean(axis=0)
    loop, nrm = rim_loop(glen, head_c, grow=0.001, lift=0.0012)
    add(f'{side} glenoid labrum', 'labrum', sweep(loop, 0.0032, 0.0026, ref=lambda i, n=nrm: n, closed=True))
    add(f'Cartilage of {side.lower()} glenoid cavity', 'cartilage', shell(sc, hu, 0.006, 0.0012))
    add(f'Cartilage of {side.lower()} humeral head', 'cartilage', shell(hu, sc, 0.022, 0.0012,
        extra=lambda v, n, c=head_c: np.linalg.norm(v - c, axis=1) < 0.03))

# ---------------------------------------------------------------- hip
for side in ('Right', 'Left'):
    hb, fe = bone(f'{side} hip bone'), bone(f'{side} femur')
    d, _ = cKDTree(fe.vertices).query(hb.vertices)
    acet = hb.vertices[d < 0.006]
    head_c = fe.vertices[cKDTree(acet).query(fe.vertices)[0] < 0.02].mean(axis=0)
    loop, nrm = rim_loop(acet, head_c, grow=0.0015, lift=0.0)
    add(f'{side} acetabular labrum', 'labrum', sweep(loop, 0.0035, 0.003, ref=lambda i, n=nrm: n, closed=True))
    add(f'Cartilage of {side.lower()} acetabulum', 'cartilage', shell(hb, fe, 0.006, 0.0012))
    add(f'Cartilage of {side.lower()} femoral head', 'cartilage', shell(fe, hb, 0.012, 0.0012,
        extra=lambda v, n, c=head_c: np.linalg.norm(v - c, axis=1) < 0.032))

# ---------------------------------------------------------------- knee
for side in ('Right', 'Left'):
    fe, ti, pa, fi = bone(f'{side} femur'), bone(f'{side} tibia'), bone(f'{side} patella'), bone(f'{side} fibula')
    med = np.array([side_x(side), 0, 0])
    lat = -med
    joint_y = fe.vertices[:, 1].min()
    # tibial plateau: top of the tibia, split into the inner (medial) and outer (lateral) halves
    top = ti.vertices[ti.vertices[:, 1] > ti.vertices[:, 1].max() - 0.012]
    pc = np.array([np.median(top[:, 0]), top[:, 1].max(), np.median(top[:, 2])])
    halves = {}
    for nm, sgn in (('medial', med), ('lateral', lat)):
        pts = top[(top[:, 0] - pc[0]) * sgn[0] > 0.004]
        c = np.array([pts[:, 0].mean(), 0, pts[:, 2].mean()])
        rx, rz = (pts[:, 0].max() - pts[:, 0].min()) / 2, (pts[:, 2].max() - pts[:, 2].min()) / 2
        halves[nm] = (c, rx, rz, pts)
    # menisci: C-shaped wedges around the edge of each half, open towards the middle of the knee
    for nm, gap in (('medial', 0.85), ('lateral', 0.5)):
        c, rx, rz, pts = halves[nm]
        toward_mid = np.sign(pc[0] - c[0])
        start = np.arctan2(0, toward_mid) + gap / 2  # angle (in x-z) pointing at the knee's middle
        ang = np.linspace(start, start + 2 * np.pi - gap, 40)
        tree = cKDTree(pts[:, [0, 2]])
        path = []
        for a in ang:
            x, z = c[0] + np.cos(a) * rx * 0.78, c[2] + np.sin(a) * rz * 0.8
            _, j = tree.query([x, z])
            path.append([x, pts[j, 1] + 0.0022, z])
        path = smooth_path(np.asarray(path)[::3], 48)
        add(f'{side} {nm} meniscus', 'meniscus', sweep(path, 0.0045, 0.0028, ref=UP, taper=6))
    # cruciate ligaments from the tibia's middle up into the notch between the femur's condyles
    low = fe.vertices[fe.vertices[:, 1] < joint_y + 0.03]
    notch_x, back_z, front_z = np.median(low[:, 0]), low[:, 2].min(), low[:, 2].max()
    acl_t = np.array([pc[0], pc[1] + 0.001, pc[2] + 0.009])
    acl_f = np.array([notch_x + lat[0] * 0.008, joint_y + 0.02, back_z + 0.008])
    mid = (acl_t + acl_f) / 2 + lat * 0.002
    add(f'{side} anterior cruciate ligament', 'ligament', sweep(push_out(smooth_path([acl_t, mid, acl_f], 24), [fe, ti], 0.004), 0.0045, 0.0034, ref=lat, taper=4))
    pcl_t = np.array([pc[0], pc[1] - 0.006, pc[2] - 0.016])
    pcl_f = np.array([notch_x + med[0] * 0.008, joint_y + 0.022, (back_z + front_z) / 2 + 0.006])
    mid = (pcl_t + pcl_f) / 2 - FRONT * 0.003
    add(f'{side} posterior cruciate ligament', 'ligament', sweep(push_out(smooth_path([pcl_t, mid, pcl_f], 24), [fe, ti], 0.0045), 0.005, 0.0038, ref=med, taper=4))
    # collateral ligaments on the inner and outer side
    band = fe.vertices[(fe.vertices[:, 1] > joint_y + 0.025) & (fe.vertices[:, 1] < joint_y + 0.05)]
    f_med = band[np.argmax(band[:, 0] * med[0])] + med * 0.0015
    f_lat = band[np.argmax(band[:, 0] * lat[0])] + lat * 0.0015
    tband = ti.vertices[(ti.vertices[:, 1] < joint_y - 0.05) & (ti.vertices[:, 1] > joint_y - 0.07)]
    t_med = tband[np.argmax(tband[:, 0] * med[0])] + med * 0.0015
    mcl_path = smooth_path([f_med, np.array([pc[0] + med[0] * (abs(halves['medial'][0][0] - pc[0]) + halves['medial'][1] + 0.002), joint_y - 0.004, (f_med[2] + t_med[2]) / 2]), t_med], 30)
    mcl_path = push_out(mcl_path, [fe, ti], 0.0025, keep_ends=False)
    add(f'{side} medial collateral ligament', 'ligament', sweep(mcl_path, 0.0055, 0.0015, ref=med, taper=3))
    fhead = fi.vertices[fi.vertices[:, 1] > fi.vertices[:, 1].max() - 0.012]
    fib = fhead[np.argmax(fhead[:, 0] * lat[0])] + lat * 0.0015
    add(f'{side} lateral collateral ligament', 'ligament', sweep(push_out(smooth_path([f_lat, (f_lat + fib) / 2 + lat * 0.003, fib], 24), [fe, ti, fi], 0.003, keep_ends=False), 0.0028, ref=lat, taper=3))
    # patellar tendon: bottom of the kneecap to the bump at the front of the tibia
    p_low = pa.vertices[np.argmin(pa.vertices[:, 1])]
    tfront = ti.vertices[(ti.vertices[:, 1] < pc[1] - 0.025) & (ti.vertices[:, 1] > pc[1] - 0.045)]
    tub = tfront[np.argmax(tfront[:, 2])] + FRONT * 0.002
    add(f'{side} patellar tendon', 'tendon', sweep(smooth_path([p_low + FRONT * 0.002, (p_low + tub) / 2 + FRONT * 0.004, tub], 24), 0.011, 0.0028, ref=FRONT, taper=3))
    # cartilage on the joint surfaces
    add(f'Cartilage of {side.lower()} femoral condyles', 'cartilage', shell(fe, ti, 0.012, 0.0015,
        extra=lambda v, n, jy=joint_y: v[:, 1] < jy + 0.04))
    add(f'Cartilage of {side.lower()} trochlea', 'cartilage', shell(fe, pa, 0.008, 0.0015))
    add(f'Cartilage of {side.lower()} tibial plateau', 'cartilage', shell(ti, fe, 0.01, 0.0015,
        extra=lambda v, n: n[:, 1] > 0.4))
    add(f'Cartilage of {side.lower()} patella', 'cartilage', shell(pa, fe, 0.009, 0.0015))

# ---------------------------------------------------------------- ankle
for side in ('Right', 'Left'):
    fi, ta, ca = bone(f'{side} fibula'), bone(f'{side} talus'), bone(f'{side} calcaneus')
    lat = np.array([-side_x(side), 0, 0])
    tip_zone = fi.vertices[fi.vertices[:, 1] < fi.vertices[:, 1].min() + 0.015]
    # outer-front corner of the ankle knob (lateral malleolus), not its inner face
    front_tip = tip_zone[np.argmax(tip_zone[:, 2] + 0.6 * tip_zone[:, 0] * lat[0])] + lat * 0.0025
    low_tip = tip_zone[np.argmin(tip_zone[:, 1] - 0.3 * tip_zone[:, 0] * lat[0])] + lat * 0.0025
    tc = ta.vertices.mean(axis=0)
    neck = ta.vertices[(ta.vertices[:, 2] > tc[2] + 0.008) & (ta.vertices[:, 1] > tc[1] - 0.006)]
    t_pt = neck[np.argmax(neck[:, 0] * lat[0] + 0.3 * neck[:, 2])] + lat * 0.0025
    add(f'{side} anterior talofibular ligament', 'ligament', sweep(smooth_path([front_tip, t_pt], 16), 0.0045, 0.0015, ref=lat, taper=3))
    cside = ca.vertices[(ca.vertices[:, 2] < low_tip[2] + 0.004) & (ca.vertices[:, 2] > low_tip[2] - 0.02)]
    c_pt = cside[np.argmax(cside[:, 0] * lat[0])] + lat * 0.0025
    add(f'{side} calcaneofibular ligament', 'ligament', sweep(smooth_path([low_tip, (low_tip + c_pt) / 2 + lat * 0.002, c_pt], 20), 0.0028, ref=lat, taper=3))

# ---------------------------------------------------------------- spine: cord, cauda equina and nerve roots
VERT = ['Atlas', 'Axis'] + [f'{w} cervical vertebra' for w in ('Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh')] + \
       [f'{w} thoracic vertebra' for w in ('First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth')] + \
       [f'{w} lumbar vertebra' for w in ('First', 'Second', 'Third', 'Fourth', 'Fifth')]
LABEL = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'] + [f'T{i}' for i in range(1, 13)] + [f'L{i}' for i in range(1, 6)]


def canal_centre(vb, y=None, zrange=None):
    """Middle of the spinal canal through a vertebra (or the sacrum at height y): the point
    outside the bone, with bone both in front and behind, furthest from any bone surface."""
    v = vb.vertices
    h = v[:, 1].max() - v[:, 1].min()
    levels = [y] if y is not None else [v[:, 1].min() + h * f for f in (0.5, 0.65, 0.35, 0.75, 0.25)]
    for strict in (True, False):  # relaxed: bone in front only (a ring open at the back)
        for ymid in levels:
            found = _canal_at(vb, v, ymid, strict, zrange)
            if found is not None:
                return found
    raise ValueError('no spinal canal found')


def _canal_at(vb, v, ymid, strict, zrange=None):
    xs = np.arange(-0.007, 0.0071, 0.001)
    zs = np.arange(v[:, 2].min(), v[:, 2].max(), 0.001)
    grid = np.array([[x, ymid, z] for x in xs for z in zs])
    inside = vb.contains(grid).reshape(len(xs), len(zs))
    dist, _ = cKDTree(v).query(grid)
    dist = dist.reshape(len(xs), len(zs))
    best, bd = None, -1
    for i, x in enumerate(xs):
        row = inside[i]
        for j, z in enumerate(zs):
            if zrange and not (zrange[0] <= z <= zrange[1]):
                continue
            if row[j] or not row[j + 1:].any() or (strict and not row[:j].any()):
                continue  # inside bone, or not enclosed front (and back)
            if dist[i, j] > bd:
                bd, best = dist[i, j], (x, z)
    if best is None or bd < 0.003:
        return None
    return np.array([best[0], ymid, best[1]]), bd


centres = []
for name in VERT:
    if name in BYNAME:
        c, r = canal_centre(bone(name))
        centres.append((name, c, r))
# spinal cord: from the base of the skull down the canal of each vertebra, ending at L1
sacrum = bone('Sacrum')
sac = sacrum.vertices
sac_top = None
for dy in (0.012, 0.018, 0.025, 0.008, 0.032):  # the sacral canal near its top
    try:
        # the canal carries on from the last lumbar vertebra, so look near the same depth
        c5z = centres[-1][1][2]
        sac_top, _ = canal_centre(sacrum, y=sac[:, 1].max() - dy, zrange=(c5z - 0.02, c5z + 0.012))
        break
    except ValueError:
        pass
if sac_top is None:  # fall back to just below the last lumbar canal
    sac_top = centres[-1][1] + np.array([0, -0.045, -0.012])
names = [n for n, c, r in centres]
upto = names.index('First lumbar vertebra')
top = centres[0][1] + np.array([0, 0.022, 0])
cord_pts = [top] + [c for n, c, r in centres[:upto + 1]]
cord_path = smooth_path(cord_pts, 120)
radius = np.interp(np.linspace(0, 1, len(cord_path)), [0, 0.1, 0.22, 0.85, 0.95, 1], [0.0062, 0.0062, 0.0052, 0.0045, 0.004, 0.0015])
add('Spinal cord', 'cord', sweep(cord_path, radius, ref=FRONT))
# cauda equina: the bundle of nerve roots carrying on from L1 down the lumbar canal into the sacrum
cauda = smooth_path([c for n, c, r in centres[upto:]] + [sac_top], 50)
add('Cauda equina', 'nerve', sweep(cauda, 0.0034, ref=FRONT, taper=8))
# nerve roots leave through the gap between each vertebra and the one below it
for k in range(len(centres) - 1):
    (n1, c1, r1), (n2, c2, r2) = centres[k], centres[k + 1]
    lab = LABEL[VERT.index(n1)]
    # cervical roots are named after the vertebra below; thoracic and lumbar after the one above
    name = ('C' + str(int(lab[1:]) + 1)) if lab.startswith('C') else lab
    y = (bone(n1).vertices[:, 1].min() + bone(n2).vertices[:, 1].max()) / 2
    cz = (c1[2] + c2[2]) / 2
    src_y = y + (0.02 if lab.startswith('L') or lab in ('T11', 'T12') else 0.006)  # lower roots run down first
    for side in ('Right', 'Left'):
        out = -side_x(side)  # away from the midline
        rr = (r1 + r2) / 2
        p0 = np.array([out * 0.0025, src_y, cz])
        p1 = np.array([out * (rr + 0.004), y, cz + 0.002])
        p2 = np.array([out * (rr + 0.016), y - 0.006, cz + 0.008])
        p3 = np.array([out * (rr + 0.032), y - 0.016, cz + 0.014])
        add(f'{side} {name} nerve root', 'nerve', sweep(smooth_path([p0, p1, p2, p3], 24), 0.0022, ref=UP, taper=3))
# L5 root leaves between the fifth lumbar vertebra and the sacrum
n5, c5, r5 = centres[-1]
y5 = (bone(n5).vertices[:, 1].min() + sac[:, 1].max()) / 2
for side in ('Right', 'Left'):
    out = -side_x(side)
    p0 = np.array([out * 0.0025, y5 + 0.02, c5[2]])
    p1 = np.array([out * (r5 + 0.004), y5, c5[2] + 0.002])
    p2 = np.array([out * (r5 + 0.016), y5 - 0.008, c5[2] + 0.008])
    p3 = np.array([out * (r5 + 0.03), y5 - 0.022, c5[2] + 0.014])
    add(f'{side} L5 nerve root', 'nerve', sweep(smooth_path([p0, p1, p2, p3], 24), 0.0024, ref=UP, taper=3))
# S1 root out of the first hole in the sacrum
for side in ('Right', 'Left'):
    out = -side_x(side)
    p0 = np.array([out * 0.003, sac_top[1] + 0.01, sac_top[2]])
    p1 = np.array([out * 0.014, sac_top[1] - 0.012, sac_top[2] + 0.006])
    p2 = np.array([out * 0.026, sac_top[1] - 0.03, sac_top[2] + 0.012])
    add(f'{side} S1 nerve root', 'nerve', sweep(smooth_path([p0, p1, p2], 20), 0.0024, ref=UP, taper=3))

# ---------------------------------------------------------------- check: drawn parts should not be buried in bone
BONES = {'ankle': ['fibula', 'talus', 'calcaneus', 'tibia'], 'knee': ['femur', 'tibia', 'fibula', 'patella']}
for name, kind, mesh in added:
    group = 'ankle' if ('talofibular' in name or 'calcaneofibular' in name) else 'knee' if ('cruciate' in name or 'collateral' in name or 'patellar' in name) else None
    if not group:
        continue
    side = name.split()[0]
    buried = np.zeros(len(mesh.vertices), bool)
    for b in BONES[group]:
        buried |= bone(f'{side} {b}').contains(mesh.vertices)
    print(f'  {name}: {buried.mean() * 100:.0f}% inside bone')

# ---------------------------------------------------------------- write
scene = trimesh.Scene()
for k, (name, kind, mesh) in enumerate(added):
    pid = f'DP{k:03d}'
    scene.add_geometry(mesh, node_name=pid, geom_name=pid)
    lo, hi = mesh.vertices.min(axis=0), mesh.vertices.max(axis=0)
    index['parts'][pid] = {'name': name, 'sys': 'added', 'drawn': True, 'color': COLOR[kind],
                           'b': [round(float(x), 4) for x in (*lo, *hi)]}
path = os.path.join(OUT, 'added.glb')
scene.export(path)
index['systems'] = [s for s in index['systems'] if s['key'] != 'added'] + [
    {'key': 'added', 'label': 'Drawn by Dr Pocket', 'file': 'added.glb', 'parts': len(added),
     'triangles': int(sum(len(m.faces) for _, _, m in added))}]
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), separators=(',', ':'))
print(len(added), 'drawn parts,', sum(len(m.faces) for _, _, m in added), 'triangles,', round(os.path.getsize(path) / 1e6, 2), 'MB')
for name, kind, m in added[:12]:
    print(' ', name, kind, len(m.faces))
