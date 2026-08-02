/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export const ANTHROPIC = "ANTHROPIC";

/**
 * Anthropic requires `max_tokens`, and it bounds thinking and response text
 * together, so this fallback is always in play. 16k matches the vendor's
 * guidance for non-streaming requests; stream and pass `maxTokens` for more.
 *
 * Lives here rather than beside {@link getMaxTokens} so the model schema can
 * advertise it as its `default` without importing the client.
 */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 16_384;
