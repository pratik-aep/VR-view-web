"""
Headless verification of MIRAS_VR_Prototype.blend and the preview renders.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python-exit-code 1 --python tests/test_blender.py

Opens the saved .blend fresh (proving it reopens), checks the scene contract,
then renders the sphere back out through a Cycles equirectangular camera and
compares it with the source panorama to prove orientation, mirroring and seam.
"""

import math
import os
import sys
import tempfile

import bpy
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLEND = os.path.join(ROOT, "blender", "MIRAS_VR_Prototype.blend")
SOURCE = os.path.join(ROOT, "assets", "panoramas", "MIRAS_VR_Test_Panorama.png")
PREVIEWS = os.path.join(ROOT, "previews")

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""), flush=True)


def pixels(img):
    w, h = img.size
    return np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)[..., :3]


def main():
    check("saved .blend exists", os.path.isfile(BLEND), BLEND)
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    check("saved .blend reopens", bpy.data.filepath == BLEND)
    scene = bpy.context.scene

    for name in ["MIRAS_ENVIRONMENT", "MIRAS_CAMERAS", "MIRAS_GUIDE", "MIRAS_EFFECTS", "MIRAS_DEBUG"]:
        check(f"collection {name}", name in scene.collection.children)

    sphere = bpy.data.objects.get("MIRAS_360_Sphere")
    cam = bpy.data.objects.get("MIRAS_VR_Camera")
    check("sphere exists in MIRAS_ENVIRONMENT", sphere and sphere.users_collection[0].name == "MIRAS_ENVIRONMENT")
    check("camera exists in MIRAS_CAMERAS", cam and cam.users_collection[0].name == "MIRAS_CAMERAS")
    check("camera is scene camera", scene.camera == cam)
    check("no stray default objects", not ({"Cube", "Light", "Camera"} & set(bpy.data.objects.keys())))

    # Sphere geometry
    me = sphere.data
    radii = [v.co.length for v in me.vertices]
    check("sphere centred at origin", sphere.location.length < 1e-6 and np.allclose(np.mean([v.co for v in me.vertices], axis=0), 0, atol=1e-3))
    check("sphere radius ≈ 20", abs(min(radii) - 20) < 1e-3 and abs(max(radii) - 20) < 1e-3, f"{min(radii):.4f}–{max(radii):.4f}")
    inward = sum(1 for p in me.polygons if p.normal.dot(p.center) < 0)
    check("all normals face inward", inward == len(me.polygons), f"{inward}/{len(me.polygons)}")
    check("sphere has UV map", len(me.uv_layers) == 1)

    # Material
    mat = bpy.data.materials.get("MIRAS_360_Environment")
    check("material MIRAS_360_Environment assigned", mat and sphere.material_slots[0].material == mat)
    nodes = {n.type: n for n in mat.node_tree.nodes}
    out = nodes.get("OUTPUT_MATERIAL")
    surf = out.inputs["Surface"].links[0].from_node if out and out.inputs["Surface"].is_linked else None
    check("Emission -> Material Output", surf is not None and surf.type == "EMISSION")
    tex_link = surf.inputs["Color"].links[0].from_node if surf and surf.inputs["Color"].is_linked else None
    check("Image Texture -> Emission colour", tex_link is not None and tex_link.type == "TEX_IMAGE")
    check("no BSDF (no lighting/reflections)", not any(n.type.startswith("BSDF") for n in mat.node_tree.nodes))
    check("backface culling off", not mat.use_backface_culling)

    img = tex_link.image
    check("image packed in .blend", img.packed_file is not None)
    check("image colour space sRGB", img.colorspace_settings.name == "sRGB")
    check("image loads with data", img.size[0] == 1774 and img.size[1] == 887 and img.has_data, f"{tuple(img.size)}")
    ext = bpy.path.abspath(img.filepath, library=img.library)
    check("external texture retained on disk", os.path.isfile(ext), ext)
    bpy.ops.file.report_missing_files()
    check("no missing external files", all(os.path.isfile(bpy.path.abspath(i.filepath)) or i.packed_file for i in bpy.data.images if i.source == "FILE"))

    # Camera
    check("camera at (0,0,0)", cam.location.length < 1e-9)
    check("camera translation locked", all(cam.lock_location))
    check("camera perspective, 90° FOV", cam.data.type == "PERSP" and abs(math.degrees(cam.data.angle) - 90) < 0.01)
    check("camera far clip covers sphere", cam.data.clip_end > 20 and cam.data.clip_start < 1)
    check("camera has no animation", cam.animation_data is None or cam.animation_data.action is None)
    check("view transform Standard", scene.view_settings.view_transform == "Standard")

    # Previews: present, not black, distinct from one another
    means = {}
    for name in ["front", "right", "back", "left", "hero"]:
        p = os.path.join(PREVIEWS, f"{name}.png")
        if not os.path.isfile(p):
            check(f"preview {name}.png", False, "missing")
            continue
        a = pixels(bpy.data.images.load(p))
        means[name] = a.mean(axis=(0, 1))
        check(f"preview {name}.png has image content", a.mean() > 0.15 and a.std() > 0.05, f"mean {a.mean():.3f} std {a.std():.3f}")
    dirs = [means[k] for k in ["front", "right", "back", "left"] if k in means]
    check("four directional previews differ", len(dirs) == 4 and min(np.abs(dirs[i] - dirs[j]).sum() for i in range(4) for j in range(i + 1, 4)) > 0.005)

    # Round-trip: render the sphere back to an equirect from the centre and compare to source.
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 4
    scene.cycles.use_denoising = False
    scene.cycles.device = "CPU"
    cam.data.type = "PANO"
    cam.data.panorama_type = "EQUIRECTANGULAR"
    cam.rotation_euler = (math.radians(90), 0, 0)  # look at front (+Y)
    scene.render.resolution_x, scene.render.resolution_y = 512, 256
    tmp = os.path.join(tempfile.mkdtemp(), "roundtrip.png")
    scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    got = pixels(bpy.data.images.load(tmp))
    src_img = bpy.data.images.load(SOURCE, check_existing=False)
    src_img.scale(512, 256)
    src = pixels(src_img)
    # Compare away from the poles, where equirect sampling differs most.
    band = slice(32, 224)
    err = np.abs(got[band] - src[band]).mean()
    err_mirror = np.abs(got[band] - src[band][:, ::-1]).mean()
    shifts = [np.abs(got[band] - np.roll(src[band], s, axis=1)).mean() for s in range(-16, 17)]
    best = int(np.argmin(shifts)) - 16
    check("round-trip matches source panorama", err < 0.06, f"mean abs err {err:.4f}")
    check("round-trip not mirrored", err < err_mirror * 0.6, f"mirrored err {err_mirror:.4f}")
    check("round-trip horizontally aligned", abs(best) <= 1, f"best shift {best}px of 512")
    seam_cols = np.abs(got[band, 0] - got[band, -1]).mean()
    check("no seam artefact at back (u=0/1)", seam_cols < 0.08, f"edge col diff {seam_cols:.4f}")

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed", flush=True)
    if failed:
        sys.exit(1)


main()
