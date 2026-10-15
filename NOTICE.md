# Attribution and compatibility

The reviewer snapshot builder, history provenance filter, stream reader, and strict JSON parser in [upstream-review.js](src/upstream-review.js) derive from `@deepseek-ai/dsh-experimental-auto-review` version `0.2.0-rc.2`, Copyright (c) 2026 DeepSeek, MIT licensed. The original [MIT license](LICENSE) is retained.

Local modifications:

- Extract only reviewer helpers; replace the original gate/lifecycle with this plugin's policy.
- Omit the fixed `temperature: 0` option. The installed Codex adapter rejects that explicit parameter; provider defaults remain in effect. No model selection or credentials are changed.
- Preserve the current session's explicit reasoning effort. If absent, use exact-model metadata; for Codex gpt-6.1-sol, replace only its known incompatible implicit off/none default with declared-supported low. Explicit unsupported user choices fail closed rather than being silently changed.
- Require a nonempty, concrete reason on every risk denial, including high-risk denials.
- Clarify that high risk forbids automatic authorization, but can be submitted to a human for one exact action.
- Return risk reasons to the executing model, use expiring per-Agent intent tickets, and compose the original DSH approval dialog with both model explanations. No execution grant is stored.

This reviewer core is intentionally a reviewed snapshot, not an automated source-patching mechanism. Updating it requires checking the upstream session/provenance contracts and running the tests. Exact DSH peer requirements prevent silently loading it against an untested runtime. Do not add version exemptions to force an incompatible upgrade.

The one-time bootstrap scripts preserve inspection references outside the application. They do not modify or repack the installed application; the current source contains reviewed changes made after bootstrap.
