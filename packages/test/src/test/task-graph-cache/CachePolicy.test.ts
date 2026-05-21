/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { isPolicyCached, isPolicyPrivate, Task, type CachePolicy } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

describe("CachePolicy", () => {
  it("Task default policy is deterministic", () => {
    const policy = new Task().getCachePolicy({} as any);
    expect(policy).toEqual({ kind: "deterministic" });
  });

  it("static cachePolicy override flows through getCachePolicy", () => {
    class Side extends Task {
      public static override type = "Side";
      public static override cachePolicy: CachePolicy = { kind: "none" };
    }
    expect(new Side().getCachePolicy({} as any)).toEqual({ kind: "none" });
  });

  it("static cacheable=false maps to {kind:'none'}", () => {
    class NoCache extends Task {
      public static override type = "NoCache";
      public static override cacheable = false;
    }
    expect(new NoCache().getCachePolicy({} as any)).toEqual({ kind: "none" });
  });

  it("static cachePolicy wins over static cacheable=false", () => {
    class Mixed extends Task {
      public static override type = "Mixed";
      public static override cacheable = false;
      public static override cachePolicy: CachePolicy = { kind: "private" };
    }
    expect(new Mixed().getCachePolicy({} as any)).toEqual({ kind: "private" });
  });

  it("subclass getCachePolicy override wins over static", () => {
    class Dyn extends Task {
      public static override type = "Dyn";
      public override getCachePolicy(inputs: any): CachePolicy {
        return inputs.priv ? { kind: "private" } : { kind: "deterministic" };
      }
    }
    expect(new Dyn().getCachePolicy({ priv: true } as any)).toEqual({ kind: "private" });
    expect(new Dyn().getCachePolicy({ priv: false } as any)).toEqual({ kind: "deterministic" });
  });

  it("policy helpers", () => {
    expect(isPolicyCached({ kind: "none" })).toBe(false);
    expect(isPolicyCached({ kind: "deterministic" })).toBe(true);
    expect(isPolicyCached({ kind: "private" })).toBe(true);
    expect(isPolicyPrivate({ kind: "private" })).toBe(true);
    expect(isPolicyPrivate({ kind: "deterministic" })).toBe(false);
  });
});
