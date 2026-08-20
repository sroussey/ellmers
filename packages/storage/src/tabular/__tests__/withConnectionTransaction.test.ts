/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  InMemoryTabularStorage,
  withConnectionTransaction,
  type AnyTabularStorage,
} from "@workglow/storage";
import { getLogger, setLogger, type ILogger } from "@workglow/util";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const Schema = {
  type: "object",
  properties: {
    name: { type: "string" },
    value: { type: "string" },
  },
  required: ["name", "value"],
} as const satisfies DataPortSchemaObject;

const PrimaryKeyNames = ["name"] as const;

async function makeInMemory(): Promise<AnyTabularStorage> {
  const storage = new InMemoryTabularStorage<typeof Schema, typeof PrimaryKeyNames>(
    Schema,
    PrimaryKeyNames
  );
  await storage.setupDatabase?.();
  return storage as unknown as AnyTabularStorage;
}

describe("withConnectionTransaction: participant list", () => {
  let previous: ILogger;

  beforeEach(() => {
    previous = getLogger();
  });

  afterEach(() => {
    setLogger(previous ?? getTestingLogger());
  });

  it("rejects an empty participant list instead of silently running unwrapped", async () => {
    const fn = vi.fn(async () => "done");
    await expect(withConnectionTransaction([], fn)).rejects.toThrow(
      /requires at least one participant/
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it("runs an all-best-effort list unwrapped, and says so at debug", async () => {
    const debug = vi.fn();
    const spyLogger = { ...getTestingLogger(), debug } as unknown as ILogger;
    setLogger(spyLogger);

    const a = await makeInMemory();
    const b = await makeInMemory();
    const result = await withConnectionTransaction([a, b], async () => {
      await a.put({ name: "a", value: "1" });
      await b.put({ name: "b", value: "2" });
      return "ok";
    });

    expect(result).toBe("ok");
    expect(await a.get({ name: "a" })).toMatchObject({ value: "1" });
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining("best-effort"),
      expect.objectContaining({ tables: expect.any(Array) })
    );
  });
});
