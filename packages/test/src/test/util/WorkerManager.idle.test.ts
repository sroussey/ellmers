/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkerManager } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { advanceFakeTimers, flushAsyncWork } from "../helpers/advanceFakeTimers";

type WorkerEventListener = (event: any) => void;

interface FakeWorkerOptions {
  readonly functions?: readonly string[];
  readonly streamFunctions?: readonly string[];
  readonly previewFunctions?: readonly string[];
  readonly readyMode?: "success" | "never";
}

class FakeWorker {
  private readonly listeners = new Map<string, Set<WorkerEventListener>>();
  private readonly abortedRequestIds = new Set<string>();
  private readonly functions: readonly string[];
  private readonly streamFunctions: readonly string[];
  private readonly previewFunctions: readonly string[];
  private readonly readyMode: "success" | "never";

  readonly id: number;
  terminateCallCount = 0;

  constructor(id: number, options: FakeWorkerOptions = {}) {
    this.id = id;
    this.functions = options.functions ?? ["TestTask"];
    this.streamFunctions = options.streamFunctions ?? [];
    this.previewFunctions = options.previewFunctions ?? [];
    this.readyMode = options.readyMode ?? "success";

    if (this.readyMode === "success") {
      queueMicrotask(() => {
        this.emit("message", {
          data: {
            type: "ready",
            functions: this.functions,
            streamFunctions: this.streamFunctions,
            previewFunctions: this.previewFunctions,
          },
        });
      });
    }
  }

  addEventListener(type: string, listener: WorkerEventListener): void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: string, listener: WorkerEventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message: {
    readonly id?: string;
    readonly type: string;
    readonly functionName?: string;
    readonly args?: readonly unknown[];
    readonly stream?: boolean;
    readonly preview?: boolean;
  }): void {
    if (message.type === "abort" && message.id) {
      this.abortedRequestIds.add(message.id);
      return;
    }

    if (message.type !== "call" || !message.id) {
      return;
    }

    const delayMs = Number(message.args?.[0] ?? 0);

    if (message.stream) {
      setTimeout(() => {
        if (this.abortedRequestIds.has(message.id!)) {
          return;
        }
        this.emit("message", {
          data: {
            id: message.id,
            type: "stream_chunk",
            data: { workerId: this.id, chunk: 1 },
          },
        });
      }, delayMs);

      setTimeout(() => {
        if (this.abortedRequestIds.has(message.id!)) {
          return;
        }
        this.emit("message", {
          data: {
            id: message.id,
            type: "complete",
            data: undefined,
          },
        });
      }, delayMs + 1);
      return;
    }

    const complete = () => {
      this.emit("message", {
        data: {
          id: message.id,
          type: "complete",
          data: { workerId: this.id, args: message.args ?? [] },
        },
      });
    };

    if (delayMs <= 0) {
      queueMicrotask(complete);
      return;
    }

    setTimeout(complete, delayMs);
  }

  async terminate(): Promise<void> {
    this.terminateCallCount += 1;
  }

  private emit(type: string, event: any): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe("WorkerManager idle termination", () => {
  let managers: WorkerManager[] = [];

  beforeEach(() => {
    managers = [];
    vi.useFakeTimers();
  });

  afterEach(async () => {
    for (const manager of managers) {
      await manager.dispose();
    }
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const createManager = (): WorkerManager => {
    const manager = new WorkerManager();
    managers.push(manager);
    return manager;
  };

  test("recreates a factory worker after the idle timeout", async () => {
    const manager = createManager();
    const workers: FakeWorker[] = [];

    manager.registerWorker(
      "idle-worker",
      () => {
        const worker = new FakeWorker(workers.length + 1);
        workers.push(worker);
        return worker as unknown as Worker;
      },
      { idleTimeoutMs: 100 }
    );

    const firstCall = manager.callWorkerFunction<{ workerId: number }>(
      "idle-worker",
      "TestTask",
      []
    );
    await flushAsyncWork();
    await expect(firstCall).resolves.toEqual({ workerId: 1, args: [] });

    await advanceFakeTimers(100);
    expect(workers[0]?.terminateCallCount).toBe(1);

    const secondCall = manager.callWorkerFunction<{ workerId: number }>(
      "idle-worker",
      "TestTask",
      []
    );
    await flushAsyncWork();
    await expect(secondCall).resolves.toEqual({ workerId: 2, args: [] });
  });

  test("does not terminate while overlapping calls are still running", async () => {
    const manager = createManager();
    const workers: FakeWorker[] = [];

    manager.registerWorker(
      "busy-worker",
      () => {
        const worker = new FakeWorker(workers.length + 1);
        workers.push(worker);
        return worker as unknown as Worker;
      },
      { idleTimeoutMs: 50 }
    );

    const firstCall = manager.callWorkerFunction<{ workerId: number }>(
      "busy-worker",
      "TestTask",
      [10]
    );
    const secondCall = manager.callWorkerFunction<{ workerId: number }>(
      "busy-worker",
      "TestTask",
      [80]
    );

    await flushAsyncWork();
    await advanceFakeTimers(10);
    await expect(firstCall).resolves.toEqual({ workerId: 1, args: [10] });

    await advanceFakeTimers(60);
    expect(workers[0]?.terminateCallCount).toBe(0);

    await advanceFakeTimers(10);
    await expect(secondCall).resolves.toEqual({ workerId: 1, args: [80] });

    await advanceFakeTimers(50);
    expect(workers[0]?.terminateCallCount).toBe(1);
  });

  test("skips idle termination when idleTimeoutMs is zero", async () => {
    const manager = createManager();
    const workers: FakeWorker[] = [];

    manager.registerWorker(
      "persistent-worker",
      () => {
        const worker = new FakeWorker(workers.length + 1);
        workers.push(worker);
        return worker as unknown as Worker;
      },
      { idleTimeoutMs: 0 }
    );

    const firstCall = manager.callWorkerFunction<{ workerId: number }>(
      "persistent-worker",
      "TestTask",
      []
    );
    await flushAsyncWork();
    await expect(firstCall).resolves.toEqual({ workerId: 1, args: [] });

    await advanceFakeTimers(1_000);
    expect(workers[0]?.terminateCallCount).toBe(0);

    const secondCall = manager.callWorkerFunction<{ workerId: number }>(
      "persistent-worker",
      "TestTask",
      []
    );
    await flushAsyncWork();
    await expect(secondCall).resolves.toEqual({ workerId: 1, args: [] });
  });

  test("retries cleanly after a worker never becomes ready", async () => {
    const manager = createManager();
    const workers: FakeWorker[] = [];

    manager.registerWorker(
      "retry-worker",
      () => {
        const worker = new FakeWorker(workers.length + 1, {
          readyMode: workers.length === 0 ? "never" : "success",
        });
        workers.push(worker);
        return worker as unknown as Worker;
      },
      { idleTimeoutMs: 100 }
    );

    const firstCall = manager.callWorkerFunction("retry-worker", "TestTask", []);
    const firstCallResult = firstCall
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ ok: false as const, error }));
    await flushAsyncWork();
    await advanceFakeTimers(10_001);
    const result = await firstCallResult;
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected first worker startup to fail.");
    }
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toMatch(/did not become ready within 10s/);

    const secondCall = manager.callWorkerFunction<{ workerId: number }>(
      "retry-worker",
      "TestTask",
      []
    );
    await flushAsyncWork();
    await expect(secondCall).resolves.toEqual({ workerId: 2, args: [] });
  });

  test("releases stream activity after early iterator exit", async () => {
    const manager = createManager();
    const workers: FakeWorker[] = [];

    manager.registerWorker(
      "stream-worker",
      () => {
        const worker = new FakeWorker(workers.length + 1, {
          streamFunctions: ["StreamTask"],
        });
        workers.push(worker);
        return worker as unknown as Worker;
      },
      { idleTimeoutMs: 50 }
    );

    const stream = manager.callWorkerStreamFunction<{ workerId: number; chunk: number }>(
      "stream-worker",
      "StreamTask",
      [5]
    );

    const firstChunk = stream.next();
    await flushAsyncWork();
    await advanceFakeTimers(5);
    await expect(firstChunk).resolves.toEqual({
      done: false,
      value: { workerId: 1, chunk: 1 },
    });
    await stream.return(undefined);

    await advanceFakeTimers(50);
    expect(workers[0]?.terminateCallCount).toBe(1);
  });

  test("does not leak idle tracking when preview functions are unavailable", async () => {
    const manager = createManager();
    const workers: FakeWorker[] = [];

    manager.registerWorker(
      "preview-worker",
      () => {
        const worker = new FakeWorker(workers.length + 1, {
          previewFunctions: [],
        });
        workers.push(worker);
        return worker as unknown as Worker;
      },
      { idleTimeoutMs: 50 }
    );

    const previewCall = manager.callWorkerPreviewFunction(
      "preview-worker",
      "MissingPreviewTask",
      []
    );
    await flushAsyncWork();
    await expect(previewCall).resolves.toBeUndefined();

    await advanceFakeTimers(50);
    expect(workers[0]?.terminateCallCount).toBe(1);
  });
});
