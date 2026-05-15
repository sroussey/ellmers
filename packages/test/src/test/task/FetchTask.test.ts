/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  InMemoryQueueStorage,
  InMemoryRateLimiterStorage,
  JobQueueClient,
  JobQueueServer,
  PermanentJobError,
  RateLimiter,
  RetryableJobError,
} from "@workglow/job-queue";
import {
  getTaskQueueRegistry,
  JobTaskFailedError,
  setTaskQueueRegistry,
} from "@workglow/task-graph";
import {
  fetchUrl,
  FetchUrlJob,
  FetchUrlTask,
  FetchUrlTaskInput,
  FetchUrlTaskOutput,
  registerSafeFetch,
  type SafeFetchFn,
} from "@workglow/tasks";
import { setLogger, sleep } from "@workglow/util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

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

    // Create server with the FetchUrlJob class
    const server = new JobQueueServer<FetchUrlTaskInput, FetchUrlTaskOutput>(FetchUrlJob, {
      storage,
      queueName,
      limiter: rateLimiter,
      pollIntervalMs: 1,
    });

    // Create client
    const client = new JobQueueClient<FetchUrlTaskInput, FetchUrlTaskOutput>({
      storage,
      queueName,
    });

    client.attach(server);

    // Register the queue with the registry
    getTaskQueueRegistry().registerQueue({ server, client, storage });

    const mockResponse = { data: { success: true } };
    mockFetch.mockImplementation(() => Promise.resolve(createMockResponse(mockResponse)));

    // Add jobs to queue via client
    await client.submit({ url: "https://api.example.com/1" });
    await client.submit({ url: "https://api.example.com/2" });
    await client.submit({ url: "https://api.example.com/3" });

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

    try {
      await fetchPromise;
    } catch (e: any) {
      expect(e).toBeInstanceOf(JobTaskFailedError);
      expect(e.jobError).toBeInstanceOf(PermanentJobError);
      expect(e.jobError.message).toContain("404");
    }

    expect(mockFetch.mock.calls.length).toBe(1);
  });

  test("handles network errors", async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error("Network error")));

    const fetchPromise = fetchUrl({
      url: "https://api.example.com/network-error",
    });

    await expect(fetchPromise).rejects.toThrow("Network error");
    await expect(fetchPromise).rejects.toBeInstanceOf(JobTaskFailedError);
    await expect(fetchPromise).rejects.toHaveProperty("jobError");
    await expect(fetchPromise).rejects.toHaveProperty(
      "jobError.message",
      expect.stringContaining("Network error")
    );

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

    await expect(fetchPromise).rejects.toThrow();
    await expect(fetchPromise).rejects.toHaveProperty("message", expect.stringContaining("JSON"));

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
    expect(error.jobError).toBeInstanceOf(RetryableJobError);
    expect(error.jobError.message).toContain("503");

    expect(mockFetch.mock.calls.length).toBe(1);
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
});
