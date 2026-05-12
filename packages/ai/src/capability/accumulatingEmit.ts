/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskOutput } from "@workglow/task-graph";
import type { AiEmit } from "./AiEmit";
import { StreamEventAccumulator } from "./StreamEventAccumulator";

/**
 * Factory for the explicit terminal-consumer pattern: a synchronous `emit`
 * callback that pushes events into a {@link StreamEventAccumulator}, plus a
 * `result()` accessor that materialises the final `O`.
 *
 * `AiTask.execute` uses this to drive a run-fn to completion while
 * accumulating its emitted output into a single materialised value. **Do
 * not** use this anywhere below the explicit terminal consumer — streams in
 * this codebase can be conceptually unbounded.
 */
export function accumulatingEmit<O extends TaskOutput = TaskOutput>(): {
  emit: AiEmit<O>;
  result: () => O;
} {
  const acc = new StreamEventAccumulator<O>();
  const emit: AiEmit<O> = (event) => {
    if (event.type === "finish") {
      acc.observeFinish(event);
      return;
    }
    acc.observe(event);
  };
  return { emit, result: () => acc.materialize() };
}
