/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Task } from "@workglow/task-graph";
import { getLogger, setLogger } from "@workglow/util";

describe("legacy static cacheable deprecation", () => {
  let originalLogger: ReturnType<typeof getLogger>;
  let warnings: string[];

  beforeEach(() => {
    originalLogger = getLogger();
    warnings = [];
    setLogger({
      debug: () => {},
      info: () => {},
      warn: (msg: unknown) => warnings.push(String(msg)),
      error: () => {},
    } as any);
  });

  afterEach(() => {
    setLogger(originalLogger);
  });

  it("warns exactly once per task type when static cacheable=false is used without cachePolicy", () => {
    class OldA extends Task {
      public static override type = "OldCacheableA";
      public static override cacheable = false;
    }
    new OldA().getCachePolicy({} as any);
    new OldA().getCachePolicy({} as any);
    new OldA().getCachePolicy({} as any);

    const matches = warnings.filter(
      (w) => w.includes("cacheable") && w.includes("deprecated") && w.includes("OldCacheableA")
    );
    expect(matches.length).toBe(1);
  });

  it("does NOT warn when cachePolicy is set explicitly", () => {
    class New extends Task {
      public static override type = "NewPolicy";
      public static override cachePolicy = { kind: "none" } as const;
    }
    new New().getCachePolicy({} as any);
    const matches = warnings.filter((w) => w.includes("deprecated"));
    expect(matches.length).toBe(0);
  });

  it("returns { kind: 'none' } via the legacy shim", () => {
    class Old extends Task {
      public static override type = "OldNonePolicy";
      public static override cacheable = false;
    }
    expect(new Old().getCachePolicy({} as any)).toEqual({ kind: "none" });
  });
});
