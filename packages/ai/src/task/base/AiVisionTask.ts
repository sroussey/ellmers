/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskConfig, TaskOutput } from "@workglow/task-graph";

import { AiTask, AiTaskInput } from "./AiTask";

/**
 * A base class for AI vision tasks.
 *
 * In the ImageValue boundary model, `input.image` is hydrated to `ImageValue`
 * (a plain POJO wrapping `ImageBitmap` on browser or `Buffer` on node) by the
 * `format: "image"` input resolver before the task runs. `ImageValue` is
 * structured-clone-safe, so it traverses the worker boundary without any
 * additional materialization. Provider workers normalize at their entry point.
 */
export class AiVisionTask<
  Input extends AiTaskInput = AiTaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig<Input> = TaskConfig<Input>,
> extends AiTask<Input, Output, Config> {
  public static override type: string = "AiVisionTask";
}
