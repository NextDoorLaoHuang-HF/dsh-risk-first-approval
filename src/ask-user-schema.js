// Exact shipped legacy ask_user_question schema, verified through Tool Inspect
// on DSH 0.2.1-rc.2. This is a compatibility allowlist, not a Host signature.
import { deepFreeze } from '@deepseek-ai/dsh-util-values';
export const LEGACY_ASK_USER_SCHEMA = deepFreeze({
  name: 'ask_user_question',
  description: 'Ask the user a concise question when you need confirmation, a choice, or missing information before proceeding.',
  parameters: {
    type: 'object',
    properties: {
      questions: {
        type: 'array', description: 'Questions to ask the user before continuing.',
        items: {
          type: 'object', additionalProperties: true,
          properties: {
            id: { type: 'string', description: 'Stable id for this question; echoed in the answer.' },
            question: { type: 'string', description: 'The specific question to ask the user.' },
            header: { type: 'string', description: 'Optional short heading for the question, such as "Confirm" or "Choose Mode".' },
            options: {
              type: 'array', description: 'Optional choices to show the user. If you recommend one, put it first and append "(Recommended)" to that label.',
              items: {
                type: 'object', additionalProperties: true,
                properties: {
                  label: { type: 'string', description: 'Short user-facing option label.' },
                  description: { type: 'string', description: 'One sentence explaining the tradeoff or impact.' },
                },
                required: ['label'],
              },
            },
            multi_select: { type: 'boolean', description: 'Whether the user may select more than one option. Defaults to false.' },
          },
          required: ['id', 'question'],
        },
      },
    },
    required: ['questions'],
  },
});
