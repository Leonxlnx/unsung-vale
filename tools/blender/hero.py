"""
hero.py  --  procedural player character for "Unsung Vale": the Cantor.

Everything (mesh, rig, weights, materials) is generated from code in an empty
scene.  No external assets, no image textures.

Run (headless):
  blender --background --threads 4 --python tools/blender/hero.py -- [options]

Options (after "--"):
  --no-render        skip the preview renders
  --no-export        skip the GLB export
  --views a,b,c      subset of front,back,side,34,pose
  --samples N        EEVEE TAA samples (default 24)
  --shot "path;az;elev;tx,ty,tz;height;WxH;posed"   extra debug render
  --blend path       also save a .blend (debugging only)

Blender space while building: +Z up, character faces -Y, character's left is
+X.  The glTF exporter converts to +Y up, so in the GLB the character faces
+Z with +X on its left.  Units are metres.
"""
import bpy, bmesh, sys, os, math, time, bisect, warnings
from math import sin, cos, pi, radians, degrees, sqrt, atan2, hypot
from mathutils import Vector, Matrix, Quaternion

T_START = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'hero.glb')
OUT_DIR = os.path.join(ROOT, 'tools', 'out')

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None, flag=False):
    if name in ARGV:
        if flag:
            return True
        return ARGV[ARGV.index(name) + 1]
    return False if flag else default


def opt_all(name):
    return [ARGV[i + 1] for i, a in enumerate(ARGV) if a == name and i + 1 < len(ARGV)]


# ----------------------------------------------------------------------------
# small maths helpers
# ----------------------------------------------------------------------------
def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(a, b, x):
    if a == b:
        return 0.0 if x < a else 1.0
    t = clamp((x - a) / (b - a))
    return t * t * (3.0 - 2.0 * t)


def spow(c, e):
    return math.copysign(abs(c) ** e, c)


def gauss(x, s=1.0):
    return math.exp(-(x / s) ** 2)


def tent(x, w, p=1.0):
    return max(0.0, 1.0 - abs(x) / w) ** p


def wrap_pi(a):
    return (a + pi) % (2 * pi) - pi


def V(x, y, z):
    return Vector((x, y, z))


class Table:
    """Smooth (Catmull-Rom) interpolation of rows keyed by their first column."""

    def __init__(self, rows):
        self.x = [float(r[0]) for r in rows]
        self.y = [tuple(float(c) for c in r[1:]) for r in rows]
        n = len(rows)
        k = len(self.y[0])
        self.m = []
        for i in range(n):
            i0, i1 = max(i - 1, 0), min(i + 1, n - 1)
            dx = self.x[i1] - self.x[i0]
            self.m.append(tuple((self.y[i1][j] - self.y[i0][j]) / dx for j in range(k)))

    def __call__(self, x):
        xs = self.x
        if x <= xs[0]:
            return self.y[0]
        if x >= xs[-1]:
            return self.y[-1]
        i = bisect.bisect_right(xs, x) - 1
        h = xs[i + 1] - xs[i]
        t = (x - xs[i]) / h
        t2, t3 = t * t, t * t * t
        h00, h10, h01, h11 = 2 * t3 - 3 * t2 + 1, t3 - 2 * t2 + t, -2 * t3 + 3 * t2, t3 - t2
        a, b, ma, mb = self.y[i], self.y[i + 1], self.m[i], self.m[i + 1]
        return tuple(h00 * a[j] + h10 * h * ma[j] + h01 * b[j] + h11 * h * mb[j] for j in range(len(a)))


# ----------------------------------------------------------------------------
# geometry accumulator
# ----------------------------------------------------------------------------
def mirror_name(n):
    if n.endswith('.L'):
        return n[:-2] + '.R'
    if n.endswith('.R'):
        return n[:-2] + '.L'
    if '.L.' in n:
        return n.replace('.L.', '.R.')
    if '.R.' in n:
        return n.replace('.R.', '.L.')
    return n


def norm_w(w):
    """weights -> dict, at most 4 influences, normalised"""
    if isinstance(w, str):
        return {w: 1.0}
    items = sorted(((k, v) for k, v in w.items() if v > 1e-4), key=lambda kv: -kv[1])[:4]
    s = sum(v for _, v in items)
    return {k: v / s for k, v in items}


# Proportion pass.  The body tables below were authored for a slightly
# short-legged figure; every part except the arms is passed through this
# monotonic height remap (longer legs, shorter waist) when it is emitted, and
# so are the bones.  Heights inside the builders are therefore "authoring"
# heights; zw() gives the final height.
_ZW = [(-1.0, -1.0), (0.085, 0.085), (0.50, 0.525), (0.94, 0.985), (1.10, 1.135), (1.33, 1.335),
       (1.40, 1.40), (3.0, 3.0)]


def zw(z):
    for (a, fa), (b, fb) in zip(_ZW, _ZW[1:]):
        if z <= b:
            return fa + (fb - fa) * (z - a) / (b - a)
    return z


def zwp(p):
    return V(p.x, p.y, zw(p.z))


class Geo:
    def __init__(self, warp=True):
        self.v, self.w = [], []
        self.f, self.fm, self.fs = [], [], []
        self.parts = []
        self.default_warp = warp
        self._mark = (0, 0, '', warp)

    def begin(self, name, warp=None):
        self._mark = (len(self.v), len(self.f), name, self.default_warp if warp is None else warp)

    def vert(self, p, w):
        self.v.append(Vector(p))
        self.w.append(norm_w(w))
        return len(self.v) - 1

    def face(self, idx, mat, sharp=35.0):
        self.f.append(tuple(idx))
        self.fm.append(mat)
        self.fs.append(sharp)

    def end(self, mirror=None, closed=True):
        v0, f0, name, warp = self._mark
        if warp:
            for i in range(v0, len(self.v)):
                self.v[i].z = zw(self.v[i].z)
        if closed:   # make the winding point outward (positive signed volume)
            vol = 0.0
            for f in self.f[f0:]:
                a = self.v[f[0]]
                for i in range(1, len(f) - 1):
                    vol += a.dot(self.v[f[i]].cross(self.v[f[i + 1]]))
            if vol < 0.0:
                for i in range(f0, len(self.f)):
                    self.f[i] = tuple(reversed(self.f[i]))
        if mirror == 'only':
            for i in range(v0, len(self.v)):
                p = self.v[i]
                self.v[i] = V(-p.x, p.y, p.z)
                self.w[i] = {mirror_name(k): x for k, x in self.w[i].items()}
            for i in range(f0, len(self.f)):
                self.f[i] = tuple(reversed(self.f[i]))
        elif mirror == 'both':
            nv, nf = len(self.v) - v0, len(self.f) - f0
            for i in range(v0, v0 + nv):
                p = self.v[i]
                self.v.append(V(-p.x, p.y, p.z))
                self.w.append({mirror_name(k): x for k, x in self.w[i].items()})
            for i in range(f0, f0 + nf):
                self.f.append(tuple(reversed([j + nv for j in self.f[i]])))
                self.fm.append(self.fm[i])
                self.fs.append(self.fs[i])
        self.parts.append((name, f0, len(self.f)))

    def tris(self, f0=0, f1=None):
        return sum(len(f) - 2 for f in self.f[f0:f1])


def wfun(w):
    if callable(w):
        return w
    return lambda p, a, b: w


def polylen(pts):
    return sum((pts[i + 1] - pts[i]).length for i in range(len(pts) - 1))


# ----------------------------------------------------------------------------
# generators
# ----------------------------------------------------------------------------
def loft(g, rings, mat, w, cap0=True, cap1=True, sharp=35.0, mats=None):
    """Skin a list of closed rings (lists of Vector, same count)."""
    wf = wfun(w)
    idx = [[g.vert(p, wf(p, i, k)) for k, p in enumerate(ring)] for i, ring in enumerate(rings)]
    n = len(rings[0])
    for i in range(len(rings) - 1):
        m = mats[i] if mats else mat
        for k in range(n):
            k2 = (k + 1) % n
            g.face((idx[i][k], idx[i][k2], idx[i + 1][k2], idx[i + 1][k]), m, sharp)
    for end, cap in ((0, cap0), (len(rings) - 1, cap1)):
        if not cap:
            continue
        c = sum(rings[end], Vector()) / n
        ci = g.vert(c, wf(c, end, 0))
        m = (mats[0] if end == 0 else mats[-1]) if mats else mat
        for k in range(n):
            k2 = (k + 1) % n
            if end == 0:
                g.face((ci, idx[end][k2], idx[end][k]), m, sharp)
            else:
                g.face((ci, idx[end][k], idx[end][k2]), m, sharp)


def tube_along(g, pts, radii, nseg, mat, w, sharp=40.0, mats=None, up=None):
    """Round (or elliptical: radii entries may be (r_n, r_b)) tube along a polyline."""
    n = len(pts)
    tans = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    t0 = tans[0]
    a = up if up is not None else (V(0, 0, 1) if abs(t0.z) < 0.9 else V(1, 0, 0))
    nrm = (a - t0 * a.dot(t0)).normalized()
    rings = []
    for i in range(n):
        t = tans[i]
        nrm = (nrm - t * nrm.dot(t)).normalized()
        b = t.cross(nrm)
        r = radii[i]
        rn, rb = r if isinstance(r, tuple) else (r, r)
        rings.append([pts[i] + nrm * (rn * cos(2 * pi * k / nseg)) + b * (rb * sin(2 * pi * k / nseg))
                      for k in range(nseg)])
    loft(g, rings, mat, w, sharp=sharp, mats=mats)


def shell(g, S, nu, nv, *, wrap=False, thick=0.005, mat='Armor', tmat='Gold',
          eu0='bevel', eu1='bevel', ev0='bevel', ev1='bevel',
          tw=0.012, th=0.0024, bev=0.0016, rise=0.0016, w='Chest', sharp=35.0,
          ref=None, us=None, vs=None, inner_mat=None):
    """A plate / cloth panel with real thickness built from a parametric surface.

    S(u, v) -> Vector is the outer base surface over [0,1]^2 (periodic in u if
    wrap).  Each open border is either 'bevel' (chamfered edge), 'trim'
    (raised strip of `tmat`, plus chamfer) or 'plain'.  The plate is closed
    with a rim and an inner surface `thick` below the base surface.
    """
    inner_mat = inner_mat or mat

    def P(u, v):
        return S(u % 1.0 if wrap else u, v)

    Lu = sum(polylen([P(i / 12, vv) for i in range(13)]) for vv in (0.2, 0.5, 0.8)) / 3.0
    Lv = sum(polylen([P(uu, i / 12) for i in range(13)]) for uu in (0.2, 0.5, 0.8)) / 3.0

    def spec(e, L):
        if e == 'trim':
            s = [0.0, bev / L, (tw - rise) / L, tw / L]
        elif e == 'bevel':
            s = [0.0, bev / L]
        else:
            s = [0.0]
        assert s[-1] < 0.45, 'border wider than the patch'
        return s

    def lines(n, base, e0, e1, L):
        base = list(base) if base else [i / n for i in range(n + 1)]
        s0 = spec(e0, L)
        s1 = [1.0 - x for x in reversed(spec(e1, L))]
        gap = 0.4 / (len(base) - 1)
        return s0 + [x for x in base if s0[-1] + gap < x < s1[0] - gap] + s1

    if wrap:
        ul = list(us) if us else [i / nu for i in range(nu)]
    else:
        ul = lines(nu, us, eu0, eu1, Lu)
    vl = lines(nv, vs, ev0, ev1, Lv)

    def nrm(u, v):
        e = 1e-3
        if wrap:
            pu = P(u + e, v) - P(u - e, v)
        else:
            pu = P(min(u + e, 1.0), v) - P(max(u - e, 0.0), v)
        pv = P(u, min(v + e, 1.0)) - P(u, max(v - e, 0.0))
        n = pu.cross(pv)
        if n.length < 1e-14:
            return None
        return n.normalized()

    sgn = 1.0
    if ref is not None:
        acc = 0
        for a in (0.12, 0.37, 0.63, 0.88):
            for b in (0.12, 0.37, 0.63, 0.88):
                n = nrm(a, b)
                if n is not None:
                    acc += 1 if n.dot(P(a, b) - ref) > 0 else -1
        if acc < 0:
            sgn = -1.0

    edges = {'u0': None if wrap else eu0, 'u1': None if wrap else eu1, 'v0': ev0, 'v1': ev1}

    def dists(u, v):
        return {'u0': u * Lu, 'u1': (1 - u) * Lu, 'v0': v * Lv, 'v1': (1 - v) * Lv}

    def height(u, v):
        d = dists(u, v)
        ht = hb = 0.0
        for k, e in edges.items():
            if e is None:
                continue
            dk = d[k]
            if e == 'trim':
                if dk <= tw - rise:
                    ht = max(ht, th)
                elif dk < tw:
                    ht = max(ht, th * (tw - dk) / rise)
            if e in ('trim', 'bevel') and dk < bev:
                hb = max(hb, bev - dk)
        return ht - hb

    def in_trim(u, v):
        d = dists(u, v)
        return any(e == 'trim' and d[k] < tw for k, e in edges.items())

    wf = wfun(w)
    nI, nJ = len(ul), len(vl)
    out, inn = [], []
    last_n = V(0, 0, 1)
    for i, u in enumerate(ul):
        co, ci = [], []
        for j, v in enumerate(vl):
            p = P(u, v)
            n = nrm(u, v)
            if n is None:
                n = last_n
            else:
                n = n * sgn
                last_n = n
            wt = wf(p, u, v)
            co.append(g.vert(p + n * height(u, v), wt))
            ci.append(g.vert(p - n * thick, wt))
        out.append(co)
        inn.append(ci)

    iu = nI if wrap else nI - 1
    for i in range(iu):
        i2 = (i + 1) % nI
        u_mid = (ul[i] + (ul[i2] if i2 > i else 1.0)) / 2
        for j in range(nJ - 1):
            v_mid = (vl[j] + vl[j + 1]) / 2
            m = tmat if in_trim(u_mid, v_mid) else mat
            g.face((out[i][j], out[i2][j], out[i2][j + 1], out[i][j + 1]), m, sharp)
            g.face((inn[i][j], inn[i][j + 1], inn[i2][j + 1], inn[i2][j]), inner_mat, sharp)
        J = nJ - 1
        g.face((out[i][0], inn[i][0], inn[i2][0], out[i2][0]), tmat if ev0 == 'trim' else mat, sharp)
        g.face((out[i][J], out[i2][J], inn[i2][J], inn[i][J]), tmat if ev1 == 'trim' else mat, sharp)
    if not wrap:
        I = nI - 1
        for j in range(nJ - 1):
            g.face((out[0][j], out[0][j + 1], inn[0][j + 1], inn[0][j]), tmat if eu0 == 'trim' else mat, sharp)
            g.face((out[I][j], inn[I][j], inn[I][j + 1], out[I][j + 1]), tmat if eu1 == 'trim' else mat, sharp)


# ----------------------------------------------------------------------------
# skeleton landmarks (left side; right is mirrored)
# ----------------------------------------------------------------------------
ARM_DOWN = radians(40.0)                       # A-pose: arms 40 degrees below horizontal
AD = V(cos(ARM_DOWN), 0.0, -sin(ARM_DOWN))     # arm direction (left arm)
AN = V(sin(ARM_DOWN), 0.0, cos(ARM_DOWN))      # dorsal / outer normal of the arm
AF = V(0.0, -1.0, 0.0)                         # forward
FWD = V(0.0, -1.0, 0.0)
UP = V(0.0, 0.0, 1.0)

SH = V(0.180, 0.0, 1.445)                      # shoulder joint
UPPER_LEN, FORE_LEN, HAND_BONE = 0.300, 0.260, 0.095
EL = SH + AD * UPPER_LEN
WR = EL + AD * FORE_LEN
HIP = V(0.095, 0.0, 0.940)
KNEE = V(0.105, -0.008, 0.500)
ANK = V(0.112, 0.012, 0.085)
BALL = V(0.118, -0.128, 0.024)
TOE = V(0.121, -0.228, 0.022)

# ----------------------------------------------------------------------------
# body envelope functions
# ----------------------------------------------------------------------------
SUP_N = 2.5
#               z      hw     hf     hb     yc
TORSO = Table([(0.84, 0.135, 0.085, 0.090, 0.010),
               (0.90, 0.158, 0.098, 0.105, 0.010),
               (0.96, 0.160, 0.100, 0.105, 0.008),
               (1.03, 0.138, 0.090, 0.090, 0.004),
               (1.10, 0.114, 0.083, 0.078, 0.002),
               (1.18, 0.128, 0.094, 0.086, 0.000),
               (1.26, 0.150, 0.107, 0.099, -0.002),
               (1.33, 0.166, 0.114, 0.108, -0.002),
               (1.40, 0.170, 0.106, 0.110, 0.004),
               (1.45, 0.160, 0.092, 0.104, 0.010),
               (1.49, 0.125, 0.072, 0.092, 0.015),
               (1.52, 0.078, 0.060, 0.074, 0.012),
               (1.55, 0.056, 0.055, 0.060, 0.008),
               (1.60, 0.052, 0.052, 0.056, 0.004),
               (1.64, 0.050, 0.050, 0.055, 0.000)])
SKIRT = Table([(0.45, 0.192, 0.104, 0.108, 0.000),
               (0.60, 0.190, 0.105, 0.110, 0.002),
               (0.72, 0.186, 0.106, 0.111, 0.004),
               (0.82, 0.178, 0.106, 0.111, 0.006),
               (0.90, 0.168, 0.103, 0.108, 0.008),
               (0.96, 0.160, 0.100, 0.105, 0.008)])


def _sup_pt(prm, phi, z, off):
    hw, hf, hb, yc = prm
    s, c = sin(phi), cos(phi)
    e = 2.0 / SUP_N
    hd = hf if c >= 0 else hb
    x = hw * spow(s, e)
    y = -hd * spow(c, e)
    if off:
        nx = spow(x / hw, SUP_N - 1) / hw
        ny = spow(y / hd, SUP_N - 1) / hd
        l = hypot(nx, ny)
        x += off * nx / l
        y += off * ny / l
    return V(x, yc + y, z)


def torso_pt(phi, z, off=0.0):
    """phi: 0 = front (-Y), +90deg = character's left (+X)"""
    return _sup_pt(TORSO(z), phi, z, off)


def skirt_pt(phi, z, off=0.0):
    """torso above the hips, flaring 'skirt' envelope around the thighs below"""
    return _sup_pt(SKIRT(z) if z < 0.96 else TORSO(z), phi, z, off)


#             z      rx     rf     rb
LEG = Table([(0.96, 0.078, 0.088, 0.093),
             (0.88, 0.083, 0.091, 0.095),
             (0.80, 0.079, 0.087, 0.089),
             (0.70, 0.070, 0.079, 0.079),
             (0.60, 0.061, 0.069, 0.067),
             (0.54, 0.055, 0.063, 0.059),
             (0.50, 0.053, 0.063, 0.055),
             (0.45, 0.049, 0.057, 0.055),
             (0.38, 0.051, 0.051, 0.067),
             (0.30, 0.046, 0.045, 0.061),
             (0.20, 0.037, 0.039, 0.045),
             (0.12, 0.032, 0.037, 0.039),
             (0.07, 0.033, 0.039, 0.041)][::-1])


def leg_c(z):
    if z >= KNEE.z:
        return KNEE.lerp(HIP, (z - KNEE.z) / (HIP.z - KNEE.z))
    return KNEE.lerp(ANK, (KNEE.z - z) / (KNEE.z - ANK.z))


def leg_pt(z, ang, off=0.0):
    """ang: 0 = front, +90deg = outer side of the left leg"""
    rx, rf, rb = LEG(z)
    c = leg_c(z)
    s, co = sin(ang), cos(ang)
    ry = rf if co >= 0 else rb
    return V(c.x + (rx + off) * s, c.y - (ry + off) * co, z)


#             s       rn     rf
ARM = Table([(-0.035, 0.038, 0.040),
             (0.000, 0.048, 0.050),
             (0.035, 0.052, 0.053),
             (0.100, 0.048, 0.049),
             (0.180, 0.044, 0.045),
             (0.260, 0.039, 0.039),
             (0.300, 0.038, 0.038),
             (0.350, 0.041, 0.040),
             (0.420, 0.037, 0.036),
             (0.500, 0.030, 0.029),
             (0.560, 0.0235, 0.029)])


def arm_pt(s, ang, off=0.0):
    """s: distance from the shoulder joint along the arm; ang 0 = dorsal, +90 = front"""
    rn, rf = ARM(s)
    return SH + AD * s + AN * ((rn + off) * cos(ang)) + AF * ((rf + off) * sin(ang))


# ----------------------------------------------------------------------------
# skin weights for the smooth-skinned parts
# ----------------------------------------------------------------------------
def w_torso(p, *_):
    z = p.z
    a = smooth(0.985, 1.085, z)
    b = smooth(1.15, 1.26, z)
    c = smooth(1.485, 1.545, z)
    d = smooth(1.565, 1.625, z)
    w = {'Hips': 1 - a, 'Spine': a * (1 - b), 'Chest': b * (1 - c), 'Neck': c * (1 - d), 'Head': d}
    sh = smooth(0.105, 0.165, abs(p.x)) * smooth(1.37, 1.43, z) * 0.8
    if sh > 0:
        k = 'Shoulder.L' if p.x > 0 else 'Shoulder.R'
        w[k] = w['Chest'] * sh
        w['Chest'] *= (1 - sh)
    return w


def w_leg(p, *_):
    z = p.z
    a = smooth(0.835, 0.955, z)          # -> Hips
    b = smooth(0.455, 0.545, z)          # knee
    c = smooth(0.070, 0.125, z)          # ankle
    return {'Hips': a, 'UpperLeg.L': (1 - a) * b, 'LowerLeg.L': (1 - b) * c, 'Foot.L': 1 - c}


def w_arm_s(s):
    a = smooth(-0.035, 0.045, s)
    b = smooth(0.255, 0.345, s)
    c = smooth(0.535, 0.585, s)
    return {'Shoulder.L': 1 - a, 'UpperArm.L': a * (1 - b), 'LowerArm.L': b * (1 - c), 'Hand.L': c}


def w_arm(p, *_):
    return w_arm_s((p - SH).dot(AD))


# ----------------------------------------------------------------------------
# undersuit body
# ----------------------------------------------------------------------------
def build_body(g):
    zs = [0.84, 0.87, 0.90, 0.93, 0.96, 0.995, 1.03, 1.065, 1.10, 1.14, 1.18, 1.22, 1.26, 1.295, 1.33,
          1.365, 1.40, 1.425, 1.45, 1.47, 1.49, 1.505, 1.52, 1.535, 1.55, 1.575, 1.60, 1.63]
    n = 18
    g.begin('body_torso')
    loft(g, [[torso_pt(2 * pi * k / n, z) for k in range(n)] for z in zs], 'Undersuit', w_torso)
    g.end()

    zs = [0.955, 0.92, 0.89, 0.86, 0.82, 0.77, 0.71, 0.65, 0.60, 0.56, 0.53, 0.50, 0.47, 0.44, 0.40, 0.35,
          0.29, 0.22, 0.16, 0.11, 0.07]
    n = 14
    g.begin('body_legs')
    loft(g, [[leg_pt(z, 2 * pi * k / n) for k in range(n)] for z in zs], 'Undersuit', w_leg)
    g.end(mirror='both')

    ss = [-0.035, -0.01, 0.02, 0.06, 0.10, 0.14, 0.18, 0.22, 0.255, 0.28, 0.30, 0.32, 0.345, 0.38, 0.43,
          0.48, 0.52, 0.56]
    n = 12
    g.begin('body_arms', warp=False)
    loft(g, [[arm_pt(s, 2 * pi * k / n) for k in range(n)] for s in ss], 'Undersuit', w_arm)
    g.end(mirror='both')

    # head: plain dark ellipsoid, only ever seen as darkness inside the hood
    c = V(0.0, -0.004, 1.685)
    rx, ry, rz = 0.080, 0.097, 0.108
    rings = []
    for i in range(1, 9):
        la = -pi / 2 + pi * i / 9
        rings.append([c + V(rx * cos(la) * sin(2 * pi * k / 12), -ry * cos(la) * cos(2 * pi * k / 12),
                            rz * sin(la)) for k in range(12)])
    g.begin('body_head')
    loft(g, rings, 'Undersuit', 'Head')
    g.end()


# ----------------------------------------------------------------------------
# cuirass, plackart, fauld, belt
# ----------------------------------------------------------------------------
REF_CHEST = V(0, 0.005, 1.28)
REF_HIPS = V(0, 0.005, 0.98)


def build_cuirass(g):
    us = [0, .07, .14, .21, .28, .35, .41, .46, .5, .54, .59, .65, .72, .79, .86, .93, 1]

    def v_edge(a):                                           # V-pointed lower edge
        return 1.132 - 0.050 * (1 - abs(a)) ** 1.7

    def breast_off(phi, z):
        off = 0.013
        off += 0.013 * tent(phi, 0.17, 1.25) * smooth(1.085, 1.17, z) * (1 - 0.75 * smooth(1.33, 1.43, z))
        off += 0.010 * gauss(z - 1.315, 0.075) * max(0.0, cos(phi)) ** 2
        return off

    def front(u, v):
        a = 2 * u - 1
        z = lerp(v_edge(a) + 0.012, 1.44, v)
        half = radians(99) * (1 - 0.58 * smooth(1.35, 1.44, z))
        phi = a * half
        return torso_pt(phi, z, breast_off(phi, z))

    g.begin('cuirass_front')
    shell(g, front, 16, 11, us=us, thick=0.005, w='Chest', ref=REF_CHEST)
    g.end()

    def plack(u, v):          # gothic plackart: a second plate rising to a point on the chest
        a = 2 * u - 1
        zb = v_edge(a)
        z = lerp(zb, 1.166 + 0.120 * (1 - abs(a)) ** 1.3, v)
        phi = a * radians(97)
        off = breast_off(phi, z) + 0.0062 + 0.010 * (1 - smooth(0.0, 0.035, z - zb)) ** 2
        return torso_pt(phi, z, off)

    g.begin('cuirass_plackart')
    shell(g, plack, 16, 5, us=us, thick=0.005, ev0='trim', ev1='trim', w='Chest', ref=REF_CHEST)
    g.end()

    def back(u, v):
        a = 2 * u - 1
        zb = 1.118 - 0.018 * (1 - abs(a)) ** 2
        z = lerp(zb, 1.455, v)
        half = radians(86) * (1 - 0.50 * smooth(1.36, 1.45, z))
        phi = pi + a * half
        off = 0.009 + 0.008 * (1 - smooth(0.0, 0.14, v)) ** 2
        off -= 0.004 * tent(a * half, 0.16, 1.5) * smooth(1.12, 1.2, z)      # spine channel
        return torso_pt(phi, z, off)

    g.begin('cuirass_back')
    shell(g, back, 12, 10, thick=0.005, ev0='trim', w='Chest', ref=REF_CHEST)
    g.end()

    # articulated waist: plackart on the spine, two fauld hoops on the hips
    def hoop(zt, zb, o0, o1, dip):
        def S(u, v):
            phi = 2 * pi * u
            z1 = zb - dip * max(0.0, cos(phi)) ** 3            # lower edge dips at the front
            return skirt_pt(phi, lerp(zt, z1, v), lerp(o0, o1, v ** 1.4))
        return S

    for name, zt, zb, o0, o1, dip, bone in (('plackart', 1.170, 1.066, 0.007, 0.015, 0.020, 'Spine'),
                                            ('fauld_a', 1.088, 1.012, 0.010, 0.019, 0.016, 'Hips'),
                                            ('fauld_b', 1.034, 0.962, 0.013, 0.023, 0.012, 'Hips')):
        g.begin(name)
        shell(g, hoop(zt, zb, o0, o1, dip), 28, 3, wrap=True, thick=0.004, ev0='bevel', ev1='trim',
              tw=0.010, w=bone, ref=REF_HIPS)
        g.end()

    # sword belt
    def belt(u, v):
        return skirt_pt(2 * pi * u, lerp(0.958, 0.924, v), 0.0355)

    g.begin('belt')
    shell(g, belt, 28, 1, wrap=True, thick=0.004, mat='Leather', bev=0.0012, w='Hips', ref=REF_HIPS)
    g.end()

    def buckle(u, v):
        return skirt_pt((2 * u - 1) * 0.17, lerp(0.970, 0.912, v), 0.040)

    g.begin('buckle')
    shell(g, buckle, 2, 2, thick=0.006, mat='Gold', bev=0.0025, w='Hips', ref=REF_HIPS)
    g.end()

    def buckle_gem(u, v):
        return skirt_pt((2 * u - 1) * 0.085, lerp(0.957, 0.925, v), 0.0435)

    g.begin('buckle_inlay')
    shell(g, buckle_gem, 1, 1, thick=0.004, mat='Armor', bev=0.002, w='Hips', ref=REF_HIPS)
    g.end()


# ----------------------------------------------------------------------------
# legs: tassets, cuisses, poleyns, greaves, sabatons
# ----------------------------------------------------------------------------
def cap_patch(center, ax_out, ax_u, ax_v, r_out, r_u, r_v, lon_max, lat_max, keel=0.0, pinch=0.45):
    def S(u, v):
        lon = lerp(-lon_max, lon_max, u)
        lm = lat_max * (1 - pinch * (lon / lon_max) ** 2)
        lat = lerp(-lm, lm, v)
        k = 1.0 + keel * tent(lon, 0.40, 1.4)
        return center + (ax_out * (cos(lon) * cos(lat) * r_out) + ax_u * (sin(lon) * cos(lat) * r_u)
                         + ax_v * (sin(lat) * r_v)) * k
    return S


def build_legs(g):
    # tassets hang from under the fauld and ride on the thighs
    PH_C, Z_TOP = radians(44), 0.972

    def tasset(u, v):
        a = 2 * u - 1
        dphi = radians(lerp(58, 44, v))
        phi = PH_C + a * dphi / 2
        zb = 0.672 + 0.085 * abs(a) ** 1.7
        z = lerp(Z_TOP, zb, v)
        off = lerp(0.019, 0.028, v) + 0.005 * tent(a, 0.5, 1.3) * smooth(0.0, 0.25, v)
        return skirt_pt(phi, z, off)

    g.begin('tassets')
    shell(g, tasset, 8, 8, thick=0.0045, eu0='trim', eu1='trim', ev0='bevel', ev1='trim',
          w='UpperLeg.L', ref=V(0.08, 0, 0.82))
    g.end(mirror='both')

    def cuisse(u, v):
        ang = radians(lerp(-88, 128, u))
        zt = 0.725 + 0.085 * smooth(0.1, 0.9, u)
        z = lerp(zt, 0.560, v)
        off = 0.0095 + 0.005 * tent(ang - radians(8), 0.42, 1.4) + 0.004 * smooth(0.8, 1.0, v) ** 2
        return leg_pt(z, ang, off)

    g.begin('cuisses')
    shell(g, cuisse, 9, 5, thick=0.0045, eu0='trim', eu1='trim', ev0='bevel', ev1='trim',
          w='UpperLeg.L', ref=leg_c(0.65))
    g.end(mirror='both')

    kc = KNEE + V(0.0, 0.004, 0.0)
    g.begin('poleyns')
    shell(g, cap_patch(kc, FWD, V(1, 0, 0), UP, 0.086, 0.073, 0.078, radians(88), radians(54), keel=0.07),
          8, 6, thick=0.0045, eu0='trim', eu1='trim', ev0='trim', ev1='trim', tw=0.009,
          w='UpperLeg.L', ref=kc)
    g.end(mirror='both')

    def greave(u, v):
        ang = 2 * pi * u
        zt = 0.447 + 0.022 * cos(ang)
        z = lerp(zt, 0.098, v)
        off = 0.009 + 0.008 * tent(wrap_pi(ang), 0.40, 1.5) * (1 - 0.5 * v)
        off += 0.007 * (1 - smooth(0.0, 0.14, v)) ** 2 + 0.011 * smooth(0.86, 1.0, v) ** 2
        return leg_pt(z, ang, off)

    g.begin('greaves')
    shell(g, greave, 16, 9, wrap=True, thick=0.0045, ev0='trim', ev1='trim', w='LowerLeg.L',
          ref=leg_c(0.3))
    g.end(mirror='both')

    # sabatons: closed pointed shoe, stepped like overlapping lames
    #              y       w      h     z0
    FT = Table([(-0.240, 0.004, 0.006, 0.016),
                (-0.218, 0.019, 0.021, 0.009),
                (-0.190, 0.033, 0.030, 0.004),
                (-0.160, 0.044, 0.039, 0.001),
                (-0.130, 0.050, 0.047, 0.000),
                (-0.100, 0.051, 0.057, 0.000),
                (-0.070, 0.050, 0.071, 0.000),
                (-0.040, 0.048, 0.091, 0.000),
                (-0.015, 0.046, 0.116, 0.000),
                (0.010, 0.045, 0.128, 0.000),
                (0.035, 0.043, 0.123, 0.000),
                (0.055, 0.040, 0.102, 0.000),
                (0.070, 0.033, 0.070, 0.004),
                (0.079, 0.018, 0.032, 0.012)])
    lame_edges = [-0.196, -0.166, -0.136, -0.106, -0.076, -0.046]
    ys = []
    y = 0.079
    stations = [0.079, 0.070, 0.055, 0.035, 0.010, -0.015]
    for e in reversed(lame_edges):
        stations += [e + 0.0145, e + 0.002, e - 0.002]
    stations += [-0.218, -0.240]
    stations = sorted(set(round(s, 4) for s in stations), reverse=True)

    def lame_scale(y):
        if y > lame_edges[-1] or y < lame_edges[0] - 0.02:
            return 1.0
        # inside lame i (between edges): grows toward the toe, then drops
        nxt = [e for e in lame_edges if e < y]
        prv = [e for e in lame_edges if e >= y]
        if not nxt:
            return 1.0
        lo, hi = max(nxt), min(prv) if prv else lame_edges[-1] + 0.03
        return 1.0 + 0.055 * (hi - y) / (hi - lo)

    def foot_ring(y, n=14):
        wd, h, z0 = FT(y)
        sc = lame_scale(y)
        wd *= sc
        h = h * (1 + (sc - 1) * 0.8)
        cx = lerp(ANK.x, TOE.x + 0.002, smooth(0.05, -0.24, y))
        hb = min(0.018, h * 0.42)
        pts = []
        for k in range(n):
            a = 2 * pi * k / n
            s, c = sin(a), cos(a)
            if c >= 0:
                x = wd * spow(s, 1.18)
                z = z0 + hb + (h - hb) * c
            else:
                x = wd * spow(s, 0.55)
                z = z0 + hb * (1 - abs(c) ** 0.55)
            pts.append(V(cx + x, y, z))
        return pts

    def w_foot(p, *_):
        t = smooth(-0.112, -0.148, p.y)
        return {'Foot.L': 1 - t, 'Toe.L': t}

    rings = [foot_ring(y) for y in stations]
    mats = ['Gold' if stations[i + 1] < -0.2 else 'Armor' for i in range(len(stations) - 1)]
    g.begin('sabatons')
    loft(g, rings, 'Armor', w_foot, mats=mats, sharp=30.0)
    g.end(mirror='both')


# ----------------------------------------------------------------------------
# arms: pauldrons, couters, vambraces
# ----------------------------------------------------------------------------
PAULDRON_RHO = Table([(-0.075, 0.052), (-0.055, 0.071), (-0.030, 0.084), (0.000, 0.091), (0.040, 0.092),
                      (0.080, 0.086), (0.120, 0.076), (0.150, 0.071)])


def build_arms(g):
    def dome(scale):
        def S(u, v):
            a = 2 * u - 1
            s0 = (-0.068 + 0.022 * a * a) * scale
            s1 = (0.070 + 0.050 * (1 - abs(a) ** 1.6)) * scale          # pointed lower tip
            s = lerp(s0, s1, v)
            amax = radians(lerp(66, 106, smooth(0.0, 0.5, v)) * (1 - 0.12 * smooth(0.7, 1.0, v)))
            ang = a * amax
            rho = PAULDRON_RHO(s / scale)[0] * scale
            rho *= 1 + 0.035 * tent(ang, 0.55, 1.3)                        # soft dorsal ridge
            return SH + AD * s + (AN * cos(ang) + AF * sin(ang)) * rho
        return S

    def lame(s0, s1, o0, o1, amax_deg, point):
        A = radians(amax_deg)

        def S(u, v):
            a = 2 * u - 1
            ang = a * A
            s_end = s1 + point * (1 - abs(a) ** 1.6)
            s = lerp(s0, s_end, v)
            off = lerp(o0, o1, v) + 0.003 * smooth(0.82, 1.0, v) ** 2 + 0.003 * tent(ang, 0.5, 1.3)
            return arm_pt(s, ang, off)
        return S

    ref = SH + AD * 0.02
    # left: large, three lames
    g.begin('pauldron_L_dome', warp=False)
    shell(g, dome(1.13), 10, 9, thick=0.005, eu0='trim', eu1='trim', ev0='trim', ev1='trim',
          w='Shoulder.L', ref=ref)
    g.end()
    for i, (s0, s1, o0, o1, A, pt) in enumerate(((0.065, 0.158, 0.022, 0.016, 106, 0.030),
                                                 (0.132, 0.212, 0.016, 0.012, 99, 0.027),
                                                 (0.192, 0.256, 0.012, 0.009, 92, 0.022))):
        g.begin('pauldron_L_lame%d' % i, warp=False)
        shell(g, lame(s0, s1, o0, o1, A, pt), 10, 4, thick=0.0045, ev1='trim', w='UpperArm.L',
              ref=SH + AD * 0.15)
        g.end()
    # right: compact, two lames
    g.begin('pauldron_R_dome', warp=False)
    shell(g, dome(0.95), 10, 8, thick=0.005, eu0='trim', eu1='trim', ev0='trim', ev1='trim',
          w='Shoulder.L', ref=ref)
    g.end(mirror='only')
    for i, (s0, s1, o0, o1, A, pt) in enumerate(((0.052, 0.132, 0.018, 0.013, 102, 0.026),
                                                 (0.110, 0.180, 0.013, 0.009, 95, 0.022))):
        g.begin('pauldron_R_lame%d' % i, warp=False)
        shell(g, lame(s0, s1, o0, o1, A, pt), 10, 4, thick=0.0045, ev1='trim', w='UpperArm.L',
              ref=SH + AD * 0.12)
        g.end(mirror='only')

    # couters ride on the upper arm and cap the elbow
    back = V(0, 1, 0)
    ca = radians(28)
    ax_out = back * cos(ca) + AN * sin(ca)
    ax_u = AN * cos(ca) - back * sin(ca)
    g.begin('couters', warp=False)
    shell(g, cap_patch(EL, ax_out, ax_u, AD, 0.051, 0.051, 0.056, radians(82), radians(50), keel=0.09,
                       pinch=0.55),
          8, 6, thick=0.004, eu0='trim', eu1='trim', ev0='trim', ev1='trim', tw=0.008,
          w='UpperArm.L', ref=EL)
    g.end(mirror='both')

    def vambrace(u, v):
        ang = 2 * pi * u
        s = lerp(0.338 - 0.012 * cos(ang), 0.548, v)
        off = 0.0075 + 0.006 * (1 - smooth(0.0, 0.22, v)) ** 2 + 0.004 * tent(wrap_pi(ang), 0.5, 1.4)
        off += 0.002 * smooth(0.9, 1.0, v)
        return arm_pt(s, ang, off)

    g.begin('vambraces', warp=False)
    shell(g, vambrace, 14, 7, wrap=True, thick=0.004, ev0='trim', ev1='trim', tw=0.010,
          w='LowerArm.L', ref=SH + AD * 0.45)
    g.end(mirror='both')

# ----------------------------------------------------------------------------
# hands / gauntlets
# ----------------------------------------------------------------------------
#              t       hx      hz
HAND = Table([(-0.050, 0.031, 0.0260),
              (0.000, 0.0295, 0.0220),
              (0.030, 0.0400, 0.0165),
              (0.060, 0.0440, 0.0155),
              (0.095, 0.0430, 0.0145),
              (0.120, 0.0410, 0.0118),
              (0.150, 0.0390, 0.0106),
              (0.180, 0.0350, 0.0096),
              (0.199, 0.0270, 0.0080)])
HAND_JOINTS = (0.095, 0.145, 0.176)
HAND_LEN = 0.199


class HandPath:
    """Centre line + frames of a mitten hand: wrist at WR, optional finger curl / yaw."""
    STEP = 0.001

    def __init__(self, curl, yaw):
        T, X, D = AD, AF, AN
        self.T0, self.X0, self.D0 = T, X, D
        self.fr = []
        pos = WR.copy()
        n = int(round(HAND_LEN / self.STEP)) + 4
        for i in range(n + 1):
            t = i * self.STEP
            pitch = sum(k * smooth(tj - 0.011, tj + 0.011, t) for tj, k in zip(HAND_JOINTS, curl))
            yw = yaw * smooth(0.030, 0.088, t)
            T1 = T * cos(yw) - X * sin(yw)
            X1 = X * cos(yw) + T * sin(yw)
            T2 = T1 * cos(pitch) - D * sin(pitch)
            D2 = D * cos(pitch) + T1 * sin(pitch)
            self.fr.append((pos.copy(), T2, X1, D2))
            pos = pos + T2 * self.STEP
        self.n = n

    def frame(self, t):
        if t <= 0:
            return WR + self.T0 * t, self.T0, self.X0, self.D0
        f = min(t / self.STEP, self.n - 1e-6)
        i = int(f)
        k = f - i
        a, b = self.fr[i], self.fr[i + 1]
        return (a[0].lerp(b[0], k), a[1].lerp(b[1], k).normalized(), a[2].lerp(b[2], k).normalized(),
                a[3].lerp(b[3], k).normalized())

    def pt(self, t, ang, off=0.0):
        pos, T, X, D = self.frame(t)
        hx, hz = HAND(t)
        e = 2.0 / 3.0
        return pos + X * ((hx + off) * spow(sin(ang), e)) + D * ((hz + off) * spow(cos(ang), e))


FIST_YAW = radians(18)
HP_OPEN = HandPath((radians(14), radians(24), radians(16)), 0.0)
HP_FIST = HandPath((radians(84), radians(96), radians(42)), FIST_YAW)


def grip_frame_left():
    """Where a held sword sits, expressed for a LEFT fist (mirrored for the right hand)."""
    pos, T, X, D = HP_FIST.frame(0.080)
    yw = FIST_YAW
    Xg = (AF * cos(yw) + AD * sin(yw)).normalized()        # grip axis, towards the thumb side
    Tg = (AD * cos(yw) - AF * sin(yw)).normalized()        # knuckle direction
    G = WR + AD * 0.079 - AN * 0.0285 - AF * 0.004
    return G, Xg, Tg, AN


def build_hand(g, hp, bone, mirror, fist):
    name = 'hand_R' if mirror == 'only' else 'hand_L'
    # glove
    ts = [0.0, 0.012, 0.03, 0.05, 0.07, 0.085, 0.095, 0.106, 0.12, 0.134, 0.145, 0.156, 0.166, 0.176,
          0.185, 0.193, 0.199]
    n = 14
    rings = [[hp.pt(t, 2 * pi * k / n) for k in range(n)] for t in ts]
    g.begin(name + '_glove', warp=False)
    loft(g, rings, 'Leather', bone, sharp=50)
    g.end(mirror=mirror)
    ref_of = lambda t: hp.frame(t)[0]
    A = radians(104)

    def plate(t0, t1, off, ridge_t=None, lip=0.0):
        def S(u, v):
            t = lerp(t0, t1, v)
            o = off + lip * smooth(0.75, 1.0, v) ** 2
            if ridge_t is not None:
                o += 0.0035 * gauss(t - ridge_t, 0.007)
            return hp.pt(t, lerp(-A, A, u), o)
        return S

    for i, (t0, t1, off, rt, nv) in enumerate(((0.006, 0.103, 0.0045, 0.094, 5),
                                               (0.097, 0.153, 0.0036, None, 3),
                                               (0.146, 0.198, 0.0030, None, 3))):
        g.begin('%s_plate%d' % (name, i), warp=False)
        shell(g, plate(t0, t1, off, rt, 0.0015), 7, nv, thick=0.0035, ev1='trim', tw=0.0055, th=0.0014,
              bev=0.001, rise=0.001, w=bone, ref=ref_of((t0 + t1) / 2))
        g.end(mirror=mirror)

    def cuff(u, v):
        t = lerp(-0.050, 0.014, v)
        return hp.pt(t, 2 * pi * u, 0.0060 + 0.017 * (1 - v) ** 1.6)

    g.begin(name + '_cuff', warp=False)
    shell(g, cuff, 14, 4, wrap=True, thick=0.004, ev0='trim', ev1='bevel', tw=0.008, w=bone,
          ref=WR - AD * 0.02)
    g.end(mirror=mirror)

    # thumb
    T, X, D = hp.T0, hp.X0, hp.D0
    if fist:
        p0 = WR + T * 0.030 + X * 0.036 - D * 0.008
        p1 = WR + T * 0.060 + X * 0.045 - D * 0.050
        p2 = WR + T * 0.094 + X * 0.026 - D * 0.070
    else:
        p0 = WR + T * 0.032 + X * 0.034 - D * 0.004
        d = (T * 0.62 + X * 0.60 - D * 0.36).normalized()
        p1 = p0 + d * 0.036 + X * 0.004
        p2 = p0 + d * 0.070 - D * 0.004
    pts, rad = [], []
    for i in range(8):
        k = i / 7
        pts.append(p0 * (1 - k) ** 2 + p1 * (2 * k * (1 - k)) + p2 * k ** 2)
        rad.append(lerp(0.0150, 0.0105, k) * (0.62 if i == 7 else 1.0))
    g.begin(name + '_thumb', warp=False)
    tube_along(g, pts, rad, 8, 'Armor', bone, sharp=50,
               mats=['Leather', 'Armor', 'Armor', 'Gold', 'Armor', 'Armor', 'Armor'])
    g.end(mirror=mirror)


# ----------------------------------------------------------------------------
# mask, hood + mantle
# ----------------------------------------------------------------------------
MASK_W = Table([(0.00, 0.0045), (0.06, 0.0165), (0.16, 0.031), (0.30, 0.046), (0.48, 0.0585),
                (0.65, 0.0640), (0.80, 0.0610), (0.92, 0.0520), (1.00, 0.0420)])
MASK_Z0, MASK_H = 1.545, 0.222


def mask_pt(u, v):
    a = 2 * u - 1
    wd = MASK_W(v)[0]
    z = MASK_Z0 + MASK_H * v
    yc = -0.098 - 0.010 * v
    depth = 0.030 * (0.40 + 0.60 * sin(pi * min(v * 1.05, 1.0)) ** 0.6)
    y = yc - depth * (1 - abs(a) ** 2.2) - 0.0035 * (1 - abs(a)) ** 3
    return V(wd * a, y, z)


#              v      Cy      Cz      tau    a_top  a_bot  b       saddle p_top p_bot
HOOD = Table([(0.000, -0.1250, 1.6560, -15.9, 0.070, 0.066, 0.1206, 0.012, 1.45, 1.25),
              (0.095, -0.0925, 1.6695, -5.2, 0.100, 0.085, 0.1370, 0.006, 1.10, 1.10),
              (0.225, -0.0450, 1.6735, 9.7, 0.115, 0.090, 0.1486, 0.000, 0.90, 1.05),
              (0.376, 0.0055, 1.6550, 27.2, 0.118, 0.092, 0.1520, 0.000, 0.88, 1.00),
              (0.515, 0.0310, 1.6125, 43.4, 0.115, 0.100, 0.1410, 0.000, 0.88, 1.00),
              (0.644, 0.0300, 1.5625, 57.3, 0.108, 0.110, 0.1250, 0.000, 0.90, 0.95),
              (0.840, 0.0200, 1.4850, 82.4, 0.188, 0.188, 0.1130, 0.022, 0.82, 0.82),
              (0.920, 0.0175, 1.4400, 85.7, 0.200, 0.200, 0.1330, 0.063, 0.80, 0.80),
              (1.000, 0.0140, 1.3925, 87.2, 0.208, 0.208, 0.1540, 0.105, 0.80, 0.80)])


def hood_pt(u, v):
    cy, cz, tau, at, ab, b, sad, pt, pb = HOOD(v)
    t = 2 * pi * u                       # 0 = outer side (brow -> crown -> back), pi = throat side
    ct, st = cos(t), sin(t)
    k = (1 + ct) / 2
    x = lerp(ab, at, k) * spow(st, lerp(pb, pt, k))
    tr = radians(tau)
    return V(x, cy + sin(tr) * b * ct - cos(tr) * sad * abs(st) ** 2.5,
             cz + cos(tr) * b * ct + sin(tr) * sad * abs(st) ** 2.5)


def w_hood(p, u, v):
    z = p.z
    c2n = smooth(1.455, 1.535, z)
    n2h = smooth(1.535, 1.625, z)
    head, neck, chest = c2n * n2h, c2n * (1 - n2h), 1 - c2n
    head2 = max(head, 1 - smooth(0.28, 0.56, v))      # the rim always rides on the head
    rest = 1 - head2
    s = neck + chest
    if s > 1e-6:
        neck, chest = rest * neck / s, rest * chest / s
    else:
        neck, chest = rest * 0.5, rest * 0.5
    return {'Head': head2, 'Neck': neck, 'Chest': chest}


def build_head(g):
    g.begin('mask')
    shell(g, mask_pt, 12, 14, thick=0.004, mat='Mask', bev=0.0018, w='Head', sharp=40,
          ref=V(0, 0, 1.68))
    g.end()

    def line(u, v):
        vv = lerp(0.045, 0.975, v)
        hw = 0.0024 * (0.55 + 0.45 * sin(pi * v) ** 0.5)
        p = mask_pt(0.5 + (u - 0.5) * 2 * hw / (2 * MASK_W(vv)[0]), vv)
        return p + V(0, -0.0012, 0)

    g.begin('mask_line')
    shell(g, line, 1, 14, thick=0.003, mat='Gold', bev=0.0007, w='Head', ref=V(0, 0, 1.68))
    g.end()

    g.begin('hood')
    shell(g, hood_pt, 32, 26, wrap=True, thick=0.006, mat='Cloth', ev0='trim', ev1='trim', tw=0.011,
          th=0.0018, w=w_hood, sharp=60, ref=V(0, 0.0, 1.35))
    g.end()


# ----------------------------------------------------------------------------
# cape, tabards, scabbard
# ----------------------------------------------------------------------------
CAPE_TOP = 1.462


def cape_base(u, v):
    """smooth cape surface without folds; u: 0 = character's right edge, 1 = left edge"""
    a = 2 * u - 1
    xr = lerp(-0.136, -0.275, v ** 0.9)
    xl = lerp(0.136, 0.150, v)
    x = lerp(xr, xl, u)
    z_hem = lerp(0.285, 0.410, smooth(0.0, 1.0, u)) + 0.02 * a * a
    z = lerp(CAPE_TOP, z_hem, v)
    y = 0.142 + 0.050 * v
    y -= 0.045 * abs(a) ** 2.2 * (1 - smooth(0.0, 0.45, v)) + 0.018 * a * a * smooth(0.2, 1.0, v)
    return V(x, y, z)


def cape_pt(u, v):
    p = cape_base(u, v)
    amp = 0.019 * smooth(0.04, 0.55, v) + 0.012 * v * v
    p.y += amp * cos(2 * pi * (2.6 * u + 0.08)) + 0.4 * amp * cos(2 * pi * (5.3 * u + 0.3)) * v
    p.x += 0.35 * amp * sin(2 * pi * (2.6 * u + 0.08))
    return p


CAPE_COLS = (('R', 1 / 6), ('C', 0.5), ('L', 5 / 6))


def w_cape(p, u, v):
    if u <= 1 / 6:
        cw = {'R': 1.0}
    elif u < 0.5:
        t = (u - 1 / 6) * 3
        cw = {'R': 1 - t, 'C': t}
    elif u < 5 / 6:
        t = (u - 0.5) * 3
        cw = {'C': 1 - t, 'L': t}
    else:
        cw = {'L': 1.0}
    x = v * 5 - 0.5
    if x <= 0:
        rw = {1: 1.0}
    elif x >= 4:
        rw = {5: 1.0}
    else:
        k = int(x)
        t = x - k
        rw = {k + 1: 1 - t, k + 2: t}
    return {'Cape.%s.%d' % (c, r): a * b for c, a in cw.items() for r, b in rw.items()}


def tabard_front(u, v):
    a = 2 * u - 1
    zb = 0.470 + 0.105 * abs(a) ** 1.15
    z = lerp(0.962, zb, v)
    ph = lerp(0.50, 0.43, v)
    p = skirt_pt(a * ph, max(z, 0.84), lerp(0.031, 0.041, v))
    p.z = z
    p.y -= 0.004 * cos(a * pi * 1.5) * v - 0.010 * v * v
    return p


def tabard_back(u, v):
    a = 2 * u - 1
    zb = 0.490 + 0.070 * abs(a) ** 1.3
    z = lerp(0.962, zb, v)
    ph = lerp(0.62, 0.56, v)
    p = skirt_pt(pi + a * ph, max(z, 0.86), lerp(0.031, 0.036, v))
    p.z = z
    p.y += 0.004 * cos(a * pi * 1.5) * v
    return p


def w_tab(bone):
    def f(p, u, v):
        t = smooth(0.02, 0.32, v)
        return {'Hips': 1 - t, bone: t}
    return f


SCAB_MOUTH = V(0.192, -0.050, 0.955)
SCAB_DIR = V(0.085, 0.60, -0.795).normalized()
SCAB_LEN = 0.94


def build_cloth(g):
    g.begin('cape')
    shell(g, cape_pt, 16, 14, thick=0.006, mat='Cape', ev1='trim', tw=0.013, th=0.0012, bev=0.0015,
          w=w_cape, sharp=65, ref=V(0, 0, 0.9))
    g.end()
    g.begin('tabard_front')
    shell(g, tabard_front, 6, 10, thick=0.004, mat='Cloth', eu0='trim', eu1='trim', ev1='trim', tw=0.009,
          th=0.0012, bev=0.001, w=w_tab('Tabard.F'), sharp=60, ref=V(0, 0, 0.75))
    g.end()
    g.begin('tabard_back')
    shell(g, tabard_back, 6, 10, thick=0.004, mat='Cloth', eu0='trim', eu1='trim', ev1='trim', tw=0.009,
          th=0.0012, bev=0.001, w=w_tab('Tabard.B'), sharp=60, ref=V(0, 0, 0.75))
    g.end()

    # scabbard on the left hip
    d = SCAB_DIR
    side = d.cross(UP).normalized()             # thin axis (roughly +-X)
    up = side.cross(d).normalized()             # wide axis
    st = [(-0.004, 0.0300, 0.0130, 'Gold'), (0.0, 0.0315, 0.0140, 'Gold'), (0.060, 0.0305, 0.0135, 'Gold'),
          (0.064, 0.0275, 0.0110, 'Leather'), (0.235, 0.0262, 0.0105, 'Leather'), (0.239, 0.0285, 0.0125, 'Gold'),
          (0.262, 0.0283, 0.0125, 'Gold'), (0.266, 0.0258, 0.0104, 'Leather'), (0.55, 0.0235, 0.0096, 'Leather'),
          (0.800, 0.0205, 0.0088, 'Leather'), (0.804, 0.0228, 0.0108, 'Gold'), (0.885, 0.0185, 0.0098, 'Gold'),
          (0.922, 0.0120, 0.0080, 'Gold'), (SCAB_LEN, 0.0040, 0.0040, 'Gold')]
    n = 12
    rings = [[SCAB_MOUTH + d * s + up * (ra * cos(2 * pi * k / n)) + side * (rb * sin(2 * pi * k / n))
              for k in range(n)] for s, ra, rb, _ in st]
    g.begin('scabbard', warp=False)
    loft(g, rings, 'Leather', 'Hips', mats=[m for _, _, _, m in st[1:]], sharp=30)
    g.end()
    # two suspension straps from the belt
    for i, s in enumerate((0.030, 0.250)):
        a = SCAB_MOUTH + d * s + up * 0.026
        phi = radians(74 + 34 * i)
        b = skirt_pt(phi, 0.940, 0.036)
        mid = (a + b) / 2 + V(0.012, 0, -0.004)
        pts = [b, b.lerp(mid, 0.5), mid, mid.lerp(a, 0.5), a]
        g.begin('scabbard_strap%d' % i, warp=False)
        tube_along(g, pts, [(0.0025, 0.008)] * 5, 6, 'Leather', 'Hips', sharp=30)
        g.end()


# ----------------------------------------------------------------------------
# sword (own object).  Local frame: blade along +Z (-> +Y in glTF), cross-guard
# along X, origin where the hand holds the grip.
# ----------------------------------------------------------------------------
SW_GUARD_Z = 0.060


def build_sword():
    g = Geo(warp=False)
    gz = SW_GUARD_Z

    def hexring(z, wd, th):
        return [V(wd / 2, 0, z), V(wd * 0.17, th / 2, z), V(-wd * 0.17, th / 2, z), V(-wd / 2, 0, z),
                V(-wd * 0.17, -th / 2, z), V(wd * 0.17, -th / 2, z)]

    blade = [(gz + 0.002, 0.046, 0.0100), (gz + 0.050, 0.041, 0.0095), (gz + 0.35, 0.037, 0.0085),
             (gz + 0.66, 0.031, 0.0072), (gz + 0.84, 0.024, 0.0058), (gz + 0.905, 0.014, 0.0042),
             (gz + 0.928, 0.0015, 0.0012)]
    g.begin('blade')
    loft(g, [hexring(*b) for b in blade], 'Blade', 'none', sharp=1.0)
    g.end()

    # cross-guard: octagonal bar swept along X, gently curved towards the blade
    def guard_ring(x):
        k = abs(x) / 0.112
        hz = lerp(0.0105, 0.0060, k ** 0.8) * (1.0 + 0.5 * gauss(x, 0.02))
        hy = lerp(0.0100, 0.0055, k ** 0.8) * (1.0 + 0.25 * gauss(x, 0.02))
        zc = gz + 0.022 * k ** 2
        pts = []
        for i in range(8):
            a = 2 * pi * (i + 0.5) / 8
            pts.append(V(x, hy * 1.08 * cos(a), zc + hz * 1.08 * sin(a)))
        return pts

    xs = [-0.118, -0.112, -0.095, -0.07, -0.045, -0.022, 0.0, 0.022, 0.045, 0.07, 0.095, 0.112, 0.118]
    rings = [guard_ring(x) for x in xs]
    for r, sc in ((rings[0], 0.45), (rings[-1], 0.45)):
        c = sum(r, Vector()) / 8
        for i in range(8):
            r[i] = c + (r[i] - c) * sc
    for r, sc in ((rings[1], 1.5), (rings[-2], 1.5)):
        c = sum(r, Vector()) / 8
        for i in range(8):
            r[i] = c + (r[i] - c) * sc
    g.begin('guard')
    loft(g, rings, 'Gold', 'none', sharp=28)
    g.end()

    # rain-guard: small faceted lozenge over the blade root
    def loz(z, wd, th):
        return [V(wd, 0, z), V(0, th, z), V(-wd, 0, z), V(0, -th, z)]

    g.begin('lozenge')
    loft(g, [loz(gz - 0.006, 0.010, 0.006), loz(gz + 0.008, 0.021, 0.0105), loz(gz + 0.045, 0.004, 0.0075)],
         'Gold', 'none', sharp=1.0)
    g.end()

    # grip (leather, oval, with wrap ridges) and faceted pommel
    prof = []
    z = gz - 0.006
    i = 0
    while z > -0.1155:
        r = 0.0128 + 0.0022 * sin(pi * (gz - z) / (gz + 0.115)) ** 0.8
        prof.append((z, r + (0.0007 if i % 2 == 0 else -0.0003)))
        z -= 0.0085
        i += 1
    prof.append((-0.117, 0.0125))
    g.begin('grip')
    loft(g, [[V(r * 1.12 * cos(2 * pi * k / 10), r * 0.92 * sin(2 * pi * k / 10), z) for k in range(10)]
             for z, r in prof], 'Leather', 'none', sharp=50)
    g.end()
    pom = [(-0.113, 0.0125), (-0.119, 0.0175), (-0.137, 0.0225), (-0.152, 0.0185), (-0.163, 0.0100),
           (-0.166, 0.0030)]
    g.begin('pommel')
    loft(g, [[V(r * cos(2 * pi * (k + .5) / 8), r * 0.9 * sin(2 * pi * (k + .5) / 8), z) for k in range(8)]
             for z, r in pom], 'Gold', 'none', sharp=1.0)
    g.end()
    return g


# ----------------------------------------------------------------------------
# skeleton
# ----------------------------------------------------------------------------
def bone_table():
    B = []   # (name, head, tail, parent, z-axis hint)

    def add(name, head, tail, parent, zax=FWD):
        B.append((name, Vector(head), Vector(tail), parent, Vector(zax)))

    add('Hips', V(0, 0, 0.955), V(0, 0, 1.050), None)
    add('Spine', V(0, 0, 1.050), V(0, 0, 1.210), 'Hips')
    add('Chest', V(0, 0, 1.210), V(0, 0, 1.500), 'Spine')
    add('Neck', V(0, 0, 1.500), V(0, 0, 1.600), 'Chest')
    add('Head', V(0, 0, 1.600), V(0, 0, 1.800), 'Neck')
    for sx, sfx in ((1, 'L'), (-1, 'R')):
        m = lambda p: V(p.x * sx, p.y, p.z)
        add('Shoulder.' + sfx, m(V(0.035, 0, 1.455)), m(SH), 'Chest')
        add('UpperArm.' + sfx, m(SH), m(EL), 'Shoulder.' + sfx)
        add('LowerArm.' + sfx, m(EL), m(WR), 'UpperArm.' + sfx)
        add('Hand.' + sfx, m(WR), m(WR + AD * HAND_BONE), 'LowerArm.' + sfx)
    for sx, sfx in ((1, 'L'), (-1, 'R')):
        m = lambda p: V(p.x * sx, p.y, p.z)
        add('UpperLeg.' + sfx, m(HIP), m(KNEE), 'Hips')
        add('LowerLeg.' + sfx, m(KNEE), m(ANK), 'UpperLeg.' + sfx)
        add('Foot.' + sfx, m(ANK), m(BALL), 'LowerLeg.' + sfx, UP)
        add('Toe.' + sfx, m(BALL), m(TOE), 'Foot.' + sfx, UP)
    for col, u in CAPE_COLS:
        pts = [cape_base(u, k / 5) for k in range(6)]
        for k in range(5):
            add('Cape.%s.%d' % (col, k + 1), pts[k], pts[k + 1],
                'Chest' if k == 0 else 'Cape.%s.%d' % (col, k))
    tf0, tf1 = tabard_front(0.5, 0.0), tabard_front(0.5, 0.93)
    tb0, tb1 = tabard_back(0.5, 0.0), tabard_back(0.5, 0.93)
    add('Tabard.F', tf0, V(tf0.x, tf0.y, tf1.z), 'Hips')
    add('Tabard.B', tb0, V(tb0.x, tb0.y, tb1.z), 'Hips')
    return B


def build_rig(bones):
    arm = bpy.data.armatures.new('Rig')
    rig = bpy.data.objects.new('Rig', arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for name, head, tail, parent, zax in bones:
        eb = arm.edit_bones.new(name)
        eb.head, eb.tail = head, tail
        eb.align_roll(zax)
        if parent:
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.display_type = 'STICK'
    return rig


# ----------------------------------------------------------------------------
# materials
# ----------------------------------------------------------------------------
#                 base colour (linear)        metallic roughness
MATERIALS = {'Armor': ((0.800, 0.770, 0.690), 0.85, 0.34),
             'Gold': ((0.900, 0.600, 0.180), 1.00, 0.30),
             'Cloth': ((0.016, 0.070, 0.090), 0.00, 0.85),
             'Cape': ((0.300, 0.016, 0.028), 0.00, 0.80),
             'Leather': ((0.075, 0.043, 0.028), 0.00, 0.55),
             'Mask': ((0.900, 0.880, 0.830), 0.00, 0.22),
             'Blade': ((0.600, 0.900, 0.960), 0.30, 0.07),
             'Undersuit': ((0.016, 0.018, 0.024), 0.00, 0.68)}


def build_materials():
    mats = {}
    for name, (col, metal, rough) in MATERIALS.items():
        m = bpy.data.materials.new(name)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled')
        bsdf.inputs['Base Color'].default_value = (*col, 1.0)
        bsdf.inputs['Metallic'].default_value = metal
        bsdf.inputs['Roughness'].default_value = rough
        m.diffuse_color = (*col, 1.0)
        m.metallic, m.roughness = metal, rough
        m.use_backface_culling = True          # every part is a closed solid -> single sided in glTF
        mats[name] = m
    return mats


# ----------------------------------------------------------------------------
# Geo -> Blender object
# ----------------------------------------------------------------------------
def make_object(name, g, mats, skinned):
    used = [m for m in MATERIALS if m in set(g.fm)]
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in g.v], [], g.f)
    for m in used:
        me.materials.append(mats[m])
    me.polygons.foreach_set('material_index', [used.index(m) for m in g.fm])
    me.polygons.foreach_set('use_smooth', [True] * len(g.f))
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) == 2:
            thr = min(g.fs[lf[0].index], g.fs[lf[1].index])
            e.smooth = degrees(e.calc_face_angle(0.0)) < thr
        else:
            e.smooth = False
    bm.to_mesh(me)
    bm.free()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if skinned:
        per = {}
        for i, w in enumerate(g.w):
            for b, x in w.items():
                per.setdefault(b, []).append((i, x))
        for b in sorted(per):
            vg = ob.vertex_groups.new(name=b)
            for i, x in per[b]:
                vg.add((i,), x, 'REPLACE')
    return ob


# ----------------------------------------------------------------------------
# preview rendering
# ----------------------------------------------------------------------------
def setup_render(samples):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.eevee.taa_render_samples = samples
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    try:
        sc.view_settings.look = 'None'
    except Exception:
        pass
    world = bpy.data.worlds.new('Studio')
    sc.world = world
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    N = nt.nodes.new
    L = nt.links.new
    out = N('ShaderNodeOutputWorld')
    mix = N('ShaderNodeMixShader')
    lp = N('ShaderNodeLightPath')
    bg_env = N('ShaderNodeBackground')
    bg_cam = N('ShaderNodeBackground')
    bg_cam.inputs['Color'].default_value = (0.215, 0.215, 0.215, 1.0)     # mid grey backdrop
    tc = N('ShaderNodeTexCoord')
    mp = N('ShaderNodeMapping')
    mp.vector_type = 'VECTOR'
    mp.name = 'EnvRot'
    L(tc.outputs['Generated'], mp.inputs['Vector'])
    sep = N('ShaderNodeSeparateXYZ')
    L(mp.outputs['Vector'], sep.inputs[0])
    sky = N('ShaderNodeMapRange')
    sky.inputs['From Min'].default_value = -1.0
    sky.inputs['From Max'].default_value = 1.0
    sky.inputs['To Min'].default_value = 0.06
    sky.inputs['To Max'].default_value = 0.75
    L(sep.outputs['Z'], sky.inputs['Value'])
    total = sky.outputs['Result']
    for d, lo, hi, gain in (((-0.50, -0.68, 0.54), 0.72, 0.95, 5.0),     # key soft box
                            ((0.80, -0.50, 0.25), 0.80, 0.97, 1.6),      # fill
                            ((0.35, 0.80, 0.50), 0.80, 0.96, 3.0)):      # rim
        dv = Vector(d).normalized()
        dot = N('ShaderNodeVectorMath')
        dot.operation = 'DOT_PRODUCT'
        dot.inputs[1].default_value = dv
        L(mp.outputs['Vector'], dot.inputs[0])
        mr = N('ShaderNodeMapRange')
        mr.interpolation_type = 'SMOOTHSTEP'
        mr.inputs['From Min'].default_value = lo
        mr.inputs['From Max'].default_value = hi
        mr.inputs['To Min'].default_value = 0.0
        mr.inputs['To Max'].default_value = gain
        L(dot.outputs['Value'], mr.inputs['Value'])
        add = N('ShaderNodeMath')
        add.operation = 'ADD'
        L(total, add.inputs[0])
        L(mr.outputs['Result'], add.inputs[1])
        total = add.outputs['Value']
    L(total, bg_env.inputs['Strength'])
    L(lp.outputs['Is Camera Ray'], mix.inputs['Fac'])
    L(bg_env.outputs['Background'], mix.inputs[1])
    L(bg_cam.outputs['Background'], mix.inputs[2])
    L(mix.outputs['Shader'], out.inputs['Surface'])

    rigl = bpy.data.objects.new('LightRig', None)
    sc.collection.objects.link(rigl)
    for nm, pos, power, size, col in (('Key', (-2.8, -3.6, 3.6), 900.0, 3.0, (1.0, 0.97, 0.94)),
                                      ('Fill', (3.6, -2.6, 1.5), 260.0, 4.0, (0.92, 0.96, 1.0)),
                                      ('Rim', (1.8, 3.8, 3.2), 650.0, 2.5, (1.0, 1.0, 1.0))):
        ld = bpy.data.lights.new(nm, 'AREA')
        ld.energy, ld.size, ld.color = power, size, col
        lo = bpy.data.objects.new(nm, ld)
        sc.collection.objects.link(lo)
        lo.parent = rigl
        lo.location = pos
        lo.rotation_euler = (V(0, 0, 0.95) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
    cd = bpy.data.cameras.new('PreviewCam')
    cd.lens, cd.sensor_fit, cd.sensor_height = 70.0, 'VERTICAL', 24.0
    cd.clip_start, cd.clip_end = 0.1, 100.0
    cam = bpy.data.objects.new('PreviewCam', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return rigl, cam, mp


def render_view(path, az, elev, target, height, res, rig_l, cam, env_map):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    a, e = radians(az), radians(elev)
    fov = 2 * math.atan(12.0 / cam.data.lens)
    dist = (height / 2) / math.tan(fov / 2)
    tgt = Vector(target)
    d = V(sin(a) * cos(e), -cos(a) * cos(e), sin(e))
    cam.location = tgt + d * dist
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    rig_l.rotation_euler = (0, 0, a)
    env_map.inputs['Rotation'].default_value = (0, 0, -a)
    sc.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print('[hero] rendered %s (%.1fs)' % (os.path.basename(path), time.time() - t))


VIEWS = {'front': dict(az=0, elev=2, target=(0, 0, 0.93), height=2.12, res=(720, 900)),
         'back': dict(az=180, elev=2, target=(0, 0, 0.93), height=2.12, res=(720, 900)),
         'side': dict(az=90, elev=2, target=(0, -0.30, 0.93), height=2.12, res=(900, 900)),
         '34': dict(az=-38, elev=8, target=(-0.10, -0.18, 0.93), height=2.12, res=(900, 900)),
         'pose': dict(az=148, elev=10, target=(0.05, 0.0, 0.98), height=2.35, res=(900, 900))}


def pose_rot(rig, name, axis, deg):
    """rotate a pose bone about an armature-space axis (parents assumed near rest)"""
    pb = rig.pose.bones[name]
    pb.rotation_mode = 'QUATERNION'
    R = pb.bone.matrix_local.to_3x3()
    q = Quaternion(Vector(axis).normalized(), radians(deg)).to_matrix()
    pb.rotation_quaternion = (R.inverted() @ q @ R).to_quaternion()


def apply_test_pose(rig):
    pose_rot(rig, 'UpperArm.L', (0, 1, 0), -52)          # raise the left arm above horizontal
    pose_rot(rig, 'LowerArm.L', tuple(AN), -65)          # bend the elbow forward
    pose_rot(rig, 'Shoulder.L', (0, 1, 0), -12)
    pose_rot(rig, 'UpperArm.R', (0, 1, 0), -25)          # lower the sword arm
    pose_rot(rig, 'UpperLeg.R', (1, 0, 0), -55)          # lift the right thigh
    pose_rot(rig, 'LowerLeg.R', (1, 0, 0), 75)           # bend the knee
    pose_rot(rig, 'UpperLeg.L', (1, 0, 0), 14)
    pose_rot(rig, 'Spine', (1, 0, 0), -8)
    pose_rot(rig, 'Head', (0, 0, 1), 32)
    for c in 'LCR':
        pose_rot(rig, 'Cape.%s.2' % c, (1, 0, 0), 22)
        pose_rot(rig, 'Cape.%s.4' % c, (1, 0, 0), -14)
    pose_rot(rig, 'Cape.L.3', (0, 1, 0), 18)
    pose_rot(rig, 'Tabard.F', (1, 0, 0), -24)
    pose_rot(rig, 'Tabard.B', (1, 0, 0), 20)
    bpy.context.view_layer.update()


def reset_pose(rig):
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'

    g = Geo()
    build_body(g)
    build_cuirass(g)
    build_legs(g)
    build_arms(g)
    build_hand(g, HP_OPEN, 'Hand.L', None, False)
    build_hand(g, HP_FIST, 'Hand.L', 'only', True)
    build_head(g)
    build_cloth(g)
    sw = build_sword()

    print('[hero] part triangle counts:')
    for name, f0, f1 in g.parts:
        print('    %-22s %6d' % (name, g.tris(f0, f1)))
    print('[hero] body tris %d, sword tris %d, geometry built in %.1fs'
          % (g.tris(), sw.tris(), time.time() - T_START))

    mats = build_materials()
    bones = bone_table()
    rig = build_rig(bones)
    hero = make_object('Hero', g, mats, skinned=True)
    hero.parent = rig
    md = hero.modifiers.new('Armature', 'ARMATURE')
    md.object = rig
    sword = make_object('Sword', sw, mats, skinned=False)

    # sword in the right fist: mirror the left-hand grip frame
    G, Xg, Tg, Dn = grip_frame_left()
    mir = lambda p: V(-p.x, p.y, p.z)
    G, blade_dir, guard_dir = mir(G), mir(Xg), mir(Tg)
    flat = blade_dir.cross(guard_dir).normalized()
    M = Matrix.Identity(4)
    for i in range(3):
        M[i][0], M[i][1], M[i][2], M[i][3] = guard_dir[i], flat[i], blade_dir[i], G[i]
    hb = rig.data.bones['Hand.R']
    pm = rig.matrix_world @ hb.matrix_local @ Matrix.Translation((0, hb.length, 0))
    sword.parent = rig
    sword.parent_type = 'BONE'
    sword.parent_bone = 'Hand.R'
    sword.matrix_parent_inverse = Matrix.Identity(4)
    sword.matrix_basis = pm.inverted() @ M
    bpy.context.view_layer.update()
    err = max(abs(sword.matrix_world[i][j] - M[i][j]) for i in range(3) for j in range(4))
    print('[hero] sword placement error %.2e' % err)

    # bounds
    zs = [p.z for p in g.v]
    print('[hero] mesh bounds z %.4f .. %.4f   x %.3f .. %.3f   y %.3f .. %.3f'
          % (min(zs), max(zs), min(p.x for p in g.v), max(p.x for p in g.v),
             min(p.y for p in g.v), max(p.y for p in g.v)))

    # ---- previews
    shots = opt_all('--shot')
    if not opt('--no-render', flag=True):
        os.makedirs(OUT_DIR, exist_ok=True)
        rig.hide_render = True
        lrig, cam, env = setup_render(int(opt('--samples', 24)))
        want = opt('--views', 'front,back,side,34,pose').split(',')
        for nm in ('front', 'back', 'side', '34'):
            if nm in want:
                render_view(os.path.join(OUT_DIR, 'hero_%s.png' % nm), rig_l=lrig, cam=cam, env_map=env,
                            **VIEWS[nm])
        for s in shots:
            path, az, elev, tgt, h, res, posed = s.split(';')
            if posed != '1':
                render_view(path, float(az), float(elev), tuple(float(x) for x in tgt.split(',')), float(h),
                            tuple(int(x) for x in res.split('x')), lrig, cam, env)
        if 'pose' in want or any(s.split(';')[6] == '1' for s in shots):
            apply_test_pose(rig)
            if 'pose' in want:
                render_view(os.path.join(OUT_DIR, 'hero_pose.png'), rig_l=lrig, cam=cam, env_map=env,
                            **VIEWS['pose'])
            for s in shots:
                path, az, elev, tgt, h, res, posed = s.split(';')
                if posed == '1':
                    render_view(path, float(az), float(elev), tuple(float(x) for x in tgt.split(',')),
                                float(h), tuple(int(x) for x in res.split('x')), lrig, cam, env)
            reset_pose(rig)
        for ob in list(bpy.data.objects):
            if ob.type in ('CAMERA', 'LIGHT') or ob.name == 'LightRig':
                bpy.data.objects.remove(ob, do_unlink=True)

    if opt('--blend'):
        bpy.ops.wm.save_as_mainfile(filepath=opt('--blend'))

    # ---- export
    reset_pose(rig)
    tri_mat = {}
    for ob in (hero, sword):
        for p in ob.data.polygons:
            nm = ob.data.materials[p.material_index].name
            tri_mat[nm] = tri_mat.get(nm, 0) + len(p.vertices) - 2
    if not opt('--no-export', flag=True):
        os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
        bpy.ops.object.select_all(action='DESELECT')
        for ob in (rig, hero, sword):
            ob.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True,
                                  export_yup=True, export_apply=True, export_skins=True,
                                  export_animations=False, export_morph=False, export_cameras=False,
                                  export_lights=False, export_materials='EXPORT', export_image_format='NONE',
                                  export_tangents=False, export_vertex_color='NONE', export_normals=True,
                                  export_texcoords=False, export_influence_nb=4, export_all_influences=False,
                                  export_extras=False, check_existing=False)
        print('[hero] wrote %s (%d bytes)' % (OUT_GLB, os.path.getsize(OUT_GLB)))
    print('[hero] bones (%d):' % len(bones))
    for name, head, tail, parent, _ in bones:
        print('    %-12s parent=%-12s head=(%.3f, %.3f, %.3f) tail=(%.3f, %.3f, %.3f)'
              % (name, parent or '-', *head, *tail))
    print('[hero] triangles per material:')
    for nm in MATERIALS:
        print('    %-10s %6d' % (nm, tri_mat.get(nm, 0)))
    print('    %-10s %6d' % ('TOTAL', sum(tri_mat.values())))
    mx = max(len(w) for w in g.w)
    print('[hero] max influences per vertex: %d, verts %d' % (mx, len(g.v)))
    print('[hero] done in %.1fs' % (time.time() - T_START))


main()
