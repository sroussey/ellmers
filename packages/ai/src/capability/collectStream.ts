/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent, TaskOutput } from "@workglow/task-graph";
import { StreamEventAccumulator } from "./StreamEventAccumulator";

/**
 * Drives a {@link StreamEventAccumulator} from an
 * `AsyncIterable<StreamEvent<T>>` to produce a single materialised value.
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
