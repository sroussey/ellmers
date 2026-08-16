/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderRunFnRegistration,
  Capability,
  ModelConfig,
} from "@workglow/ai";
import {
  AiProvider,
  getAiProviderRegistry,
  registerAiTasks,
  StructuredGenerationTask,
  StructuredOutputValidationError,
} from "@workglow/ai";
import type { IExecuteContext, Usage } from "@workglow/task-graph";
import { TaskConfigurationError, TaskRegistry } from "@workglow/task-graph";
import type { ILogger } from "@workglow/util";
import { getLogger, setLogger } from "@workglow/util";
import { describe, expect, it } from "vitest";

// ============================================================================
// Fixtures
// ============================================================================

const JSON_MODE = ["text.generation", "json-mode"] as const satisfies Capability[];

function mkContext(): IExecuteContext {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    updateProgress: async () => {},
    own: <T>(i: T) => i,
    disown: () => {},
    registry: {
      has: () => false,
      get: () => {
        throw new Error("not registered");
      },
    } as any,
    resourceScope: {
      register: (_key: string, _fn: () => Promise<void>) => {},
      dispose: async () => {},
    } as any,
  } as IExecuteContext;
}

function mkModel(): ModelConfig {
  return {
    provider: "fake-structured",
    model: "fake-model",
    capabilities: JSON_MODE,
    provider_config: {},
  } as ModelConfig;
}

class FakeStructuredProvider extends AiProvider {
  override readonly name = "fake-structured";
  override readonly displayName = "Fake Structured";
  override readonly isLocal = true;
  override readonly supportsBrowser = false;
  override readonly supportsServer = true;

  constructor(runFns?: readonly AiProviderRunFnRegistration<any, any, ModelConfig>[]) {
    super(runFns);
  }
}

/**
 * Registers a fake provider that, per attempt, yields a partial object-delta
 * with the scripted payload and a finish event whose `data.object` carries the
 * full parsed payload (per the json-mode finish convention). `attempts` is an
 * ordered list of payloads — one per invocation.
 */
function registerFakeStructuredProvider(attempts: ReadonlyArray<Record<string, unknown>>): {
  calls: ReadonlyArray<string>;
  unregister: () => void;
} {
  const calls: string[] = [];
  let index = 0;
  const stream: AiProviderRunFn<any, any, ModelConfig> = async (input, _model, _signal, emit) => {
    calls.push(input.prompt as string);
    const payload = attempts[Math.min(index, attempts.length - 1)];
    index++;
    emit({ type: "object-delta", port: "object", objectDelta: payload });
    emit({ type: "finish", data: { object: payload } as any });
  };

  const registry = getAiProviderRegistry();
  const provider = new FakeStructuredProvider([{ serves: JSON_MODE, runFn: stream }]);
  registry.registerProvider(provider);
  registry.registerRunFn("fake-structured", { serves: JSON_MODE, runFn: stream });
  return { calls, unregister: () => registry.unregisterProvider("fake-structured") };
}

const PERSON_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "integer", minimum: 0 },
  },
  required: ["name", "age"],
  additionalProperties: false,
} as const;

async function drain<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

// ============================================================================
// Static + registration
// ============================================================================

describe("StructuredGenerationTask — schema and registration", () => {
  it("declares maxRetries input with default 2", () => {
    const schema = StructuredGenerationTask.inputSchema() as any;
    expect(schema.properties.maxRetries).toBeDefined();
    expect(schema.properties.maxRetries.default).toBe(2);
  });

  it("registers via registerAiTasks()", () => {
    registerAiTasks();
    expect(TaskRegistry.all.get("StructuredGenerationTask")).toBe(StructuredGenerationTask);
  });
});

// ============================================================================
// Validation (no retry)
// ============================================================================

describe("StructuredGenerationTask — validation", () => {
  it("returns the object unchanged when it matches the schema", async () => {
    const good = { name: "Alice", age: 30 };
    const { unregister } = registerFakeStructuredProvider([good]);
    try {
      const input = {
        model: mkModel(),
        prompt: "Give me a person",
        outputSchema: PERSON_SCHEMA,
        maxRetries: 0,
      };
      const task = new StructuredGenerationTask({ defaults: input } as any);
      const result = await task.execute(input as any, mkContext());
      expect(result).toEqual({ object: good });
    } finally {
      unregister();
    }
  });

  it("throws StructuredOutputValidationError on type mismatch with maxRetries=0", async () => {
    const bad = { name: "Alice", age: "thirty" }; // age wrong type
    const { unregister } = registerFakeStructuredProvider([bad]);
    try {
      const input = {
        model: mkModel(),
        prompt: "Give me a person",
        outputSchema: PERSON_SCHEMA,
        maxRetries: 0,
      };
      const task = new StructuredGenerationTask({ defaults: input } as any);
      await expect(drain(task.executeStream(input as any, mkContext()))).rejects.toBeInstanceOf(
        StructuredOutputValidationError
      );
    } finally {
      unregister();
    }
  });

  it("flags missing required properties", async () => {
    const bad = { name: "Alice" }; // missing age
    const { unregister } = registerFakeStructuredProvider([bad]);
    try {
      const input = {
        model: mkModel(),
        prompt: "Give me a person",
        outputSchema: PERSON_SCHEMA,
        maxRetries: 0,
      };
      const task = new StructuredGenerationTask({ defaults: input } as any);
      let caught: unknown;
      try {
        await drain(task.executeStream(input as any, mkContext()));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StructuredOutputValidationError);
      const err = caught as StructuredOutputValidationError;
      expect(err.attempts).toHaveLength(1);
      const errorMessages = err.attempts[0].errors.map((e) => e.message).join(" | ");
      expect(errorMessages.toLowerCase()).toContain("required");
    } finally {
      unregister();
    }
  });
});

// ============================================================================
// Retry with feedback
// ============================================================================

describe("StructuredGenerationTask — retry", () => {
  it("retries on validation failure and succeeds on a later attempt", async () => {
    const bad = { name: "Alice", age: "thirty" };
    const good = { name: "Alice", age: 30 };
    const { calls, unregister } = registerFakeStructuredProvider([bad, good]);
    try {
      const input = {
        model: mkModel(),
        prompt: "Give me a person",
        outputSchema: PERSON_SCHEMA,
        maxRetries: 2,
      };
      const task = new StructuredGenerationTask({ defaults: input } as any);
      const result = await task.execute(input as any, mkContext());
      expect(result).toEqual({ object: good });
      expect(calls.length).toBe(2);
      expect(calls[0]).toBe("Give me a person");
      // Retry prompt should contain the original prompt plus feedback
      expect(calls[1]).toContain("Give me a person");
      expect(calls[1].toLowerCase()).toContain("validation");
    } finally {
      unregister();
    }
  });

  it("emits an empty object-delta between attempts to reset accumulators", async () => {
    const bad = { name: "Alice", age: "thirty" };
    const good = { name: "Alice", age: 30 };
    const { unregister } = registerFakeStructuredProvider([bad, good]);
    try {
      const input = {
        model: mkModel(),
        prompt: "Give me a person",
        outputSchema: PERSON_SCHEMA,
        maxRetries: 2,
      };
      const task = new StructuredGenerationTask({ defaults: input } as any);
      const events = await drain(task.executeStream(input as any, mkContext()));

      // Between the first attempt's (invalid) object-delta and the second
      // attempt's object-delta, there should be a reset {} delta.
      const deltas = events.filter(
        (e) => e.type === "object-delta" && (e as any).port === "object"
      ) as Array<{ objectDelta: Record<string, unknown> }>;
      expect(deltas.length).toBeGreaterThanOrEqual(3);
      // First: the bad output. Second: the reset. Third: the good output.
      expect(deltas[1].objectDelta).toEqual({});
    } finally {
      unregister();
    }
  });

  it("throws with all attempt errors when retries are exhausted", async () => {
    const bad1 = { name: "Alice", age: "thirty" };
    const bad2 = { name: "Alice", age: "fifty" };
    const bad3 = { name: "Alice", age: "eighty" };
    const { calls, unregister } = registerFakeStructuredProvider([bad1, bad2, bad3]);
    try {
      const input = {
        model: mkModel(),
        prompt: "Give me a person",
        outputSchema: PERSON_SCHEMA,
        maxRetries: 2, // 3 total attempts
      };
      const task = new StructuredGenerationTask({ defaults: input } as any);
      let caught: unknown;
      try {
        await drain(task.executeStream(input as any, mkContext()));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StructuredOutputValidationError);
      const err = caught as StructuredOutputValidationError;
      expect(err.attempts).toHaveLength(3);
      expect(calls.length).toBe(3);
    } finally {
      unregister();
    }
  });

  it("honors maxRetries=0 (no retries)", async () => {
    const bad = { name: "Alice", age: "thirty" };
    const { calls, unregister } = registerFakeStructuredProvider([bad, bad, bad]);
    try {
      const input = {
        model: mkModel(),
        prompt: "Give me a person",
        outputSchema: PERSON_SCHEMA,
        maxRetries: 0,
      };
      const task = new StructuredGenerationTask({ defaults: input } as any);
      await expect(drain(task.executeStream(input as any, mkContext()))).rejects.toBeInstanceOf(
        StructuredOutputValidationError
      );
      expect(calls.length).toBe(1);
    } finally {
      unregister();
    }
  });

  it("defaults maxRetries to 2 when the field is omitted", async () => {
    const bad = { name: "Alice", age: "thirty" };
    const { calls, unregister } = registerFakeStructuredProvider([bad, bad, bad]);
    try {
      const input = {
        model: mkModel(),
        prompt: "Give me a person",
        outputSchema: PERSON_SCHEMA,
      };
      const task = new StructuredGenerationTask({ defaults: input } as any);
      await expect(drain(task.executeStream(input as any, mkContext()))).rejects.toBeInstanceOf(
        StructuredOutputValidationError
      );
      // Default maxRetries=2 → 3 total attempts.
      expect(calls.length).toBe(3);
    } finally {
      unregister();
    }
  });
});

// ============================================================================
// Schema-of-schema check
// ============================================================================

describe("StructuredGenerationTask — schema compile errors", () => {
  it("fails fast with a TaskConfigurationError when outputSchema is null", async () => {
    // No provider registration — the compile error should hit before the
    // provider is ever called. compileSchema() is lenient with most "bad"
    // schemas (unknown types, broken $refs) but null is a genuine failure.
    const input = {
      model: mkModel(),
      prompt: "Give me something",
      outputSchema: null as unknown as Record<string, unknown>,
      maxRetries: 0,
    };
    const task = new StructuredGenerationTask({ defaults: input });
    let caught: unknown;
    try {
      await drain(task.executeStream(input, mkContext()));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TaskConfigurationError);
    expect((caught as TaskConfigurationError).message.toLowerCase()).toContain(
      "invalid outputschema"
    );
  });
});

// ============================================================================
// Usage aggregation across validation retries
// ============================================================================

describe("StructuredGenerationTask — usage aggregation", () => {
  function mkUsage(partial: Partial<Usage>): Usage {
    return {
      input: undefined,
      output: undefined,
      cached: undefined,
      cacheWrite: undefined,
      reasoning: undefined,
      total: undefined,
      extra: undefined,
      ...partial,
    };
  }

  /**
   * Like {@link registerFakeStructuredProvider}, but each scripted attempt also
   * carries its own token counts on the finish event.
   */
  function registerUsageProvider(
    attempts: ReadonlyArray<{ payload: Record<string, unknown>; usage: Usage | undefined }>
  ): { unregister: () => void } {
    let index = 0;
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      _input,
      _model,
      _signal,
      emit
    ) => {
      const attempt = attempts[Math.min(index, attempts.length - 1)];
      index++;
      emit({ type: "object-delta", port: "object", objectDelta: attempt.payload });
      emit({
        type: "finish",
        data: { object: attempt.payload } as any,
        ...(attempt.usage ? { usage: attempt.usage } : {}),
      } as any);
    };
    const registry = getAiProviderRegistry();
    registry.registerProvider(new FakeStructuredProvider([{ serves: JSON_MODE, runFn: stream }]));
    registry.registerRunFn("fake-structured", { serves: JSON_MODE, runFn: stream });
    return { unregister: () => registry.unregisterProvider("fake-structured") };
  }

  it("records usage telemetry even though the retry loop closes the stream early", async () => {
    // `StructuredGenerationTask` returns the moment it sees a valid `finish`,
    // which closes the base class's generator at its `yield`. A telemetry call
    // sited after that loop would never run, so the task that bills the most
    // tokens would be the one reporting none.
    const { unregister } = registerUsageProvider([
      { payload: { name: "Alice", age: 30 }, usage: mkUsage({ input: 90, output: 12 }) },
    ]);
    const recorded: Array<Record<string, unknown> | undefined> = [];
    const previous = getLogger();
    setLogger({
      ...previous,
      debug: (message: string, meta?: Record<string, unknown>) => {
        if (message.startsWith("AI usage for")) recorded.push(meta);
      },
    } as ILogger);
    try {
      const input = {
        model: mkModel(),
        prompt: "Give me a person",
        outputSchema: PERSON_SCHEMA,
        maxRetries: 0,
      };
      const task = new StructuredGenerationTask({ defaults: input } as any);
      await task.execute(input as any, mkContext());
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.usage).toEqual(mkUsage({ input: 90, output: 12 }));
    } finally {
      setLogger(previous);
      unregister();
    }
  });

  it("sums usage across a failed attempt and the retry that succeeds", async () => {
    // A rejected attempt is still billed — the run costs both requests.
    const { unregister } = registerUsageProvider([
      { payload: { name: "Alice", age: "thirty" }, usage: mkUsage({ input: 50, output: 8 }) },
      { payload: { name: "Alice", age: 30 }, usage: mkUsage({ input: 90, output: 12 }) },
    ]);
    try {
      const input = {
        model: mkModel(),
        prompt: "Give me a person",
        outputSchema: PERSON_SCHEMA,
        maxRetries: 2,
      };
      const task = new StructuredGenerationTask({ defaults: input } as any);
      const events = await drain(task.executeStream(input as any, mkContext()));

      const finishes = events.filter((e) => e.type === "finish") as Array<{
        data: { object: Record<string, unknown> };
        usage?: Usage;
      }>;
      // Only the successful attempt yields a finish to the consumer.
      expect(finishes).toHaveLength(1);
      expect(finishes[0].data.object).toEqual({ name: "Alice", age: 30 });
      expect(finishes[0].usage).toEqual(mkUsage({ input: 140, output: 20 }));
    } finally {
      unregister();
    }
  });

  it("does not double-count a single successful attempt", async () => {
    const { unregister } = registerUsageProvider([
      { payload: { name: "Alice", age: 30 }, usage: mkUsage({ input: 90, output: 12 }) },
    ]);
    try {
      const input = {
        model: mkModel(),
        prompt: "Give me a person",
        outputSchema: PERSON_SCHEMA,
        maxRetries: 2,
      };
      const task = new StructuredGenerationTask({ defaults: input } as any);
      const events = await drain(task.executeStream(input as any, mkContext()));
      const finish = events.find((e) => e.type === "finish") as { usage?: Usage };
      expect(finish.usage).toEqual(mkUsage({ input: 90, output: 12 }));
    } finally {
      unregister();
    }
  });

  it("folds retry-summed usage onto the execute() output next to the object", async () => {
    // The output schema declares `additionalProperties: false` and requires
    // `object`; `usage` is a reserved field, so it rides along without tripping
    // validation and without displacing the structured payload.
    const { unregister } = registerUsageProvider([
      { payload: { name: "Alice", age: "thirty" }, usage: mkUsage({ input: 50, output: 8 }) },
      { payload: { name: "Alice", age: 30 }, usage: mkUsage({ input: 90, output: 12 }) },
    ]);
    try {
      const input = {
        model: mkModel(),
        prompt: "Give me a person",
        outputSchema: PERSON_SCHEMA,
        maxRetries: 2,
      };
      const task = new StructuredGenerationTask({ defaults: input } as any);
      const result = (await task.execute(input as any, mkContext())) as {
        object: Record<string, unknown>;
        usage?: Usage;
      };
      expect(result.object).toEqual({ name: "Alice", age: 30 });
      expect(result.usage).toEqual(mkUsage({ input: 140, output: 20 }));
    } finally {
      unregister();
    }
  });

  it("reports the tokens every failed attempt billed on the thrown error", async () => {
    // The all-attempts-failed path is the most expensive outcome the task has:
    // three billed requests and no result. Reporting nothing for it would make
    // a schema-flaky model look cheaper than one that answers correctly.
    const { unregister } = registerUsageProvider([
      { payload: { name: "Alice", age: "thirty" }, usage: mkUsage({ input: 50, output: 8 }) },
      { payload: { name: "Alice", age: "forty" }, usage: mkUsage({ input: 60, output: 9 }) },
      { payload: { name: "Alice", age: "fifty" }, usage: mkUsage({ input: 70, output: 10 }) },
    ]);
    try {
      const input = {
        model: mkModel(),
        prompt: "Give me a person",
        outputSchema: PERSON_SCHEMA,
        maxRetries: 2, // 3 total attempts, all failing
      };
      const task = new StructuredGenerationTask({ defaults: input } as any);
      let caught: unknown;
      try {
        await drain(task.executeStream(input as any, mkContext()));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StructuredOutputValidationError);
      const err = caught as StructuredOutputValidationError;
      expect(err.attempts).toHaveLength(3);
      expect(err.usage).toEqual(mkUsage({ input: 180, output: 27 }));
    } finally {
      unregister();
    }
  });

  it("emits the failed run's total as a usage snapshot before throwing", async () => {
    // No `finish` reaches the consumer on this path, so the snapshot is the
    // only thing that puts the spend in front of the run's usage sinks.
    const { unregister } = registerUsageProvider([
      { payload: { name: "Alice", age: "thirty" }, usage: mkUsage({ input: 50, output: 8 }) },
      { payload: { name: "Alice", age: "forty" }, usage: mkUsage({ input: 60, output: 9 }) },
    ]);
    try {
      const input = {
        model: mkModel(),
        prompt: "Give me a person",
        outputSchema: PERSON_SCHEMA,
        maxRetries: 1, // 2 total attempts, both failing
      };
      const task = new StructuredGenerationTask({ defaults: input } as any);
      const seen: Array<{ type: string; usage?: Usage }> = [];
      await expect(
        (async () => {
          for await (const event of task.executeStream(input as any, mkContext())) {
            seen.push(event as { type: string; usage?: Usage });
          }
        })()
      ).rejects.toBeInstanceOf(StructuredOutputValidationError);

      expect(seen.some((e) => e.type === "finish")).toBe(false);
      const snapshots = seen.filter((e) => e.type === "usage");
      expect(snapshots).toHaveLength(1);
      // Cumulative, not per-attempt: the consumer replaces on each snapshot.
      expect(snapshots[0].usage).toEqual(mkUsage({ input: 110, output: 17 }));
      expect(seen[seen.length - 1]).toBe(snapshots[0]);
    } finally {
      unregister();
    }
  });

  it("emits no usage snapshot when a failed run reported no tokens", async () => {
    // `undefined` means "not reported" — a zeroed snapshot would state that the
    // failed attempts were free.
    const { unregister } = registerUsageProvider([
      { payload: { name: "Alice", age: "thirty" }, usage: undefined },
    ]);
    try {
      const input = {
        model: mkModel(),
        prompt: "Give me a person",
        outputSchema: PERSON_SCHEMA,
        maxRetries: 0,
      };
      const task = new StructuredGenerationTask({ defaults: input } as any);
      const seen: Array<{ type: string }> = [];
      let caught: unknown;
      try {
        for await (const event of task.executeStream(input as any, mkContext())) {
          seen.push(event as { type: string });
        }
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StructuredOutputValidationError);
      expect((caught as StructuredOutputValidationError).usage).toBeUndefined();
      expect(seen.some((e) => e.type === "usage")).toBe(false);
    } finally {
      unregister();
    }
  });

  it("leaves no usage key when the provider reported none", async () => {
    const { unregister } = registerUsageProvider([
      { payload: { name: "Alice", age: 30 }, usage: undefined },
    ]);
    try {
      const input = {
        model: mkModel(),
        prompt: "Give me a person",
        outputSchema: PERSON_SCHEMA,
        maxRetries: 0,
      };
      const task = new StructuredGenerationTask({ defaults: input } as any);
      const result = await task.execute(input as any, mkContext());
      expect(result).toEqual({ object: { name: "Alice", age: 30 } });
      expect("usage" in (result as object)).toBe(false);
    } finally {
      unregister();
    }
  });
});
