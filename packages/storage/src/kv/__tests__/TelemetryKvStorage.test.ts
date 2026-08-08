/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryKvStorage, TelemetryKvStorage } from "@workglow/storage";
import {
  ConsoleTelemetryProvider,
  NoopTelemetryProvider,
  SpanStatusCode,
  setTelemetryProvider,
} from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("TelemetryKvStorage", () => {
  let inner: InMemoryKvStorage;
  let wrapped: TelemetryKvStorage;
  let startSpanSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const provider = new ConsoleTelemetryProvider();
    setTelemetryProvider(provider);
    startSpanSpy = vi.spyOn(provider, "startSpan");

    inner = new InMemoryKvStorage();
    wrapped = new TelemetryKvStorage("test-kv", inner);

    // Suppress console output during tests
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setTelemetryProvider(new NoopTelemetryProvider());
    vi.restoreAllMocks();
  });

  it("should forward put and create a span", async () => {
    await wrapped.put("key1", "value1");
    expect(startSpanSpy).toHaveBeenCalledWith(
      "workglow.storage.kv.put",
      expect.objectContaining({
        attributes: expect.objectContaining({ "workglow.storage.name": "test-kv" }),
      })
    );
    expect(await inner.get("key1")).toBe("value1");
  });

  it("should forward get and create a span", async () => {
    await inner.put("key1", "value1");
    const result = await wrapped.get("key1");
    expect(result).toBe("value1");
    expect(startSpanSpy).toHaveBeenCalledWith("workglow.storage.kv.get", expect.anything());
  });

  it("should forward delete and create a span", async () => {
    await inner.put("key1", "value1");
    await wrapped.delete("key1");
    expect(await inner.get("key1")).toBeUndefined();
    expect(startSpanSpy).toHaveBeenCalledWith("workglow.storage.kv.delete", expect.anything());
  });

  it("should forward getAll and create a span", async () => {
    await inner.put("a", 1);
    const result = await wrapped.getAll();
    expect(result).toHaveLength(1);
    expect(startSpanSpy).toHaveBeenCalledWith("workglow.storage.kv.getAll", expect.anything());
  });

  it("should forward deleteAll and create a span", async () => {
    await inner.put("a", 1);
    await wrapped.deleteAll();
    expect(await inner.size()).toBe(0);
    expect(startSpanSpy).toHaveBeenCalledWith("workglow.storage.kv.deleteAll", expect.anything());
  });

  it("should forward size and create a span", async () => {
    await inner.put("a", 1);
    const result = await wrapped.size();
    expect(result).toBe(1);
    expect(startSpanSpy).toHaveBeenCalledWith("workglow.storage.kv.size", expect.anything());
  });

  it("should forward putBulk and create a span", async () => {
    await wrapped.putBulk([
      { key: "a", value: 1 },
      { key: "b", value: 2 },
    ]);
    expect(await inner.size()).toBe(2);
    expect(startSpanSpy).toHaveBeenCalledWith("workglow.storage.kv.putBulk", expect.anything());
  });

  it("should set ERROR status on span when operation throws", async () => {
    const error = new Error("fail");
    vi.spyOn(inner, "put").mockRejectedValueOnce(error);
    const endSpy = vi.fn();
    const setStatusSpy = vi.fn();
    startSpanSpy.mockReturnValueOnce({
      setAttributes: vi.fn(),
      addEvent: vi.fn(),
      setStatus: setStatusSpy,
      end: endSpy,
    });
    await expect(wrapped.put("k", "v")).rejects.toThrow("fail");
    expect(setStatusSpy).toHaveBeenCalledWith(SpanStatusCode.ERROR, "fail");
    expect(endSpy).toHaveBeenCalled();
  });

  it("should forward event methods to inner storage", () => {
    const fn = vi.fn();
    wrapped.on("put", fn);
    inner.emit("put", "key", "value");
    expect(fn).toHaveBeenCalledWith("key", "value");
  });
});
