/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JobError } from "@workglow/job-queue";
import {
  createInMemoryQueue,
  InMemoryQueueStorage,
  InMemoryRateLimiterStorage,
  JobQueueClient,
  JobQueueServer,
  JobStatus,
  PermanentJobError,
  RateLimiter,
  RetryableJobError,
  wrapQueueStorage,
} from "@workglow/job-queue";
import {
  getTaskQueueRegistry,
  JobTaskFailedError,
  setTaskQueueRegistry,
  TaskConfigurationError,
} from "@workglow/task-graph";
import type { FetchUrlTaskInput, FetchUrlTaskOutput } from "@workglow/tasks";
import {
  applyCredentialToHeaders,
  createFetchUrlJobError,
  fetchUrl,
  FetchUrlErrorCode,
  FetchUrlJob,
  FetchUrlTask,
  isFetchUrlJobError,
  registerSafeFetch,
  type SafeFetchFn,
} from "@workglow/tasks";
import {
  Container,
  InMemoryCredentialStore,
  registerCredentialDefaults,
  ServiceRegistry,
  setGlobalCredentialStore,
  setLogger,
  sleep,
} from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const mock = vi.fn;

// Create base mock response
const createMockResponse = (jsonData: any = {}): Response => {
  return new Response(JSON.stringify(jsonData), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

// Mock fetch for testing — stubbed into SafeFetch so we bypass the real
// server impl (DNS + undici) during unit tests. These tests cover retry,
// progress, and response-type logic, not SSRF policy.
const mockFetch = mock((_url: string, _options: RequestInit & { allowPrivate?: boolean }) =>
  Promise.resolve(createMockResponse({}))
);
const mockSafeFetch: SafeFetchFn = (url, options) => mockFetch(url, options);

describe("FetchUrlTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let prevSafeFetch: SafeFetchFn;
  beforeAll(() => {
    prevSafeFetch = registerSafeFetch(mockSafeFetch);
  });

  afterAll(() => {
    registerSafeFetch(prevSafeFetch);
  });

  beforeEach(async () => {
    mockFetch.mockClear();
    await setTaskQueueRegistry(null);
  });

  afterEach(async () => {
    await setTaskQueueRegistry(null);
  });

  test("fetches multiple URLs successfully", async () => {
    const mockResponses = [
      { data: { id: 1, name: "Test 1" } },
      { data: { id: 2, name: "Test 2" } },
      { data: { id: 3, name: "Test 3" } },
    ];

    let responseIndex = 0;
    mockFetch.mockImplementation(() =>
      Promise.resolve(createMockResponse(mockResponses[responseIndex++]))
    );

    const urls = [
      "https://api.example.com/1",
      "https://api.example.com/2",
      "https://api.example.com/3",
    ];

    const results = await Promise.all(urls.map((url) => fetchUrl({ url })));
    expect(mockFetch.mock.calls.length).toBe(3);
    expect(results).toHaveLength(3);
    const sorted = results
      .map((result) => (result.json as any)?.data)
      .filter(Boolean)
      .sort((a, b) => (a!.id ?? 0) - (b!.id ?? 0));
    expect(sorted).toEqual(mockResponses.map((r) => r.data));
  });

  test("respects rate limiting with InMemoryQueue", async () => {
    const queueName = "rate-limited-queue";
    // Create a rate limiter that allows 1 request per minute
    const rateLimiter = new RateLimiter(new InMemoryRateLimiterStorage(), queueName, {
      maxExecutions: 1,
      windowSizeInSeconds: 1,
    }); // 1 request per 1 minute window

    // Create storage
    const storage = new InMemoryQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>(queueName);
    await storage.migrate();
    const { messageQueue, jobStore } = wrapQueueStorage(storage);

    // Create server with the FetchUrlJob class
    const server = new JobQueueServer<FetchUrlTaskInput, FetchUrlTaskOutput>(FetchUrlJob, {
      messageQueue,
      jobStore,
      queueName,
      limiter: rateLimiter,
      pollIntervalMs: 1,
    });

    // Create client
    const client = new JobQueueClient<FetchUrlTaskInput, FetchUrlTaskOutput>({
      messageQueue,
      jobStore,
      queueName,
    });

    client.attach(server);

    // Register the queue with the registry
    getTaskQueueRegistry().registerQueue({ server, client, storage });

    const mockResponse = { data: { success: true } };
    mockFetch.mockImplementation(() => Promise.resolve(createMockResponse(mockResponse)));

    // Add jobs to queue via client
    await client.send({ url: "https://api.example.com/1" });
    await client.send({ url: "https://api.example.com/2" });
    await client.send({ url: "https://api.example.com/3" });

    // Start the server and wait for processing
    await server.start();
    await sleep(50); // Give time for rate limiting and processing

    // Verify that fetch was called only once due to rate limiting
    expect(mockFetch.mock.calls.length).toBe(1);

    // Clean up
    await server.stop();
    await storage.deleteAll();
  });

  test("handles HTTP error responses", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response("Not Found", {
          status: 404,
          statusText: "Not Found",
        })
      )
    );

    const fetchPromise = fetchUrl({
      url: "https://api.example.com/notfound",
    });

    const error = await fetchPromise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JobTaskFailedError);
    const jobFailed = error as JobTaskFailedError;
    expect(jobFailed.jobError).toBeInstanceOf(PermanentJobError);
    expect(jobFailed.jobError.message).toContain("404");
    expect(jobFailed.code).toBe(FetchUrlErrorCode.HTTP_CLIENT_ERROR);
    expect(jobFailed.jobError.code).toBe(FetchUrlErrorCode.HTTP_CLIENT_ERROR);
    expect(isFetchUrlJobError(jobFailed.jobError)).toBe(true);
    if (isFetchUrlJobError(jobFailed.jobError)) {
      expect(jobFailed.jobError.httpStatus).toBe(404);
    }

    expect(mockFetch.mock.calls.length).toBe(1);
  });

  test("handles network errors", async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error("Network error")));

    const fetchPromise = fetchUrl({
      url: "https://api.example.com/network-error",
    });

    const error = await fetchPromise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JobTaskFailedError);
    const jobFailed = error as JobTaskFailedError;
    expect(jobFailed.message).toContain("Network error");
    expect(jobFailed.code).toBe(FetchUrlErrorCode.NETWORK_ERROR);
    expect(jobFailed.jobError.code).toBe(FetchUrlErrorCode.NETWORK_ERROR);
    expect(jobFailed.jobError).toBeInstanceOf(RetryableJobError);

    expect(mockFetch.mock.calls.length).toBe(1);
  });

  test("handles invalid JSON responses", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response("Invalid JSON", {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        })
      )
    );

    const fetchPromise = fetchUrl({
      url: "https://api.example.com/invalid-json",
    });

    const error = await fetchPromise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JobTaskFailedError);
    const jobFailed = error as JobTaskFailedError;
    expect(jobFailed.message).toContain("parse");
    expect(jobFailed.code).toBe(FetchUrlErrorCode.RESPONSE_PARSE_ERROR);

    expect(mockFetch.mock.calls.length).toBe(1);
  });

  test("handles mixed success and failure responses", async () => {
    mockFetch.mockImplementation((input: string) => {
      const url = input;
      if (url.includes("/success")) {
        return Promise.resolve(createMockResponse({ data: "success" }));
      } else if (url.includes("/network-error")) {
        return Promise.reject(new Error("Network error"));
      } else {
        return Promise.resolve(
          new Response("Not Found", {
            status: 404,
            statusText: "Not Found",
          })
        );
      }
    });

    const urls = [
      "https://api.example.com/success",
      "https://api.example.com/network-error",
      "https://api.example.com/not-found",
    ];

    const results = await Promise.allSettled(urls.map((url) => fetchUrl({ url })));

    expect(mockFetch.mock.calls.length).toBe(3);
    expect(results[0].status).toBe("fulfilled");
    expect((results[0] as PromiseFulfilledResult<any>).value.json).toEqual({ data: "success" });
    expect(results[1].status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason.message).toContain("Network error");
    expect(results[2].status).toBe("rejected");
    expect((results[2] as PromiseRejectedResult).reason).toBeInstanceOf(JobTaskFailedError);
    expect((results[2] as PromiseRejectedResult).reason.jobError).toBeInstanceOf(PermanentJobError);
    expect((results[2] as PromiseRejectedResult).reason.message).toContain("404");
  });

  test("handles rate limit responses with Retry-After header as seconds", async () => {
    const retryAfterSeconds = 30;
    const beforeTest = Date.now();
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response("Too Many Requests", {
          status: 429,
          statusText: "Too Many Requests",
          headers: {
            "Retry-After": retryAfterSeconds.toString(),
          },
        })
      )
    );

    const error = await fetchUrl({
      url: "https://api.example.com/rate-limited",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(JobTaskFailedError);
    expect(error.code).toBe(FetchUrlErrorCode.HTTP_RATE_LIMITED);
    expect(error.jobError.message).toContain("429");
    expect(error.jobError.retryDate).toBeInstanceOf(Date);

    // Should be approximately retryAfterSeconds in the future
    const expectedTime = beforeTest + retryAfterSeconds * 1000;
    const actualTime = error.jobError.retryDate.getTime();
    const tolerance = 1000; // 1 second tolerance

    expect(actualTime).toBeGreaterThan(expectedTime - tolerance);
    expect(actualTime).toBeLessThan(expectedTime + tolerance);
    expect(mockFetch.mock.calls.length).toBe(1);
  });

  test("handles service unavailable with default retry time", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response("Service Unavailable", {
          status: 503,
          statusText: "Service Unavailable",
        })
      )
    );

    const error = await fetchUrl({
      url: "https://api.example.com/service-unavailable",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(JobTaskFailedError);
    expect(error.code).toBe(FetchUrlErrorCode.HTTP_SERVER_ERROR);
    expect(error.jobError).toBeInstanceOf(RetryableJobError);
    expect(error.jobError.message).toContain("503");

    expect(mockFetch.mock.calls.length).toBe(1);
  });

  test("persists FETCH_* error_code on queued job failure", async () => {
    const queueName = "fetch-error-code-queue";
    const storage = new InMemoryQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>(queueName);
    await storage.migrate();
    const { messageQueue, jobStore } = wrapQueueStorage(storage);

    const server = new JobQueueServer<FetchUrlTaskInput, FetchUrlTaskOutput>(FetchUrlJob, {
      messageQueue,
      jobStore,
      queueName,
      pollIntervalMs: 1,
    });
    const client = new JobQueueClient<FetchUrlTaskInput, FetchUrlTaskOutput>({
      messageQueue,
      jobStore,
      queueName,
    });
    client.attach(server);
    getTaskQueueRegistry().registerQueue({ server, client, storage });

    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response("Not Found", { status: 404, statusText: "Not Found" }))
    );

    const handle = await client.send({ url: "https://api.example.com/missing" });
    await server.start();
    const queueError = await handle.waitFor().catch((e: unknown) => e);
    expect(queueError).toBeInstanceOf(PermanentJobError);
    expect((queueError as PermanentJobError).code).toBe(FetchUrlErrorCode.HTTP_CLIENT_ERROR);

    const failedJob = await client.getJob(handle.id);
    expect(failedJob?.errorCode).toBe(FetchUrlErrorCode.HTTP_CLIENT_ERROR);

    await server.stop();
    await storage.deleteAll();
  });

  test("handles Retry-After with HTTP date format", async () => {
    const retryDate = new Date(Date.now() + 60000); // 1 minute in the future
    const retryDateStr = retryDate.toUTCString();
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response("Too Many Requests", {
          status: 429,
          statusText: "Too Many Requests",
          headers: {
            "retry-after": retryDateStr,
          },
        })
      )
    );

    const error = await fetchUrl({
      url: "https://api.example.com/rate-limited-date",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(JobTaskFailedError);
    expect(error.jobError).toBeInstanceOf(RetryableJobError);
    expect(error.jobError.message).toContain("429");
    expect(error.jobError.retryDate).toBeInstanceOf(Date);
    expect(error.jobError.retryDate > new Date()).toBe(true); // Should be in the future

    // Should be close to our specified retry date
    const timeDiff = Math.abs(error.jobError.retryDate.getTime() - retryDate.getTime());
    expect(timeDiff).toBeLessThan(1000); // Within 1 second
    expect(mockFetch.mock.calls.length).toBe(1);
  });

  test("handles invalid Retry-After date by falling back to seconds", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response("Too Many Requests", {
          status: 429,
          statusText: "Too Many Requests",
          headers: {
            "Retry-After": "invalid-date",
          },
        })
      )
    );

    const error = await fetchUrl({
      url: "https://api.example.com/rate-limited-invalid",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(JobTaskFailedError);
    expect(error.jobError).toBeInstanceOf(RetryableJobError);
    expect(error.jobError.message).toContain("429");
    expect(error.jobError.retryDate).not.toBeInstanceOf(Date);
    expect(mockFetch.mock.calls.length).toBe(1);
  });

  test("handles past Retry-After in the past", async () => {
    const pastDate = new Date(Date.now() - 60000); // 1 minute in the past
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response("Too Many Requests", {
          status: 429,
          statusText: "Too Many Requests",
          headers: {
            "Retry-After": pastDate.toUTCString(),
          },
        })
      )
    );

    const error = await fetchUrl({
      url: "https://api.example.com/rate-limited-past",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(JobTaskFailedError);
    expect(error.jobError).toBeInstanceOf(RetryableJobError);
    expect(error.jobError.message).toContain("429");
    expect(error.jobError.retryDate).not.toBeInstanceOf(Date);
    expect(mockFetch.mock.calls.length).toBe(1);
  });

  test("handles Retry-After with RFC1123 date format", async () => {
    const retryDate = new Date(Date.now() + 120000); // 2 minutes in the future
    const retryDateStr = retryDate.toUTCString(); // RFC1123 format
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response("Too Many Requests", {
          status: 429,
          statusText: "Too Many Requests",
          headers: {
            "Retry-After": retryDateStr,
          },
        })
      )
    );

    const error = await fetchUrl({
      url: "https://api.example.com/rate-limited-rfc1123",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(JobTaskFailedError);
    expect(error.jobError).toBeInstanceOf(RetryableJobError);
    expect(error.jobError.message).toContain("429");
    expect(error.jobError.retryDate).toBeInstanceOf(Date);

    // Should be very close to the date we provided (within 1 second)
    const tolerance = 1000;
    expect(Math.abs(error.jobError.retryDate.getTime() - retryDate.getTime())).toBeLessThan(
      tolerance
    );
    expect(mockFetch.mock.calls.length).toBe(1);
  });

  test("handles Retry-After with ISO8601 date format", async () => {
    const retryDate = new Date(Date.now() + 180000); // 3 minutes in the future
    const retryDateStr = retryDate.toISOString(); // ISO8601 format
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response("Too Many Requests", {
          status: 429,
          statusText: "Too Many Requests",
          headers: {
            "Retry-After": retryDateStr,
          },
        })
      )
    );

    const error = await fetchUrl({
      url: "https://api.example.com/rate-limited-iso8601",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(JobTaskFailedError);
    expect(error.jobError).toBeInstanceOf(RetryableJobError);
    expect(error.jobError.message).toContain("429");
    expect(error.jobError.retryDate).toBeInstanceOf(Date);

    // Should be very close to the date we provided (within 1 second)
    const tolerance = 1000;
    expect(Math.abs(error.jobError.retryDate.getTime() - retryDate.getTime())).toBeLessThan(
      tolerance
    );
    expect(mockFetch.mock.calls.length).toBe(1);
  });

  describe("dynamic outputSchema", () => {
    test("outputSchema returns all output types when response_type is null", () => {
      const task = new FetchUrlTask({
        defaults: { url: "https://api.example.com/test", response_type: null },
      });
      const schema = task.outputSchema();

      expect(typeof schema).toBe("object");
      expect(schema).not.toBe(false);
      if (typeof schema === "object" && schema !== null && "properties" in schema) {
        expect(schema.properties).toHaveProperty("json");
        expect(schema.properties).toHaveProperty("text");
        expect(schema.properties).toHaveProperty("blob");
        expect(schema.properties).toHaveProperty("arraybuffer");
      }
    });

    test("outputSchema returns all output types when response_type is undefined", () => {
      const task = new FetchUrlTask({ defaults: { url: "https://api.example.com/test" } });
      const schema = task.outputSchema();

      expect(typeof schema).toBe("object");
      expect(schema).not.toBe(false);
      if (typeof schema === "object" && schema !== null && "properties" in schema) {
        expect(schema.properties).toHaveProperty("json");
        expect(schema.properties).toHaveProperty("text");
        expect(schema.properties).toHaveProperty("blob");
        expect(schema.properties).toHaveProperty("arraybuffer");
      }
    });

    test("outputSchema returns only json when response_type is json", () => {
      const task = new FetchUrlTask({
        defaults: { url: "https://api.example.com/test", response_type: "json" },
      });
      const schema = task.outputSchema();

      expect(typeof schema).toBe("object");
      expect(schema).not.toBe(false);
      if (typeof schema === "object" && schema !== null && "properties" in schema) {
        expect(schema.properties).toHaveProperty("json");
        expect(schema.properties).not.toHaveProperty("text");
        expect(schema.properties).not.toHaveProperty("blob");
        expect(schema.properties).not.toHaveProperty("arraybuffer");
      }
    });

    test("outputSchema returns only text when response_type is text", () => {
      const task = new FetchUrlTask({
        defaults: { url: "https://api.example.com/test", response_type: "text" },
      });
      const schema = task.outputSchema();

      expect(typeof schema).toBe("object");
      expect(schema).not.toBe(false);
      if (typeof schema === "object" && schema !== null && "properties" in schema) {
        expect(schema.properties).not.toHaveProperty("json");
        expect(schema.properties).toHaveProperty("text");
        expect(schema.properties).not.toHaveProperty("blob");
        expect(schema.properties).not.toHaveProperty("arraybuffer");
      }
    });

    test("outputSchema returns only blob when response_type is blob", () => {
      const task = new FetchUrlTask({
        defaults: { url: "https://api.example.com/test", response_type: "blob" },
      });
      const schema = task.outputSchema();

      expect(typeof schema).toBe("object");
      expect(schema).not.toBe(false);
      if (typeof schema === "object" && schema !== null && "properties" in schema) {
        expect(schema.properties).not.toHaveProperty("json");
        expect(schema.properties).not.toHaveProperty("text");
        expect(schema.properties).toHaveProperty("blob");
        expect(schema.properties).not.toHaveProperty("arraybuffer");
      }
    });

    test("outputSchema returns only arraybuffer when response_type is arraybuffer", () => {
      const task = new FetchUrlTask({
        defaults: { url: "https://api.example.com/test", response_type: "arraybuffer" },
      });
      const schema = task.outputSchema();

      expect(typeof schema).toBe("object");
      expect(schema).not.toBe(false);
      if (typeof schema === "object" && schema !== null && "properties" in schema) {
        expect(schema.properties).not.toHaveProperty("json");
        expect(schema.properties).not.toHaveProperty("text");
        expect(schema.properties).not.toHaveProperty("blob");
        expect(schema.properties).toHaveProperty("arraybuffer");
      }
    });

    test("outputSchema updates when response_type changes", () => {
      const task = new FetchUrlTask<FetchUrlTaskInput>({
        defaults: { url: "https://api.example.com/test", response_type: null },
      });
      let schema = task.outputSchema();

      // Initially should have all types (4 response types + metadata)
      expect(typeof schema).toBe("object");
      expect(schema).not.toBe(false);
      if (typeof schema === "object" && schema !== null && "properties" in schema) {
        expect(Object.keys(schema.properties || {})).toHaveLength(5);
        expect(schema.properties).toHaveProperty("metadata");
      }

      // Change response_type to json
      task.setInput({ response_type: "json" });
      schema = task.outputSchema();

      expect(typeof schema).toBe("object");
      expect(schema).not.toBe(false);
      if (typeof schema === "object" && schema !== null && "properties" in schema) {
        expect(Object.keys(schema.properties || {})).toHaveLength(2); // json + metadata
        expect(schema.properties).toHaveProperty("json");
        expect(schema.properties).toHaveProperty("metadata");
      }
    });

    test("execution with null response_type defaults to json", async () => {
      const mockResponse = { data: { success: true } };
      mockFetch.mockImplementation(() => Promise.resolve(createMockResponse(mockResponse)));

      const result = await fetchUrl({
        url: "https://api.example.com/test",
        response_type: null,
      });

      expect(result).toHaveProperty("json");
      expect(result.json).toEqual(mockResponse);
      expect(mockFetch.mock.calls.length).toBe(1);
    });

    test("emits schemaChange event when response_type changes", () => {
      const task = new FetchUrlTask<FetchUrlTaskInput>({
        defaults: { url: "https://api.example.com/test", response_type: null },
      });

      let schemaChangeEmitted = false;
      let receivedInputSchema: any;
      let receivedOutputSchema: any;

      task.on("schemaChange", (inputSchema?: any, outputSchema?: any) => {
        schemaChangeEmitted = true;
        receivedInputSchema = inputSchema;
        receivedOutputSchema = outputSchema;
      });

      // Change response_type from null to "json"
      task.setInput({ response_type: "json" });

      expect(schemaChangeEmitted).toBe(true);
      expect(receivedInputSchema).toBeDefined();
      expect(receivedOutputSchema).toBeDefined();

      // Verify the output schema only has json property
      if (
        typeof receivedOutputSchema === "object" &&
        receivedOutputSchema !== null &&
        "properties" in receivedOutputSchema
      ) {
        expect(receivedOutputSchema.properties).toHaveProperty("json");
        expect(receivedOutputSchema.properties).not.toHaveProperty("text");
        expect(receivedOutputSchema.properties).not.toHaveProperty("blob");
        expect(receivedOutputSchema.properties).not.toHaveProperty("arraybuffer");
      }
    });

    test("emits schemaChange event when response_type changes from json to text", () => {
      const task = new FetchUrlTask<FetchUrlTaskInput>({
        defaults: { url: "https://api.example.com/test", response_type: "json" },
      });

      let schemaChangeEmitted = false;
      let receivedOutputSchema: any;

      task.on("schemaChange", (_inputSchema?: any, outputSchema?: any) => {
        schemaChangeEmitted = true;
        receivedOutputSchema = outputSchema;
      });

      // Change response_type from "json" to "text"
      task.setInput({ response_type: "text" });

      expect(schemaChangeEmitted).toBe(true);
      expect(receivedOutputSchema).toBeDefined();

      // Verify the output schema only has text property
      if (
        typeof receivedOutputSchema === "object" &&
        receivedOutputSchema !== null &&
        "properties" in receivedOutputSchema
      ) {
        expect(receivedOutputSchema.properties).not.toHaveProperty("json");
        expect(receivedOutputSchema.properties).toHaveProperty("text");
        expect(receivedOutputSchema.properties).not.toHaveProperty("blob");
        expect(receivedOutputSchema.properties).not.toHaveProperty("arraybuffer");
      }
    });

    test("does not emit schemaChange event when response_type does not change", () => {
      const task = new FetchUrlTask({
        defaults: { url: "https://api.example.com/test", response_type: "json" },
      });

      let schemaChangeEmitted = false;

      task.on("schemaChange", () => {
        schemaChangeEmitted = true;
      });

      // Set response_type to the same value
      task.setInput({ response_type: "json" });

      expect(schemaChangeEmitted).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // C1 regression: SafeFetch throws permanent FETCH_* errors (SSRF deny, DNS
  // failure, invalid URL, etc). The outer catches in fetchWithProgress /
  // FetchUrlJob.execute previously rewrote *every* non-Abort throw into a
  // NETWORK_ERROR (retryable) — burning the full retry budget on a permanent
  // SSRF deny. Each case below asserts the original code/class is preserved.
  //
  // SECURITY: a permanent SSRF deny that gets re-classified as retryable is
  // a privilege-escalation amplifier — the queue worker keeps the
  // (potentially attacker-controlled) URL alive for 10 attempts. Treat any
  // regression here as a security issue.
  // -------------------------------------------------------------------------
  describe("FetchUrlTask permanent error pass-through", () => {
    const permanentCases: ReadonlyArray<{
      readonly label: string;
      readonly code: (typeof FetchUrlErrorCode)[keyof typeof FetchUrlErrorCode];
    }> = [
      { label: "PRIVATE_DENIED", code: FetchUrlErrorCode.PRIVATE_DENIED },
      { label: "SCOPE_DENIED", code: FetchUrlErrorCode.SCOPE_DENIED },
      { label: "INVALID_URL", code: FetchUrlErrorCode.INVALID_URL },
      { label: "DNS_FAILED", code: FetchUrlErrorCode.DNS_FAILED },
      { label: "REDIRECT_MISSING_LOCATION", code: FetchUrlErrorCode.REDIRECT_MISSING_LOCATION },
      { label: "TOO_MANY_REDIRECTS", code: FetchUrlErrorCode.TOO_MANY_REDIRECTS },
      { label: "NO_RESPONSE_BODY", code: FetchUrlErrorCode.NO_RESPONSE_BODY },
      { label: "CONFIGURATION", code: FetchUrlErrorCode.CONFIGURATION },
    ];

    for (const { label, code } of permanentCases) {
      test(`${label} thrown by safeFetch is preserved (not rewrapped as NETWORK_ERROR)`, async () => {
        mockFetch.mockImplementation(() =>
          Promise.reject(createFetchUrlJobError(code, `${label} from mock`, { url: "x" }))
        );

        const fetchPromise = fetchUrl({
          url: "https://api.example.com/will-deny",
        });
        const error = await fetchPromise.catch((e: unknown) => e);
        // JobTaskFailedError wraps at the task layer; assert on `.jobError`.
        const jobErr = (error as { jobError?: unknown }).jobError ?? error;
        expect(isFetchUrlJobError(jobErr)).toBe(true);
        expect((jobErr as { code?: string }).code).toBe(code);
        expect(jobErr).toBeInstanceOf(PermanentJobError);
        // Critical: not rewrapped as NETWORK_ERROR (retryable).
        expect((jobErr as { code?: string }).code).not.toBe(FetchUrlErrorCode.NETWORK_ERROR);
      });
    }

    test("genuine TypeError still wraps to NETWORK_ERROR (positive control)", async () => {
      mockFetch.mockImplementation(() =>
        Promise.reject(new TypeError("connect ECONNREFUSED 127.0.0.1:443"))
      );
      const error = await fetchUrl({ url: "https://api.example.com/down" }).catch(
        (e: unknown) => e
      );
      const jobErr = (error as { jobError?: unknown }).jobError ?? error;
      expect(isFetchUrlJobError(jobErr)).toBe(true);
      expect((jobErr as { code?: string }).code).toBe(FetchUrlErrorCode.NETWORK_ERROR);
      expect(jobErr).toBeInstanceOf(RetryableJobError);
    });
  });

  describe("credentials", () => {
    const SECRET = "sk-super-secret-value-1234567890";
    const CREDENTIAL_KEY = "my-api-credential";

    /**
     * Builds a registry scoped to its own container so the credential store
     * never leaks into the global registry shared by the other suites.
     */
    const createCredentialRegistry = async (
      entries: Readonly<Record<string, string>> = { [CREDENTIAL_KEY]: SECRET }
    ): Promise<ServiceRegistry> => {
      const registry = new ServiceRegistry(new Container());
      registerCredentialDefaults(registry);
      const store = new InMemoryCredentialStore();
      for (const [key, value] of Object.entries(entries)) {
        await store.put(key, value);
      }
      setGlobalCredentialStore(store, registry);
      return registry;
    };

    const lastRequestHeaders = (): Record<string, string> => {
      const call = mockFetch.mock.calls.at(-1);
      const options = call?.[1] as { headers?: Record<string, string> } | undefined;
      return options?.headers ?? {};
    };

    test("resolves credential_key into an Authorization: Bearer header", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(createMockResponse({ ok: true })));

      const registry = await createCredentialRegistry();
      const task = new FetchUrlTask();
      await task.run(
        { url: "https://api.example.com/data", credential_key: CREDENTIAL_KEY },
        { registry }
      );

      expect(lastRequestHeaders().Authorization).toBe(`Bearer ${SECRET}`);
    });

    test("keeps the secret out of the request body and off the job input", async () => {
      let seenInput: FetchUrlTaskInput | undefined;
      const originalExecute = FetchUrlJob.prototype.execute;
      const spy = vi.spyOn(FetchUrlJob.prototype, "execute").mockImplementation(async function (
        this: FetchUrlJob,
        input: any,
        context: any
      ) {
        seenInput = input;
        return originalExecute.call(this, input, context) as any;
      });

      try {
        mockFetch.mockImplementation(() => Promise.resolve(createMockResponse({ ok: true })));

        const registry = await createCredentialRegistry();
        const task = new FetchUrlTask();
        await task.run(
          {
            url: "https://api.example.com/data",
            method: "POST",
            body: "payload-without-secrets",
            credential_key: CREDENTIAL_KEY,
          },
          { registry }
        );

        // The resolved secret must never survive as a data port: it is a header,
        // not an input field the job (or a queue) can persist.
        expect(seenInput).toBeDefined();
        expect(seenInput).not.toHaveProperty("credential_key");
        expect(seenInput?.body).toBe("payload-without-secrets");

        const call = mockFetch.mock.calls.at(-1);
        const options = call?.[1] as { body?: string } | undefined;
        expect(options?.body).toBe("payload-without-secrets");
        expect(options?.body ?? "").not.toContain(SECRET);
      } finally {
        spy.mockRestore();
      }
    });

    // -----------------------------------------------------------------------
    // Regression: a resolved secret must never reach durable queue storage.
    // The queued path persists the job input (SQLite/Postgres/SQS), so the
    // credential is refused up front instead of being written to disk.
    // -----------------------------------------------------------------------
    test("refuses the queued path when a credential is present, and persists no secret", async () => {
      const queueName = "credential-leak-queue";
      const storage = new InMemoryQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>(queueName);
      await storage.migrate();
      const { messageQueue, jobStore } = wrapQueueStorage(storage);
      const server = new JobQueueServer<FetchUrlTaskInput, FetchUrlTaskOutput>(FetchUrlJob, {
        messageQueue,
        jobStore,
        queueName,
        pollIntervalMs: 1,
      });
      const client = new JobQueueClient<FetchUrlTaskInput, FetchUrlTaskOutput>({
        messageQueue,
        jobStore,
        queueName,
      });
      client.attach(server);
      getTaskQueueRegistry().registerQueue({ server, client, storage });

      mockFetch.mockImplementation(() => Promise.resolve(createMockResponse({ ok: true })));

      try {
        const registry = await createCredentialRegistry();
        const task = new FetchUrlTask({ queue: queueName });
        const error = await task
          .run(
            { url: "https://api.example.com/data", credential_key: CREDENTIAL_KEY },
            { registry }
          )
          .catch((e: unknown) => e);

        // The leak assertion comes first: it is the defect under regression.
        const persisted = JSON.stringify(storage.jobQueue);
        expect(persisted).not.toContain(SECRET);
        expect(await storage.size(JobStatus.PENDING)).toBe(0);

        // ...and the refusal must be explicit, never a silent downgrade to the
        // inline path (which would quietly drop queue-level rate limiting).
        const configError = (error as { cause?: unknown })?.cause ?? error;
        expect(String((configError as Error)?.message ?? "")).toContain("credential");
        expect(String((configError as Error)?.message ?? "")).not.toContain(SECRET);
      } finally {
        await server.stop();
        await storage.deleteAll();
      }
    });

    test("credential_scheme 'header' places the secret in the named header only", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(createMockResponse({ ok: true })));

      const registry = await createCredentialRegistry();
      const task = new FetchUrlTask();
      await task.run(
        {
          url: "https://api.example.com/data",
          credential_key: CREDENTIAL_KEY,
          credential_scheme: "header",
          credential_header: "X-Api-Key",
        },
        { registry }
      );

      const headers = lastRequestHeaders();
      expect(headers["X-Api-Key"]).toBe(SECRET);
      expect(headers.Authorization).toBeUndefined();
    });

    test("credential_scheme 'basic' sends the secret as a Basic credential", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(createMockResponse({ ok: true })));

      const registry = await createCredentialRegistry();
      const task = new FetchUrlTask();
      await task.run(
        {
          url: "https://api.example.com/data",
          credential_key: CREDENTIAL_KEY,
          credential_scheme: "basic",
        },
        { registry }
      );

      expect(lastRequestHeaders().Authorization).toBe(`Basic ${SECRET}`);
    });

    test("credential_scheme 'none' resolves the credential but sends no header", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(createMockResponse({ ok: true })));

      const registry = await createCredentialRegistry();
      const task = new FetchUrlTask();
      await task.run(
        {
          url: "https://api.example.com/data",
          credential_key: CREDENTIAL_KEY,
          credential_scheme: "none",
        },
        { registry }
      );

      const headers = lastRequestHeaders();
      expect(headers.Authorization).toBeUndefined();
      expect(JSON.stringify(headers)).not.toContain(SECRET);
    });

    test("rejects a credential_header carrying CRLF (header injection)", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(createMockResponse({ ok: true })));

      const registry = await createCredentialRegistry();
      const task = new FetchUrlTask();
      const error = await task
        .run(
          {
            url: "https://api.example.com/data",
            credential_key: CREDENTIAL_KEY,
            credential_scheme: "header",
            credential_header: "X-Api-Key\r\nX-Injected: evil",
          },
          { registry }
        )
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      const configError = (error as { cause?: unknown })?.cause ?? error;
      expect(String((configError as Error)?.message ?? "")).toContain("credential_header");
      expect(mockFetch.mock.calls.length).toBe(0);
    });

    test("a missing credential key sends no Authorization and never echoes the key name", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(createMockResponse({ ok: true })));

      // Registry has a store, but not this key.
      const registry = await createCredentialRegistry({ "some-other-key": SECRET });
      const task = new FetchUrlTask();
      await task.run(
        { url: "https://api.example.com/data", credential_key: "absent-key-name" },
        { registry }
      );

      const headers = lastRequestHeaders();
      expect(headers.Authorization).toBeUndefined();
      // Guards the CredentialStoreRegistry invariant: a miss resolves to
      // undefined, never to the reference id, so the key *name* is never
      // threaded through as if it were the secret.
      expect(JSON.stringify(headers)).not.toContain("absent-key-name");
    });

    test("a resolved credential overrides a user-supplied Authorization header", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(createMockResponse({ ok: true })));

      const registry = await createCredentialRegistry();
      const task = new FetchUrlTask();
      await task.run(
        {
          url: "https://api.example.com/data",
          headers: { Authorization: "Bearer hard-coded-token", "X-Trace": "keep-me" },
          credential_key: CREDENTIAL_KEY,
        },
        { registry }
      );

      const headers = lastRequestHeaders();
      expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
      expect(headers["X-Trace"]).toBe("keep-me");
    });
  });

  describe("applyCredentialToHeaders", () => {
    test("defaults to bearer and leaves other headers intact", () => {
      expect(
        applyCredentialToHeaders({
          headers: { "X-Trace": "abc" },
          credential: "s3cret",
          scheme: undefined,
          headerName: undefined,
        })
      ).toEqual({ "X-Trace": "abc", Authorization: "Bearer s3cret" });
    });

    test("passes a basic credential through verbatim", () => {
      expect(
        applyCredentialToHeaders({
          headers: undefined,
          credential: "dXNlcjpwYXNz",
          scheme: "basic",
          headerName: undefined,
        })
      ).toEqual({ Authorization: "Basic dXNlcjpwYXNz" });
    });

    test("places the credential in a custom header", () => {
      expect(
        applyCredentialToHeaders({
          headers: undefined,
          credential: "s3cret",
          scheme: "header",
          headerName: "X-Api-Key",
        })
      ).toEqual({ "X-Api-Key": "s3cret" });
    });

    test("'none' applies nothing", () => {
      expect(
        applyCredentialToHeaders({
          headers: { "X-Trace": "abc" },
          credential: "s3cret",
          scheme: "none",
          headerName: undefined,
        })
      ).toEqual({ "X-Trace": "abc" });
    });

    test("an absent credential is a no-op", () => {
      expect(
        applyCredentialToHeaders({
          headers: { "X-Trace": "abc" },
          credential: undefined,
          scheme: "bearer",
          headerName: undefined,
        })
      ).toEqual({ "X-Trace": "abc" });
    });

    test.each([
      ["X-Api-Key\r\nX-Injected: evil"],
      ["X-Api Key"],
      ["X-Api:Key"],
      [""],
      ["a".repeat(65)],
    ])("rejects invalid header name %j", (headerName) => {
      expect(() =>
        applyCredentialToHeaders({
          headers: undefined,
          credential: "s3cret",
          scheme: "header",
          headerName,
        })
      ).toThrow(TaskConfigurationError);
    });

    test("replaces a differently-cased header the caller supplied", () => {
      // HTTP header names are case-insensitive, and `new Headers({...})` folds
      // duplicate spellings into one comma-joined field — so leaving the
      // caller's key in place would send the stale token alongside the real one.
      expect(
        applyCredentialToHeaders({
          headers: { authorization: "Bearer stale", "X-Trace": "abc" },
          credential: "s3cret",
          scheme: "bearer",
          headerName: undefined,
        })
      ).toEqual({ "X-Trace": "abc", Authorization: "Bearer s3cret" });

      expect(
        applyCredentialToHeaders({
          headers: { "x-api-key": "stale" },
          credential: "s3cret",
          scheme: "header",
          headerName: "X-Api-Key",
        })
      ).toEqual({ "X-Api-Key": "s3cret" });
    });

    test("validates the header name even when the scheme ignores it", () => {
      expect(() =>
        applyCredentialToHeaders({
          headers: undefined,
          credential: "s3cret",
          scheme: "bearer",
          headerName: "bad\r\nname",
        })
      ).toThrow(TaskConfigurationError);
    });
  });

  // -------------------------------------------------------------------------
  // Regression: confirm @workglow/tasks registers its FETCH_*
  // reconstructor on import so JobQueueClient round-trips persisted codes
  // back to the correct retryable/permanent JobError subclass.
  // -------------------------------------------------------------------------
  describe("FETCH_* codes reconstructed by JobQueueClient", () => {
    class TestableClient<I, O> extends JobQueueClient<I, O> {
      public buildErrorFromCodePublic(message: string, errorCode?: string): JobError {
        return this.buildErrorFromCode(message, errorCode);
      }
    }

    test("FETCH_HTTP_RATE_LIMITED reconstructed by client is RetryableJobError", () => {
      const client = new TestableClient<unknown, unknown>({
        ...createInMemoryQueue<unknown, unknown>("q"),
        queueName: "q",
      });
      const err = client.buildErrorFromCodePublic("rate limited", "FETCH_HTTP_RATE_LIMITED");
      expect(err).toBeInstanceOf(RetryableJobError);
      expect(err.code).toBe("FETCH_HTTP_RATE_LIMITED");
    });

    test("FETCH_PRIVATE_DENIED reconstructed by client is PermanentJobError", () => {
      const client = new TestableClient<unknown, unknown>({
        ...createInMemoryQueue<unknown, unknown>("q"),
        queueName: "q",
      });
      const err = client.buildErrorFromCodePublic("private denied", "FETCH_PRIVATE_DENIED");
      expect(err).toBeInstanceOf(PermanentJobError);
      expect(err).not.toBeInstanceOf(RetryableJobError);
      expect(err.code).toBe("FETCH_PRIVATE_DENIED");
    });
  });
});
