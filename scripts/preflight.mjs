// Inspect only OS-held session locks and permission events; never print prompts.
import { execFileSync } from 'node:child_process';
const pid = process.argv[2];
if (!/^\d+$/.test(pid ?? '')) throw new Error('Usage: node scripts/preflight.mjs <DSH-pid>');
const stdout = execFileSync('/usr/sbin/lsof', ['-a', '-p', pid, '-Fn'], { encoding: 'utf8' });
const paths = stdout.split('\n').filter(s => s.startsWith('n') && s.endsWith('/session.lock')).map(s => s.slice(1, -'session.lock'.length) + 'session.v4.jsonl.zstd');
if (!paths.length) throw new Error('No live session locks; cannot verify migration safety');
const sessions = [];
for (const path of paths) {
  // zstdDecompressSync only decodes the first frame of this file format.
  // The CLI handles all concatenated frames and any error fails closed.
  const lines = execFileSync('/opt/homebrew/bin/zstd', ['-dc', path], { maxBuffer: 128 * 1024 * 1024 }).toString().trim().split('\n');
  let id, preset, approval, sandbox;
  for (const line of lines) {
    const event = JSON.parse(line);
    if (event.type === 'session') id = event.id;
    if (event.type === 'permission/preset') preset = event.data.preset;
    if (event.type === 'approval/policy') approval = event.data.policy;
    if (event.type === 'sandbox/mode') sandbox = event.data.mode;
  }
  sessions.push({ id, preset, approval, sandbox });
}
console.log(JSON.stringify({ pid: Number(pid), sessions }, null, 2));
// Confined child sessions can omit preset events; their sandbox proves they
// cannot match Auto (which requires danger-full-access). Unknown unconfined
// sessions still block replacement.
if (sessions.some(s => s.preset === 'auto' || (!s.preset && !['read-only', 'workspace-write'].includes(s.sandbox)))) {
  throw new Error('Do not hot-replace Auto: at least one live session is Auto or unknown. Leave Auto in those sessions before activation.');
}
console.log('PASS: no live Auto sessions; replacement will not downgrade an existing Auto session.');
