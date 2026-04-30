/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { type IExecuteContext, type IExecutePreviewContext } from "@workglow/task-graph";
import { ImageFilterTask, type ImageFilterInput, type ImageFilterOutput } from "@workglow/tasks";
import {
  CpuImage,
  imageValueFromBuffer,
  registerFilterOp,
  type FilterOpFn,
  type ImageValue,
} from "@workglow/util/media";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, test } from "vitest";

// ---------------------------------------------------------------------------
// Helpers — build NodeImageValue inputs and read CpuImage pixels back out.
// ---------------------------------------------------------------------------
function rawValue(data: Uint8ClampedArray, w: number, h: number, previewScale = 1): ImageValue {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return imageValueFromBuffer(buf, "raw-rgba", w, h, previewScale);
}

async function readPixels(value: ImageValue): Promise<Uint8ClampedArray> {
  const cpu = await CpuImage.from(value);
  const bin = cpu.getBinary();
  return bin.data;
}

function makeContext(): IExecuteContext {
  return {
    signal: new AbortController().signal,
    updateProgress: async () => {},
    own: <T>(t: T) => t,
    registry: undefined as unknown as IExecuteContext["registry"],
    resourceScope: undefined,
  };
}

const previewCtx: IExecutePreviewContext = { own: <T>(t: T) => t };

// ---------------------------------------------------------------------------
// Bump filter — adds `delta` to red channel (CPU arm only). Used to verify
// the filter is invoked and that opParams receives the input.
// ---------------------------------------------------------------------------
interface BumpParams {
  delta: number;
}

const bumpOp: FilterOpFn<BumpParams> = (image, { delta }) => {
  const bin = (image as CpuImage).getBinary();
  const data = new Uint8ClampedArray(bin.data);
  for (let i = 0; i < data.length; i += 4) data[i] = (data[i]! + delta) & 0xff;
  return CpuImage.fromRaw({ ...bin, data });
};

// Register only on cpu — the Task's runFilter() fallback materializes the
// input to CpuImage when the active backend (sharp on Node, webgpu in browser)
// has no registered arm for this filter name.
registerFilterOp<BumpParams>("cpu", "__bump_test_filter__", bumpOp);

interface BumpInput extends ImageFilterInput, Record<string, unknown> {
  delta: number;
}

class BumpTask extends ImageFilterTask<BumpParams, BumpInput> {
  static override readonly type = "BumpTask";
  static override readonly category = "Image";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { image: { type: "object" }, delta: { type: "number" } },
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { image: { type: "object" } },
    } as const satisfies DataPortSchema;
  }
  protected readonly filterName = "__bump_test_filter__";
  protected opParams(input: BumpInput): BumpParams {
    return { delta: input.delta };
  }
}

describe("ImageFilterTask", () => {
  test("execute applies the registered filter", async () => {
    const value = rawValue(new Uint8ClampedArray([10, 0, 0, 255]), 1, 1);
    const t = new BumpTask();
    const out = (await t.execute({ image: value, delta: 5 } as BumpInput, makeContext())) as
      | ImageFilterOutput
      | undefined;
    expect(out).toBeDefined();
    const pixels = await readPixels(out!.image);
    expect(pixels[0]).toBe(15);
  });

  test("executePreview produces the same pixel result as execute", async () => {
    const value = rawValue(new Uint8ClampedArray([10, 0, 0, 255]), 1, 1);
    const t = new BumpTask();
    const prev = (await t.executePreview({ image: value, delta: 5 } as BumpInput, previewCtx)) as
      | ImageFilterOutput
      | undefined;
    expect(prev).toBeDefined();
    const pixels = await readPixels(prev!.image);
    expect(pixels[0]).toBe(15);
  });

  test("output ImageValue carries the same previewScale as the input", async () => {
    const value = rawValue(new Uint8ClampedArray([10, 0, 0, 255]), 1, 1, 0.25);
    const t = new BumpTask();
    const out = (await t.execute({ image: value, delta: 0 } as BumpInput, makeContext())) as
      | ImageFilterOutput
      | undefined;
    expect(out!.image.previewScale).toBe(0.25);
  });

  test("opParams is called with the full input on each invocation", async () => {
    let captured: BumpInput | null = null;
    class Capture extends ImageFilterTask<BumpParams, BumpInput> {
      static override readonly type = "CaptureTask";
      static override readonly category = "Image";
      static override readonly cacheable = false;
      static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { image: { type: "object" }, delta: { type: "number" } },
        } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { image: { type: "object" } },
        } as const satisfies DataPortSchema;
      }
      protected readonly filterName = "__bump_test_filter__";
      protected opParams(input: BumpInput): BumpParams {
        captured = input;
        return { delta: input.delta };
      }
    }
    const value = rawValue(new Uint8ClampedArray(4), 1, 1);
    const t = new Capture();
    await t.execute({ image: value, delta: 7 } as BumpInput, makeContext());
    expect(captured).not.toBeNull();
    expect(captured!.delta).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// scalePreviewParams hook — pixel-space params multiply by image.previewScale.
// ---------------------------------------------------------------------------
describe("ImageFilterTask scalePreviewParams hook", () => {
  test("scalePreviewParams is invoked with image.previewScale", async () => {
    let captured: { radius: number } | undefined;
    const captureOp: FilterOpFn<{ radius: number }> = (image, params) => {
      captured = params;
      // Return a fresh CpuImage — the Task disposes the input image after the
      // filter runs, then calls toImageValue() on the output. Returning the
      // same instance would dispose the output and break that egress call.
      const bin = (image as CpuImage).getBinary();
      return CpuImage.fromRaw({ ...bin, data: new Uint8ClampedArray(bin.data) });
    };
    registerFilterOp<{ radius: number }>("cpu", "__scale_test_filter__", captureOp);

    interface ScaleInput extends ImageFilterInput, Record<string, unknown> {}
    class ScaleAwareTask extends ImageFilterTask<{ radius: number }, ScaleInput> {
      static override readonly type = "ScaleAwareTask";
      static override readonly category = "Image";
      static override readonly cacheable = false;
      static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { image: { type: "object" } },
          required: ["image"],
        } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { image: { type: "object" } },
          required: ["image"],
        } as const satisfies DataPortSchema;
      }
      protected readonly filterName = "__scale_test_filter__";
      protected opParams(): { radius: number } {
        return { radius: 8 };
      }
      protected override scalePreviewParams(p: { radius: number }, s: number): { radius: number } {
        return { radius: Math.max(1, Math.round(p.radius * s)) };
      }
    }

    const value = rawValue(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1, 0.25);
    const t = new ScaleAwareTask();
    await t.execute({ image: value } as ScaleInput, makeContext());
    // 8 * 0.25 = 2.
    expect(captured!.radius).toBe(2);
  });

  test("scalePreviewParams is identity when input.previewScale is 1.0", async () => {
    let captured: { radius: number } | undefined;
    const captureOp: FilterOpFn<{ radius: number }> = (image, params) => {
      captured = params;
      const bin = (image as CpuImage).getBinary();
      return CpuImage.fromRaw({ ...bin, data: new Uint8ClampedArray(bin.data) });
    };
    registerFilterOp<{ radius: number }>("cpu", "__scale_passthrough_filter__", captureOp);

    interface ScaleInput extends ImageFilterInput, Record<string, unknown> {}
    class ScaleTask extends ImageFilterTask<{ radius: number }, ScaleInput> {
      static override readonly type = "ScalePassthroughTask";
      static override readonly category = "Image";
      static override readonly cacheable = false;
      static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { image: { type: "object" } },
          required: ["image"],
        } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { image: { type: "object" } },
          required: ["image"],
        } as const satisfies DataPortSchema;
      }
      protected readonly filterName = "__scale_passthrough_filter__";
      protected opParams(): { radius: number } {
        return { radius: 8 };
      }
      protected override scalePreviewParams(p: { radius: number }, s: number): { radius: number } {
        return { radius: Math.max(1, Math.round(p.radius * s)) };
      }
    }

    const value = rawValue(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1, 1.0);
    const t = new ScaleTask();
    await t.execute({ image: value } as ScaleInput, makeContext());
    expect(captured!.radius).toBe(8);
  });
});
