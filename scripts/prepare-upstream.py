"""Generate the attributed reviewer core; never modify the application archive."""
import pathlib
import json
import struct

root = pathlib.Path(__file__).resolve().parents[1]
source = (root / '_reference/dsh-experimental-auto-review/lib/index.js').read_text()
core, _, _ = source.partition('/** Materialize the fixed model-facing final Auto denial')
assert core.count('\t\ttemperature: 0,\n') == 1
core = core.replace('\t\ttemperature: 0,\n', '')
core = core.replace('import { AUTO_PRESET } from "@deepseek-ai/dsh-permission-presets";\n', '')
core = core.replace('import { RUN_CODE_NAME } from "@deepseek-ai/dsh-tools";\n', '')
start = core.index('/** Cordis plugin name used by loader diagnostics. */')
end = core.index('/** Return JSON text for one immutable logged value. */')
core = core[:start] + core[end:]
core = ('// Derived from @deepseek-ai/dsh-experimental-auto-review 0.2.0-rc.2 (MIT).\n'
        '// See NOTICE.md. Snapshot and strict parser retained; temperature omitted.\n' + core)
core += '\nexport { classifyRisk, snapshotAutoReview, parseDecision, readDecision, REVIEW_POLICY };\n'
target = root / 'src/upstream-review.js'
if target.exists():
    raise RuntimeError(f'Refusing to overwrite {target}')
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(core)
archive = pathlib.Path('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar')
with archive.open('rb') as f:
    h = struct.unpack('<4I', f.read(16))
    entry = json.loads(f.read(h[3]))
    for part in 'dsh/node_modules/@deepseek-ai/dsh-experimental-auto-review/LICENSE'.split('/'):
        entry = entry['files'][part]
    f.seek(8 + h[1] + int(entry['offset']))
    license_text = f.read(entry['size'])
license_path = root / 'LICENSE'
if license_path.exists():
    raise RuntimeError(f'Refusing to overwrite {license_path}')
license_path.write_bytes(license_text)
print('Generated attributed reviewer core and retained upstream MIT license')
