/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CoveringIndexMissingError } from "@workglow/storage";
import { describe, expect, it } from "vitest";

describe("CoveringIndexMissingError", () => {
  it("includes the table name, required columns, and registered indexes in its message", () => {
    const err = new CoveringIndexMissingError(
      "activities",
      ["user_id", "project_id", "created_at", "status"],
      [
        ["user_id", "project_id"],
        ["user_id", "activity_id"],
      ]
    );

    expect(err.message).toContain("activities");
    expect(err.message).toContain("created_at");
    expect(err.message).toContain("status");
    expect(err.message).toContain("user_id, project_id");
    expect(err.name).toBe("CoveringIndexMissingError");
  });

  it("exposes the table, requiredColumns, and registeredIndexes as fields", () => {
    const required = ["a", "b"];
    const registered = [["a"], ["b", "c"]];
    const err = new CoveringIndexMissingError("t", required, registered);
    expect(err.table).toBe("t");
    expect(err.requiredColumns).toEqual(required);
    expect(err.registeredIndexes).toEqual(registered);
  });
});
