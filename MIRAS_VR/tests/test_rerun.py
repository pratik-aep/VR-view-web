"""Rerun safety: building twice into the same open file must not duplicate anything."""
import importlib.util, os, sys, tempfile
import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("setup_miras_vr", os.path.join(ROOT, "blender", "setup_miras_vr.py"))
miras = importlib.util.module_from_spec(spec)
spec.loader.exec_module(miras)

out = os.path.join(tempfile.mkdtemp(), "rerun.blend")
counts = []
for i in range(3):
    miras.build(blend_path=out, fresh=(i == 0), previews=False)
    counts.append((len(bpy.data.objects), len(bpy.data.meshes), len(bpy.data.materials),
                   len(bpy.data.images), len(bpy.data.cameras), len(bpy.data.collections)))
print("counts per run:", counts)
ok = len(set(counts)) == 1
print(f"[{'PASS' if ok else 'FAIL'}] rerun creates no duplicates")
sys.exit(0 if ok else 1)
