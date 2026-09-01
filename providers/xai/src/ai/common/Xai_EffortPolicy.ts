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

const REASONING = {
  supported: MODEL_EFFORTS,
  default: "medium",
} as const satisfies ModelEffortPolicy;

/**
 * xAI serves reasoning only on the Grok text ids, and rejects
 * `reasoning_effort` elsewhere, so an id outside them keeps the plain path.
 */
export const xaiEffortPolicy: ModelEffortPolicyFn = makeEffortPolicy({
  rules: [
    { when: [/(?:^|-)image(?:-|$)/i, /non-reasoning/i], policy: EFFORT_POLICY_NONE },
    { when: /^grok/i, policy: REASONING },
  ],
  fallback: EFFORT_POLICY_NONE,
});
