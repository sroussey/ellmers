/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Imported directly from source — `@workglow/storage` only exposes this class in
// its `browser` conditional export and these tests run under Node.
import { SharedInMemoryTabularStorage } from "../../../../storage/src/tabular/SharedInMemoryTabularStorage";
import { setLogger } from "@workglow/util";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

const SearchSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    user_id: { type: "string" },
    created_at: { type: "string" },
    status: { type: "string" },
  },
  required: ["id", "user_id", "created_at", "status"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;
const SearchPK = ["id"] as const;

describe("SharedInMemoryTabularStorage.queryIndex", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  it("delegates to the inner InMemory storage instead of throwing the base default", async () => {
    const storage = new SharedInMemoryTabularStorage<typeof SearchSchema, typeof SearchPK>(
      `shared_qidx_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      SearchSchema,
      SearchPK,
      [["user_id", "created_at"]]
    );
    await storage.put({ id: "1", user_id: "u", created_at: "0001", status: "done" });
    await storage.put({ id: "2", user_id: "u", created_at: "0005", status: "running" });
    await storage.put({ id: "3", user_id: "v", created_at: "0010", status: "done" });

    const rows = await storage.queryIndex(
      { user_id: "u" },
      { select: ["id", "user_id", "created_at"] }
    );

    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["1", "2"]);
    storage.destroy();
  });
});
