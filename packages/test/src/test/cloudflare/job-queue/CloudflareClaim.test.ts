/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CloudflareClaim } from "@workglow/cloudflare/job-queue";
import {
  InMemoryJobStore,
  InMemoryQueueStorage,
  JobStatus,
  type JobStorageFormat,
} from "@workglow/job-queue";
import { describe, expect, it, vi } from "vitest";

interface TestInput {
  readonly v: string;
}
interface TestOutput {
  readonly r: string;
}

function fakeMessage(body: unknown) {
  return {
    id: "cf-msg-1",
    body,
    timestamp: new Date(),
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function emptyBody(): JobStorageFormat<TestInput, TestOutput> {
  return { input: { v: "x" }, status: JobStatus.PENDING } as JobStorageFormat<
    TestInput,
    TestOutput
  >;
}

async function setup() {
  const core = new InMemoryQueueStorage<TestInput, TestOutput>("q");
  const jobStore = new InMemoryJobStore(core, new Map());
  const id = await jobStore.create(emptyBody(), {});
  const record = (await jobStore.get(id))!;
  return { jobStore, id, record };
}

describe("CloudflareClaim", () => {
  it("ack({result}) calls message.ack and persists via completeWithResult", async () => {
    const { jobStore, id, record } = await setup();
    const message = fakeMessage({ id: String(id), attempts: 0 });
    const claim = new CloudflareClaim<TestInput, TestOutput>({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      message: message as any,
      jobStore,
      record,
    });

    await claim.ack({ r: "ok" });
    expect(message.ack).toHaveBeenCalledOnce();
    const row = await jobStore.get(id);
    expect(row?.status).toBe(JobStatus.COMPLETED);
    expect(row?.output).toEqual({ r: "ok" });
  });

  it("ack() with no result calls message.ack and writes COMPLETED via saveStatus", async () => {
    const { jobStore, id, record } = await setup();
    const message = fakeMessage({ id: String(id), attempts: 0 });
    const claim = new CloudflareClaim<TestInput, TestOutput>({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      message: message as any,
      jobStore,
      record,
    });

    await claim.ack();
    expect(message.ack).toHaveBeenCalledOnce();
    const row = await jobStore.get(id);
    expect(row?.status).toBe(JobStatus.COMPLETED);
  });

  it("fail({error, errorCode}) calls message.ack (NOT retry) and writes failWithError", async () => {
    const { jobStore, id, record } = await setup();
    const message = fakeMessage({ id: String(id), attempts: 0 });
    const claim = new CloudflareClaim<TestInput, TestOutput>({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      message: message as any,
      jobStore,
      record,
    });

    await claim.fail({ error: "boom", errorCode: "E_BOOM", abortRequested: false });

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    const row = await jobStore.get(id);
    expect(row?.status).toBe(JobStatus.FAILED);
    expect(row?.error).toBe("boom");
  });

  it("retry({delaySeconds: 30}) calls message.retry({ delaySeconds: 30 })", async () => {
    const { jobStore, id, record } = await setup();
    const message = fakeMessage({ id: String(id), attempts: 0 });
    const claim = new CloudflareClaim<TestInput, TestOutput>({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      message: message as any,
      jobStore,
      record,
    });

    await claim.retry({ delaySeconds: 30 });
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
  });

  it("extendLease(1000) throws referencing Cloudflare Queues", async () => {
    const { jobStore, id, record } = await setup();
    const message = fakeMessage({ id: String(id), attempts: 0 });
    const claim = new CloudflareClaim<TestInput, TestOutput>({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      message: message as any,
      jobStore,
      record,
    });
    await expect(claim.extendLease(1000)).rejects.toThrow(/Cloudflare Queues/);
  });
});
