/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiEmit,
  AiJobInput,
  AiProviderLegacyStreamFnRegistration,
  AiProviderStreamFn,
  Capability,
  IAiExecutionStrategy,
  ModelConfig,
  ModelRecord,
} from "@workglow/ai";
import {
  AiProvider,
  AiProviderRegistry,
  AiTask,
  getAiProviderRegistry,
  setAiProviderRegistry,
} from "@workglow/ai";
import type { IExecuteContext, StreamEvent, TaskInput, TaskOutput } from "@workglow/task-graph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeStreamFn(label: string): AiProviderStreamFn {
  return async function* () {
    yield { type: "finish", data: { label } as unknown as TaskOutput } as StreamEvent<TaskOutput>;
  };
}

function makeRegistration(
  serves: readonly Capability[],
  label: string
): AiProviderLegacyStreamFnRegistration {
  return { serves, runFn: makeStreamFn(label) };
}

class TestProvider extends AiProvider {
  readonly name: string;
  readonly displayName = "Test Provider";
  readonly isLocal = false;
  readonly supportsBrowser = true;

  constructor(name: string, runFns: readonly AiProviderLegacyStreamFnRegistration[]) {
    super(runFns);
    this.name = name;
  }
}

// Strategy that resolves the registered run-fn via the registry and forwards
// emitted events to the supplied `emit`. Used by the strict-gating test.
// Run-fns wrapped through `registerLegacyStreamFn` already emit a `finish`
// event when their async generator yields one, so the terminal accumulator on
// the AiTask side materialises the output.
class CollectingStrategy implements IAiExecutionStrategy {
  constructor(private readonly registry: AiProviderRegistry) {}

  async execute(
    jobInput: AiJobInput<TaskInput>,
    context: IExecuteContext,
    _runnerId: string | undefined,
    emit: AiEmit<TaskOutput>
  ): Promise<void> {
    const fn = this.registry.getRunFnFor(jobInput.aiProvider, jobInput.requires);
    if (!fn) throw new Error("no runFn");
    await fn(jobInput.taskInput, jobInput.taskInput.model, context.signal, emit);
  }

  abort(): void {}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AiProviderRegistry — capability dispatch", () => {
  let registry: AiProviderRegistry;

  beforeEach(() => {
    registry = new AiProviderRegistry();
  });

  // 4. getRunFnFor returns undefined for unknown provider, and unknown capability.
  it("returns undefined for an unknown provider", () => {
    expect(registry.getRunFnFor("UNKNOWN", ["text.generation"])).toBeUndefined();
  });

  it("returns undefined when no registration matches the requires set", () => {
    registry.registerLegacyStreamFn("PROVIDER_A", makeRegistration(["text.embedding"], "embed"));
    expect(registry.getRunFnFor("PROVIDER_A", ["text.generation"])).toBeUndefined();
  });

  // 2. Tiebreak by serves size — smallest serves wins.
  it("picks the smallest matching `serves` (most-specific superset)", async () => {
    registry.registerLegacyStreamFn(
      "PROVIDER_A",
      makeRegistration(["text.generation", "tool-use"], "with-tools")
    );
    registry.registerLegacyStreamFn("PROVIDER_A", makeRegistration(["text.generation"], "plain"));
    const fn = registry.getRunFnFor("PROVIDER_A", ["text.generation"]);
    expect(fn).toBeDefined();
    let label = "";
    const emit = (evt: StreamEvent<TaskOutput>): void => {
      if (evt.type === "finish") {
        label = (evt.data as { label: string }).label;
      }
    };
    await fn!({} as TaskInput, undefined, AbortSignal.any([]), emit);
    expect(label).toBe("plain");
  });

  // 3. Size-tie falls back to registration order.
  it("breaks size ties by registration order (first-registered wins)", async () => {
    registry.registerLegacyStreamFn("PROVIDER_A", makeRegistration(["text.generation"], "first"));
    registry.registerLegacyStreamFn("PROVIDER_A", makeRegistration(["text.embedding"], "second"));
    const fn = registry.getRunFnFor("PROVIDER_A", []);
    expect(fn).toBeDefined();
    let label = "";
    const emit = (evt: StreamEvent<TaskOutput>): void => {
      if (evt.type === "finish") {
        label = (evt.data as { label: string }).label;
      }
    };
    await fn!({} as TaskInput, undefined, AbortSignal.any([]), emit);
    expect(label).toBe("first");
  });

  // 5. Empty requires matches the smallest serves available (vacuous-pass).
  it("empty requires matches the smallest available `serves` (vacuous superset)", async () => {
    registry.registerLegacyStreamFn(
      "PROVIDER_A",
      makeRegistration(["text.generation", "tool-use", "json-mode"], "huge")
    );
    registry.registerLegacyStreamFn("PROVIDER_A", makeRegistration(["text.generation"], "small"));
    const fn = registry.getRunFnFor("PROVIDER_A", []);
    expect(fn).toBeDefined();
    let label = "";
    const emit = (evt: StreamEvent<TaskOutput>): void => {
      if (evt.type === "finish") {
        label = (evt.data as { label: string }).label;
      }
    };
    await fn!({} as TaskInput, undefined, AbortSignal.any([]), emit);
    expect(label).toBe("small");
  });

  // 6. AiProvider constructor with runFns registers each entry under provider name.
  it("AiProvider.register() adds every runFn entry to the provider's registration list", async () => {
    // Use the global registry the provider talks to via getAiProviderRegistry().
    // We snapshot the relevant slice rather than fight DI here.
    const provider = new TestProvider("TEST_PROVIDER_ENTRY", [
      makeRegistration(["text.generation"], "a"),
      makeRegistration(["text.embedding"], "b"),
    ]);
    await provider.register();

    // After register(), the global registry holds both entries.
    const { getAiProviderRegistry } = await import("@workglow/ai");
    const globalRegistry = getAiProviderRegistry();
    const regs = globalRegistry.getRunFnRegistrations("TEST_PROVIDER_ENTRY");
    expect(regs).toHaveLength(2);
    expect(regs[0].serves).toEqual(["text.generation"]);
    expect(regs[1].serves).toEqual(["text.embedding"]);

    globalRegistry.unregisterProvider("TEST_PROVIDER_ENTRY");
  });

  // 7. inferCapabilities default returns model.capabilities ?? [].
  it("AiProvider.inferCapabilities returns model.capabilities (or [])", () => {
    const provider = new TestProvider("INFER_CAPS_TEST", []);
    const withCaps = {
      capabilities: ["text.generation", "tool-use"],
    } as unknown as ModelRecord;
    expect(provider.inferCapabilities(withCaps)).toEqual(["text.generation", "tool-use"]);
    const withoutCaps = {} as unknown as ModelRecord;
    expect(provider.inferCapabilities(withoutCaps)).toEqual([]);
  });

  // 8. The old API is genuinely gone.
  it("the removed registry methods are no longer present", () => {
    expect((registry as unknown as Record<string, unknown>).getDirectRunFn).toBeUndefined();
    expect((registry as unknown as Record<string, unknown>).getStreamFn).toBeUndefined();
    expect((registry as unknown as Record<string, unknown>).registerStreamFn).toBeUndefined();
    expect(
      (registry as unknown as Record<string, unknown>).registerAsWorkerStreamFn
    ).toBeUndefined();
    expect((registry as unknown as Record<string, unknown>).getProviderIdsForTask).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Strict gating in AiTask.execute
// ---------------------------------------------------------------------------

describe("AiTask strict capability gating", () => {
  const taskInputSchema = {
    type: "object",
    properties: {
      model: { type: "object", format: "model" },
    },
    required: ["model"],
    additionalProperties: false,
  } as const;

  // 1. Strict gating throws when model.capabilities is missing a required one.
  it("throws when model.capabilities is missing a capability the task requires", async () => {
    class GatedTask extends AiTask {
      static override readonly type = "GatedTestTask";
      static override readonly requires = [
        "text.generation",
      ] as const satisfies readonly Capability[];
      static override inputSchema() {
        return taskInputSchema;
      }
    }

    const task = new GatedTask({
      defaults: {
        model: {
          provider: "DOES_NOT_MATTER",
          provider_config: {},
          capabilities: ["text.embedding"], // missing text.generation
          model_id: "test-model",
        } as ModelConfig,
      },
    });

    await expect(task.run()).rejects.toThrow(/missing capabilities[^:]*: text\.generation/);
  });

  // Bonus: passes gating when capabilities cover requires.
  describe("passes the gate when model.capabilities ⊇ task.requires", () => {
    // Use a fresh, isolated registry so setDefaultStrategy doesn't pollute
    // subsequent tests in the same Vitest worker.
    let isolatedReg: AiProviderRegistry;
    let originalReg: AiProviderRegistry;

    beforeEach(() => {
      originalReg = getAiProviderRegistry();
      isolatedReg = new AiProviderRegistry();
      setAiProviderRegistry(isolatedReg);
    });

    afterEach(() => {
      setAiProviderRegistry(originalReg);
    });

    it("runs to completion via CollectingStrategy", async () => {
      // Not asserting end-to-end execution here (which needs a real provider);
      // we register a stream fn on a temp provider so the strategy can run
      // it through to completion without the missing-capability throw.
      const providerName = "GATING_PASS_PROVIDER";

      class PassingTask extends AiTask {
        static override readonly type = "PassingTestTask";
        static override readonly requires = [
          "text.embedding",
        ] as const satisfies readonly Capability[];
        static override inputSchema() {
          return taskInputSchema;
        }
      }

      isolatedReg.registerLegacyStreamFn(providerName, {
        serves: ["text.embedding"],
        runFn: async function* () {
          yield {
            type: "finish",
            data: { ok: true } as unknown as TaskOutput,
          } as StreamEvent<TaskOutput>;
        },
      });

      // Inject a strategy that will resolve through the registry rather than
      // hitting the JobQueue infrastructure for this isolated test.
      isolatedReg.setDefaultStrategy(new CollectingStrategy(isolatedReg));

      const task = new PassingTask({
        defaults: {
          model: {
            provider: providerName,
            provider_config: {},
            capabilities: ["text.embedding"],
            model_id: "test-model",
          } as ModelConfig,
        },
      });

      const out = await task.run();
      expect(out).toEqual({ ok: true });
    });
  });
});
