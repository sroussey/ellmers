/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fence untrusted dataset text for inclusion in a prompt. The quote delimiter
 * grows until it does not occur in the text, so a row that itself contains
 * `"""` cannot terminate the fence early and smuggle instructions.
 */
export function fenceText(text: string): string {
  let fence = '"""';
  while (text.includes(fence)) fence += '"';
  return `${fence}\n${text}\n${fence}`;
}
