/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildAddColumnSql,
  buildAddIndexSql,
  buildDropColumnSql,
  buildDropIndexSql,
  buildRenameColumnSql,
} from "@workglow/storage";
import { describe, expect, it } from "vitest";

describe("sqlMigrationDdl", () => {
  it("addColumn for SQLite", () => {
    expect(buildAddColumnSql("sqlite", "users", "archived", "INTEGER", false)).toBe(
      "ALTER TABLE `users` ADD COLUMN `archived` INTEGER NOT NULL"
    );
  });

  it("addColumn for Postgres without DEFAULT", () => {
    expect(buildAddColumnSql("postgres", "users", "archived", "BOOLEAN", true, false)).toBe(
      'ALTER TABLE "users" ADD COLUMN "archived" BOOLEAN'
    );
  });

  it("addColumn with DEFAULT", () => {
    expect(buildAddColumnSql("postgres", "users", "n", "INTEGER", true, true, "0")).toBe(
      'ALTER TABLE "users" ADD COLUMN "n" INTEGER DEFAULT 0'
    );
  });

  it("dropColumn", () => {
    expect(buildDropColumnSql("postgres", "users", "old_col")).toBe(
      'ALTER TABLE "users" DROP COLUMN "old_col"'
    );
    expect(buildDropColumnSql("sqlite", "users", "old_col")).toBe(
      "ALTER TABLE `users` DROP COLUMN `old_col`"
    );
  });

  it("renameColumn", () => {
    expect(buildRenameColumnSql("postgres", "users", "status", "state")).toBe(
      'ALTER TABLE "users" RENAME COLUMN "status" TO "state"'
    );
    expect(buildRenameColumnSql("sqlite", "users", "status", "state")).toBe(
      "ALTER TABLE `users` RENAME COLUMN `status` TO `state`"
    );
  });

  it("addIndex (non-unique)", () => {
    expect(buildAddIndexSql("postgres", "users", "idx_archived", ["archived"], false)).toBe(
      'CREATE INDEX IF NOT EXISTS "idx_archived" ON "users" ("archived")'
    );
  });

  it("addIndex (unique)", () => {
    expect(buildAddIndexSql("postgres", "users", "uq_email", ["email"], true)).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "uq_email" ON "users" ("email")'
    );
  });

  it("dropIndex", () => {
    expect(buildDropIndexSql("postgres", "idx_archived")).toBe(
      'DROP INDEX IF EXISTS "idx_archived"'
    );
    expect(buildDropIndexSql("sqlite", "idx_archived")).toBe("DROP INDEX IF EXISTS `idx_archived`");
  });
});
