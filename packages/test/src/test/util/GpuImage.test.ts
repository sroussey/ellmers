/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import "@workglow/tasks";
import type { GpuImage, GpuImageBackend } from "@workglow/util/media";
import {
  GpuImageFactory,
  imageValueFromBuffer,
  ImageValueSchema,
} from "@workglow/util/media";

describe("GpuImage interface", () => {
  test("backend tag is one of the three allowed strings", () => {
    const backends: GpuImageBackend[] = ["webgpu", "sharp", "cpu"];
    expect(backends).toHaveLength(3);
  });

  test("interface shape exists at type level", () => {
    // GpuImage is now a private internal — its public methods are
    // toImageValue, encode, dispose, plus width/height/channels/backend.
    const _stub = (img: GpuImage) =>
      [
        img.width,
        img.height,
        img.channels,
        img.backend,
        img.toImageValue,
        img.encode,
        img.dispose,
      ] as const;
    expect(typeof _stub).toBe("function");
  });
});

describe("GpuImageFactory Proxy guards", () => {
  test("symbol property access returns undefined (not throw)", () => {
    expect(() => (GpuImageFactory as any)[Symbol.toPrimitive]).not.toThrow();
    expect((GpuImageFactory as any)[Symbol.toPrimitive]).toBeUndefined();
  });

  test("'then' property returns undefined so the value is not thenable", async () => {
    expect((GpuImageFactory as any).then).toBeUndefined();
    // Promise.resolve checks .then on its argument; this must not throw.
    await expect(Promise.resolve(GpuImageFactory)).resolves.toBe(GpuImageFactory);
  });

  test("unregistered string key throws with a helpful message", () => {
    expect(() => (GpuImageFactory as any).somethingBogus()).toThrow(
      /somethingBogus is not registered/,
    );
  });
});

describe("ImageValueSchema", () => {
  test("declares format:'image' so the input resolver hydrates it", () => {
    const schema = ImageValueSchema({ title: "Image" }) as Record<string, unknown>;
    expect(schema.format).toBe("image");
    expect(schema.title).toBe("Image");
  });

  test("accepts annotation overrides", () => {
    const schema = ImageValueSchema({
      title: "Source",
      description: "Input image",
    }) as Record<string, unknown>;
    expect(schema.title).toBe("Source");
    expect(schema.description).toBe("Input image");
  });

  test("works with no annotations (defaults)", () => {
    const schema = ImageValueSchema() as Record<string, unknown>;
    expect(schema.format).toBe("image");
    expect(schema.title).toBe("Image");
    expect(schema.description).toBe("Image (hydrated to ImageValue at task entry)");
  });
});

describe("GpuImageFactory.from", () => {
  test("from(NodeImageValue raw-rgba) yields a backed image", async () => {
    // 1x1 red pixel as a raw-rgba NodeImageValue.
    const raw = new Uint8ClampedArray([255, 0, 0, 255]);
    const buf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
    const value = imageValueFromBuffer(buf, "raw-rgba", 1, 1);
    const img = await GpuImageFactory.from(value);
    expect(img.width).toBe(1);
    expect(img.height).toBe(1);
    expect(["webgpu", "sharp", "cpu"]).toContain(img.backend);
  });
});
