/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CacheRef, CacheRefResolver } from "@workglow/task-graph";
import { makeCacheRef, resolveOutput } from "@workglow/task-graph";
import { describe, expect, it, vi } from "vitest";

const ref = (key: string): CacheRef => makeCacheRef({ $ref: key });

describe("resolveOutput opaque-type policy", () => {
  it("treats Headers as opaque (preserves instance, never inspects keys)", async () => {
    const resolver = vi.fn<CacheRefResolver>();
    const headers = new Headers({ "x-test": "1" });
    const input = { headers };
    const out = await resolveOutput(input, resolver);
    expect(out).toBe(input);
    expect(out.headers).toBe(headers);
    expect(out.headers.get("x-test")).toBe("1");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("treats Request as opaque (Object.keys would drop everything)", async () => {
    const resolver = vi.fn<CacheRefResolver>();
    const request = new Request("https://example.com/path", { method: "POST" });
    const input = { request };
    const out = await resolveOutput(input, resolver);
    expect(out).toBe(input);
    expect(out.request).toBe(request);
    expect(out.request.method).toBe("POST");
    expect(out.request instanceof Request).toBe(true);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("treats Response as opaque (body lives in a private slot)", async () => {
    const resolver = vi.fn<CacheRefResolver>();
    const response = new Response("hello", { status: 201 });
    const input = { response };
    const out = await resolveOutput(input, resolver);
    expect(out).toBe(input);
    expect(out.response).toBe(response);
    expect(out.response.status).toBe(201);
    expect(out.response instanceof Response).toBe(true);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("treats FormData as opaque (entries are not own enumerable properties)", async () => {
    const resolver = vi.fn<CacheRefResolver>();
    const form = new FormData();
    form.set("k", "v");
    const input = { form };
    const out = await resolveOutput(input, resolver);
    expect(out).toBe(input);
    expect(out.form).toBe(form);
    expect(out.form.get("k")).toBe("v");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("treats URLSearchParams as opaque", async () => {
    const resolver = vi.fn<CacheRefResolver>();
    const params = new URLSearchParams("a=1&b=2");
    const input = { params };
    const out = await resolveOutput(input, resolver);
    expect(out).toBe(input);
    expect(out.params).toBe(params);
    expect(out.params.get("a")).toBe("1");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("treats Error as opaque (preserves message/stack on prototype-resident slots)", async () => {
    const resolver = vi.fn<CacheRefResolver>();
    const err = new Error("boom");
    const input = { err };
    const out = await resolveOutput(input, resolver);
    expect(out).toBe(input);
    expect(out.err).toBe(err);
    expect(out.err.message).toBe("boom");
    expect(out.err instanceof Error).toBe(true);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("treats URL as opaque", async () => {
    const resolver = vi.fn<CacheRefResolver>();
    const url = new URL("https://example.com/path?q=1");
    const input = { url };
    const out = await resolveOutput(input, resolver);
    expect(out).toBe(input);
    expect(out.url).toBe(url);
    expect(out.url.href).toBe("https://example.com/path?q=1");
    expect(out.url instanceof URL).toBe(true);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("treats user-defined classes (including private fields) as opaque", async () => {
    const resolver = vi.fn<CacheRefResolver>();
    class UserClass {
      readonly #secret: number;
      readonly label: string;
      constructor(secret: number, label: string) {
        this.#secret = secret;
        this.label = label;
      }
      getSecret(): number {
        return this.#secret;
      }
    }
    const instance = new UserClass(42, "answer");
    const input = { instance };
    const out = await resolveOutput(input, resolver);
    expect(out).toBe(input);
    expect(out.instance).toBe(instance);
    expect(out.instance.getSecret()).toBe(42);
    expect(out.instance.label).toBe("answer");
    expect(out.instance instanceof UserClass).toBe(true);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("treats null-prototype objects as plain (walked structurally)", async () => {
    const blob = new Blob([new Uint8Array([7])]);
    const resolver: CacheRefResolver = async () => blob;
    const inner: Record<string, unknown> = Object.create(null);
    inner.payload = ref("cache://np");
    const out = await resolveOutput({ inner }, resolver);
    expect(out.inner.payload).toBe(blob);
  });

  it("resolves a ref sibling of an opaque class instance without inspecting the instance", async () => {
    const blob = new Blob([new Uint8Array([1])]);
    const resolver = vi.fn<CacheRefResolver>(async (r) =>
      r.$ref === "cache://k" ? blob : undefined
    );
    const headers = new Headers({ "x-not-touched": "1" });
    const input = {
      headers,
      payload: ref("cache://k"),
    };
    const out = await resolveOutput(input, resolver);
    expect(out.headers).toBe(headers);
    expect(out.payload).toBe(blob);
    // Only the branded ref triggered a resolver call; Headers was not walked.
    expect(resolver).toHaveBeenCalledTimes(1);
  });
});
