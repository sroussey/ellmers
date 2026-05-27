/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IBackendsTransport, IRunningHandle } from "@workglow/ai/provider-utils";
import { acquireBaseUrl } from "@workglow/llamacpp-server/ai-runtime";
import { describe, expect, it, vi } from "vitest";

function fakeTransport(): IBackendsTransport & {
  ensureRunning: ReturnType<typeof vi.fn>;
} {
  return {
    ensureRunning: vi.fn(),
    subscribeStatus: vi.fn(() => () => undefined),
    install: vi.fn(),
    list: vi.fn(),
    uninstall: vi.fn(),
  } as unknown as IBackendsTransport & { ensureRunning: ReturnType<typeof vi.fn> };
}

describe("acquireBaseUrl precedence", () => {
  it("prefers model.provider_config.base_url over everything", async () => {
    const transport = fakeTransport();
    const result = await acquireBaseUrl(
      { provider_config: { base_url: "http://localhost:8080/" } } as any,
      { externalUrl: "http://127.0.0.1:8081", transport }
    );
    expect(result.baseUrl).toBe("http://localhost:8080");
    expect(transport.ensureRunning).not.toHaveBeenCalled();
    await result.release(); // no-op
  });

  it("prefers opts.externalUrl over transport when no model.base_url", async () => {
    const transport = fakeTransport();
    const result = await acquireBaseUrl({ provider_config: { model_path: "/x.gguf" } } as any, {
      externalUrl: "http://127.0.0.1:8081",
      transport,
    });
    expect(result.baseUrl).toBe("http://127.0.0.1:8081");
    expect(transport.ensureRunning).not.toHaveBeenCalled();
    await result.release(); // no-op
  });

  it("falls back to transport.ensureRunning when neither URL is set", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const transport = fakeTransport();
    transport.ensureRunning.mockResolvedValue({
      url: "http://127.0.0.1:9999/",
      release,
    } as IRunningHandle);
    const result = await acquireBaseUrl(
      { provider_config: { model_path: "/abs/m.gguf", ctx: 8192 } } as any,
      { transport, defaultCtx: 4096 }
    );
    expect(transport.ensureRunning).toHaveBeenCalledWith({
      backend: "llamacpp-server",
      modelPath: "/abs/m.gguf",
      opts: { ctx: 8192 },
    });
    expect(result.baseUrl).toBe("http://127.0.0.1:9999");
    await result.release();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("uses defaultCtx when model has no ctx override", async () => {
    const transport = fakeTransport();
    transport.ensureRunning.mockResolvedValue({
      url: "http://127.0.0.1:9999",
      release: vi.fn(),
    } as IRunningHandle);
    await acquireBaseUrl({ provider_config: { model_path: "/abs/m.gguf" } } as any, {
      transport,
      defaultCtx: 12345,
    });
    expect(transport.ensureRunning).toHaveBeenCalledWith({
      backend: "llamacpp-server",
      modelPath: "/abs/m.gguf",
      opts: { ctx: 12345 },
    });
  });

  it("throws when transport mode is selected but model_path is missing", async () => {
    const transport = fakeTransport();
    await expect(acquireBaseUrl({ provider_config: {} } as any, { transport })).rejects.toThrow(
      /model_path/
    );
  });

  it("rejects public model URLs before requests can use them", async () => {
    await expect(
      acquireBaseUrl({ provider_config: { base_url: "https://example.com:8080/" } } as any, {})
    ).rejects.toThrow(/loopback HTTP/);
  });

  it("normalizes slash-heavy local URLs", async () => {
    const result = await acquireBaseUrl(
      { provider_config: { base_url: `http://127.0.0.1:8080${"/".repeat(1_000)}` } } as any,
      {}
    );
    expect(result.baseUrl).toBe("http://127.0.0.1:8080");
  });

  it("throws when no source resolves", async () => {
    await expect(acquireBaseUrl({ provider_config: {} } as any, {})).rejects.toThrow(
      /no base URL source/
    );
  });
});
