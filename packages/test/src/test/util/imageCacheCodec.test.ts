/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import "@workglow/util/media";
import {
  imageValueFromBuffer,
  isNodeImageValue,
  type ImageValue,
} from "@workglow/util/media";
import { getPortCodec } from "@workglow/task-graph";

const codec = getPortCodec("image");

describe("image port codec", () => {
  test("serialize produces a JSON-safe wire form for NodeImageValue", async () => {
    const buf = Buffer.from(new Uint8Array([1, 2, 3, 255]));
    const value = imageValueFromBuffer(buf, "raw-rgba", 1, 1, 0.5);
    expect(codec).toBeDefined();
    const wire = await codec!.serialize(value);

    // Round through JSON to prove it survives persistent caching.
    const round = JSON.parse(JSON.stringify(wire)) as Record<string, unknown>;
    expect(round.__imageValueWire).toBe(1);
    expect(round.format).toBe("raw-rgba");
    expect(typeof round.base64).toBe("string");
    expect(round.width).toBe(1);
    expect(round.height).toBe(1);
    expect(round.previewScale).toBe(0.5);
  });

  test("deserialize reconstructs a NodeImageValue with bytes intact", async () => {
    const original = imageValueFromBuffer(Buffer.from(new Uint8Array([10, 20, 30, 255])), "raw-rgba", 1, 1, 0.25);
    const wire = await codec!.serialize(original);
    const json = JSON.parse(JSON.stringify(wire));
    const out = (await codec!.deserialize(json)) as ImageValue;

    expect(isNodeImageValue(out)).toBe(true);
    if (!isNodeImageValue(out)) throw new Error("expected NodeImageValue");
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(out.previewScale).toBe(0.25);
    expect(out.format).toBe("raw-rgba");
    expect(Array.from(out.buffer)).toEqual([10, 20, 30, 255]);
  });

  test("deserialize rejects values that aren't a wire form", async () => {
    await expect(codec!.deserialize({ width: 1, height: 1 } as never)).rejects.toThrow();
  });

  test("serialize rejects values that aren't an ImageValue", async () => {
    await expect(codec!.serialize({ width: 1 } as never)).rejects.toThrow();
  });

  test("strings (data: URIs from image:data-uri ports) pass through both directions", async () => {
    const dataUri = "data:image/png;base64,iVBORw0KGgo=";
    expect(await codec!.serialize(dataUri as never)).toBe(dataUri);
    expect(await codec!.deserialize(dataUri as never)).toBe(dataUri);
  });
});
