"""
MIRAS VR — turn the sculpted guide STL into a VR-ready GLB.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
        --python build_heritage_guide.py -- [--stl PATH] [--tris 80000]

Steps: import -> weld/validate -> decimate to the triangle budget -> paint
clothing/skin regions as vertex colours (one material, one draw call) -> darken
creases with vertex-colour dirt -> origin at the feet -> save .blend -> export GLB
-> re-import the GLB to verify it.

The STL carries no colour, UVs or rig, so regions are classified from position
on this particular sculpt (Z up, faces -Y, 1.9 m tall, A-pose). Retune
REGION_RULES if the source model changes.
"""

import argparse
import os
import sys

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROJECT = os.path.dirname(ROOT)

DEFAULTS = {
    "stl": os.path.join(PROJECT, "models ", "Stylized Trump Tour Guide.stl"),
    "blend": os.path.join(HERE, "heritage_guide.blend"),
    "glb": os.path.join(ROOT, "assets", "models", "heritage_guide.glb"),
}
NAME = "MIRAS_Heritage_Guide"

# Linear-ish sRGB colours, multiplied by crease shading later.
PALETTE = {
    "kurta": (0.86, 0.80, 0.66),
    "scarf": (0.56, 0.13, 0.10),
    "trousers": (0.90, 0.88, 0.82),
    "shoes": (0.24, 0.14, 0.08),
    "skin": (0.86, 0.63, 0.50),
    "hair": (0.88, 0.74, 0.46),
}


def classify(c):
    """Region for a face centre `c` (metres, origin at model centre, feet at z≈-0.95)."""
    x, y, z = c.x, c.y, c.z
    ax = abs(x)
    if z < -0.80:
        return "shoes"
    if ax > 0.44 and z < 0.12:
        return "skin"  # hands
    if z > 0.80 or (z > 0.62 and y > 0.04 and ax < 0.16):
        return "hair"  # crown and back of head
    if z > 0.57 and ax < 0.16:
        return "skin"  # face, ears, neck
    if z < -0.45:
        return "trousers"
    return "kurta"  # the scarf is found afterwards by grow_scarf()


def in_scarf_bounds(c):
    """Where the scarf can be: two front panels down to the fringe, and around the neck."""
    return -0.42 < c.z < 0.62 and abs(c.x) < 0.26 and (c.y < -0.04 or (c.z > 0.44 and c.y < 0.02))


def grow_scarf(bm, shift, max_angle=0.5):
    """Flood-fill from points on each hanging panel across smooth edges.

    The scarf is fused into the jacket in the sculpt, but its edges form a sharp
    ledge, so growth stops there. Bounded so a soft spot cannot spill everywhere.
    """
    def centre(f):
        c = f.calc_center_median()
        c.z += shift
        return c

    # Front-most faces down the middle of each panel; folds can split a panel into
    # pockets the fill cannot cross, so seed it at several heights.
    centres = [(f, centre(f)) for f in bm.faces]
    seeds = []
    for side in (-1, 1):
        for zs in (-0.30, -0.15, 0.0, 0.15, 0.30):
            cands = [(f, c) for f, c in centres if abs(c.z - zs) < 0.03 and abs(c.x - side * 0.13) < 0.025]
            seeds.append(min(cands, key=lambda fc: fc[1].y)[0])
    scarf = set(seeds)
    stack = list(seeds)
    while stack:
        f = stack.pop()
        for e in f.edges:
            if len(e.link_faces) != 2 or e.calc_face_angle(3.14) > max_angle:
                continue
            g = e.link_faces[0] if e.link_faces[1] is f else e.link_faces[1]
            if g not in scarf and in_scarf_bounds(centre(g)):
                scarf.add(g)
                stack.append(g)
    return scarf


def log(msg):
    print(f"[MIRAS guide] {msg}", flush=True)


def build(stl, blend, glb, tris):
    if not os.path.isfile(stl):
        raise SystemExit(f"[MIRAS guide] ERROR: STL not found: {stl}")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.stl_import(filepath=stl)
    obj = bpy.context.selected_objects[0]
    obj.name = obj.data.name = NAME
    bpy.context.view_layer.objects.active = obj
    src_tris = len(obj.data.polygons)
    log(f"Imported {src_tris} triangles")

    # Weld + clean before decimating so the collapse sees a connected surface.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-7)
    bm.to_mesh(obj.data)
    bm.free()

    mod = obj.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = min(1.0, tris / src_tris)
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    me = obj.data
    log(f"Decimated to {len(me.polygons)} triangles")

    # Feet on the ground, origin between them: the web viewer places the guide by its feet.
    zmin = min(v.co.z for v in me.vertices)
    for v in me.vertices:
        v.co.z -= zmin
    obj.location = (0, 0, 0)

    # Region colours per face corner, so region edges stay crisp.
    attr = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    shift = zmin  # classify in the original centred coordinates
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    scarf_faces = {f.index for f in grow_scarf(bm, shift)}
    bm.free()
    counts = {}
    for poly in me.polygons:
        c = poly.center.copy()
        c.z += shift
        region = classify(c)
        if region == "kurta" and poly.index in scarf_faces:
            region = "scarf"
        counts[region] = counts.get(region, 0) + 1
        rgb = PALETTE[region]
        for li in poly.loop_indices:
            attr.data[li].color = (*rgb, 1.0)
    me.color_attributes.active_color = attr
    log("Regions: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))

    # Crease darkening: a cheap baked occlusion that reads well without lights.
    dirt = me.color_attributes.new("Dirt", "BYTE_COLOR", "POINT")
    me.color_attributes.active_color = dirt
    for d in dirt.data:
        d.color = (1, 1, 1, 1)
    bpy.ops.object.mode_set(mode="VERTEX_PAINT")
    bpy.ops.paint.vertex_color_dirt(blur_strength=1.0, blur_iterations=2, clean_angle=3.14159,
                                    dirt_angle=0.0, dirt_only=True, normalize=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            k = 0.55 + 0.45 * dirt.data[vi].color[0]  # keep creases from going black
            r, g, b, a = attr.data[li].color
            attr.data[li].color = (r * k, g * k, b * k, a)
    me.color_attributes.remove(dirt)
    me.color_attributes.active_color = me.color_attributes["Col"]
    me.color_attributes.render_color_index = 0

    bpy.ops.object.shade_smooth()

    mat = bpy.data.materials.new("MIRAS_Guide_Material")
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    col = nt.nodes.new("ShaderNodeVertexColor")
    col.layer_name = "Col"
    nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.75
    me.materials.append(mat)

    os.makedirs(os.path.dirname(blend), exist_ok=True)
    os.makedirs(os.path.dirname(glb), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    log(f"Saved {blend}")

    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=False,
                              export_vertex_color="MATERIAL", export_normals=True,
                              export_apply=True, export_yup=True)
    size = os.path.getsize(glb) / 1e6
    log(f"Exported {glb} ({size:.2f} MB)")

    # Verify: a clean re-import must give the same mesh, colours and size.
    built_tris = len(me.polygons)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    vtris = sum(len(o.data.polygons) for o in meshes)
    has_col = all(len(o.data.color_attributes) > 0 for o in meshes)
    h = max(max((o.matrix_world @ v.co).z for v in o.data.vertices) for o in meshes)
    zlo = min(min((o.matrix_world @ v.co).z for v in o.data.vertices) for o in meshes)
    log(f"Verify GLB: {len(meshes)} mesh, {vtris} tris, colours {has_col}, height {h - zlo:.3f} m, feet at z={zlo:.4f}")
    ok = len(meshes) == 1 and has_col and abs(vtris - built_tris) < 10 and abs(zlo) < 1e-3
    if not ok:
        raise SystemExit("[MIRAS guide] ERROR: GLB verification failed")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="build_heritage_guide.py")
    p.add_argument("--stl", default=DEFAULTS["stl"])
    p.add_argument("--blend", default=DEFAULTS["blend"])
    p.add_argument("--glb", default=DEFAULTS["glb"])
    p.add_argument("--tris", type=int, default=80000)
    a = p.parse_args(argv)
    build(a.stl, a.blend, a.glb, a.tris)


if __name__ == "__main__" and bpy.app.background:
    main()
