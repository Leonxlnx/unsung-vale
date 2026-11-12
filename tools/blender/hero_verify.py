"""
hero_verify.py -- sanity check for public/models/hero.glb.

Run:  blender --background --threads 4 --python tools/blender/hero_verify.py

1. parses the GLB container directly (node tree, skin, materials, primitives,
   joint/weight accessors) and
2. re-imports it into an empty Blender scene and checks bone names/parents and
   the mesh bounds.
Exits with code 1 if a check fails.
"""
import bpy, sys, os, json, struct, math
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
GLB = os.path.abspath(os.path.join(HERE, '..', '..', 'public', 'models', 'hero.glb'))
VERBOSE = '--verbose' in sys.argv

EXPECT_PARENT = {'Hips': None, 'Spine': 'Hips', 'Chest': 'Spine', 'Neck': 'Chest', 'Head': 'Neck',
                 'Tabard.F': 'Hips', 'Tabard.B': 'Hips'}
for s in 'LR':
    EXPECT_PARENT.update({'Shoulder.' + s: 'Chest', 'UpperArm.' + s: 'Shoulder.' + s,
                          'LowerArm.' + s: 'UpperArm.' + s, 'Hand.' + s: 'LowerArm.' + s,
                          'UpperLeg.' + s: 'Hips', 'LowerLeg.' + s: 'UpperLeg.' + s,
                          'Foot.' + s: 'LowerLeg.' + s, 'Toe.' + s: 'Foot.' + s})
for c in 'LCR':
    for k in range(1, 6):
        EXPECT_PARENT['Cape.%s.%d' % (c, k)] = 'Chest' if k == 1 else 'Cape.%s.%d' % (c, k - 1)
EXPECT_MATS = {'Armor', 'Gold', 'Cloth', 'Cape', 'Leather', 'Mask', 'Blade', 'Undersuit'}

fails = []


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond:
        fails.append(msg)


# ---------------------------------------------------------------- raw GLB
with open(GLB, 'rb') as fh:
    data = fh.read()
magic, version, length = struct.unpack_from('<4sII', data, 0)
jlen, jtype = struct.unpack_from('<I4s', data, 12)
gltf = json.loads(data[20:20 + jlen].decode('utf-8'))
boff = 20 + jlen
blen, btype = struct.unpack_from('<I4s', data, boff)
BIN = data[boff + 8: boff + 8 + blen]
print('[verify] %s  %d bytes, glTF %s, generator %s' % (GLB, len(data), gltf['asset']['version'],
                                                         gltf['asset'].get('generator')))
nodes = gltf['nodes']
parent = {}
for i, n in enumerate(nodes):
    for c in n.get('children', []):
        parent[c] = i


def local(n):
    t = Matrix.Translation(n.get('translation', (0, 0, 0)))
    q = n.get('rotation', (0, 0, 0, 1))
    r = Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4()
    s = n.get('scale', (1, 1, 1))
    return t @ r @ Matrix.Diagonal((*s, 1))


def world(i):
    m = local(nodes[i])
    while i in parent:
        i = parent[i]
        m = local(nodes[i]) @ m
    return m


COMP = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
NUM = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_acc(idx):
    a = gltf['accessors'][idx]
    bv = gltf['bufferViews'][a['bufferView']]
    n = NUM[a['type']]
    fmt = COMP[a['componentType']]
    size = struct.calcsize(fmt) * n
    stride = bv.get('byteStride', size)
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return [struct.unpack_from('<%d%s' % (n, fmt), BIN, off + i * stride) for i in range(a['count'])]


print('[verify] container')
check(not gltf.get('images') and not gltf.get('textures'), 'no images / textures')
check(not gltf.get('animations'), 'no animations')
check(not gltf.get('cameras'), 'no cameras')
check('KHR_lights_punctual' not in gltf.get('extensionsUsed', []), 'no lights')
check(len(gltf.get('skins', [])) == 1, 'exactly one skin')
mats = gltf.get('materials', [])
check({m['name'] for m in mats} == EXPECT_MATS, 'material names: ' + ', '.join(sorted(m['name'] for m in mats)))
for m in mats:
    p = m.get('pbrMetallicRoughness', {})
    tex = [k for k in list(p) + list(m) if 'Texture' in k]
    print('       %-10s base=%s metal=%.2f rough=%.2f doubleSided=%s %s'
          % (m['name'], [round(c, 3) for c in p.get('baseColorFactor', [1, 1, 1, 1])],
             p.get('metallicFactor', 1.0), p.get('roughnessFactor', 1.0), m.get('doubleSided', False),
             ('TEXTURES ' + str(tex)) if tex else ''))
    check(not tex, m['name'] + ' has plain factors only')

skin = gltf['skins'][0]
joints = skin['joints']
jname = [nodes[j]['name'] for j in joints]
print('[verify] skin "%s": %d joints' % (skin.get('name'), len(joints)))
for j in joints:
    p = parent.get(j)
    pn = nodes[p]['name'] if p is not None and p in joints else None
    nm = nodes[j]['name']
    if nm in EXPECT_PARENT and EXPECT_PARENT[nm] != pn:
        check(False, 'parent of %s is %s (expected %s)' % (nm, pn, EXPECT_PARENT[nm]))
check(set(jname) == set(EXPECT_PARENT), 'joint names match the specification (%d)' % len(EXPECT_PARENT))

tri_mat = {}
print('[verify] meshes')
for ni, n in enumerate(nodes):
    if 'mesh' not in n:
        continue
    mesh = gltf['meshes'][n['mesh']]
    pn = nodes[parent[ni]]['name'] if ni in parent else None
    print('       node "%s" (parent "%s") mesh "%s" skin=%s, %d primitives'
          % (n['name'], pn, mesh['name'], n.get('skin'), len(mesh['primitives'])))
    lo, hi = [1e9] * 3, [-1e9] * 3
    for prim in mesh['primitives']:
        att = prim['attributes']
        pa = gltf['accessors'][att['POSITION']]
        tris = gltf['accessors'][prim['indices']]['count'] // 3
        mn = mats[prim['material']]['name']
        tri_mat[mn] = tri_mat.get(mn, 0) + tris
        lo = [min(a, b) for a, b in zip(lo, pa['min'])]
        hi = [max(a, b) for a, b in zip(hi, pa['max'])]
        extra = sorted(k for k in att if k not in ('POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0'))
        P = [Vector(p) for p in read_acc(att['POSITION'])]
        N = read_acc(att['NORMAL'])
        I = [i[0] for i in read_acc(prim['indices'])]
        degen = sum(1 for k in range(0, len(I), 3)
                    if (P[I[k + 1]] - P[I[k]]).cross(P[I[k + 2]] - P[I[k]]).length < 1e-9)
        badn = sum(1 for nn in N if abs(math.sqrt(nn[0] ** 2 + nn[1] ** 2 + nn[2] ** 2) - 1.0) > 1e-2)
        check(degen == 0 and badn == 0, '%s/%s: no degenerate triangles (%d) / bad normals (%d)'
              % (n['name'], mn, degen, badn))
        if 'JOINTS_0' in att:
            J, W = read_acc(att['JOINTS_0']), read_acc(att['WEIGHTS_0'])
            wt = gltf['accessors'][att['WEIGHTS_0']]['componentType']
            sc = {5126: 1.0, 5121: 255.0, 5123: 65535.0}[wt]
            bad = sum(1 for w in W if abs(sum(w) / sc - 1.0) > 1e-3)
            used = {jname[j[k]] for j, w in zip(J, W) for k in range(4) if w[k] > 0}
            check(bad == 0 and 'JOINTS_1' not in att,
                  '%s/%s: %d verts, %d tris, <=4 influences, weights normalised' % (n['name'], mn, len(J), tris))
            if VERBOSE:
                print('         bones:', ', '.join(sorted(used)))
        else:
            print('       %s/%s: %d verts, %d tris (unskinned)' % (n['name'], mn, pa['count'], tris))
        check(not extra, '%s/%s has no extra attributes %s' % (n['name'], mn, extra))
    print('       local bounds (glTF, +Y up): min %s max %s' % ([round(v, 4) for v in lo], [round(v, 4) for v in hi]))
    if n.get('skin') is not None:
        check(abs(lo[1]) < 0.005, 'feet on y = 0 (min y %.4f)' % lo[1])
        check(abs(hi[1] - 1.82) < 0.02, 'height about 1.82 m (max y %.4f)' % hi[1])
print('[verify] triangles per material:')
for k in sorted(tri_mat):
    print('       %-10s %6d' % (k, tri_mat[k]))
total = sum(tri_mat.values())
print('       %-10s %6d' % ('TOTAL', total))
check(25000 <= total <= 45000, 'triangle budget 25k-45k')

print('[verify] rest pose, glTF space (+Y up, +Z forward, +X = character left); world position of each joint')
print('         and the world direction of its local +X / +Y / +Z axes')
for j in joints:
    m = world(j)
    p = m.to_translation()
    ax = [tuple(round(m[r][c], 3) for r in range(3)) for c in range(3)]
    pj = parent.get(j)
    q = nodes[j].get('rotation', (0, 0, 0, 1))
    print('       %-11s parent=%-11s pos=(%7.4f, %7.4f, %7.4f)  X=%s Y=%s Z=%s'
          % (nodes[j]['name'], nodes[pj]['name'] if pj in joints else '(%s)' % nodes[pj]['name'],
             p.x, p.y, p.z, ax[0], ax[1], ax[2]))
for i, n in enumerate(nodes):
    if n['name'] == 'Sword':
        print('[verify] Sword node: parent "%s"' % nodes[parent[i]]['name'])
        print('         local translation %s' % [round(v, 5) for v in n.get('translation', (0, 0, 0))])
        print('         local rotation (xyzw) %s' % [round(v, 5) for v in n.get('rotation', (0, 0, 0, 1))])
        print('         local scale %s' % [round(v, 5) for v in n.get('scale', (1, 1, 1))])
        m = world(i)
        print('         world origin (%.4f, %.4f, %.4f); blade (+Y local) points along world %s'
              % (*m.to_translation(), tuple(round(m[r][1], 3) for r in range(3))))
        check(parent.get(i) is not None and nodes[parent[i]]['name'] == 'Hand.R', 'Sword is a child of Hand.R')
        check('skin' not in n, 'Sword is unskinned')
check(any(n['name'] == 'Rig' for n in nodes), 'armature node "Rig" present')
roots = [nodes[i]['name'] for i in gltf['scenes'][gltf.get('scene', 0)]['nodes']]
print('[verify] scene roots: %s' % roots)

# ---------------------------------------------------------------- Blender round trip
print('[verify] re-import into an empty scene')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
check(len(arms) == 1 and arms[0].name == 'Rig', 'one armature named Rig')
rig = arms[0]
ok = True
for b in rig.data.bones:
    exp = EXPECT_PARENT.get(b.name, 'MISSING')
    got = b.parent.name if b.parent else None
    if exp != got:
        ok = False
        print('       bone %s parent %s (expected %s)' % (b.name, got, exp))
check(ok and len(rig.data.bones) == len(EXPECT_PARENT), 'imported bones and parents match (%d bones)' % len(rig.data.bones))
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
for o in bpy.data.objects:
    if o.type != 'MESH' or o.name not in ('Hero', 'Sword'):   # (the importer adds a bone-shape helper)
        continue
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    pts = [ev.matrix_world @ v.co for v in me.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    print('       %-6s world bounds (Blender, +Z up): min (%.3f, %.3f, %.3f) max (%.3f, %.3f, %.3f), %d verts, '
          'parent=%s %s' % (o.name, *lo, *hi, len(me.vertices), o.parent.name if o.parent else None,
                            ('bone=' + o.parent_bone) if o.parent_type == 'BONE' else ''))
    if o.name == 'Hero':
        check(abs(lo.z) < 0.005 and abs(hi.z - 1.82) < 0.02, 'Hero stands on z=0 and is %.3f m tall' % hi.z)
        mx = max(len([g for g in v.groups if g.weight > 0]) for v in me.vertices)
        check(mx <= 4, 'max %d influences per vertex after import' % mx)
        zmask = [p for p, v in zip(pts, me.vertices)]
        front = min(p.y for p in pts if p.z > 1.55)
        check(front < -0.12, 'character faces -Y in Blender / +Z in glTF (hood brow at y=%.3f)' % front)
    ev.to_mesh_clear()
print('[verify] %s' % ('ALL CHECKS PASSED' if not fails else '%d CHECK(S) FAILED: %s' % (len(fails), fails)))
sys.stdout.flush()
if fails:
    sys.exit(1)
