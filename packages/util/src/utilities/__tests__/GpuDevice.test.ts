/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { getGpuDevice } from "@workglow/util/media";
import { resetGpuDeviceForTests } from "@workglow/util/test";
import { beforeEach, describe, expect, test } from "vitest";

describe.skipIf(typeof navigator === "undefined" || !("gpu" in navigator))("GpuDevice", () => {
  beforeEach(() => {
    resetGpuDeviceForTests();
  });

  test("returns the same device for two calls within a session (singleton)", async () => {
    const a = await getGpuDevice();
    const b = await getGpuDevice();
    expect(a).toBe(b);
  });

  test("returns null when no adapter is available", async () => {
    const original = navigator.gpu.requestAdapter;
    navigator.gpu.requestAdapter = async () => null;
    try {
      const dev = await getGpuDevice();
      expect(dev).toBeNull();
    } finally {
      navigator.gpu.requestAdapter = original;
    }
  });
});

describe("GpuDevice (node fallback)", () => {
  test("getGpuDevice returns null without WebGPU", async () => {
    if (typeof navigator !== "undefined" && "gpu" in navigator) return; // skip in browser env
    resetGpuDeviceForTests();
    const dev = await getGpuDevice();
    expect(dev).toBeNull();
  });

  test("resetGpuDeviceForTests is callable on node stub", () => {
    expect(() => resetGpuDeviceForTests()).not.toThrow();
  });
});
