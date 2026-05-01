/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ImageGenerateTask } from "@workglow/ai";
import { TaskGraph } from "@workglow/task-graph";
import type { TaskGraphTabularRepository } from "@workglow/task-graph";

export const IMAGE_GENERATE_SAMPLE_ID = "generate-image";

const DEFAULT_MODEL = {
  provider: "OPENAI",
  provider_config: { model_name: "gpt-image-2" },
} as const;

export function buildImageGenerateSampleGraph(): TaskGraph {
  const graph = new TaskGraph();
  const task = new ImageGenerateTask({
    defaults: {
      model: DEFAULT_MODEL as any,
      prompt: "A friendly orange cat in a sunlit kitchen",
      aspectRatio: "1:1",
    },
  });
  graph.addTask(task);
  return graph;
}

/** Idempotent installer — never overwrites an existing workflow with the same id. */
export async function ensureImageGenerateSample(repo: TaskGraphTabularRepository): Promise<void> {
  const existing = await repo.tabularRepository.get({ key: IMAGE_GENERATE_SAMPLE_ID });
  if (existing) return;
  await repo.saveTaskGraph(IMAGE_GENERATE_SAMPLE_ID, buildImageGenerateSampleGraph());
}
