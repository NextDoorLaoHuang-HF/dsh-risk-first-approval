// Only the shipped native question tool's linked, original Session result is
// eligible. Arbitrary tool output, assistant claims and compacted copies are not.
// Host plugin/tool registration is a trusted boundary, as it is for core Session
// source attribution; a same-name tool installed by a hostile Host is not covered.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
function parse(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

function questionSchemaBefore(events, call) {
  let header;
  for (const event of events) {
    if (event.seq >= call.seq) break;
    if (event.type === 'request/header') header = event.data.header;
  }
  const tools = header?.tools;
  if (!Array.isArray(tools)) return false;
  const matches = tools.filter(tool => tool.name === 'ask_user_question');
  if (matches.length !== 1) return false;
  const questions = matches[0].parameters?.properties?.questions;
  return questions?.type === 'array' && questions.items?.type === 'object' &&
    questions.items.properties?.id?.type === 'string' &&
    questions.items.properties?.question?.type === 'string';
}

function pairedAnswers(argumentsText, content) {
  const args = parse(argumentsText);
  if (!record(args) || !Array.isArray(args.questions) || !args.questions.length) return;
  if (!Array.isArray(content) || content.length !== 1 || content[0].type !== 'text') return;
  const value = parse(content[0].text);
  // The shipped renderer uses JSON.stringify. Reject duplicate-key JSON and
  // edited/augmented renderings rather than guessing which answer was submitted.
  if (JSON.stringify(value) !== content[0].text) return;
  if (!record(value) || !keys(value, ['answers']) || !Array.isArray(value.answers)) return;
  if (value.answers.length !== args.questions.length) return;
  const questions = new Map();
  for (const q of args.questions) {
    if (!record(q) || !nonempty(q.id) || !nonempty(q.question) || questions.has(q.id)) return;
    if (q.header !== undefined && typeof q.header !== 'string') return;
    if (q.multi_select !== undefined && typeof q.multi_select !== 'boolean') return;
    if (q.options !== undefined && !Array.isArray(q.options)) return;
    const options = new Map();
    for (const option of q.options ?? []) {
      if (!record(option) || !nonempty(option.label) || options.has(option.label) ||
          (option.description !== undefined && typeof option.description !== 'string')) return;
      options.set(option.label, option);
    }
    questions.set(q.id, { q, options });
  }
  const seen = new Set();
  const answers = [];
  for (const answer of value.answers) {
    if (!record(answer) || !keys(answer, ['id', 'selected', 'custom']) ||
        !questions.has(answer.id) || seen.has(answer.id) || !Array.isArray(answer.selected) ||
        (answer.custom !== undefined && typeof answer.custom !== 'string')) return;
    const { q, options } = questions.get(answer.id);
    if (new Set(answer.selected).size !== answer.selected.length ||
        answer.selected.some(label => typeof label !== 'string' || !options.has(label))) return;
    if (!q.multi_select && (answer.selected.length > 1 || (answer.custom && answer.selected.length))) return;
    seen.add(answer.id);
    answers.push({
      id: q.id, question: q.question,
      ...(q.header === undefined ? {} : { header: q.header }),
      // Do not show unselected options as authority. The question supplies scope,
      // but only the selected descriptions and actual custom text are the answer.
      selected: answer.selected.map(label => ({
        label, ...(options.get(label).description === undefined ? {} : { description: options.get(label).description }),
      })),
      ...(answer.custom === undefined ? {} : { custom: answer.custom }),
    });
  }
  return answers;
}

export function nativeQuestionAnswer(session, events, event, calls, visibleCalls, callKey) {
  if (event.type !== 'tool/result' || event.surfaceOp !== 'append' || !session.isOwnSeq(event.seq) ||
      event.data.error !== undefined || event.data.message.isError === true) return;
  const message = event.data.message;
  if (message.role !== 'tool' || message.source?.kind !== 'tool' ||
      message.source.callId !== message.toolCallId) return;
  const key = callKey(event.data, message.toolCallId);
  const matches = calls.get(key) ?? [];
  const call = matches[0];
  if (matches.length !== 1 || !visibleCalls.has(key) || !session.isOwnSeq(call.seq) ||
      call.seq >= event.seq || call.data.name !== 'ask_user_question' || !questionSchemaBefore(events, call)) return;
  // Never guess which result won, or recover authority from a rewritten result.
  const results = events.filter(candidate => candidate.type === 'tool/result' &&
    callKey(candidate.data, candidate.data.message.toolCallId) === key);
  if (results.length !== 1 || results[0] !== event) return;
  const answers = pairedAnswers(call.data.arguments, message.content);
  if (!answers) return;
  return { kind: 'user-question-answer', role: 'human-answer', callId: message.toolCallId,
    callSeq: call.seq, answerSeq: event.seq, answers };
}
