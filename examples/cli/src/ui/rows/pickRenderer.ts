/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import type React from "react";
import type { CliTaskLine, IterationSlotRow } from "../taskGraphCliSubscriptions";

export interface TaskRowProps {
  readonly task: ITask;
  readonly line: CliTaskLine;
  readonly iterationSlots: ReadonlyArray<IterationSlotRow> | undefined;
}

export function hasAppendStream(schema: DataPortSchema | undefined): boolean {
  if (!schema || typeof schema === "boolean") return false;
  const props = schema.properties;
  if (!props) return false;
  for (const value of Object.values(props)) {
    if (value && typeof value === "object" && value["x-stream"] === "append") {
      return true;
    }
  }
  return false;
}

export type TaskRowComponent = React.ComponentType<TaskRowProps>;

/**
 * Returns the React component that should render the given task row.
 *
 * Explicit mapping: AiChatTask → ChatTaskRow.
 * Fallback: any task with an `x-stream: append` port → StreamingTextRow.
 * Default: DefaultTaskRow (progress + live map/reduce iteration tasks).
 *
 * The concrete components are injected at call time (see WorkflowRunApp) to
 * avoid import cycles between this module and its consumers.
 */
export function pickRenderer(
  taskType: string,
  outputSchema: DataPortSchema | undefined,
  components: {
    ChatTaskRow: TaskRowComponent;
    StreamingTextRow: TaskRowComponent;
    DefaultTaskRow: TaskRowComponent;
  }
): TaskRowComponent {
  if (taskType === "AiChatTask") return components.ChatTaskRow;
  if (hasAppendStream(outputSchema)) return components.StreamingTextRow;
  return components.DefaultTaskRow;
}
