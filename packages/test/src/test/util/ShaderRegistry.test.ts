/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { createShaderCache } from "@workglow/util/media";
import { describe, expect, test, vi } from "vitest";

describe("ShaderRegistry", () => {
  test("compiles a shader once per source string (cached by source)", () => {
    const compile = vi.fn((src: string) => ({ src }));
    const fakeDevice = {
      createShaderModule: ({ code }: { code: string }) => compile(code),
    } as unknown as GPUDevice;
    const cache = createShaderCache(fakeDevice);
    const a = cache.get("@@SRC@@");
    const b = cache.get("@@SRC@@");
    expect(a).toBe(b);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  test("different sources compile separately", () => {
    const compile = vi.fn((src: string) => ({ src }));
    const fakeDevice = {
      createShaderModule: ({ code }: { code: string }) => compile(code),
    } as unknown as GPUDevice;
    const cache = createShaderCache(fakeDevice);
    cache.get("A");
    cache.get("B");
    expect(compile).toHaveBeenCalledTimes(2);
  });
});
