/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ImageEditTask } from "@workglow/ai";
import { TaskGraph } from "@workglow/task-graph";
import type { TaskGraphTabularRepository } from "@workglow/task-graph";

export const IMAGE_EDIT_INPAINT_SAMPLE_ID = "edit-image-inpaint";

const DEFAULT_MODEL = {
  provider: "OPENAI",
  provider_config: { model_name: "gpt-image-2" },
} as const;

export function buildImageEditInpaintSampleGraph(): TaskGraph {
  const graph = new TaskGraph();
  const task = new ImageEditTask({
    defaults: {
      model: DEFAULT_MODEL as any,
      prompt: "Replace the masked region with a clear blue sky",
      aspectRatio: "1:1",
    },
  });
  graph.addTask(task);
  return graph;
}

/** Idempotent installer — never overwrites an existing workflow with the same id. */
export async function ensureImageEditInpaintSample(
  repo: TaskGraphTabularRepository,
): Promise<void> {
  const existing = await repo.tabularRepository.get({ key: IMAGE_EDIT_INPAINT_SAMPLE_ID });
  if (existing) return;
  await repo.saveTaskGraph(IMAGE_EDIT_INPAINT_SAMPLE_ID, buildImageEditInpaintSampleGraph());
}
