/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn } from "@workglow/ai";
import {
  AiProviderRegistry,
  createEmitQueue,
  getAiProviderRegistry,
  setAiProviderRegistry,
} from "@workglow/ai";
import type {
  IBackendStatus,
  IBackendsTransport,
  IEnsureRunningRequest,
  IRunningHandle,
} from "@workglow/ai/provider-utils";
import { pngBytesToImageValue } from "@workglow/ai/provider-utils";
import { LOCAL_LLAMACPP_SERVER, registerLlamaCppServerInline } from "@workglow/llamacpp-server/ai";
import {
  LOCAL_STABLE_DIFFUSION_CPP,
  registerStableDiffusionCppInline,
} from "@workglow/stable-diffusion-server/ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workglow/ai/provider-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workglow/ai/provider-utils")>();
  return {
    ...actual,
    pngBytesToImageValue: vi.fn(),
  };
});

const originalFetch = globalThis.fetch;
const MOCK_IMAGE = { kind: "mock-image" } as const;

interface ITransportStub {
  readonly ensureRunning: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
  readonly transport: IBackendsTransport;
}

function createTransportStub(url = "http://127.0.0.1:8765"): ITransportStub {
  const release = vi.fn(async (): Promise<void> => undefined);
  const ensureRunning = vi.fn(async (_req: IEnsureRunningRequest): Promise<IRunningHandle> => ({
    url,
    release,
  }));
  const transport: IBackendsTransport = {
    ensureRunning,
    subscribeStatus: (
      _backend: string,
      _callback: (status: IBackendStatus) => void
    ): (() => void) => {
      return (): void => undefined;
    },
    install: async (_backend: string): Promise<void> => undefined,
    list: async (): Promise<void> => undefined,
    uninstall: async (_backend: string): Promise<void> => undefined,
  };

  return { ensureRunning, release, transport };
}

async function runProviderStream(
  runFn: AiProviderRunFn<any, any>,
  input: Record<string, unknown>,
  model: Record<string, unknown>,
  timeoutMs = 100
): Promise<unknown[]> {
  const q = createEmitQueue<unknown>();
  const events: unknown[] = [];
  const controller = new AbortController();

  const runPromise = runFn(input as any, model as any, controller.signal, (event: unknown) =>
    q.push(event)
  ).then(
    () => q.close(),
    (error: unknown) => q.fail(error)
  );
  const consumePromise = (async (): Promise<void> => {
    for await (const event of q.iterable) {
      events.push(event);
    }
  })();

  await Promise.race([
    Promise.all([runPromise, consumePromise]),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);

  return events;
}

describe("local backend provider stream contracts", () => {
  beforeEach(() => {
    setAiProviderRegistry(new AiProviderRegistry());
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
    vi.mocked(pngBytesToImageValue).mockResolvedValue(MOCK_IMAGE as any);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("llama.cpp stops after [DONE] even if the server keeps the stream open", async () => {
    const { release, transport } = createTransportStub();
    await registerLlamaCppServerInline({ transport });

    const runFn = getAiProviderRegistry().getRunFnFor(LOCAL_LLAMACPP_SERVER, ["text.generation"]);
    expect(runFn).toBeDefined();

    const payload = new TextEncoder().encode(
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n'
    );

    let resolvePendingRead:
      | ((value: { readonly done: boolean; readonly value?: Uint8Array }) => void)
      | undefined;
    let readCount = 0;
    const reader = {
      read: vi.fn(() => {
        readCount += 1;
        if (readCount === 1) {
          return Promise.resolve({ done: false, value: payload });
        }
        return new Promise<{ readonly done: boolean; readonly value?: Uint8Array }>((resolve) => {
          resolvePendingRead = resolve;
        });
      }),
      cancel: vi.fn(async (): Promise<void> => {
        resolvePendingRead?.({ done: true });
      }),
      releaseLock: vi.fn((): void => undefined),
    };

    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          body: { getReader: () => reader },
          text: async (): Promise<string> => "",
        }) as unknown as Response
    ) as unknown as typeof fetch;

    const events = await runProviderStream(
      runFn!,
      { prompt: "hello" },
      {
        model_id: "llama-test",
        provider: LOCAL_LLAMACPP_SERVER,
        provider_config: { model_path: "/models/llama.gguf" },
      }
    );

    // Provisional mid-stream `usage` snapshots are expected (OpenAI-shaped
    // streams only bill on the trailer); this contract is about termination.
    expect(events.filter((e) => (e as { type?: string }).type === "text-delta")).toEqual([
      { type: "text-delta", port: "text", textDelta: "hello" },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "finish", data: {} });
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("stable-diffusion emits the generated image as a snapshot before finish", async () => {
    const { release, transport } = createTransportStub();
    await registerStableDiffusionCppInline({ transport });

    const runFn = getAiProviderRegistry().getRunFnFor(LOCAL_STABLE_DIFFUSION_CPP, [
      "image.generation",
    ]);
    expect(runFn).toBeDefined();

    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async (): Promise<{ images: string[] }> => ({
            images: [
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aFEAAAAASUVORK5CYII=",
            ],
          }),
        }) as unknown as Response
    ) as unknown as typeof fetch;

    const events = await runProviderStream(
      runFn!,
      { prompt: "draw a cat" },
      {
        model_id: "sd-test",
        provider: LOCAL_STABLE_DIFFUSION_CPP,
        provider_config: { model_path: "/models/stable-diffusion.gguf" },
      }
    );

    expect(events).toEqual([
      { type: "snapshot", data: { image: MOCK_IMAGE } },
      { type: "finish", data: {} },
    ]);
    expect(pngBytesToImageValue).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
