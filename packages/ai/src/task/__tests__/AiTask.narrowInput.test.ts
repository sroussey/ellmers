/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRepository } from "@workglow/ai";
import { AiTask, InMemoryModelRepository, MODEL_REPOSITORY } from "@workglow/ai";
import type { TaskInput, TaskOutput } from "@workglow/task-graph";
import { ServiceRegistry } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

interface NarrowTestInput extends TaskInput {
  readonly model: string;
  readonly keep: string;
}

interface NarrowTestOutput extends TaskOutput {
  readonly out: string;
}

class NarrowTestTask extends AiTask<NarrowTestInput, NarrowTestOutput> {
  static override readonly type = "NarrowInputTestTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        model: { type: "string", format: "model:NarrowInputTestTask" },
        keep: { type: "string" },
      },
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        out: { type: "string" },
      },
    } as const satisfies DataPortSchema;
  }
}

async function createRegistry(): Promise<ServiceRegistry> {
  const registry = new ServiceRegistry();
  const modelRepo: ModelRepository = new InMemoryModelRepository();
  registry.registerInstance(MODEL_REPOSITORY, modelRepo);
  return registry;
}

describe("AiTask.narrowInput — does not mutate the input argument", () => {
  it("drops an unresolvable model on the returned copy while leaving the argument untouched", async () => {
    const registry = await createRegistry();
    const task = new NarrowTestTask();

    const input: NarrowTestInput = { model: "does-not-exist", keep: "value" };
    const snapshot = structuredClone(input);

    const narrowed = await task.narrowInput(input, registry);

    // (a) the returned object has the model key narrowed to undefined
    expect(narrowed.model).toBeUndefined();
    expect(narrowed.keep).toBe("value");

    // (b) the original input object is unchanged and is a different reference
    expect(input).toEqual(snapshot);
    expect(input.model).toBe("does-not-exist");
    expect(narrowed).not.toBe(input);
  });

  it("returns a fresh object even when nothing is narrowed", async () => {
    const registry = await createRegistry();
    const modelRepo = registry.get<ModelRepository>(MODEL_REPOSITORY);
    await modelRepo.addModel({
      model_id: "resolvable",
      capabilities: [],
      provider: "fake",
      title: "Resolvable",
      description: "Resolvable",
      provider_config: {},
      metadata: {},
    });
    const task = new NarrowTestTask();

    const input: NarrowTestInput = { model: "resolvable", keep: "value" };

    const narrowed = await task.narrowInput(input, registry);

    expect(narrowed.model).toBe("resolvable");
    expect(narrowed.keep).toBe("value");
    expect(narrowed).not.toBe(input);
  });
});
