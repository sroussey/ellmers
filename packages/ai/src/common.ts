/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

export * from "./execution/DirectExecutionStrategy";
export * from "./execution/IAiExecutionStrategy";
export * from "./execution/QueuedExecutionStrategy";
export * from "./job/AiJob";
export * from "./model/InMemoryModelRepository";
export * from "./model/ModelRegistry";
export * from "./model/ModelRepository";
export * from "./model/ModelSchema";

export * from "./errors/ImageGenerationErrors";

export * from "./provider/AiProvider";
export * from "./provider/AiProviderRegistry";
export * from "./provider/CheckpointRegistry";
export * from "./provider/QueuedAiProvider";

export * from "./capability";
export * from "./kb/createStandardKbStrategy";
export * from "./task";

import { AiVisionTask } from "./task/base/AiVisionTask";

/**
 * @internal Symbols exported only for use by `@workglow/test`. Not part of the stable public API.
 */
export const _testOnly = {
  AiVisionTask,
} as const;
