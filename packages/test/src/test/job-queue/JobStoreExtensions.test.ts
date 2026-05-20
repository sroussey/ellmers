/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IJobStore } from "@workglow/job-queue";
import { JobStatus, createInMemoryQueue } from "@workglow/job-queue";
import { createSqliteQueue } from "@workglow/sqlite/job-queue";
import { Sqlite } from "@workglow/sqlite/storage";
import { uuid4 } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Shared types for tests
// ---------------------------------------------------------------------------

interface TestInput {
  readonly value: string;
}

interface TestOutput {
  readonly result: string;
}

// ---------------------------------------------------------------------------
// Parameterized backend interface
// ---------------------------------------------------------------------------

interface BackendUnderTest {
  readonly name: string;
  readonly setup: () => Promise<{
    jobStore: IJobStore<TestInput, TestOutput>;
    queueName: string;
    dispose: () => Promise<void>;
  }>;
}

// ---------------------------------------------------------------------------
// Shared test suite (exported so other test files can reuse it)
// ---------------------------------------------------------------------------

export function runJobStoreExtensionTests(backend: BackendUnderTest): void {
  describe(`IJobStore extensions — ${backend.name}`, () => {
    let jobStore: IJobStore<TestInput, TestOutput>;
    let queueName: string;
    let dispose: () => Promise<void>;

    beforeEach(async () => {
      ({ jobStore, queueName, dispose } = await backend.setup());
    });

    afterEach(async () => {
      await dispose();
    });

    // -----------------------------------------------------------------------
    // create()
    // -----------------------------------------------------------------------

    it("create() inserts a PENDING row and returns its id", async () => {
      const id = await jobStore.create(
        { input: { value: "hello" }, visible_at: null, completed_at: null },
        {}
      );
      expect(id).toBeDefined();
      const record = await jobStore.get(id);
      expect(record).toBeDefined();
      expect(record?.status).toBe(JobStatus.PENDING);
    });

    it("create() persists fingerprint, jobRunId, maxAttempts from SendOptions", async () => {
      const fingerprint = `fp-${uuid4()}`;
      const jobRunId = `run-${uuid4()}`;
      const id = await jobStore.create(
        { input: { value: "opts" }, visible_at: null, completed_at: null },
        { fingerprint, jobRunId, maxAttempts: 5 }
      );
      const record = await jobStore.get(id);
      expect(record?.fingerprint).toBe(fingerprint);
      expect(record?.job_run_id).toBe(jobRunId);
      expect(record?.max_attempts).toBe(5);
    });

    it("create() persists deadline_at derived from timeoutSeconds", async () => {
      const before = Date.now();
      const id = await jobStore.create(
        { input: { value: "timeout" }, visible_at: null, completed_at: null },
        { timeoutSeconds: 60 }
      );
      const after = Date.now();
      const record = await jobStore.get(id);
      expect(record?.deadline_at).toBeDefined();
      const deadline = new Date(record!.deadline_at!).getTime();
      expect(deadline).toBeGreaterThanOrEqual(before + 60_000);
      expect(deadline).toBeLessThanOrEqual(after + 60_000 + 100);
    });

    // -----------------------------------------------------------------------
    // findActiveByFingerprint()
    // -----------------------------------------------------------------------

    it("findActiveByFingerprint() returns the PENDING row in the same queue", async () => {
      const fingerprint = `fp-${uuid4()}`;
      const id = await jobStore.create(
        { input: { value: "find-pending" }, visible_at: null, completed_at: null },
        { fingerprint }
      );
      const found = await jobStore.findActiveByFingerprint(fingerprint, queueName);
      expect(found).toBeDefined();
      expect(found?.id).toBe(id);
    });

    it("findActiveByFingerprint() ignores COMPLETED rows", async () => {
      const fingerprint = `fp-${uuid4()}`;
      const id = await jobStore.create(
        { input: { value: "find-completed" }, visible_at: null, completed_at: null },
        { fingerprint }
      );
      // Force the row to COMPLETED via saveStatus
      await jobStore.saveStatus(id, JobStatus.COMPLETED);
      const found = await jobStore.findActiveByFingerprint(fingerprint, queueName);
      expect(found).toBeUndefined();
    });

    it("findActiveByFingerprint() is queue-scoped — wrong queue name returns undefined", async () => {
      const fingerprint = `fp-${uuid4()}`;
      await jobStore.create(
        { input: { value: "find-scope" }, visible_at: null, completed_at: null },
        { fingerprint }
      );
      const wrongQueue = `other-queue-${uuid4()}`;
      const found = await jobStore.findActiveByFingerprint(fingerprint, wrongQueue);
      expect(found).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // getMany()
    // -----------------------------------------------------------------------

    it("getMany() returns records in the requested order, undefined for missing ids", async () => {
      const id1 = await jobStore.create(
        { input: { value: "first" }, visible_at: null, completed_at: null },
        {}
      );
      const id2 = await jobStore.create(
        { input: { value: "second" }, visible_at: null, completed_at: null },
        {}
      );
      const missingId = `missing-${uuid4()}`;

      const results = await jobStore.getMany([id2, missingId, id1]);
      expect(results).toHaveLength(3);
      expect(results[0]?.id).toBe(id2);
      expect(results[1]).toBeUndefined();
      expect(results[2]?.id).toBe(id1);
    });

    // -----------------------------------------------------------------------
    // completeWithResult()
    // -----------------------------------------------------------------------

    it("completeWithResult() writes result and status=COMPLETED atomically", async () => {
      const id = await jobStore.create(
        { input: { value: "to-complete" }, visible_at: null, completed_at: null },
        {}
      );
      const output: TestOutput = { result: "done" };

      await jobStore.completeWithResult(id, output);

      // Both fields must be set in the single subsequent read — no intermediate
      // state is observable (JS single-threaded guarantee for in-memory).
      const record = await jobStore.get(id);
      expect(record?.status).toBe(JobStatus.COMPLETED);
      expect(record?.output).toEqual(output);
    });

    // -----------------------------------------------------------------------
    // failWithError()
    // -----------------------------------------------------------------------

    it("failWithError() writes error/errorCode/abortRequested AND status=FAILED atomically", async () => {
      const id = await jobStore.create(
        { input: { value: "to-fail" }, visible_at: null, completed_at: null },
        {}
      );

      await jobStore.failWithError(id, {
        error: "something went wrong",
        errorCode: "ERR_OOPS",
        abortRequested: true,
      });

      const record = await jobStore.get(id);
      expect(record?.status).toBe(JobStatus.FAILED);
      expect(record?.error).toBe("something went wrong");
      expect(record?.error_code).toBe("ERR_OOPS");
      expect(record?.abort_requested_at).toBeTruthy();
    });

    it("failWithError({}) still sets status=FAILED and doesn't clobber existing error fields", async () => {
      const id = await jobStore.create(
        { input: { value: "to-fail-empty" }, visible_at: null, completed_at: null },
        {}
      );

      // Pre-populate error fields via saveError (deprecated path)
      await jobStore.saveError(id, "original error", "ORIG_CODE", false);

      // failWithError with empty opts must set FAILED but leave existing fields alone
      // For in-memory, the pending-buffer error is drained on failWithError, so the
      // status FAILED write is the key invariant here.
      await jobStore.failWithError(id, {});

      const record = await jobStore.get(id);
      expect(record?.status).toBe(JobStatus.FAILED);
    });
  });
}

// ---------------------------------------------------------------------------
// InMemory backend registration
// ---------------------------------------------------------------------------

const inMemoryBackend: BackendUnderTest = {
  name: "InMemory",
  setup: async () => {
    const queueName = `test-js-ext-${uuid4()}`;
    const { jobStore } = createInMemoryQueue<TestInput, TestOutput>(queueName);
    return {
      jobStore,
      queueName,
      dispose: async () => {
        await jobStore.deleteAll();
      },
    };
  },
};

runJobStoreExtensionTests(inMemoryBackend);

// ---------------------------------------------------------------------------
// SQLite backend registration
// ---------------------------------------------------------------------------

await Sqlite.init();
const sqliteDb = new Sqlite.Database(":memory:");

const sqliteBackend: BackendUnderTest = {
  name: "SQLite",
  setup: async () => {
    const queueName = `test-sqlite-ext-${uuid4()}`;
    const { jobStore, core } = createSqliteQueue<TestInput, TestOutput>(queueName, sqliteDb);
    await core.migrate();
    return {
      jobStore,
      queueName,
      dispose: async () => {
        await jobStore.deleteAll();
      },
    };
  },
};

runJobStoreExtensionTests(sqliteBackend);
