/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import "@workglow/util/media";
import "@workglow/tasks";
import { ImageBlurTask } from "@workglow/tasks";
import { CpuImage, imageValueFromBuffer, type ImageValue } from "@workglow/util/media";
import {
  TaskOutputRepository,
  type TaskInput,
  type TaskOutput,
} from "@workglow/task-graph";

class MapRepo extends TaskOutputRepository {
  store = new Map<string, TaskOutput>();

  constructor() {
    super({ outputCompression: false });
  }

  async saveOutput(_t: string, inputs: TaskInput, output: TaskOutput): Promise<void> {
    this.store.set(JSON.stringify(inputs), output);
  }

  async getOutput(_t: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    return this.store.get(JSON.stringify(inputs));
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async size(): Promise<number> {
    return this.store.size;
  }

  async clearOlderThan(_olderThanInMs: number): Promise<void> {}
}

function makeImageValue(bytes: number[]): ImageValue {
  const data = new Uint8ClampedArray(bytes);
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return imageValueFromBuffer(buf, "raw-rgba", 8, 8);
}

describe("image cache round-trip", () => {
  test("two equivalent ImageValues hit the same cache entry", async () => {
    const repo = new MapRepo();
    const bytes = new Array<number>(8 * 8 * 4).fill(128);
    const a = makeImageValue(bytes);
    const b = makeImageValue(bytes);
    expect(a).not.toBe(b);

    const t = new ImageBlurTask();
    const r1 = await t.run({ image: a, radius: 1 } as never, { outputCache: repo });
    const r2 = await t.run({ image: b, radius: 1 } as never, { outputCache: repo });

    // Same pixel result on both runs (decode the ImageValue back through CpuImage).
    const aCpu = await CpuImage.from((r1 as { image: ImageValue }).image);
    const bCpu = await CpuImage.from((r2 as { image: ImageValue }).image);
    const ab = aCpu.getBinary();
    const bb = bCpu.getBinary();
    expect(Array.from(ab.data).slice(0, 32)).toEqual(Array.from(bb.data).slice(0, 32));

    // Single cache entry — input normalization should make equivalent
    // ImageValues produce the same cache key.
    expect(repo.store.size).toBe(1);
  });
});
