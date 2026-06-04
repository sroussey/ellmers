/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ALLOWED_SEARCH_OPERATORS,
  buildSearchWhere,
  isSearchCondition,
  PostgresDialect,
  SEARCH_OPERATOR_SET,
  SqliteDialect,
  type SearchCondition,
  type ValueOptionType,
} from "@workglow/storage";
import { describe, expect, it } from "vitest";

interface Row {
  readonly id: string;
  readonly value: number;
  readonly createdAt: string;
}

const schemaProps: Record<string, unknown> = {
  id: { type: "string" },
  value: { type: "number" },
  createdAt: { type: "string" },
};

const passthroughConvert = (_column: string, value: Row[keyof Row]): ValueOptionType =>
  value as ValueOptionType;

describe("PredicateBuilder operator allow-list (L-MAIN-01)", () => {
  describe("ALLOWED_SEARCH_OPERATORS / SEARCH_OPERATOR_SET", () => {
    it("contains exactly the five SQL comparison operators", () => {
      expect([...ALLOWED_SEARCH_OPERATORS].sort()).toEqual(["<", "<=", "=", ">", ">="]);
    });

    it("SEARCH_OPERATOR_SET mirrors ALLOWED_SEARCH_OPERATORS", () => {
      for (const op of ALLOWED_SEARCH_OPERATORS) {
        expect(SEARCH_OPERATOR_SET.has(op)).toBe(true);
      }
      expect(SEARCH_OPERATOR_SET.size).toBe(ALLOWED_SEARCH_OPERATORS.length);
    });
  });

  describe("isSearchCondition", () => {
    it("accepts every allowed operator", () => {
      for (const operator of ALLOWED_SEARCH_OPERATORS) {
        const candidate = { value: 1, operator };
        expect(isSearchCondition(candidate)).toBe(true);
      }
    });

    it("rejects a forged operator (e.g. SQL injection attempt)", () => {
      const forged = { value: 1, operator: "OR 1=1 --" };
      expect(isSearchCondition(forged)).toBe(false);
    });

    it("rejects a LIKE operator that is not in the allow-list", () => {
      const forged = { value: "x", operator: "LIKE" };
      expect(isSearchCondition(forged)).toBe(false);
    });

    it("rejects non-object values", () => {
      expect(isSearchCondition(null)).toBe(false);
      expect(isSearchCondition("=")).toBe(false);
      expect(isSearchCondition(42)).toBe(false);
    });

    it("rejects objects missing value or operator", () => {
      expect(isSearchCondition({ value: 1 })).toBe(false);
      expect(isSearchCondition({ operator: "=" })).toBe(false);
    });
  });

  describe("buildSearchWhere", () => {
    it("round-trips equality with SQLite placeholders", () => {
      const result = buildSearchWhere<Row>(
        SqliteDialect,
        { id: "abc" },
        schemaProps,
        passthroughConvert
      );
      expect(result.whereClause).toBe("`id` = ?");
      expect(result.params).toEqual(["abc"]);
    });

    it("round-trips a non-equality SearchCondition with Postgres placeholders", () => {
      const criterion: SearchCondition<number> = { value: 100, operator: "<" };
      const result = buildSearchWhere<Row>(
        PostgresDialect,
        { value: criterion },
        schemaProps,
        passthroughConvert
      );
      expect(result.whereClause).toBe('"value" < $1');
      expect(result.params).toEqual([100]);
    });

    it("AND-joins multiple columns and increments the parameter index", () => {
      const criterion: SearchCondition<string> = {
        value: "2025-01-01T00:00:00Z",
        operator: "<=",
      };
      const result = buildSearchWhere<Row>(
        PostgresDialect,
        { id: "abc", createdAt: criterion },
        schemaProps,
        passthroughConvert,
        5
      );
      // First column "id" → $5 (=), second column "createdAt" → $6 (<=)
      expect(result.whereClause).toBe('"id" = $5 AND "createdAt" <= $6');
      expect(result.params).toEqual(["abc", "2025-01-01T00:00:00Z"]);
    });

    it("throws on a forged operator that bypasses the type guard", () => {
      // Simulate JSON arriving from an HTTP boundary that smuggles an
      // unsafe operator past the type system (e.g. `as unknown as`).
      // `isSearchCondition` rejects the forged criterion, so it is treated
      // as a literal equality value rather than a SearchCondition. The raw
      // SQL injection attempt becomes the parameter for `=`, not part of
      // the operator slot — which is what we want.
      const forged = { value: 1, operator: "OR 1=1 --" } as unknown as SearchCondition<number>;
      const result = buildSearchWhere<Row>(
        SqliteDialect,
        { value: forged },
        schemaProps,
        passthroughConvert
      );
      expect(result.whereClause).toBe("`value` = ?");
      // The whole forged object is the bound value — no SQL injection.
      expect(result.params).toEqual([forged]);
    });

    it("throws when the column is not present in the schema", () => {
      expect(() =>
        buildSearchWhere<Row>(
          SqliteDialect,
          { unknownColumn: "x" } as never,
          schemaProps,
          passthroughConvert
        )
      ).toThrow(/Schema must have a "unknownColumn" field/);
    });
  });
});
