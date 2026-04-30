/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test, vi } from "vitest";
import {
  registerFilterOp,
  applyFilter,
  hasFilterOp,
  _resetFilterRegistryForTests,
} from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

describe("applyFilter", () => {
  test("dispatches to the registered cpu fn for CpuImage", () => {
    const cpu = vi.fn((img: GpuImage, _params: unknown) => img);
    registerFilterOp<{ k: number }>("cpu", "__test_dispatch__", cpu);
    const img = CpuImage.fromRaw({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
      channels: 4,
    }) as unknown as GpuImage;
    applyFilter(img, "__test_dispatch__", { k: 1 });
    expect(cpu).toHaveBeenCalledOnce();
    expect(cpu.mock.calls[0]?.[1]).toEqual({ k: 1 });
  });

  test("returns the value produced by the registered fn", () => {
    const sentinel = {} as unknown as GpuImage;
    registerFilterOp<undefined>("cpu", "__test_return__", () => sentinel);
    const img = CpuImage.fromRaw({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
      channels: 4,
    }) as unknown as GpuImage;
    expect(applyFilter(img, "__test_return__", undefined)).toBe(sentinel);
  });

  test("throws when no fn registered for backend/filter combo", () => {
    const img = CpuImage.fromRaw({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
      channels: 4,
    }) as unknown as GpuImage;
    expect(() => applyFilter(img, "__nonexistent__", undefined)).toThrow(
      /applyFilter\("__nonexistent__"\) on backend "cpu": no implementation registered/,
    );
  });
});

describe("hasFilterOp", () => {
  test("returns false when no op registered for (backend, filter)", () => {
    _resetFilterRegistryForTests();
    expect(hasFilterOp("webgpu", "__nope__")).toBe(false);
  });

  test("returns true after registerFilterOp for that key", () => {
    _resetFilterRegistryForTests();
    registerFilterOp<undefined>("webgpu", "__yes__", (img) => img);
    expect(hasFilterOp("webgpu", "__yes__")).toBe(true);
    expect(hasFilterOp("cpu", "__yes__")).toBe(false);
  });
});
