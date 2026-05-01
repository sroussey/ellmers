/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { RateLimiter } from "@workglow/job-queue";
import type { IRateLimiterStorage } from "@workglow/storage";
import { describe, expect, it, beforeEach, vi } from "vitest";

interface MockRateLimiterStorage extends IRateLimiterStorage {
  _setExecutionCount: (n: number) => void;
  _setOldestExecution: (t: string | undefined) => void;
}

function createMockStorage(): MockRateLimiterStorage {
  let executionCount = 0;
  let nextAvailableTime: string | undefined = undefined;
  let oldestExecution: string | undefined = undefined;

  return {
    scope: "process" as const,
    setupDatabase: vi.fn(async () => {}),
    getExecutionCount: vi.fn(async () => executionCount),
    recordExecution: vi.fn(async () => {
      executionCount++;
    }),
    tryReserveExecution: vi.fn(async (_q: string, max: number) => {
      const next = nextAvailableTime ? new Date(nextAvailableTime).getTime() : 0;
      if (executionCount >= max || next > Date.now()) return false;
      executionCount++;
      return true;
    }),
    releaseExecution: vi.fn(async () => {
      executionCount = Math.max(0, executionCount - 1);
    }),
    getNextAvailableTime: vi.fn(async () => nextAvailableTime),
    setNextAvailableTime: vi.fn(async (_queue: string, time: string) => {
      nextAvailableTime = time;
    }),
    getOldestExecutionAtOffset: vi.fn(async () => oldestExecution),
    clear: vi.fn(async () => {
      executionCount = 0;
      nextAvailableTime = undefined;
      oldestExecution = undefined;
    }),
    _setExecutionCount: (n: number) => {
      executionCount = n;
    },
    _setOldestExecution: (t: string | undefined) => {
      oldestExecution = t;
    },
  };
}

describe("RateLimiter", () => {
  let storage: MockRateLimiterStorage;

  beforeEach(() => {
    storage = createMockStorage();
  });

  describe("constructor validation", () => {
    it("should throw for maxExecutions <= 0", () => {
      expect(
        () => new RateLimiter(storage, "queue", { maxExecutions: 0, windowSizeInSeconds: 10 })
      ).toThrow("maxExecutions must be greater than 0");
    });

    it("should throw for windowSizeInSeconds <= 0", () => {
      expect(
        () => new RateLimiter(storage, "queue", { maxExecutions: 5, windowSizeInSeconds: 0 })
      ).toThrow("windowSizeInSeconds must be greater than 0");
    });

    it("should throw for initialBackoffDelay <= 0", () => {
      expect(
        () =>
          new RateLimiter(storage, "queue", {
            maxExecutions: 5,
            windowSizeInSeconds: 10,
            initialBackoffDelay: 0,
          })
      ).toThrow("initialBackoffDelay must be greater than 0");
    });

    it("should throw for backoffMultiplier <= 1", () => {
      expect(
        () =>
          new RateLimiter(storage, "queue", {
            maxExecutions: 5,
            windowSizeInSeconds: 10,
            backoffMultiplier: 1,
          })
      ).toThrow("backoffMultiplier must be greater than 1");
    });

    it("should throw for maxBackoffDelay <= initialBackoffDelay", () => {
      expect(
        () =>
          new RateLimiter(storage, "queue", {
            maxExecutions: 5,
            windowSizeInSeconds: 10,
            initialBackoffDelay: 1000,
            maxBackoffDelay: 500,
          })
      ).toThrow("maxBackoffDelay must be greater than initialBackoffDelay");
    });
  });

  describe("canProceed", () => {
    it("should allow when execution count is below limit", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 5,
        windowSizeInSeconds: 60,
      });
      expect(await limiter.canProceed()).toBe(true);
    });

    it("should block when execution count meets limit", async () => {
      storage._setExecutionCount(5);
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 5,
        windowSizeInSeconds: 60,
      });
      expect(await limiter.canProceed()).toBe(false);
    });
  });

  describe("recordJobStart", () => {
    it("should call storage.recordExecution", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 10,
        windowSizeInSeconds: 60,
      });
      await limiter.recordJobStart();
      expect(storage.recordExecution).toHaveBeenCalledWith("queue");
    });
  });

  describe("recordJobCompletion", () => {
    it("should be a no-op", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 10,
        windowSizeInSeconds: 60,
      });
      await expect(limiter.recordJobCompletion()).resolves.toBeUndefined();
    });
  });

  describe("clear", () => {
    it("should clear storage", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 5,
        windowSizeInSeconds: 60,
      });
      await limiter.clear();
      expect(storage.clear).toHaveBeenCalledWith("queue");
    });
  });

  describe("getNextAvailableTime", () => {
    it("should return a Date", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 5,
        windowSizeInSeconds: 60,
      });
      const result = await limiter.getNextAvailableTime();
      expect(result).toBeInstanceOf(Date);
    });
  });

  describe("setNextAvailableTime", () => {
    it("should delegate to storage", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 5,
        windowSizeInSeconds: 60,
      });
      const date = new Date(Date.now() + 5000);
      await limiter.setNextAvailableTime(date);
      expect(storage.setNextAvailableTime).toHaveBeenCalledWith("queue", date.toISOString());
    });
  });

  describe("scope", () => {
    it("should reflect storage scope", () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 5,
        windowSizeInSeconds: 60,
      });
      expect(limiter.scope).toBe("process");
    });
  });

  describe("tryAcquire", () => {
    it("should return true and reserve a slot when capacity is available", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 5,
        windowSizeInSeconds: 60,
      });
      expect(await limiter.tryAcquire()).toBe(true);
      expect(storage.tryReserveExecution).toHaveBeenCalledWith("queue", 5, 60_000);
    });

    it("should return false when storage rejects the reservation", async () => {
      storage._setExecutionCount(5);
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 5,
        windowSizeInSeconds: 60,
      });
      expect(await limiter.tryAcquire()).toBe(false);
    });

    it("should be atomic: 100 parallel acquirers with max=10 produce exactly 10 trues", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 10,
        windowSizeInSeconds: 60,
      });
      const results = await Promise.all(
        Array.from({ length: 100 }, () => limiter.tryAcquire())
      );
      const successes = results.filter((r) => r === true).length;
      expect(successes).toBe(10);
    });
  });

  describe("release", () => {
    it("should delegate to storage.releaseExecution", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 5,
        windowSizeInSeconds: 60,
      });
      await limiter.tryAcquire();
      await limiter.release();
      expect(storage.releaseExecution).toHaveBeenCalledWith("queue");
    });

    it("should free a slot so a follow-up tryAcquire succeeds", async () => {
      const limiter = new RateLimiter(storage, "queue", {
        maxExecutions: 1,
        windowSizeInSeconds: 60,
      });
      expect(await limiter.tryAcquire()).toBe(true);
      expect(await limiter.tryAcquire()).toBe(false);
      await limiter.release();
      expect(await limiter.tryAcquire()).toBe(true);
    });
  });
});
