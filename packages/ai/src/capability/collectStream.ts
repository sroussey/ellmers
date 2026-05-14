/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent, TaskOutput } from "@workglow/task-graph";
import { StreamEventAccumulator } from "./StreamEventAccumulator";

/**
 * Thin wrapper that drives a {@link StreamEventAccumulator} from an
 * `AsyncIterable<StreamEvent<T>>`. Use this only at explicit terminal-consumer
 * sites where you already hold a stream handle and want a single materialised
 * value. Most new code should hold an `AiEmit` and drive the accumulator
 * directly via {@link accumulatingEmit}; iterating an `AsyncIterable` here
 * exists for backwards compat with the few remaining sites that hand back
 * streams.
 */
export async function collectStream<T extends TaskOutput>(
  stream: AsyncIterable<StreamEvent<T>>
): Promise<T> {
  const acc = new StreamEventAccumulator<T>();
  for await (const event of stream) {
    if (event.type === "finish") {
      acc.observeFinish(event);
      break;
    }
    acc.observe(event);
  }
  return acc.materialize();
}
