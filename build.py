"""Reproducible XPI build. Python 3 standard library only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
import json
root = Path(__file__).resolve().parent
version = json.loads((root / 'manifest.json').read_text())['version']
output = root.parent / f'thunderbird-native-groups-{version}.xpi'
files = ['manifest.json', 'background.js', 'native/schema.json', 'native/implementation.js', 'LICENSE']
files += [str(path.relative_to(root)) for folder in ['_locales', 'icons'] for path in (root / folder).rglob('*') if path.is_file()]
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for name in sorted(files):
        data = (root / name).read_bytes()
        if name == 'native/implementation.js':
            data = (root / 'native/tree-model.js').read_bytes() + b'\n' + data
        entry = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        entry.compress_type = ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, data)
print(output)
