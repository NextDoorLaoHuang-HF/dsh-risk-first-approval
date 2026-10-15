// This is an in-memory reviewer input, not an execution or real permission grant.
// Never copy private messages or tool arguments into this public-constant smoke test.
export function makeSmokeFixture(realConfig, mode, signal) {
  const config = { provider: realConfig.provider, model: realConfig.model };
  if (mode === 'session' && realConfig.reasoningEffort !== undefined) config.reasoningEffort = realConfig.reasoningEffort;
  const schema = { name: 'return_constant', description: 'Return the constant string hello. No filesystem, network, subprocess, settings, or permission effects.', parameters: { type: 'object', properties: {}, additionalProperties: false } };
  const callId = 'in-memory-smoke-only';
  const events = [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'step/start', data: { turn: 1, step: 1 } },
    { seq: 2, type: 'user/message', data: { source: { kind: 'user', rpcId: 'smoke-fixture' }, content: [{ type: 'text', text: 'Classify this inert synthetic action for a reviewer compatibility test. No action will be executed.' }] } },
    { seq: 3, type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'tool-call', id: callId, name: schema.name, arguments: '{}' }] } } },
    { seq: 4, type: 'tool/call', data: { turn: 1, step: 1, callId, name: schema.name, arguments: '{}' } },
  ];
  const header = { config, tools: [schema] };
  const agent = { session: { header: { cwd: '/in-memory-reviewer-smoke' }, surface: { nodes: [2, 3] },
    snapshotEvents: () => events, requestHeader: () => header, isOwnSeq: () => true } };
  const exec = { agent, name: schema.name, arguments: {}, callId, rootCallId: callId, signal };
  return { config, agent, exec };
}
