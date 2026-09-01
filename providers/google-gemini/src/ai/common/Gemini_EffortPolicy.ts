/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EFFORT_POLICY_NONE,
  makeEffortPolicy,
  MODEL_EFFORTS,
  type ModelEffortPolicy,
  type ModelEffortPolicyFn,
} from "@workglow/ai/worker";

const TEXT = { supported: MODEL_EFFORTS, default: "none" } as const satisfies ModelEffortPolicy;

/**
 * Gemini rejects `thinkingConfig` on the models that do not think, so an id
 * outside the `gemini-` text families keeps the plain path — including the
 * embedding and image ids denied above, which share that prefix.
 */
export const geminiEffortPolicy: ModelEffortPolicyFn = makeEffortPolicy({
  rules: [
    {
      when: [
        /^gemini-embedding/i,
        /^text-embedding/i,
        /^embedding-/i,
        /^imagen-/i,
        /^gemini-.*-image(?:-|$)/i,
      ],
      policy: EFFORT_POLICY_NONE,
    },
    { when: /^gemini-/i, policy: TEXT },
  ],
  fallback: EFFORT_POLICY_NONE,
});
