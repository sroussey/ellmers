/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export async function clearHftInlinePipelineCache(): Promise<void> {
  const { clearPipelineCache } = await import("./HFT_Pipeline");
  clearPipelineCache();
}
