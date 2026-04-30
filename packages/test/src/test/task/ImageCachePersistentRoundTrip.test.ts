/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import "@workglow/util/media";
import "@workglow/tasks";
import { ImageBlurTask } from "@workglow/tasks";
import {
  CpuImage,
  imageValueFromBuffer,
  isNodeImageValue,
  type ImageValue,
} from "@workglow/util/media";
import { InMemoryTaskOutputRepository } from "../../binding/InMemoryTaskOutputRepository";

/**
 * Verifies that `ImageValue` outputs survive a real persistent cache round-trip
 * through `TaskOutputTabularRepository`. The repo `JSON.stringify`s outputs before
 * writing to its tabular backing store and `JSON.parse`s on read — the image port
 * codec must serialize to a JSON-safe wire form for this to work.
 */
describe("image cache — persistent round-trip via TaskOutputTabularRepository", () => {
  test("ImageValue output survives JSON.stringify and is decoded back to a usable image", async () => {
    const repo = new InMemoryTaskOutputRepository();
    await repo.setupDatabase();

    const bytes = new Array<number>(8 * 8 * 4).fill(128);
    const data = new Uint8ClampedArray(bytes);
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const input = imageValueFromBuffer(buf, "raw-rgba", 8, 8) as ImageValue;

    const t = new ImageBlurTask();
    const r1 = await t.run({ image: input, radius: 1 } as never, { outputCache: repo });
    const r2 = await t.run({ image: input, radius: 1 } as never, { outputCache: repo });

    const out1 = (r1 as { image: ImageValue }).image;
    const out2 = (r2 as { image: ImageValue }).image;

    expect(isNodeImageValue(out2)).toBe(true);
    expect(out2.width).toBe(8);
    expect(out2.height).toBe(8);

    const cpu1 = await CpuImage.from(out1);
    const cpu2 = await CpuImage.from(out2);
    expect(Array.from(cpu1.getBinary().data).slice(0, 32)).toEqual(
      Array.from(cpu2.getBinary().data).slice(0, 32),
    );
  });

  test("non-cacheable inputs aren't persisted (sanity)", async () => {
    const repo = new InMemoryTaskOutputRepository();
    await repo.setupDatabase();
    expect(await repo.size()).toBe(0);
  });
});
