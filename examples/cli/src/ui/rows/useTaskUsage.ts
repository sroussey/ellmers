/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask, Usage } from "@workglow/task-graph";
import { useEffect, useState } from "react";

export interface TaskUsageState {
  readonly usage: Usage | undefined;
  readonly modelId: string | undefined;
}

/**
 * Subscribes to a task's `usage` event and returns its running token total plus
 * the model id that produced it (when the provider named one).
 *
 * Deliberately does NOT clear on `stream_end` or completion, unlike the stream
 * text hook: streaming text is transient, but the final token count is the
 * result and stays on the row.
 */
export function useTaskUsage(task: ITask): TaskUsageState {
  // Rows are keyed by task id (see SubtaskRows), so `task` never changes
  // identity within one hook instance — the initial value only needs to cover
  // the case where the row mounts after usage already landed.
  const [state, setState] = useState<TaskUsageState>(() => ({
    usage: task.runUsage,
    modelId: task.runUsageModelId,
  }));

  useEffect(() => {
    const onUsage = (next: Usage, modelId: string | undefined): void => {
      setState({ usage: next, modelId: modelId ?? task.runUsageModelId });
    };
    task.events.on("usage", onUsage);
    return () => {
      task.events.off("usage", onUsage);
    };
  }, [task]);

  return state;
}
