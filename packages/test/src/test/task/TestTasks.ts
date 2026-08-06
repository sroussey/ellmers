/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CachePolicy,
  IExecuteContext,
  TaskConfig,
  TaskInput,
  TaskOutput,
} from "@workglow/task-graph";
import {
  CreateWorkflow,
  GraphAsTask,
  IteratorTask,
  smartClone,
  Task,
  TaskAbortedError,
  TaskError,
  TaskFailedError,
  TaskGraph,
  Workflow,
} from "@workglow/task-graph";
import { sleep } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";

export type TestIOTaskInput = {
  key: string;
};

export type TestIOTaskOutput = {
  previewOnly: boolean;
  all: boolean;
  key: string;
};

export class TestIOTask extends Task<TestIOTaskInput, TestIOTaskOutput> {
  static override readonly type = "TestIOTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        key: {
          type: "string",
          default: "default",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        previewOnly: {
          type: "boolean",
        },
        all: {
          type: "boolean",
        },
        key: {
          type: "string",
          default: "default",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Preview: if execute ran there will be output data, otherwise return the input data.
   */
  override async executePreview(input: TestIOTaskInput): Promise<TestIOTaskOutput> {
    const output = this.runOutputData;
    return {
      all: output.all ?? false,
      key: output.key !== "default" && output.key !== undefined ? output.key : input.key,
      previewOnly: output.previewOnly ?? true,
    };
  }

  override async execute(
    _input: TestIOTaskInput,
    _context: IExecuteContext
  ): Promise<TestIOTaskOutput> {
    return { all: true, key: "full", previewOnly: false };
  }
}

type SimpleProcessingInput = {
  value: string;
};

type SimpleProcessingOutput = {
  processed: boolean;
  result: string;
};

export class SimpleProcessingTask extends Task<SimpleProcessingInput, SimpleProcessingOutput> {
  static override readonly type = "SimpleProcessingTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: {
          type: "string",
          description: "Input value to process",
          default: "default",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        processed: {
          type: "boolean",
          description: "Flag indicating if the value was processed",
        },
        result: {
          type: "string",
          description: "Processed result value",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(
    input: SimpleProcessingInput,
    { updateProgress }: IExecuteContext
  ): Promise<SimpleProcessingOutput> {
    await updateProgress(0.5);
    const result = `Processed: ${input.value}`;
    return { processed: true, result };
  }

  override async executePreview(input: SimpleProcessingInput) {
    const output = this.runOutputData;
    return { processed: output.processed ?? false, result: `Preview: ${input.value}` };
  }
}

export const FAILURE_MESSAGE = "Task failed intentionally" as const;
export const ABORT_MESSAGE = "Task aborted intentionally" as const;

export class FailingTask extends Task {
  static override readonly type = "FailingTask";
  declare runInputData: { in: number };
  declare runOutputData: { out: number };

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        in: {
          type: "number",
          description: "Input number",
          default: 0,
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        out: {
          type: "number",
          description: "Output number",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(
    input: TaskInput,
    executeContext: IExecuteContext
  ): Promise<{ out: number }> {
    // Delay so abort signal has time to take effect
    await sleep(5);
    if (executeContext.signal?.aborted) {
      throw new TaskAbortedError(ABORT_MESSAGE);
    }
    throw new TaskFailedError(FAILURE_MESSAGE);
  }
}

export class EventTestTask extends Task<TestIOTaskInput, TestIOTaskOutput> {
  static override readonly type = "EventTestTask";

  shouldThrowError = false;
  shouldEmitProgress = false;
  progressValue = 0.5;
  delayMs = 0;

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        key: {
          type: "string",
          default: "default",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        previewOnly: {
          type: "boolean",
        },
        all: {
          type: "boolean",
        },
        key: {
          type: "string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(
    input: TestIOTaskInput,
    { updateProgress, signal }: IExecuteContext
  ): Promise<any> {
    if (signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }

    if (this.shouldEmitProgress) {
      updateProgress(this.progressValue);
    }

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }

    if (this.shouldThrowError) {
      throw new TaskError("Test error");
    }

    return {
      previewOnly: false,
      all: true,
      key: input.key,
    };
  }
}

export type TestSquareTaskInput = {
  input: number;
};

export type TestSquareTaskOutput = {
  output: number;
};

export class TestSquareTask extends Task<TestSquareTaskInput, TestSquareTaskOutput> {
  static override readonly type = "TestSquareTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "number",
          description: "Number to square",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "number",
          description: "Squared number",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: TestSquareTaskInput): Promise<TestSquareTaskOutput> {
    return {
      output: input.input * input.input,
    };
  }

  override async executePreview(input: TestSquareTaskInput): Promise<TestSquareTaskOutput> {
    return {
      output: input.input * input.input,
    };
  }
}

/**
 * Only implements execute() — tests differences between preview and non-preview tasks.
 */
export class TestSquareNonPreviewTask extends Task<TestSquareTaskInput, TestSquareTaskOutput> {
  static override readonly type = "TestSquareNonPreviewTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "number",
          description: "Number to square",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "number",
          description: "Squared number",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: TestSquareTaskInput): Promise<TestSquareTaskOutput> {
    return { output: input.input * input.input };
  }
}

export type TestDoubleTaskInput = {
  input: number;
};

export type TestDoubleTaskOutput = {
  output: number;
};

export class TestDoubleTask extends Task<TestDoubleTaskInput, TestDoubleTaskOutput> {
  static override readonly type = "TestDoubleTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "number",
          description: "Number to double",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "number",
          description: "Doubled number",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: TestDoubleTaskInput): Promise<TestDoubleTaskOutput> {
    return {
      output: input.input * 2,
    };
  }

  override async executePreview(input: TestDoubleTaskInput): Promise<TestDoubleTaskOutput> {
    return {
      output: input.input * 2,
    };
  }
}

export class TestSquareErrorTask extends Task<TestSquareTaskInput, TestSquareTaskOutput> {
  static override readonly type = "TestSquareErrorTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "number",
          description: "Number to square (will throw error)",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "number",
          description: "Squared number (never returned due to error)",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Always throws an error to test error handling (full run).
   */
  override async execute(_input: TestSquareTaskInput): Promise<TestSquareTaskOutput> {
    throw new TaskError("Test error");
  }

  /**
   * Always throws an error to test error handling
   */
  override async executePreview(_input: TestSquareTaskInput): Promise<TestSquareTaskOutput> {
    throw new TaskError("Test error");
  }
}

export class TestSimpleTask extends Task<{ input: string }, { output: string }> {
  static override type = "TestSimpleTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "Input string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "string",
          description: "Output string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { input: string }): Promise<{ output: string }> {
    return { output: `processed-${input.input}` };
  }
}

export class TestOutputTask extends Task<{ input: string }, { customOutput: string }> {
  static override type = "TestOutputTask";
  declare runInputData: { input: string };
  declare runOutputData: { customOutput: string };

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "Input string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        customOutput: {
          type: "string",
          description: "Custom output string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: TaskInput): Promise<any> {
    return { customOutput: (input as { input: string }).input };
  }
}

export class TestInputTask extends Task<{ customInput: string }, { output: string }> {
  static override type = "TestInputTask";
  declare runInputData: { customInput: string };
  declare runOutputData: { output: string };

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        customInput: {
          type: "string",
          description: "Custom input string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "string",
          description: "Output string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: TaskInput): Promise<any> {
    return { output: (input as { customInput: string }).customInput };
  }
}

/** Runs indefinitely until aborted — for testing task abortion. */
export class LongRunningTask extends Task {
  static override type = "LongRunningTask";

  override async execute(input: TaskInput, executeContext: IExecuteContext): Promise<any> {
    while (true) {
      if (executeContext.signal?.aborted) {
        throw new TaskAbortedError(ABORT_MESSAGE);
      }
      await sleep(100);
    }
  }
}

export class StringTask extends Task<{ input: string }, { output: string }, TaskConfig> {
  static override type = "StringTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "Input string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "string",
          description: "Output string",
        },
      },
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { input: string }): Promise<{ output: string }> {
    return { output: input.input };
  }

  override async executePreview(input: { input: string }): Promise<{ output: string }> {
    return { output: input.input };
  }
}

export class NumberToStringTask extends Task<{ input: number }, { output: string }, TaskConfig> {
  static override type = "NumberToStringTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "number",
          description: "Input number",
        },
      },
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "string",
          description: "Output string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(
    input: { input: number },
    _context: IExecuteContext
  ): Promise<{ output: string }> {
    return { output: String(input.input) };
  }
}

export class NumberTask extends Task<{ input: number }, { output: number }, TaskConfig> {
  static override type = "NumberTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "number",
          description: "Input number",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "number",
          description: "Output number",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(
    input: { input: number },
    _context: IExecuteContext
  ): Promise<{ output: number }> {
    return { output: input.input };
  }
}

type TestAddTaskInput = {
  a: number;
  b: number;
};

type TestAddTaskOutput = {
  output: number;
};

export class TestAddTask extends Task<TestAddTaskInput, TestAddTaskOutput> {
  static override readonly type = "TestAddTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        a: {
          type: "number",
          description: "First number",
        },
        b: {
          type: "number",
          description: "Second number",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "number",
          description: "Sum of a and b",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: TestAddTaskInput) {
    return {
      output: input.a + input.b,
    };
  }

  override async executePreview(input: TestAddTaskInput) {
    return {
      output: input.a + input.b,
    };
  }
}

/** Outputs a TypedArray with port name "vector" (singular). */
export class VectorOutputTask extends Task<{ text: string }, { vector: Float32Array }> {
  static override type = "VectorOutputTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Input text",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        vector: {
          type: "array",
          format: "TypedArray",
          title: "Vector",
          description: "Output vector (singular name)",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { text: string }): Promise<{ vector: Float32Array }> {
    return { vector: new Float32Array([0.1, 0.2, 0.3]) };
  }
}

/** Accepts a TypedArray with port name "vectors" (plural). */
export class VectorsInputTask extends Task<{ vectors: Float32Array }, { count: number }> {
  static override type = "VectorsInputTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        vectors: {
          type: "array",
          format: "TypedArray",
          title: "Vectors",
          description: "Input vectors (plural name)",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        count: {
          type: "number",
          description: "Length of the vector",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { vectors: Float32Array }): Promise<{ count: number }> {
    return { count: input.vectors.length };
  }
}

/**
 * Task that outputs a TypedArray wrapped in oneOf (like TypeSingleOrArray)
 */
export class VectorOneOfOutputTask extends Task<{ text: string }, { embedding: Float32Array }> {
  static override type = "VectorOneOfOutputTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Input text",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        embedding: {
          oneOf: [
            {
              type: "array",
              format: "TypedArray",
              title: "Single Embedding",
            },
            {
              type: "array",
              items: {
                type: "array",
                format: "TypedArray",
              },
              title: "Multiple Embeddings",
            },
          ],
          title: "Embedding",
          description: "Output embedding (oneOf wrapper)",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { text: string }): Promise<{ embedding: Float32Array }> {
    return { embedding: new Float32Array([0.4, 0.5, 0.6]) };
  }
}

export class VectorAnyOfInputTask extends Task<{ data: Float32Array }, { sum: number }> {
  static override type = "VectorAnyOfInputTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        data: {
          anyOf: [
            {
              type: "array",
              format: "TypedArray",
              title: "Single Vector",
            },
            {
              type: "array",
              items: {
                type: "array",
                format: "TypedArray",
              },
              title: "Multiple Vectors",
            },
          ],
          title: "Data",
          description: "Input data (anyOf wrapper)",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        sum: {
          type: "number",
          description: "Sum of vector elements",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { data: Float32Array }): Promise<{ sum: number }> {
    return { sum: Array.from(input.data).reduce((a, b) => a + b, 0) };
  }
}
export class TextOutputTask extends Task<{ input: string }, { text: string }> {
  static override type = "TextOutputTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "Input string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Output text",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { input: string }): Promise<{ text: string }> {
    return { text: input.input };
  }
}

export class VectorOutputOnlyTask extends Task<{ size: number }, { vector: Float32Array }> {
  static override type = "VectorOutputOnlyTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        size: {
          type: "number",
          description: "Vector size",
          default: 3,
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        vector: {
          type: "array",
          format: "TypedArray",
          title: "Vector",
          description: "Output vector",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { size: number }): Promise<{ vector: Float32Array }> {
    return { vector: new Float32Array(input.size || 3).fill(1.0) };
  }
}

export class TextVectorInputTask extends Task<
  { text: string; vector: Float32Array },
  { result: string }
> {
  static override type = "TextVectorInputTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Input text",
        },
        vector: {
          type: "array",
          items: { type: "number" },
          format: "TypedArray",
          title: "Vector",
          description: "Input vector",
        },
      },
      required: ["text", "vector"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: {
          type: "string",
          description: "Combined result",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: {
    text: string;
    vector: Float32Array;
  }): Promise<{ result: string }> {
    return { result: `${input.text} with vector of length ${input.vector.length}` };
  }
}

export class PassthroughVectorTask extends Task<
  { vector: Float32Array },
  { vector: Float32Array }
> {
  static override type = "PassthroughVectorTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        vector: {
          type: "array",
          format: "TypedArray",
          title: "Vector",
          description: "Input vector",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        vector: {
          type: "array",
          format: "TypedArray",
          title: "Vector",
          description: "Output vector (passthrough)",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { vector: Float32Array }): Promise<{ vector: Float32Array }> {
    return { vector: input.vector };
  }
}

/**
 * Passthrough with additionalProperties: true and no named ports — mirrors
 * DebugLogTask's behavior.
 */
export class WildcardPassthroughTask extends Task {
  static override type = "WildcardPassthroughTask";
  static override category = "Test";
  static override passthroughInputsToOutputs = true;

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return { ...input };
  }
}

export class ProcessValueTask extends Task<{ value: number }, { result: string }> {
  static override type = "ProcessValueTask";
  static override category = "Test";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "number" },
      },
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: { type: "string" },
      },
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { value: number }): Promise<{ result: string }> {
    return { result: `processed-${input.value}` };
  }
}

export class TrackingTask extends Task<{ input: any }, { executed: boolean; input: any }> {
  static override type = "TrackingTask";
  static override category = "Test";

  executed = false;

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {},
      },
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        executed: { type: "boolean" },
        input: {},
      },
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { input: any }): Promise<{ executed: boolean; input: any }> {
    this.executed = true;
    return { executed: true, input: input.input };
  }
}

export class DoubleToDoubledTask extends Task<{ value: number }, { doubled: number }> {
  static override type = "DoubleToDoubledTask";
  static override category = "Test";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "number" },
      },
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        doubled: { type: "number" },
      },
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { value: number }): Promise<{ doubled: number }> {
    return { doubled: input.value * 2 };
  }
}

export class HalveTask extends Task<{ value: number }, { halved: number }> {
  static override type = "HalveTask";
  static override category = "Test";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "number" },
      },
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        halved: { type: "number" },
      },
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { value: number }): Promise<{ halved: number }> {
    return { halved: input.value / 2 };
  }
}

export class DoubleToResultTask extends Task<{ value: number }, { result: number }> {
  static override type = "DoubleToResultTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "number", default: 0 },
      },
      required: ["value"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: { type: "number" },
      },
      required: ["result"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { value: number }): Promise<{ result: number }> {
    return { result: input.value * 2 };
  }
}

export class SquareTask extends Task<{ value: number }, { squared: number }> {
  static override type = "SquareTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "number", default: 0 },
      },
      required: ["value"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        squared: { type: "number" },
      },
      required: ["squared"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { value: number }): Promise<{ squared: number }> {
    return { squared: input.value * input.value };
  }
}

export class ProcessItemTask extends Task<{ item: number }, { processed: number }> {
  static override type = "ProcessItemTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        item: { type: "number" },
      },
      required: ["item"],
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        processed: { type: "number" },
      },
      required: ["processed"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { item: number }): Promise<{ processed: number }> {
    return { processed: input.item * 2 };
  }
}

/** Mock embedding from text. */
export class TextEmbeddingTask extends Task<{ text: string }, { vector: readonly number[] }> {
  static override type = "TextEmbeddingTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string" },
      },
      required: ["text"],
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        vector: {
          type: "array",
          items: { type: "number" },
        },
      },
      required: ["vector"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { text: string }): Promise<{ vector: readonly number[] }> {
    const vector = input.text.split("").map((c) => c.charCodeAt(0) / 255);
    return { vector };
  }
}

export class RefineTask extends Task<
  { value: number; quality?: number },
  { quality: number; value: number }
> {
  static override type = "RefineTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "number" },
        quality: { type: "number" },
      },
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        quality: { type: "number" },
        value: { type: "number" },
      },
      required: ["quality", "value"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: {
    value: number;
    quality?: number;
  }): Promise<{ quality: number; value: number }> {
    const currentQuality = input.quality ?? 0;
    const newQuality = Math.min(1.0, currentQuality + 0.2);
    return {
      quality: newQuality,
      value: input.value + 1,
    };
  }
}

export class AddToSumTask extends Task<
  { accumulator: { sum: number }; currentItem: number; index: number },
  { sum: number }
> {
  static override type = "AddToSumTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        accumulator: {
          type: "object",
          properties: {
            sum: { type: "number" },
          },
        },
        currentItem: { type: "number" },
        index: { type: "number" },
      },
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        sum: { type: "number" },
      },
      required: ["sum"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: {
    accumulator: { sum: number };
    currentItem: number;
  }): Promise<{ sum: number }> {
    return { sum: input.accumulator.sum + input.currentItem };
  }
}

export class BulkProcessTask extends Task<
  { items: readonly number[] },
  { results: readonly number[] }
> {
  static override type = "BulkProcessTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "number" },
        },
      },
      required: ["items"],
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: { type: "number" },
        },
      },
      required: ["results"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { items: readonly number[] }): Promise<{
    results: readonly number[];
  }> {
    return { results: input.items.map((x) => x * 10) };
  }
}

export class TestIteratorTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
> extends IteratorTask<Input, Output> {
  static override type = "TestIteratorTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "number" },
        },
      },
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }
}

export class TestTaskWithDefaults extends Task<
  { value: number; multiplier?: number },
  { result: number }
> {
  static override readonly type = "TestTaskWithDefaults";
  static override readonly category = "Test";
  declare runInputData: { value: number; multiplier?: number };
  declare runOutputData: { result: number };

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "number" },
        multiplier: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: {
    value: number;
    multiplier?: number;
  }): Promise<{ result: number }> {
    const multiplier = input.multiplier ?? 1;
    return { result: input.value * multiplier };
  }
}

export class TestGraphAsTask extends GraphAsTask<{ input: string }, { output: string }> {
  static override readonly type = "TestGraphAsTask";
  static override readonly category = "Test";
  declare runInputData: { input: string };
  declare runOutputData: { output: string };

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: { type: "string" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: { type: "string" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
}

/** Exposes the shared smartClone helper for testing. */
export class TestSmartCloneTask extends Task<{ data: any }, { result: any }> {
  static override readonly type = "TestSmartCloneTask";
  static override readonly category = "Test";
  static override readonly title = "Test Smart Clone Task";
  static override readonly description = "A task for testing smartClone";
  declare runInputData: { data: any };
  declare runOutputData: { result: any };

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        data: {},
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: {},
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { data: any }): Promise<{ result: any }> {
    return { result: input.data };
  }

  /** Expose smartClone for testing */
  public testSmartClone(obj: any): any {
    return smartClone(obj);
  }
}

/**
 * InputTask-like task that passes through its input (from GraphAsTask tests)
 */
export class GraphAsTask_InputTask extends Task<Record<string, unknown>, Record<string, unknown>> {
  static override type = "GraphAsTask_InputTask";
  static override category = "Test";
  static override hasDynamicSchemas = true;
  static override cachePolicy: CachePolicy = { kind: "none" };

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const as DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const as DataPortSchema;
  }

  override async execute(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return input;
  }

  override async executePreview(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return input;
  }
}

export class GraphAsTask_ComputeTask extends Task<{ a: number; b: number }, { result: number }> {
  static override type = "GraphAsTask_ComputeTask";
  static override category = "Test";
  static override cachePolicy: CachePolicy = { kind: "none" };

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
      required: ["a", "b"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { a: number; b: number }): Promise<{ result: number }> {
    return { result: input.a + input.b };
  }

  override async executePreview(input: { a: number; b: number }): Promise<{ result: number }> {
    return { result: input.a + input.b };
  }
}

export class TestGraphAsTask_AB extends GraphAsTask<{ a: number; b: number }, { result: number }> {
  static override type = "TestGraphAsTask_AB";
  static override category = "Test";
  static override hasDynamicSchemas = true;

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public override inputSchema(): DataPortSchema {
    return (this.constructor as typeof TestGraphAsTask_AB).inputSchema();
  }

  public override outputSchema(): DataPortSchema {
    return (this.constructor as typeof TestGraphAsTask_AB).outputSchema();
  }
}

export class TestGraphAsTask_Value extends GraphAsTask<{ value: string }, { value: string }> {
  static override type = "TestGraphAsTask_Value";
  static override category = "Test";
  static override hasDynamicSchemas = true;

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "string" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "string" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public override inputSchema(): DataPortSchema {
    return (this.constructor as typeof TestGraphAsTask_Value).inputSchema();
  }

  public override outputSchema(): DataPortSchema {
    return (this.constructor as typeof TestGraphAsTask_Value).outputSchema();
  }
}

export class GraphAsTask_TaskA extends Task {
  static override type = "GraphAsTask_TaskA";
  static override category = "Test";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        inputA1: {
          type: "string",
          description: "First input to A",
        },
        inputA2: {
          type: "number",
          description: "Second input to A",
          default: 42,
        },
      },
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        outputA: {
          type: "string",
          description: "Output from A",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: any): Promise<any> {
    return {
      outputA: `${input.inputA1}-${input.inputA2}`,
    };
  }
}

export class GraphAsTask_TaskB extends Task {
  static override type = "GraphAsTask_TaskB";
  static override category = "Test";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        inputB: {
          type: "string",
          description: "Input to B",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        outputB: {
          type: "string",
          description: "Output from B",
        },
      },
    } as const satisfies DataPortSchema;
  }

  override async execute(input: any): Promise<any> {
    return {
      outputB: `processed-${input.inputB}`,
    };
  }
}

export class GraphAsTask_TaskC extends Task {
  static override type = "GraphAsTask_TaskC";
  static override category = "Test";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        inputC1: {
          type: "string",
          description: "First input to C",
        },
        inputC2: {
          type: "string",
          description: "Second input to C",
          default: "defaultC2",
        },
      },
      required: ["inputC1"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        outputC1: {
          type: "string",
          description: "First output from C",
        },
        outputC2: {
          type: "number",
          description: "Second output from C",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: any): Promise<any> {
    return {
      outputC1: `${input.inputC1}+${input.inputC2}`,
      outputC2: input.inputC1.length + input.inputC2.length,
    };
  }
}

export class GraphAsTask_OutputTask extends Task<Record<string, unknown>, Record<string, unknown>> {
  static override type = "GraphAsTask_OutputTask";
  static override category = "Test";
  static override cachePolicy: CachePolicy = { kind: "none" };

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const as DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const as DataPortSchema;
  }

  override async execute(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return input;
  }

  override async executePreview(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return input;
  }
}

/**
 * Format semantic test tasks (from TaskGraphFormatSemantic tests)
 * Used for testing model/prompt format compatibility
 */
export class ModelProviderTask extends Task<{ config: string }, { model: string }> {
  static override readonly type = "ModelProviderTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        config: {
          type: "string",
          description: "Configuration string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        model: {
          type: "string",
          format: "model",
          description: "Generic model identifier",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: TaskInput): Promise<any> {
    return { model: "generic-model" };
  }
}

export class EmbeddingModelProviderTask extends Task<{ config: string }, { model: string }> {
  static override readonly type = "EmbeddingModelProviderTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        config: {
          type: "string",
          description: "Configuration string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        model: {
          type: "string",
          format: "model:EmbeddingTask",
          description: "Embedding model identifier",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: TaskInput): Promise<any> {
    return { model: "embedding-model" };
  }
}

export class GenericModelConsumerTask extends Task<{ model: string }, { result: string }> {
  static override readonly type = "GenericModelConsumerTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        model: {
          type: "string",
          format: "model",
          description: "Generic model identifier",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: {
          type: "string",
          description: "Processing result",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: TaskInput): Promise<any> {
    return { result: `processed with ${(input as any).model}` };
  }
}

export class EmbeddingConsumerTask extends Task<{ model: string }, { embeddings: number[] }> {
  static override readonly type = "EmbeddingConsumerTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        model: {
          oneOf: [
            {
              format: "model:EmbeddingTask",
              type: "string",
            },
            {
              type: "array",
              items: {
                format: "model:EmbeddingTask",
                type: "string",
              },
            },
          ],
          title: "Model",
          description: "The embedding model to use",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        embeddings: {
          type: "array",
          items: { type: "number" },
          description: "Generated embeddings",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: TaskInput): Promise<any> {
    return { embeddings: [1, 2, 3] };
  }
}

export class PromptProviderTask extends Task<{ text: string }, { prompt: string }> {
  static override readonly type = "PromptProviderTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Input text",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          format: "prompt",
          description: "Generated prompt",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: TaskInput): Promise<any> {
    return { prompt: "generated prompt" };
  }
}

export class TextGenerationModelProviderTask extends Task<{ config: string }, { model: string }> {
  static override readonly type = "TextGenerationModelProviderTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        config: {
          type: "string",
          description: "Configuration string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        model: {
          type: "string",
          format: "model:TextGenerationTask",
          description: "Text generation model identifier",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: TaskInput): Promise<any> {
    return { model: "text-generation-model" };
  }
}

export class PlainStringProviderTask extends Task<{ input: string }, { output: string }> {
  static override readonly type = "PlainStringProviderTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "Input string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: {
          type: "string",
          description: "Output string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: TaskInput): Promise<any> {
    return { output: "plain string" };
  }
}

export class PlainStringConsumerTask extends Task<{ input: string }, { result: string }> {
  static override readonly type = "PlainStringConsumerTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "Input string",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: {
          type: "string",
          description: "Processing result",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(input: TaskInput): Promise<any> {
    return { result: "processed" };
  }
}

export type PipelineNumberIO = { value: number };

export class PipelineDoubleTask extends Task<PipelineNumberIO, PipelineNumberIO> {
  static override type = "PipelineDoubleTask";
  static override category = "Math";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
    } as const satisfies DataPortSchema;
  }

  override async execute(input: PipelineNumberIO): Promise<PipelineNumberIO> {
    return { value: input.value * 2 };
  }
}

export class AddFiveTask extends Task<PipelineNumberIO, PipelineNumberIO> {
  static override type = "AddFiveTask";
  static override category = "Math";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
    } as const satisfies DataPortSchema;
  }

  override async execute(input: PipelineNumberIO): Promise<PipelineNumberIO> {
    return { value: input.value + 5 };
  }
}

export class PipelineSquareTask extends Task<PipelineNumberIO, PipelineNumberIO> {
  static override type = "PipelineSquareTask";
  static override category = "Math";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
    } as const satisfies DataPortSchema;
  }

  override async execute(input: PipelineNumberIO): Promise<PipelineNumberIO> {
    return { value: input.value * input.value };
  }
}

export class TaskCreatorTask extends Task {
  static override type = "TaskCreatorTask";
  static override category = "Test";

  override async execute(input: TaskInput, context: any): Promise<TaskOutput> {
    const simpleTask = new Task();
    context.own(simpleTask);

    const taskGraph = new TaskGraph();
    taskGraph.addTask(new Task());
    context.own(taskGraph);

    const workflow = new Workflow();
    workflow.graph.addTask(new Task());
    context.own(workflow);

    return {};
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    testSimple(input?: Partial<{ input: string }>, config?: Partial<TaskConfig>): this;
    testOutput(input?: Partial<{ input: string }>, config?: Partial<TaskConfig>): this;
    testInput(input?: Partial<{ customInput: string }>, config?: Partial<TaskConfig>): this;
    failing(input?: Partial<TaskInput>, config?: Partial<TaskConfig>): this;
    longRunning(input?: Partial<TaskInput>, config?: Partial<TaskConfig>): this;
    string(input?: Partial<{ input: string }>, config?: Partial<TaskConfig>): this;
    numberToString(input?: Partial<{ input: number }>, config?: Partial<TaskConfig>): this;
    number(input?: Partial<{ input: number }>, config?: Partial<TaskConfig>): this;
    testAdd(input?: Partial<TestAddTaskInput>, config?: Partial<TaskConfig>): this;
    vectorOutput(input?: Partial<{ text: string }>, config?: Partial<TaskConfig>): this;
    vectorsInput(input?: Partial<{ vectors: Float32Array }>, config?: Partial<TaskConfig>): this;
    vectorOneOfOutput(input?: Partial<{ text: string }>, config?: Partial<TaskConfig>): this;
    vectorAnyOfInput(input?: Partial<{ data: Float32Array }>, config?: Partial<TaskConfig>): this;
    textOutput(input?: Partial<{ input: string }>, config?: Partial<TaskConfig>): this;
    vectorOutputOnly(input?: Partial<{ size: number }>, config?: Partial<TaskConfig>): this;
    textVectorInput(
      input?: Partial<{ text: string; vector: Float32Array }>,
      config?: Partial<TaskConfig>
    ): this;
    passthroughVector(
      input?: Partial<{ vector: Float32Array }>,
      config?: Partial<TaskConfig>
    ): this;
    refine(
      input?: Partial<{ value: number; quality?: number }>,
      config?: Partial<TaskConfig>
    ): this;
    addToSum(
      input?: Partial<{ accumulator: { sum: number }; currentItem: number }>,
      config?: Partial<TaskConfig>
    ): this;
    bulkProcess(input?: Partial<{ items: readonly number[] }>, config?: Partial<TaskConfig>): this;
    testIterator(input?: Partial<{ items: number[] }>, config?: Partial<TaskConfig>): this;
    processItem(input?: Partial<{ item: number }>, config?: Partial<TaskConfig>): this;
    wildcardPassthrough(
      input?: Partial<Record<string, unknown>>,
      config?: Partial<TaskConfig>
    ): this;
  }
}

Workflow.prototype.testSimple = CreateWorkflow(TestSimpleTask);
Workflow.prototype.testOutput = CreateWorkflow(TestOutputTask);
Workflow.prototype.testInput = CreateWorkflow(TestInputTask);
Workflow.prototype.failing = CreateWorkflow(FailingTask);
Workflow.prototype.longRunning = CreateWorkflow(LongRunningTask);
Workflow.prototype.string = CreateWorkflow(StringTask);
Workflow.prototype.numberToString = CreateWorkflow(NumberToStringTask);
Workflow.prototype.number = CreateWorkflow(NumberTask);
Workflow.prototype.testAdd = CreateWorkflow(TestAddTask);
Workflow.prototype.vectorOutput = CreateWorkflow(VectorOutputTask);
Workflow.prototype.vectorsInput = CreateWorkflow(VectorsInputTask);
Workflow.prototype.vectorOneOfOutput = CreateWorkflow(VectorOneOfOutputTask);
Workflow.prototype.vectorAnyOfInput = CreateWorkflow(VectorAnyOfInputTask);
Workflow.prototype.textOutput = CreateWorkflow(TextOutputTask);
Workflow.prototype.vectorOutputOnly = CreateWorkflow(VectorOutputOnlyTask);
Workflow.prototype.textVectorInput = CreateWorkflow(TextVectorInputTask);
Workflow.prototype.passthroughVector = CreateWorkflow(PassthroughVectorTask);
Workflow.prototype.refine = CreateWorkflow(RefineTask);
Workflow.prototype.addToSum = CreateWorkflow(AddToSumTask);
Workflow.prototype.bulkProcess = CreateWorkflow(BulkProcessTask);
Workflow.prototype.testIterator = CreateWorkflow(TestIteratorTask);
Workflow.prototype.processItem = CreateWorkflow(ProcessItemTask);
Workflow.prototype.wildcardPassthrough = CreateWorkflow(WildcardPassthroughTask);
