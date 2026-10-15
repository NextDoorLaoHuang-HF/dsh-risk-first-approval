"""Read-only extraction of selected DSH packages for compatibility inspection."""
import json
import pathlib
import struct

archive = pathlib.Path('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar')
output = pathlib.Path(__file__).resolve().parents[1] / '_reference'
packages = {
    'dsh-experimental-auto-review', 'dsh-user-approval', 'dsh-tools',
    'dsh-plugin-manager', 'dsh-app-boot', 'dsh-cordis-host-runner',
    'dsh-agent-preset', 'dsh-scope', 'dsh-llm', 'dsh-system-prompt',
    'dsh-hmr', 'cordis', 'dsh-tool-cordis', 'dsh-client-ui-approval',
    'dsh-permission-presets', 'dsh-profile', 'dsh-app', 'dsh-agent',
}
with archive.open('rb') as source:
    header = struct.unpack('<4I', source.read(16))
    tree = json.loads(source.read(header[3]))
    base = 8 + header[1]
    def walk(node, parts=()):
        for name, entry in node.get('files', {}).items():
            current = (*parts, name)
            if 'files' in entry:
                yield from walk(entry, current)
            else:
                yield current, entry
    count = 0
    for parts, entry in walk(tree):
        if len(parts) < 5 or parts[:3] != ('dsh', 'node_modules', '@deepseek-ai'):
            continue
        if parts[3] not in packages or entry.get('link') or entry.get('unpacked'):
            continue
        if pathlib.Path(parts[-1]).suffix not in {'.js', '.json', '.md', '.yaml', '.yml'}:
            continue
        target = output.joinpath(*parts[3:])
        if target.exists():
            continue  # Keep the previously inspected reference immutable.
        target.parent.mkdir(parents=True, exist_ok=True)
        source.seek(base + int(entry['offset']))
        target.write_bytes(source.read(entry['size']))
        count += 1
print(f'Extracted {count} reference files to {output}; application unchanged')
