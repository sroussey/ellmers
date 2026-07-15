/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** Bearer-token headers for HuggingFace requests (gated/private repos). */
export function hfAuthHeaders(token?: string | undefined): Record<string, string> {
  const t = token ?? process.env.HF_TOKEN;
  return t ? { Authorization: `Bearer ${t}` } : {};
}
