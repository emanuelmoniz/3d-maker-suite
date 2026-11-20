# 6.3.0 Step 1 spike: a copy of a Bambu Studio 3MF with the one value Orca refuses set to 0.
import sys
import zipfile

src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zi, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zo:
    for i in zi.infolist():
        b = zi.read(i.filename)
        if i.filename == "Metadata/project_settings.config":
            b = b.replace(b'"raft_first_layer_expansion": "-1"', b'"raft_first_layer_expansion": "0"')
        zo.writestr(i, b)
