// Intentionally outside the watched engine directory. A stable public schema.
export const TOOL_NAME = 'request_risk_approval';
export const DESCRIPTION = 'Only after AUTO_REVIEW_REWORK_REQUIRED, first consider safer alternatives. If the exact blocked action is necessary and cannot reasonably be made safer, provide its risk_ticket, necessity, risk_reduction_impossible_reason, and alternatives_considered. This records only an intent to ask, not permission or execution. Then retry the exact original call. Medium and high risk both support single-call human approval. Respect approval policy never and independent guards. Do not repeatedly request a rejected approval.';
export const PARAMETERS = {
  type: 'object', additionalProperties: false,
  properties: {
    risk_ticket: { type: 'string', description: 'The pending ticket for this exact action and Agent.' },
    necessity: { type: 'string', description: 'Why this exact action and scope are necessary.' },
    risk_reduction_impossible_reason: { type: 'string', description: 'The specific reason further risk reduction cannot satisfy the task; shown verbatim to the human.' },
    alternatives_considered: { type: 'string', description: 'Safer approaches considered or tried and why they do not satisfy the task.' },
  },
  required: ['risk_ticket', 'necessity', 'risk_reduction_impossible_reason', 'alternatives_considered'],
};
export const OUTPUT = {
  schema: { type: 'object', additionalProperties: false,
    properties: { status: { type: 'string' }, message: { type: 'string' } }, required: ['status', 'message'] },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};
export const GUIDANCE = 'Auto review returns risk reasons to you before asking a human. AUTO_REVIEW_REWORK_REQUIRED means the tool body did not run. First narrow scope, inspect read-only, split operations, or use reversible alternatives. Only when the exact action cannot reasonably be made safer, call request_risk_approval with risk_ticket, necessity, risk_reduction_impossible_reason and alternatives_considered; then retry the exact original call separately. The intent is not a grant. Both medium and high risks can request one-call human approval. The dialog shows both model explanations. Approval policy never and independent guards remain binding. An unavailable/reloading reviewer is not a risk denial and must not be bypassed. Do not repeatedly request a rejected approval.';
