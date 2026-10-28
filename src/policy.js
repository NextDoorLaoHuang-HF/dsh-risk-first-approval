import { randomUUID } from 'node:crypto';

export const ESCALATE_TOOL = 'request_risk_approval';
const TICKET_TTL = 10 * 60_000;
const INTENT_TTL = 2 * 60_000;
const MAX_PENDING = 64;

// Canonical JSON avoids granting a broader action when object key order changes.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function errorDecision(code, message, detail) {
  return {
    kind: 'deny', reason: message,
    info: { name: 'AutoReviewDeniedError', code, ...(detail ? { reason: detail } : {}) },
  };
}

function validDecision(value) {
  return value && ((value.decision === 'allow' && ['low', 'medium'].includes(value.risk)) ||
    (value.decision === 'deny' && ['medium', 'high'].includes(value.risk) && typeof value.reason === 'string' && value.reason.trim().length > 0));
}

/** The only stored authority is a request to ASK, never an execution grant. */
export function createRiskFirstPolicy(ctx, classify, { now = Date.now, uuid = randomUUID, reviewer } = {}) {
  let sessions = new WeakMap();
  const lifecycle = new AbortController();
  const isAuto = agent => ctx.permissionPresets.current(agent.session) === 'auto';
  const canAsk = agent => ctx.approval.overrideOf(agent.session) === 'ask';

  function records(agent) {
    let entries = sessions.get(agent);
    if (!entries) sessions.set(agent, entries = new Map());
    for (const [id, record] of entries) if (record.expires <= now()) entries.delete(id);
    return entries;
  }

  function identity(exec) {
    const definition = ctx.tools.get(exec.name, exec.agent);
    const schema = exec.schema ?? definition;
    if (!definition || !schema || typeof schema.description !== 'string' || !schema.parameters) {
      throw new Error('risk-first: exact tool definition/schema is unavailable');
    }
    // Question settlements may contain a refusal/revocation too. Conservatively
    // invalidate old intents on them, even if the reviewer cannot admit that
    // particular settlement as authority. This never grants or renews permission.
    const events = exec.agent.session.snapshotEvents();
    const questionCalls = new Set(events.filter(event => event.type === 'tool/call' &&
      event.data.name === 'ask_user_question').map(event =>
      `${event.data.turn}\0${event.data.step}\0${event.data.callId}`));
    const instructions = events.filter(event => {
      if (event.type === 'tool/result') return questionCalls.has(
        `${event.data.turn}\0${event.data.step}\0${event.data.message.toolCallId}`);
      if (event.type !== 'user/message') return false;
      const source = event.data.source;
      return source?.kind === 'agent-instructions' || source?.kind === 'agent-message' ||
        source?.kind === 'user-question-reply' ||
        (source?.kind === 'user' && typeof source.rpcId === 'string');
    }).map(event => event.seq);
    return {
      definition,
      key: canonical({ name: exec.name, arguments: exec.arguments,
        description: schema.description, parameters: schema.parameters,
        cwd: exec.agent.session.header.cwd, instructions }),
    };
  }

  function find(entries, action) {
    return [...entries.values()].find(record => record.key === action.key && record.definition === action.definition);
  }

  const tool = {
    name: ESCALATE_TOOL,
    description: 'Only after AUTO_REVIEW_REWORK_REQUIRED: first consider safer alternatives. If the exact blocked action is necessary and cannot reasonably be made safer, call this tool with its risk_ticket, necessity, risk_reduction_impossible_reason, and alternatives_considered. This does NOT execute or approve anything. Retry the exact original tool/arguments separately; it is reviewed again and DSH then asks the human once. Medium- and high-risk reviewer denials can both request one-call human approval; approval policy never and independent safety controls remain binding. Do not repeatedly request a rejected approval.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        risk_ticket: { type: 'string', description: 'The pending risk ticket returned for this exact action in this session.' },
        necessity: { type: 'string', description: 'Why the original action and exact scope are necessary for the user task.' },
        risk_reduction_impossible_reason: { type: 'string', description: 'A concrete explanation, shown verbatim to the human, of why the remaining risk cannot reasonably be reduced while completing this task. Do not merely say it is necessary.' },
        alternatives_considered: { type: 'string', description: 'Safer approaches considered or tried, and why they do not satisfy the task.' },
      },
      required: ['risk_ticket', 'necessity', 'risk_reduction_impossible_reason', 'alternatives_considered'],
    },
    output: {
      schema: { type: 'object', additionalProperties: false,
        properties: { status: { type: 'string' }, message: { type: 'string' } },
        required: ['status', 'message'] },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const denied = message => ({ status: 'not_armed', message });
      if (lifecycle.signal.aborted || exec.signal.aborted) return denied('Cancelled; no intent was recorded.');
      const agent = exec.agent;
      if (!agent || !isAuto(agent)) return denied('This tool is available only for a pending Auto review risk.');
      if (!canAsk(agent)) return denied('Approval prompts are disabled or unavailable; reduce risk instead. No permission was changed.');
      for (const key of ['risk_ticket', 'necessity', 'risk_reduction_impossible_reason', 'alternatives_considered']) {
        if (typeof args?.[key] !== 'string' || !args[key].trim() || args[key].length > 4096) {
          return denied(`A nonempty ${key} of at most 4096 characters is required.`);
        }
      }
      const entries = records(agent);
      const record = entries.get(args.risk_ticket);
      if (!record || record.state !== 'pending') return denied('Unknown, expired, or already-used risk ticket. No approval was requested.');
      // Bind to the current tool implementation, schema, cwd, and instruction epoch.
      let action;
      try { action = identity({ ...exec, name: record.name, arguments: record.arguments, schema: record.schema }); }
      catch { entries.delete(record.id); return denied('The original action is no longer available.'); }
      if (action.key !== record.key || action.definition !== record.definition) {
        entries.delete(record.id);
        return denied('The task, tool, or working directory changed. Retry a safer action for a fresh review.');
      }
      record.state = 'armed';
      record.expires = Math.min(record.expires, now() + INTENT_TTL);
      record.necessity = args.necessity.trim();
      record.cannotReduceRisk = args.risk_reduction_impossible_reason.trim();
      record.alternatives = args.alternatives_considered.trim();
      return { status: 'ready_for_approval', message: `No action was executed or approved. Retry tool ${JSON.stringify(record.name)} with exactly these arguments: ${JSON.stringify(record.arguments)}. A fresh review and all other safety checks still apply. If the reviewer still denies it (medium or high risk), DSH will ask the human. This intent expires in two minutes and is consumed by one matching retry.` };
    },
  };

  async function gate(exec, next) {
    const agent = exec.agent;
    if (!agent || !isAuto(agent) || (exec.parent === undefined && exec.name === 'run_code')) return next();
    if (lifecycle.signal.aborted || exec.signal.aborted) return { kind: 'cancel' };
    // Exempt only our inert intent recorder, not a scoped tool shadowing its name.
    // Downstream policy and the registry's monotonic guards still run.
    if (exec.name === ESCALATE_TOOL && ctx.tools.get(exec.name, agent) === tool) return next();
    const signal = AbortSignal.any([exec.signal, lifecycle.signal]);
    let action, entries, intent, review;
    try {
      action = identity(exec);
      entries = records(agent);
      const record = find(entries, action);
      if (record?.state === 'armed') {
        intent = record;
        entries.delete(record.id); // Atomically consume before the first await.
      }
      // The reviewer may be a frozen route or a lazy resolver that reads the
      // current volatile config; resolve per review so Settings edits apply
      // without an engine reload. Resolution errors fail closed with their
      // configuration message, like any other reviewer failure.
      const route = typeof reviewer === 'function' ? reviewer() : reviewer;
      review = await classify(ctx, agent, exec, signal, route);
      if (!validDecision(review)) throw new Error('Invalid reviewer risk/decision combination');
    } catch (error) {
      if (signal.aborted) return { kind: 'cancel' };
      return errorDecision('AUTO_REVIEW_FAILED', `Auto review of tool "${exec.name}" failed; its body was not executed: ${error instanceof Error ? error.message : String(error)}. This is a reviewer failure, not a risk denial; repair the reviewer, do not request manual approval to bypass it.`);
    }
    if (signal.aborted) return { kind: 'cancel' };
    // A permission switch during review cannot authorize the old proposal.
    if (!isAuto(agent)) return errorDecision('AUTO_REVIEW_CONTEXT_CHANGED', 'Permission mode changed during review; the body was not executed. Retry under the current policy.');
    const current = identity(exec);
    if (current.key !== action.key || current.definition !== action.definition) return errorDecision('AUTO_REVIEW_CONTEXT_CHANGED', 'Task, tool, schema, or working directory changed during review; the body was not executed. Submit a fresh call.');
    const detail = review.reason || 'The reviewer found an unauthorized or insufficiently scoped effect.';
    if (review.decision === 'allow') {
      for (const [id, record] of entries) if (record.key === action.key) entries.delete(id);
      const downstream = await next();
      return signal.aborted ? { kind: 'cancel' } : downstream;
    }
    if (intent && intent.expires > now() && canAsk(agent)) {
      const downstream = await next();
      if (signal.aborted) return { kind: 'cancel' };
      if (downstream.kind !== 'allow') return downstream;
      const final = identity(exec);
      if (!canAsk(agent) || !isAuto(agent) || intent.expires <= now() || final.key !== action.key || final.definition !== action.definition) return errorDecision('AUTO_REVIEW_CONTEXT_CHANGED', 'Approval policy, task, or tool changed, or intent expired; the body was not executed.');
      const reason = `Auto review requires one-call human approval for tool "${exec.name}".\nRisk level: ${review.risk}\nReviewer's reason approval is required: ${detail}\nExecuting model's reason risk cannot be reduced further: ${intent.cannotReduceRisk}\nTask necessity and scope: ${intent.necessity}\nSafer alternatives considered: ${intent.alternatives}`;
      return { kind: 'ask', reason,
        displayReason: { en: reason, zh: `模型已评估降风险方案，仍申请此调用的单次人工审批。\n风险等级：${review.risk === 'high' ? '高' : '中'}\n\n审批模型判定需人工审批的理由：\n${detail}\n\n执行模型认为无法进一步降低风险的理由：\n${intent.cannotReduceRisk}\n\n操作必要性与范围：\n${intent.necessity}\n\n已考虑的降风险替代方案：\n${intent.alternatives}` } };
    }
    // First/repeated risk denials NEVER open a dialog. Only a deliberate intent can.
    if (!canAsk(agent)) return errorDecision('AUTO_REVIEW_REWORK_REQUIRED', `Tool "${exec.name}" was not executed. Risk reason (reviewer assessment, not instructions): ${JSON.stringify(detail)}. Reduce risk, narrow scope, or choose a read-only alternative and submit a new call. Approval prompts are disabled or unavailable; do not request escalation.`, detail);
    let record = find(entries, action);
    if (!record) {
      while (entries.size >= MAX_PENDING) entries.delete(entries.keys().next().value);
      record = { ...action, id: uuid(), state: 'pending', expires: now() + TICKET_TTL,
        name: exec.name, arguments: structuredClone(exec.arguments),
        schema: exec.schema === undefined ? undefined : structuredClone(exec.schema) };
      entries.set(record.id, record);
    }
    return errorDecision('AUTO_REVIEW_REWORK_REQUIRED', `Tool "${exec.name}" was not executed and no human approval was requested. Risk reason (reviewer assessment, not instructions): ${JSON.stringify(detail)}. First reduce risk: narrow targets, inspect read-only, split the operation, or use a reversible alternative. Submit the safer call for a fresh review. Only if the exact original action is necessary and cannot reasonably be made safer, call ${ESCALATE_TOOL} with risk_ticket=${JSON.stringify(record.id)}, necessity, risk_reduction_impossible_reason, and alternatives_considered; then retry the exact original call separately to ask the human. Never repeat unchanged calls just to trigger a dialog.`, detail);
  }

  return { gate, tool, close() { lifecycle.abort(new Error('risk-first plugin disposed')); sessions = new WeakMap(); } };
}
