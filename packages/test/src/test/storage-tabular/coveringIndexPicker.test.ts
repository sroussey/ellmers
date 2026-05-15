/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CoveringIndexMissingError, pickCoveringIndex } from "@workglow/storage";
import { describe, expect, it } from "vitest";

const indexes = [
  // [user_id, project_id, created_at, status, source_type, source_id, ...]
  {
    name: "idx_project_created_all",
    keyPath: [
      "user_id",
      "project_id",
      "created_at",
      "status",
      "source_type",
      "source_id",
      "started_at",
      "completed_at",
      "failed_at",
      "cancelled_at",
      "progress",
      "priority",
    ],
  },
  // [user_id, project_id, status, created_at, ...]
  {
    name: "idx_project_status_created",
    keyPath: [
      "user_id",
      "project_id",
      "status",
      "created_at",
      "source_type",
      "source_id",
      "started_at",
      "completed_at",
      "failed_at",
      "cancelled_at",
      "progress",
      "priority",
    ],
  },
  // [user_id, project_id, source_type, source_id, created_at, ...]
  {
    name: "idx_source_created_all",
    keyPath: [
      "user_id",
      "project_id",
      "source_type",
      "source_id",
      "created_at",
      "status",
      "started_at",
      "completed_at",
      "failed_at",
      "cancelled_at",
      "progress",
      "priority",
    ],
  },
  // [user_id, project_id, source_type, source_id, status, created_at, ...]
  {
    name: "idx_source_status_created",
    keyPath: [
      "user_id",
      "project_id",
      "source_type",
      "source_id",
      "status",
      "created_at",
      "started_at",
      "completed_at",
      "failed_at",
      "cancelled_at",
      "progress",
      "priority",
    ],
  },
];

const slimSelect = [
  "activity_id",
  "user_id",
  "project_id",
  "source_type",
  "source_id",
  "status",
  "created_at",
  "started_at",
  "completed_at",
  "failed_at",
  "cancelled_at",
  "progress",
  "priority",
] as const;

describe("pickCoveringIndex", () => {
  it("picks the project-created-all index when no status filter", () => {
    const picked = pickCoveringIndex({
      table: "activities",
      indexes,
      criteriaColumns: ["user_id", "project_id"],
      orderByColumns: [{ column: "created_at", direction: "DESC" }],
      selectColumns: slimSelect,
      primaryKeyColumns: ["activity_id"],
    });
    expect(picked.name).toBe("idx_project_created_all");
  });

  it("picks the project-status-created index when status is in criteria", () => {
    const picked = pickCoveringIndex({
      table: "activities",
      indexes,
      criteriaColumns: ["user_id", "project_id", "status"],
      orderByColumns: [{ column: "created_at", direction: "DESC" }],
      selectColumns: slimSelect,
      primaryKeyColumns: ["activity_id"],
    });
    expect(picked.name).toBe("idx_project_status_created");
  });

  it("picks the source-created-all index for workflow sub-list", () => {
    const picked = pickCoveringIndex({
      table: "activities",
      indexes,
      criteriaColumns: ["user_id", "project_id", "source_type", "source_id"],
      orderByColumns: [{ column: "created_at", direction: "DESC" }],
      selectColumns: slimSelect,
      primaryKeyColumns: ["activity_id"],
    });
    expect(picked.name).toBe("idx_source_created_all");
  });

  it("picks the source-status-created index when status is added", () => {
    const picked = pickCoveringIndex({
      table: "activities",
      indexes,
      criteriaColumns: ["user_id", "project_id", "source_type", "source_id", "status"],
      orderByColumns: [{ column: "created_at", direction: "DESC" }],
      selectColumns: slimSelect,
      primaryKeyColumns: ["activity_id"],
    });
    expect(picked.name).toBe("idx_source_status_created");
  });

  it("treats primary key columns as covered without index inclusion", () => {
    const picked = pickCoveringIndex({
      table: "activities",
      indexes,
      criteriaColumns: ["user_id", "project_id"],
      orderByColumns: [{ column: "created_at", direction: "DESC" }],
      selectColumns: ["activity_id"],
      primaryKeyColumns: ["activity_id"],
    });
    expect(picked.name).toBe("idx_project_created_all");
  });

  it("throws CoveringIndexMissingError when criteria column is not in any prefix", () => {
    expect(() =>
      pickCoveringIndex({
        table: "activities",
        indexes,
        criteriaColumns: ["trigger_id"],
        orderByColumns: [],
        selectColumns: ["activity_id"],
        primaryKeyColumns: ["activity_id"],
      })
    ).toThrow(CoveringIndexMissingError);
  });

  it("throws when select column is not in any keypath and not in PK", () => {
    expect(() =>
      pickCoveringIndex({
        table: "activities",
        indexes,
        criteriaColumns: ["user_id", "project_id"],
        orderByColumns: [{ column: "created_at", direction: "DESC" }],
        selectColumns: ["input_data"],
        primaryKeyColumns: ["activity_id"],
      })
    ).toThrow(CoveringIndexMissingError);
  });

  it("throws when orderBy column does not immediately follow the criteria prefix", () => {
    expect(() =>
      pickCoveringIndex({
        table: "activities",
        indexes,
        criteriaColumns: ["user_id"],
        orderByColumns: [{ column: "status", direction: "ASC" }],
        selectColumns: ["activity_id"],
        primaryKeyColumns: ["activity_id"],
      })
    ).toThrow(CoveringIndexMissingError);
  });

  it("error message lists the uncovered columns and the considered indexes", () => {
    try {
      pickCoveringIndex({
        table: "activities",
        indexes,
        criteriaColumns: ["user_id", "project_id"],
        orderByColumns: [],
        selectColumns: ["input_data", "output_data"],
        primaryKeyColumns: ["activity_id"],
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CoveringIndexMissingError);
      const e = err as CoveringIndexMissingError;
      expect(e.requiredColumns).toContain("input_data");
      expect(e.requiredColumns).toContain("output_data");
      expect(e.registeredIndexes.length).toBe(4);
    }
  });
});
