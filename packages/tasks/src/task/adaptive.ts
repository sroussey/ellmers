/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskConfig } from "@workglow/task-graph";
import { CreateAdaptiveWorkflow, Workflow } from "@workglow/task-graph";
import { ScalarAddTask } from "./scalar/ScalarAddTask";
import { ScalarDivideTask } from "./scalar/ScalarDivideTask";
import { ScalarMultiplyTask } from "./scalar/ScalarMultiplyTask";
import { ScalarSubtractTask } from "./scalar/ScalarSubtractTask";
import { ScalarSumTask } from "./scalar/ScalarSumTask";
import { VectorDivideTask } from "./vector/VectorDivideTask";
import { VectorMultiplyTask } from "./vector/VectorMultiplyTask";
import { VectorSubtractTask } from "./vector/VectorSubtractTask";
import { VectorSumTask } from "./vector/VectorSumTask";

declare module "@workglow/task-graph" {
  interface Workflow {
    add: CreateAdaptiveWorkflow<
      import("./scalar/ScalarAddTask").ScalarAddTaskInput,
      import("./scalar/ScalarAddTask").ScalarAddTaskOutput,
      import("./vector/VectorSumTask").VectorSumTaskInput,
      import("./vector/VectorSumTask").VectorSumTaskOutput,
      TaskConfig,
      TaskConfig
    >;
    subtract: CreateAdaptiveWorkflow<
      import("./scalar/ScalarSubtractTask").ScalarSubtractTaskInput,
      import("./scalar/ScalarSubtractTask").ScalarSubtractTaskOutput,
      import("./vector/VectorSubtractTask").VectorSubtractTaskInput,
      import("./vector/VectorSubtractTask").VectorSubtractTaskOutput,
      TaskConfig,
      TaskConfig
    >;
    multiply: CreateAdaptiveWorkflow<
      import("./scalar/ScalarMultiplyTask").ScalarMultiplyTaskInput,
      import("./scalar/ScalarMultiplyTask").ScalarMultiplyTaskOutput,
      import("./vector/VectorMultiplyTask").VectorMultiplyTaskInput,
      import("./vector/VectorMultiplyTask").VectorMultiplyTaskOutput,
      TaskConfig,
      TaskConfig
    >;
    divide: CreateAdaptiveWorkflow<
      import("./scalar/ScalarDivideTask").ScalarDivideTaskInput,
      import("./scalar/ScalarDivideTask").ScalarDivideTaskOutput,
      import("./vector/VectorDivideTask").VectorDivideTaskInput,
      import("./vector/VectorDivideTask").VectorDivideTaskOutput,
      TaskConfig,
      TaskConfig
    >;
    sum: CreateAdaptiveWorkflow<
      import("./scalar/ScalarSumTask").ScalarSumTaskInput,
      import("./scalar/ScalarSumTask").ScalarSumTaskOutput,
      import("./vector/VectorSumTask").VectorSumTaskInput,
      import("./vector/VectorSumTask").VectorSumTaskOutput,
      TaskConfig,
      TaskConfig
    >;
  }
}

Workflow.prototype.add = CreateAdaptiveWorkflow(ScalarAddTask, VectorSumTask);
Workflow.prototype.subtract = CreateAdaptiveWorkflow(ScalarSubtractTask, VectorSubtractTask);
Workflow.prototype.multiply = CreateAdaptiveWorkflow(ScalarMultiplyTask, VectorMultiplyTask);
Workflow.prototype.divide = CreateAdaptiveWorkflow(ScalarDivideTask, VectorDivideTask);
Workflow.prototype.sum = CreateAdaptiveWorkflow(ScalarSumTask, VectorSumTask);
