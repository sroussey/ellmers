/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryQueueStorage, TelemetryQueueStorage } from "@workglow/job-queue";
import {
  ConsoleTelemetryProvider,
  NoopTelemetryProvider,
  setTelemetryProvider,
} from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("TelemetryQueueStorage", () => {
  let inner: InMemoryQueueStorage<{ data: string }, { result: string }>;
  let wrapped: TelemetryQueueStorage<{ data: string }, { result: string }>;
  let startSpanSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const provider = new ConsoleTelemetryProvider();
    setTelemetryProvider(provider);
    startSpanSpy = vi.spyOn(provider, "startSpan");

    inner = new InMemoryQueueStorage("test-queue");
    await inner.migrate();
    wrapped = new TelemetryQueueStorage("test-queue", inner);

    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setTelemetryProvider(new NoopTelemetryProvider());
    vi.restoreAllMocks();
  });

  it("should forward add and create a span", async () => {
    const id = await wrapped.add({
      input: { data: "test" },
      visible_at: null,
      completed_at: null,
    });
    expect(id).toBeDefined();
    expect(startSpanSpy).toHaveBeenCalledWith(
      "workglow.storage.queue.add",
      expect.objectContaining({
        attributes: expect.objectContaining({ "workglow.storage.name": "test-queue" }),
      })
    );
  });

  it("should forward next and create a span", async () => {
    await inner.add({
      input: { data: "test" },
      visible_at: null,
      completed_at: null,
    });
    const job = await wrapped.next("worker-1");
    expect(job).toBeDefined();
    expect(startSpanSpy).toHaveBeenCalledWith("workglow.storage.queue.next", expect.anything());
  });

  it("should forward size and create a span", async () => {
    const result = await wrapped.size();
    expect(result).toBe(0);
    expect(startSpanSpy).toHaveBeenCalledWith("workglow.storage.queue.size", expect.anything());
  });

  it("should forward deleteAll and create a span", async () => {
    await inner.add({
      input: { data: "test" },
      visible_at: null,
      completed_at: null,
    });
    await wrapped.deleteAll();
    expect(await inner.size()).toBe(0);
  });

  it("should forward get and create a span", async () => {
    const id = await inner.add({
      input: { data: "test" },
      visible_at: null,
      completed_at: null,
    });
    const job = await wrapped.get(id);
    expect(job).toBeDefined();
    expect(startSpanSpy).toHaveBeenCalledWith("workglow.storage.queue.get", expect.anything());
  });

  it("should forward peek and create a span", async () => {
    const jobs = await wrapped.peek();
    expect(jobs).toEqual([]);
    expect(startSpanSpy).toHaveBeenCalledWith("workglow.storage.queue.peek", expect.anything());
  });

  it("exposes findActiveByFingerprint and delegates when the inner implements it", async () => {
    // InMemoryQueueStorage has a native findActiveByFingerprint, so the
    // telemetry wrapper must expose a delegating, traced passthrough — not
    // drop it (which would silently degrade dedup to the O(N) scan fallback
    // once wrapped in front of a real DB backend).
    expect(typeof wrapped.findActiveByFingerprint).toBe("function");

    const id = await inner.add({
      input: { data: "fp-test" },
      fingerprint: "fp-123",
      visible_at: null,
      completed_at: null,
    });
    expect(id).toBeDefined();

    const found = await wrapped.findActiveByFingerprint!("fp-123", "test-queue");
    expect(found?.fingerprint).toBe("fp-123");
    expect(startSpanSpy).toHaveBeenCalledWith(
      "workglow.storage.queue.findActiveByFingerprint",
      expect.anything()
    );
  });

  it("leaves findActiveByFingerprint undefined when the inner lacks it", () => {
    // Mirror the optional-method semantics: if the inner storage has no native
    // implementation, the wrapper must stay undefined so wrapQueueStorage's
    // `typeof === 'function'` probe falls through to the bounded scan fallback.
    const innerWithout = {
      ...inner,
      findActiveByFingerprint: undefined,
    } as unknown as InMemoryQueueStorage<{ data: string }, { result: string }>;
    const wrappedWithout = new TelemetryQueueStorage("no-native", innerWithout);
    expect(wrappedWithout.findActiveByFingerprint).toBeUndefined();
  });
});
