/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EFFORT_POLICY_ALL,
  EFFORT_POLICY_NONE,
  makeEffortPolicy,
  type ModelEffortPolicyFn,
} from "@workglow/ai/worker";

/**
 * OpenRouter ids are `vendor/model[:variant]`, so a family name can sit either
 * at the start or straight after the slash. These are the modalities that have
 * no `reasoning` field to carry the dial at all.
 */
const NON_TEXT_MODALITIES = [
  /embedding/i,
  /(?:^|[/-])embed(?:$|[-:])/i,
  /(?:^|\/)(?:dall-e|gpt-image|imagen|flux|sdxl|stable-diffusion|playground|recraft|ideogram|kandinsky)/i,
  /-image(?:$|[-:])/i,
  /(?:^|\/)(?:whisper|tts)(?:$|[-:])/i,
  /(?:^|\/)rerank/i,
  /moderation/i,
];

/**
 * OpenRouter's catalogue is open-ended and it drops a parameter the routed
 * model does not accept rather than rejecting the request, so an id no rule
 * recognizes keeps the dial. What it cannot do is make a non-text model reason,
 * and returning every level for every id — embeddings and image models
 * included — left the gate at the call site a literal no-op.
 */
export const openrouterEffortPolicy: ModelEffortPolicyFn = makeEffortPolicy({
  rules: [{ when: NON_TEXT_MODALITIES, policy: EFFORT_POLICY_NONE }],
  fallback: EFFORT_POLICY_ALL,
});
