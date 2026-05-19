/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { TaskInput, TaskOutput } from "@workglow/task-graph";
import { Task, TaskOutputRepository, registerPortCodec } from "@workglow/task-graph";
import type { ImageValue } from "@workglow/util/media";
import { describe, expect, test, vi } from "vitest";

class SpyRepo extends TaskOutputRepository {
  private readonly map = new Map<string, unknown>();
  readonly saved: unknown[] = [];
  constructor() {
    super({ outputCompression: false });
  }
  async saveOutput(_t: string, inputs: TaskInput, output: TaskOutput): Promise<void> {
    this.saved.push(output);
    this.map.set(JSON.stringify(inputs), output);
  }
  async getOutput(_t: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    return this.map.get(JSON.stringify(inputs)) as TaskOutput | undefined;
  }
  async clear(): Promise<void> {
    this.map.clear();
  }
  async size(): Promise<number> {
    return this.map.size;
  }
  async clearOlderThan(_ms: number): Promise<void> {}

  isDurable(): boolean {
    return false;
  }
}

describe("TaskRunner cache port serialization", () => {
  test("output ports declaring a registered format are serialized before saveOutput", async () => {
    const serialize = vi.fn(async (v: unknown) => ({ wire: v }));
    const deserialize = vi.fn(async (v: unknown) => (v as { wire: unknown }).wire);
    registerPortCodec("test-port-output", { serialize, deserialize });

    class MyTask extends Task<
      Record<string, unknown>,
      { thing: { live: number } } & Record<string, unknown>
    > {
      static override readonly type = "MyTask";
      static override outputSchema() {
        return {
          type: "object",
          properties: { thing: { type: "object", format: "test-port-output", properties: {} } },
        } as never;
      }
      override async execute() {
        return { thing: { live: 42 } } as never;
      }
    }

    const repo = new SpyRepo();
    const t = new MyTask();
    await t.run({}, { outputCache: repo });
    expect(serialize).toHaveBeenCalledWith({ live: 42 });
    expect(repo.saved[0]).toEqual({ thing: { wire: { live: 42 } } });
  });

  test("cached outputs are deserialized after getOutput", async () => {
    registerPortCodec("test-port-cache", {
      serialize: async (v: unknown) => ({ wire: v }),
      deserialize: async (v: unknown) => (v as { wire: unknown }).wire,
    });

    let executeCount = 0;
    class MyTask2 extends Task<
      Record<string, unknown>,
      { thing: { live: number } } & Record<string, unknown>
    > {
      static override readonly type = "MyTask2";
      static override outputSchema() {
        return {
          type: "object",
          properties: { thing: { type: "object", format: "test-port-cache", properties: {} } },
        } as never;
      }
      override async execute() {
        executeCount++;
        return { thing: { live: 1 } } as never;
      }
    }

    const repo = new SpyRepo();
    // Seed cache with wire-format data directly; __cv is the cacheVersion sentinel injected by buildKey
    await repo.saveOutput("MyTask2", { __cv: "1" }, { thing: { wire: { live: 99 } } });

    const t = new MyTask2();
    const result = await t.run({}, { outputCache: repo });
    expect(executeCount).toBe(0);
    expect(result).toEqual({ thing: { live: 99 } });
  });

  test("class-instance inputs keyed identically via the registered codec", async () => {
    registerPortCodec("test-port-input", {
      serialize: async (v: unknown) => ({ wire: (v as { reveal(): number }).reveal() }),
      deserialize: async (v: unknown) => ({
        reveal: () => (v as { wire: number }).wire,
      }),
    });

    const repo = new SpyRepo();

    class Opaque {
      reveal: () => number;
      constructor(v: number) {
        this.reveal = () => v;
      }
    }
    const a = new Opaque(7);
    const b = new Opaque(7);
    expect(a).not.toBe(b);

    let calls = 0;
    class T2 extends Task<
      { thing: Opaque } & Record<string, unknown>,
      { x: number } & Record<string, unknown>
    > {
      static override readonly type = "T2";
      static override inputSchema() {
        return {
          type: "object",
          properties: { thing: { type: "object", format: "test-port-input", properties: {} } },
        } as never;
      }
      override async execute() {
        calls++;
        return { x: 1 } as never;
      }
    }
    const t = new T2();
    await t.run({ thing: a } as never, { outputCache: repo });
    await t.run({ thing: b } as never, { outputCache: repo });
    expect(calls).toBe(1);
  });
});

describe("TaskRunner cache key determinism — image codec", () => {
  test("two ImageValues with identical pixels hit the same cache entry", async () => {
    await import("@workglow/util/media");
    const { imageValueFromBuffer } = await import("@workglow/util/media");

    const repo = new SpyRepo();
    const a = imageValueFromBuffer(Buffer.from([1, 2, 3, 255]), "raw-rgba", 1, 1);
    const b = imageValueFromBuffer(Buffer.from([1, 2, 3, 255]), "raw-rgba", 1, 1);
    expect(a).not.toBe(b);

    let calls = 0;
    class ImgKeyTask extends Task<
      { image: ImageValue } & Record<string, unknown>,
      { x: number } & Record<string, unknown>
    > {
      static override readonly type = "ImgKeyTask";
      static override inputSchema() {
        return {
          type: "object",
          properties: { image: { type: "object", format: "image", properties: {} } },
        } as never;
      }
      override async execute() {
        calls++;
        return { x: 1 } as never;
      }
    }
    const t = new ImgKeyTask();
    await t.run({ image: a } as never, { outputCache: repo });
    await t.run({ image: b } as never, { outputCache: repo });
    expect(calls).toBe(1);
  });
});
