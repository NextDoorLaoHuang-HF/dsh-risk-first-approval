import z from '@deepseek-ai/schemastery';

/**
 * Configurable reviewer route shared by the production entry and the hot
 * engine. Empty provider/model keeps the historical behavior: every review
 * follows the session's own request-header route.
 */
export const ReviewerRouteConfig = z.object({
  reviewerProvider: z.string().default('').description(
    'Dedicated reviewer LLM provider id (for example zai-coding-cn). Empty follows each session route.'),
  reviewerModel: z.string().default('').description(
    'Dedicated reviewer LLM model id (for example glm-5.3-flash). Must be set together with reviewerProvider.'),
  reviewerReasoningEffort: z.string().default('').description(
    'Fixed reviewer reasoning effort (for example low). Empty keeps the automatic effort choice. Requires reviewerProvider and reviewerModel.'),
});

/**
 * Validate the raw plugin config into one immutable reviewer route, or
 * `undefined` when no dedicated route is configured.
 *
 * @param config - untrusted plugin configuration after Loader normalization.
 * @returns frozen `{ provider, model, reasoningEffort? }` or `undefined`.
 */
export function resolveReviewerRoute(config = {}) {
  const read = value => (typeof value === 'string' ? value.trim() : '');
  const provider = read(config.reviewerProvider);
  const model = read(config.reviewerModel);
  const effort = read(config.reviewerReasoningEffort);
  if ((provider.length === 0) !== (model.length === 0)) {
    throw new Error(
      'risk-first-approval: reviewerProvider and reviewerModel must be set together; leave both empty to follow the session route');
  }
  if (provider.length === 0 && effort.length > 0) {
    throw new Error(
      'risk-first-approval: reviewerReasoningEffort requires reviewerProvider and reviewerModel');
  }
  if (provider.length === 0) return undefined;
  return Object.freeze({
    provider,
    model,
    ...(effort.length === 0 ? {} : { reasoningEffort: effort }),
  });
}
