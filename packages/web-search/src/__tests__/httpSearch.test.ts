/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "@workglow/task-graph";
import { describe, expect, it, vi } from "vitest";
import { fetchSearchJson } from "../providers/httpSearch";

function contextReturning(response: unknown, spy?: (input: unknown) => void): IExecuteContext {
  return {
    signal: new AbortController().signal,
    updateProgress: async () => {},
    own: () => ({
      run: async (input: unknown) => {
        spy?.(input);
        return response;
      },
    }),
  } as unknown as IExecuteContext;
}

describe("fetchSearchJson", () => {
  it("returns the parsed JSON body", async () => {
    const out = await fetchSearchJson(
      { provider: "brave", url: "https://example.test/s" },
      contextReturning({ json: { ok: true }, metadata: { status: 200 } })
    );
    expect(out).toEqual({ ok: true });
  });

  it("names the provider and status when no JSON body came back", async () => {
    await expect(
      fetchSearchJson(
        { provider: "brave", url: "https://example.test/s" },
        contextReturning({ json: undefined, metadata: { status: 503 } })
      )
    ).rejects.toThrow(/brave returned no JSON body \(status 503\)/);
  });

  it("reports an unknown status rather than 'undefined'", async () => {
    await expect(
      fetchSearchJson(
        { provider: "tavily", url: "https://example.test/s" },
        contextReturning({ json: null })
      )
    ).rejects.toThrow(/status unknown/);
  });

  it("defaults the credential scheme to bearer when a key is given", async () => {
    const seen = vi.fn();
    await fetchSearchJson(
      { provider: "tavily", url: "https://example.test/s", credentialKey: "k" },
      contextReturning({ json: {} }, seen)
    );
    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({ credential_key: "k", credential_scheme: "bearer" })
    );
  });

  it("sends no credential scheme when no key is given", async () => {
    const seen = vi.fn();
    await fetchSearchJson(
      { provider: "searxng", url: "https://example.test/s" },
      contextReturning({ json: {} }, seen)
    );
    const input = seen.mock.calls[0][0] as Record<string, unknown>;
    expect(input.credential_key).toBeUndefined();
    expect(input.credential_scheme).toBeUndefined();
  });
});
