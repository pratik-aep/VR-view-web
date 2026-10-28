"""
MIRAS VR — Blender scene builder for the 360° heritage courtyard prototype.

Builds an inward-facing emissive UV sphere textured with an equirectangular
panorama, a stationary viewer camera at the origin, the MIRAS collections,
directional preview renders, and saves the .blend.

Run headless (recommended, builds into a fresh empty file):

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python setup_miras_vr.py -- [--image PATH] [--blend PATH] [--previews DIR]
        [--no-previews] [--no-pack] [--radius 20]

Or from Blender's Text Editor / MCP: call `build(fresh=False)` to rebuild the
MIRAS objects inside the current file without touching anything else.

Safe to rerun: every object, mesh, material and image it owns is looked up by
name and replaced, never duplicated.

Orientation convention (shared with web/main.js):
    front 0°  = +Y  = panorama horizontal centre (u = 0.5)
    right 90° = +X  (u = 0.75), back 180° = -Y (u = 0/1), left 270° = -X (u = 0.25)
"""

import argparse
import math
import os
import sys

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

DEFAULTS = {
    "image": os.path.join(ROOT, "assets", "panoramas", "MIRAS_VR_Test_Panorama.png"),
    "blend": os.path.join(HERE, "MIRAS_VR_Prototype.blend"),
    "previews": os.path.join(ROOT, "previews"),
}

COLLECTIONS = ["MIRAS_ENVIRONMENT", "MIRAS_CAMERAS", "MIRAS_GUIDE", "MIRAS_EFFECTS", "MIRAS_DEBUG"]
SPHERE_NAME = "MIRAS_360_Sphere"
MATERIAL_NAME = "MIRAS_360_Environment"
CAMERA_NAME = "MIRAS_VR_Camera"
GUIDE_ANCHOR_NAME = "MIRAS_Guide_Anchor"

SEGMENTS = 128  # around the horizon
RINGS = 64      # pole to pole

# (file name, yaw degrees clockwise from front, pitch degrees, horizontal FOV degrees)
PREVIEWS = [
    ("front.png", 0, 0, 90),
    ("right.png", 90, 0, 90),
    ("back.png", 180, 0, 90),
    ("left.png", 270, 0, 90),
    ("hero.png", 0, -8, 100),
]


class MirasError(RuntimeError):
    pass


def log(msg):
    print(f"[MIRAS] {msg}", flush=True)


# ---------------------------------------------------------------- validation

VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"}


def is_video(path):
    return os.path.splitext(path)[1].lower() in VIDEO_EXTENSIONS


def validate_image(path):
    if not os.path.isfile(path):
        raise MirasError(f"Panorama not found: {path}")
    img = bpy.data.images.load(path, check_existing=True)
    w, h = img.size
    if w == 0 or h == 0:
        raise MirasError(f"Panorama could not be decoded: {path}")
    ratio = w / h
    if img.source == "MOVIE":
        # 360 videos are often re-encoded at 16:9; the UVs still span the full 360x180,
        # so the frame is only stretched back vertically. Warn rather than refuse.
        if abs(ratio - 2.0) > 0.01:
            log(f"WARNING: video is {w}x{h} (ratio {ratio:.3f}), not 2:1; mapping it as full 360x180")
        log(f"360 video OK: {os.path.basename(path)} {w}x{h}, {img.frame_duration} frames")
        return img
    if abs(ratio - 2.0) > 0.01:
        raise MirasError(f"Panorama must be 2:1 equirectangular, got {w}x{h} (ratio {ratio:.3f})")
    log(f"Panorama OK: {os.path.basename(path)} {w}x{h} ratio {ratio:.3f}")
    return img


# ---------------------------------------------------------------- scene helpers

def ensure_collection(name, scene):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if name not in scene.collection.children:
        scene.collection.children.link(col)
    return col


def remove_object(name):
    obj = bpy.data.objects.get(name)
    if obj is None:
        return
    data = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if data is not None and data.users == 0:
        if isinstance(data, bpy.types.Mesh):
            bpy.data.meshes.remove(data)
        elif isinstance(data, bpy.types.Camera):
            bpy.data.cameras.remove(data)


def set_enum(owner, prop, candidates):
    """Assign the first enum value this Blender build accepts."""
    for value in candidates:
        try:
            setattr(owner, prop, value)
            return value
        except TypeError:
            continue
    raise MirasError(f"None of {candidates} is valid for {type(owner).__name__}.{prop}")


# ---------------------------------------------------------------- environment

def build_sphere_mesh(radius):
    """UV sphere with inward normals and seam-correct equirectangular UVs."""
    me = bpy.data.meshes.new(SPHERE_NAME)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=SEGMENTS, v_segments=RINGS, radius=radius)
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])  # normals point at the viewer

    uv_layer = bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        centre = face.calc_center_median()
        face_u = 0.5 + math.atan2(centre.x, centre.y) / (2 * math.pi)
        for loop in face.loops:
            co = loop.vert.co
            on_pole = abs(abs(co.z) - radius) < 1e-6 * radius
            if on_pole:
                u = face_u  # pole vertex: use the face's own longitude to avoid a fan twist
            else:
                u = 0.5 + math.atan2(co.x, co.y) / (2 * math.pi)
                # keep each face on one side of the back seam (u wraps 1 -> 0 at -Y)
                if u - face_u > 0.5:
                    u -= 1.0
                elif face_u - u > 0.5:
                    u += 1.0
            v = 0.5 + math.asin(max(-1.0, min(1.0, co.z / radius))) / math.pi
            loop[uv_layer].uv = (u, v)

    for face in bm.faces:
        face.smooth = True
    bm.to_mesh(me)
    bm.free()
    return me


def build_material(image):
    mat = bpy.data.materials.get(MATERIAL_NAME) or bpy.data.materials.new(MATERIAL_NAME)
    if mat.node_tree is None:  # node trees are implicit from Blender 5; older files may lack one
        mat.use_nodes = True
    mat.use_backface_culling = False  # visible from either side, regardless of normals
    nt = mat.node_tree
    nt.nodes.clear()

    uv = nt.nodes.new("ShaderNodeTexCoord")
    uv.location = (-700, 0)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.location = (-450, 0)
    tex.image = image
    tex.interpolation = "Cubic"
    tex.extension = "REPEAT"  # u slightly beyond [0,1] at the seam wraps cleanly
    if image.source == "MOVIE":
        tex.image_user.frame_start = 1
        tex.image_user.frame_duration = image.frame_duration
        tex.image_user.use_auto_refresh = True  # follow the timeline in the viewport
        tex.image_user.use_cyclic = True
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.location = (-150, 0)
    emit.inputs["Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (100, 0)

    nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def build_environment(scene, image, radius):
    remove_object(SPHERE_NAME)
    if SPHERE_NAME in bpy.data.meshes:
        bpy.data.meshes.remove(bpy.data.meshes[SPHERE_NAME])
    me = build_sphere_mesh(radius)
    me.materials.append(build_material(image))
    obj = bpy.data.objects.new(SPHERE_NAME, me)
    obj.location = (0, 0, 0)
    # A pure backdrop: it neither casts shadows nor shows in reflections of future objects.
    obj.visible_shadow = False
    obj.hide_select = True
    ensure_collection("MIRAS_ENVIRONMENT", scene).objects.link(obj)
    return obj


# ---------------------------------------------------------------- camera

def camera_rotation(yaw_deg, pitch_deg=0.0):
    """Euler for a camera at the origin: yaw clockwise from +Y seen from above, pitch up positive."""
    return (math.radians(90 + pitch_deg), 0.0, math.radians(-yaw_deg))


def build_camera(scene):
    remove_object(CAMERA_NAME)
    if CAMERA_NAME in bpy.data.cameras:
        bpy.data.cameras.remove(bpy.data.cameras[CAMERA_NAME])
    cam_data = bpy.data.cameras.new(CAMERA_NAME)
    cam_data.type = "PERSP"
    cam_data.sensor_fit = "HORIZONTAL"
    cam_data.angle = math.radians(90)
    cam_data.clip_start = 0.05
    cam_data.clip_end = 1000.0
    cam = bpy.data.objects.new(CAMERA_NAME, cam_data)
    cam.location = (0, 0, 0)
    cam.rotation_euler = camera_rotation(0)
    # The visitor is stationary: translation is locked, rotation stays free.
    cam.lock_location = (True, True, True)
    ensure_collection("MIRAS_CAMERAS", scene).objects.link(cam)
    scene.camera = cam
    return cam


def build_guide_anchor(scene):
    """Empty marking where heritage_guide.glb will stand; no character geometry."""
    remove_object(GUIDE_ANCHOR_NAME)
    anchor = bpy.data.objects.new(GUIDE_ANCHOR_NAME, None)
    anchor.empty_display_type = "SINGLE_ARROW"
    anchor.empty_display_size = 0.5
    anchor.location = (0.0, 3.0, -1.6)  # 3 m in front of the viewer, on the floor (eye at 1.6 m)
    anchor.rotation_euler = (0.0, 0.0, math.radians(180))  # faces the viewer
    anchor.hide_render = True
    anchor["miras_asset"] = "assets/models/heritage_guide.glb"
    ensure_collection("MIRAS_GUIDE", scene).objects.link(anchor)
    return anchor


# ---------------------------------------------------------------- render settings

def configure_render(scene):
    set_enum(scene.render, "engine", ["BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"])
    try:
        scene.eevee.taa_render_samples = 16
    except AttributeError:
        pass
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    # "Standard" reproduces the photo's sRGB values; AgX/Filmic would wash it out.
    set_enum(scene.view_settings, "view_transform", ["Standard"])
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0

    world = scene.world or bpy.data.worlds.new("MIRAS_World")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg is not None:
        bg.inputs["Color"].default_value = (0, 0, 0, 1)
        bg.inputs["Strength"].default_value = 0.0


def render_previews(scene, cam, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    saved = (tuple(cam.rotation_euler), cam.data.angle)
    written = []
    try:
        for fname, yaw, pitch, fov in PREVIEWS:
            cam.rotation_euler = camera_rotation(yaw, pitch)
            cam.data.angle = math.radians(fov)
            path = os.path.join(out_dir, fname)
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            if not os.path.isfile(path):
                raise MirasError(f"Preview was not written: {path}")
            written.append(path)
            log(f"Preview {fname}: yaw {yaw}° pitch {pitch}° fov {fov}°")
    finally:
        cam.rotation_euler, cam.data.angle = saved
    return written


def configure_video_timeline(scene, image, path):
    """Match the scene to the video's length and frame rate and add its soundtrack."""
    clip = bpy.data.movieclips.load(path)  # Image has no frame rate; a MovieClip does
    fps = clip.fps or 30
    bpy.data.movieclips.remove(clip)
    # 29.97 and friends are stored as fps / fps_base in Blender.
    if abs(fps - round(fps)) > 0.01:
        scene.render.fps, scene.render.fps_base = round(fps * 1.001), 1.001
    else:
        scene.render.fps, scene.render.fps_base = round(fps), 1.0
    scene.frame_start = 1
    scene.frame_end = image.frame_duration
    scene.frame_current = 1

    seq = scene.sequence_editor or scene.sequence_editor_create()
    strips = seq.strips if hasattr(seq, "strips") else seq.sequences  # "strips" from Blender 5
    for s in [s for s in strips if s.name == "MIRAS_360_Audio"]:
        strips.remove(s)
    try:
        strips.new_sound("MIRAS_360_Audio", path, channel=1, frame_start=1)
        scene.sync_mode = "AUDIO_SYNC"  # keep the sphere in time with the soundtrack
    except RuntimeError as e:
        log(f"WARNING: no audio track added ({e})")
    log(f"Timeline: {scene.frame_end} frames at {scene.render.fps / scene.render.fps_base:.3f} fps")


# ---------------------------------------------------------------- entry points

def build(image_path=DEFAULTS["image"], blend_path=DEFAULTS["blend"], previews_dir=DEFAULTS["previews"],
          radius=20.0, fresh=True, previews=True, pack=True, preview_frame=None):
    image_path = os.path.abspath(image_path)
    blend_path = os.path.abspath(blend_path)

    if fresh:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "MIRAS_Courtyard"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    image = validate_image(image_path)
    image.name = os.path.basename(image_path)
    image.colorspace_settings.name = "sRGB"
    video = image.source == "MOVIE"

    for name in COLLECTIONS:
        ensure_collection(name, scene)
    build_environment(scene, image, radius)
    cam = build_camera(scene)
    build_guide_anchor(scene)
    configure_render(scene)
    if video:
        configure_video_timeline(scene, image, image_path)

    os.makedirs(os.path.dirname(blend_path), exist_ok=True)
    if pack and not video:  # Blender cannot pack movie files; videos stay linked
        image.pack()  # before the path goes relative: the unsaved file has no base dir to resolve it
    if video and preview_frame is not None:
        scene.frame_set(preview_frame)
    written = render_previews(scene, cam, previews_dir) if previews else []
    if video:
        scene.frame_set(1)

    # Store the path relative to the .blend so the project folder stays portable. Done after
    # rendering: an unsaved file has no base directory, so a linked video would not resolve.
    image.filepath = bpy.path.relpath(image_path, start=os.path.dirname(blend_path))

    bpy.ops.wm.save_as_mainfile(filepath=blend_path, compress=True)
    log(f"Saved {blend_path}")
    return {"blend": blend_path, "previews": written}


def parse_args(argv):
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    p = argparse.ArgumentParser(prog="setup_miras_vr.py")
    p.add_argument("--image", default=DEFAULTS["image"])
    p.add_argument("--blend", default=DEFAULTS["blend"])
    p.add_argument("--previews", default=DEFAULTS["previews"])
    p.add_argument("--radius", type=float, default=20.0)
    p.add_argument("--no-previews", action="store_true")
    p.add_argument("--no-pack", action="store_true")
    p.add_argument("--frame", type=int, default=None, help="video frame to render previews from")
    return p.parse_args(argv)


def main():
    args = parse_args(sys.argv)
    try:
        build(args.image, args.blend, args.previews, radius=args.radius,
              fresh=True, previews=not args.no_previews, pack=not args.no_pack, preview_frame=args.frame)
    except MirasError as e:
        log(f"ERROR: {e}")
        sys.exit(1)
    except Exception as e:  # surface anything unexpected with a clear prefix and non-zero exit
        log(f"UNEXPECTED ERROR: {type(e).__name__}: {e}")
        raise


if __name__ == "__main__" and bpy.app.background:
    main()
