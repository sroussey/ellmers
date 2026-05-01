/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiChatTask } from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "@workglow/ai-provider/hf-transformers";
import { TaskGraph } from "@workglow/task-graph";
import type { TaskGraphTabularRepository } from "@workglow/task-graph";

import { ensureImageGenerateSample } from "./generate-image";
import { ensureImageEditInpaintSample } from "./edit-image-inpaint";
import { ensureImageEditComposeSample } from "./edit-image-compose";

export const CHAT_SAMPLE_ID = "chat";

const BONSAI_MODEL = {
  provider: "HF_TRANSFORMERS_ONNX",
  provider_config: {
    model_path: "onnx-community/Bonsai-1.7B-ONNX",
    dtype: "q1",
    pipeline: "text-generation",
  },
} as const satisfies HfTransformersOnnxModelConfig;

/**
 * Builds the chat sample: a TaskGraph with a single AiChatTask whose `model`
 * input is pre-populated with the Bonsai 1.7B ONNX q1 ModelConfig (via
 * `task.defaults.model`).
 *
 * The user is prompted for `prompt` on every run (no default). `systemPrompt`
 * is unset and can be edited via `workflow run chat --interactive`.
 */
export function buildChatSampleGraph(): TaskGraph {
  const graph = new TaskGraph();
  const task = new AiChatTask({
    defaults: { model: BONSAI_MODEL },
  });
  graph.addTask(task);
  return graph;
}

/** Idempotent installer — never overwrites an existing workflow with the same id. */
export async function ensureChatSample(repo: TaskGraphTabularRepository): Promise<void> {
  const existing = await repo.tabularRepository.get({ key: CHAT_SAMPLE_ID });
  if (existing) return;
  await repo.saveTaskGraph(CHAT_SAMPLE_ID, buildChatSampleGraph());
}

/**
 * Startup-time seed guard: installs all bundled samples only if the workflow
 * repo is completely empty. Preserves user deletions of any sample.
 */
export async function seedSamplesIfRepoEmpty(repo: TaskGraphTabularRepository): Promise<void> {
  const all = await repo.tabularRepository.getAll();
  if (all && all.length > 0) return;
  await ensureChatSample(repo);
  await ensureImageGenerateSample(repo);
  await ensureImageEditInpaintSample(repo);
  await ensureImageEditComposeSample(repo);
}
