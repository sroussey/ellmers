/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AbortSignalJobError,
  clearErrorCodeReconstructors,
  createInMemoryQueue,
  InMemoryQueueStorage,
  Job,
  JobDisabledError,
  JobError,
  JobQueueClient,
  JobQueueServer,
  lookupErrorCodeReconstructor,
  PermanentJobError,
  registerErrorCodeReconstructor,
  restoreErrorCodeReconstructors,
  RetryableJobError,
  snapshotErrorCodeReconstructors,
  unregisterErrorCodeReconstructor,
  wrapQueueStorage,
  type IJobExecuteContext,
} from "@workglow/job-queue";
import { sleep } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers — expose the protected reconstruction path so we can assert the
// JobQueueClient round-trip without standing up a full queue.
// ---------------------------------------------------------------------------

class TestableClient<I, O> extends JobQueueClient<I, O> {
  // Surface the protected method for tests; no behavior change.
  public buildErrorFromCodePublic(message: string, errorCode?: string): JobError {
    return this.buildErrorFromCode(message, errorCode);
  }
}

class FooError extends PermanentJobError {
  public static override type = "FooError";
}

class BarError extends RetryableJobError {
  public static override type = "BarError";
}

// ---------------------------------------------------------------------------

describe("JobErrorRegistry", () => {
  // Snapshot the registry before each test and restore after, so registrations
  // made by neighboring test files (e.g. `FetchTask.test.ts` registering
  // FETCH_* via ESM import side-effects) survive this file's mutations. A
  // plain `clear()` would permanently wipe those for the rest of the worker,
  // because ESM module caches mean the registration code only runs once.
  let registrySnapshot: ReturnType<typeof snapshotErrorCodeReconstructors>;
  beforeEach(() => {
    registrySnapshot = snapshotErrorCodeReconstructors();
    // Start each test from a clean slate so prefix assertions are unambiguous.
    clearErrorCodeReconstructors();
  });
  afterEach(() => {
    restoreErrorCodeReconstructors(registrySnapshot);
  });

  test("client reconstructs registered prefix as the registered error class", () => {
    registerErrorCodeReconstructor("FOO_", (errorCode, message) => {
      const err = new FooError(message);
      err.code = errorCode;
      return err;
    });

    const client = new TestableClient<unknown, unknown>({
      ...createInMemoryQueue<unknown, unknown>("q"),
      queueName: "q",
    });
    const err = client.buildErrorFromCodePublic("boom", "FOO_BAR");
    expect(err).toBeInstanceOf(FooError);
    expect(err).toBeInstanceOf(PermanentJobError);
    expect(err.code).toBe("FOO_BAR");
    expect(err.message).toBe("boom");
  });

  test("unregistered code prefix falls back to generic JobError", () => {
    const client = new TestableClient<unknown, unknown>({
      ...createInMemoryQueue<unknown, unknown>("q"),
      queueName: "q",
    });
    const err = client.buildErrorFromCodePublic("oops", "UNKNOWN_PREFIX_FOO");
    // Should be a plain JobError, not any of the built-in subclasses.
    expect(err).toBeInstanceOf(JobError);
    expect(err).not.toBeInstanceOf(PermanentJobError);
    expect(err).not.toBeInstanceOf(RetryableJobError);
    expect(err.code).toBe("UNKNOWN_PREFIX_FOO");
  });

  test("built-in codes still work after the registry rewrite", () => {
    const client = new TestableClient<unknown, unknown>({
      ...createInMemoryQueue<unknown, unknown>("q"),
      queueName: "q",
    });
    expect(client.buildErrorFromCodePublic("p", "PermanentJobError")).toBeInstanceOf(
      PermanentJobError
    );
    expect(client.buildErrorFromCodePublic("r", "RetryableJobError")).toBeInstanceOf(
      RetryableJobError
    );
    expect(client.buildErrorFromCodePublic("a", "AbortSignalJobError")).toBeInstanceOf(
      AbortSignalJobError
    );
    expect(client.buildErrorFromCodePublic("d", "JobDisabledError")).toBeInstanceOf(
      JobDisabledError
    );
  });

  test("registering different fn against same prefix warns and overwrites", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      registerErrorCodeReconstructor("X_", (_c, m) => new FooError(m));
      registerErrorCodeReconstructor("X_", (_c, m) => new BarError(m));
      expect(warn).toHaveBeenCalledOnce();

      const client = new TestableClient<unknown, unknown>({
        ...createInMemoryQueue<unknown, unknown>("q"),
        queueName: "q",
      });
      // Last writer wins — should reconstruct as BarError now.
      expect(client.buildErrorFromCodePublic("m", "X_CODE")).toBeInstanceOf(BarError);
    } finally {
      warn.mockRestore();
    }
  });

  test("registering identical fn against same prefix is idempotent (no warning)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fn = (_c: string, m: string) => new FooError(m);
      registerErrorCodeReconstructor("Y_", fn);
      registerErrorCodeReconstructor("Y_", fn);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("unregisterErrorCodeReconstructor removes a single entry", () => {
    registerErrorCodeReconstructor("Z_", (_c, m) => new FooError(m));
    expect(lookupErrorCodeReconstructor("Z_FOO")).toBeDefined();
    expect(unregisterErrorCodeReconstructor("Z_")).toBe(true);
    expect(lookupErrorCodeReconstructor("Z_FOO")).toBeUndefined();
    // Second remove is a no-op.
    expect(unregisterErrorCodeReconstructor("Z_")).toBe(false);
  });

  test("clearErrorCodeReconstructors restores defaults (no registered entries)", () => {
    registerErrorCodeReconstructor("FOO_", (_c, m) => new FooError(m));
    registerErrorCodeReconstructor("BAR_", (_c, m) => new BarError(m));
    clearErrorCodeReconstructors();
    expect(lookupErrorCodeReconstructor("FOO_X")).toBeUndefined();
    expect(lookupErrorCodeReconstructor("BAR_X")).toBeUndefined();
  });

  test("first-registered-prefix wins when multiple prefixes both match", () => {
    // Register the more general prefix first; a later, more specific prefix
    // should not preempt it — first-registered wins per the documented v1
    // semantics.
    registerErrorCodeReconstructor("ABC_", (_c, m) => new FooError(m));
    registerErrorCodeReconstructor("ABC_DEF_", (_c, m) => new BarError(m));

    const client = new TestableClient<unknown, unknown>({
      ...createInMemoryQueue<unknown, unknown>("q"),
      queueName: "q",
    });
    expect(client.buildErrorFromCodePublic("m", "ABC_DEF_GHI")).toBeInstanceOf(FooError);
  });

  test("registered 'P' prefix does not intercept PermanentJobError built-in", () => {
    // A short prefix that would naively `startsWith`-match the built-in
    // `PermanentJobError` code. The client must dispatch built-ins first so
    // the registered reconstructor is never consulted for them.
    let reconstructorCalls = 0;
    registerErrorCodeReconstructor("P", (errorCode, message) => {
      reconstructorCalls += 1;
      const err = new FooError(message);
      err.code = errorCode;
      return err;
    });

    const client = new TestableClient<unknown, unknown>({
      ...createInMemoryQueue<unknown, unknown>("q"),
      queueName: "q",
    });

    const err = client.buildErrorFromCodePublic("boom", "PermanentJobError");
    expect(err).toBeInstanceOf(PermanentJobError);
    expect(err).not.toBeInstanceOf(FooError);
    expect(reconstructorCalls).toBe(0);
  });

  test("reconstructor that throws falls through to JobError with code preserved", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      registerErrorCodeReconstructor("BOOM_", () => {
        throw new Error("reconstructor exploded");
      });

      const client = new TestableClient<unknown, unknown>({
        ...createInMemoryQueue<unknown, unknown>("q"),
        queueName: "q",
      });

      const err = client.buildErrorFromCodePublic("boom-msg", "BOOM_OOPS");
      // Generic JobError (not any subclass) with code preserved.
      expect(err).toBeInstanceOf(JobError);
      expect(err).not.toBeInstanceOf(PermanentJobError);
      expect(err).not.toBeInstanceOf(RetryableJobError);
      expect(err.code).toBe("BOOM_OOPS");
      expect(err.message).toBe("boom-msg");
    } finally {
      warn.mockRestore();
    }
  });

  test("reconstructor that returns error without code has code injected", () => {
    registerErrorCodeReconstructor("NOCODE_", (_errorCode, message) => {
      // Buggy implementation — forgets to set err.code.
      return new FooError(message);
    });

    const client = new TestableClient<unknown, unknown>({
      ...createInMemoryQueue<unknown, unknown>("q"),
      queueName: "q",
    });

    const err = client.buildErrorFromCodePublic("oops", "NOCODE_BAD");
    expect(err).toBeInstanceOf(FooError);
    expect(err.code).toBe("NOCODE_BAD");
  });

  test("end-to-end: queued job rejection propagates the reconstructed error class", async () => {
    const queueName = "registry-roundtrip-q";
    registerErrorCodeReconstructor("CUSTOM_", (errorCode, message) => {
      const err = new FooError(message);
      err.code = errorCode;
      return err;
    });

    class ThrowsCustomJob extends Job<{ thing: string }, { ok: boolean }> {
      override async execute(
        _input: { thing: string },
        _ctx: IJobExecuteContext
      ): Promise<{ ok: boolean }> {
        const err = new PermanentJobError("worker-side failure");
        err.code = "CUSTOM_RUNTIME";
        throw err;
      }
    }

    const storage = new InMemoryQueueStorage<{ thing: string }, { ok: boolean }>(queueName);
    await storage.migrate();
    const { messageQueue, jobStore } = wrapQueueStorage(storage);
    const server = new JobQueueServer<{ thing: string }, { ok: boolean }>(ThrowsCustomJob, {
      messageQueue,
      jobStore,
      queueName,
      pollIntervalMs: 1,
    });
    const client = new JobQueueClient<{ thing: string }, { ok: boolean }>({
      messageQueue,
      jobStore,
      queueName,
    });
    client.attach(server);

    const handle = await client.send({ thing: "x" }, { maxAttempts: 1 });
    await server.start();
    const err = await handle.waitFor().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FooError);
    expect((err as JobError).code).toBe("CUSTOM_RUNTIME");
    await server.stop();
    await sleep(0);
    await storage.deleteAll();
  });
});
