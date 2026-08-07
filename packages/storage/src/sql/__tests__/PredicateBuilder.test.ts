/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ALLOWED_SEARCH_OPERATORS,
  buildSearchWhere,
  DuckDbDialect,
  isSearchCondition,
  isSearchInCondition,
  normalizeCriterion,
  PostgresDialect,
  SEARCH_OPERATOR_SET,
  SqliteDialect,
  type SearchCondition,
  type SearchInCondition,
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

    it("treats a forged operator as a literal value (no SQL injection)", () => {
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

  describe("in-list criteria", () => {
    const inCriterion = (values: number[]): SearchInCondition<number> => ({
      value: values,
      operator: "in",
    });

    it("expands one placeholder per value on SQLite", () => {
      const result = buildSearchWhere<Row>(
        SqliteDialect,
        { value: inCriterion([1, 2, 3]) },
        schemaProps,
        passthroughConvert
      );
      expect(result.whereClause).toBe("`value` IN (?, ?, ?)");
      expect(result.params).toEqual([1, 2, 3]);
    });

    it("binds the whole list as ONE array parameter on Postgres", () => {
      // This is the difference that makes an in-list unbounded on Postgres and
      // capped by SQLITE_MAX_VARIABLE_NUMBER on SQLite. If this ever regresses
      // to expanded placeholders, a long list starts failing at 65535 params.
      const result = buildSearchWhere<Row>(
        PostgresDialect,
        { value: inCriterion([1, 2, 3]) },
        schemaProps,
        passthroughConvert
      );
      expect(result.whereClause).toBe('"value" = ANY($1)');
      expect(result.params).toEqual([[1, 2, 3]]);
    });

    it("expands with $N numbering on DuckDB, whose driver has no array binding", () => {
      const result = buildSearchWhere<Row>(
        DuckDbDialect,
        { value: inCriterion([1, 2]) },
        schemaProps,
        passthroughConvert
      );
      expect(result.whereClause).toBe('"value" IN ($1, $2)');
      expect(result.params).toEqual([1, 2]);
    });

    it("advances the placeholder index past every value it bound", () => {
      // Postgres consumes ONE index for the array, so a following column must
      // land on $2 — deriving the next index from the value count would skew it.
      const pg = buildSearchWhere<Row>(
        PostgresDialect,
        { value: inCriterion([1, 2, 3]), id: "abc" },
        schemaProps,
        passthroughConvert
      );
      expect(pg.whereClause).toBe('"value" = ANY($1) AND "id" = $2');
      expect(pg.params).toEqual([[1, 2, 3], "abc"]);

      // DuckDB consumes three, so the following column lands on $4.
      const duck = buildSearchWhere<Row>(
        DuckDbDialect,
        { value: inCriterion([1, 2, 3]), id: "abc" },
        schemaProps,
        passthroughConvert
      );
      expect(duck.whereClause).toBe('"value" IN ($1, $2, $3) AND "id" = $4');
      expect(duck.params).toEqual([1, 2, 3, "abc"]);
    });

    it("emits an always-false predicate for an empty list, binding nothing", () => {
      // `IN ()` is a syntax error in every dialect here.
      for (const dialect of [SqliteDialect, PostgresDialect, DuckDbDialect]) {
        const result = buildSearchWhere<Row>(
          dialect,
          { value: inCriterion([]) },
          schemaProps,
          passthroughConvert
        );
        expect(result.whereClause).toBe("1 = 0");
        expect(result.params).toEqual([]);
      }
    });

    it("runs each element through convertValue, like a scalar value", () => {
      const upper = (_column: string, value: Row[keyof Row]): ValueOptionType =>
        String(value).toUpperCase();
      const result = buildSearchWhere<Row>(
        SqliteDialect,
        { id: { value: ["a", "b"], operator: "in" } as SearchInCondition<string> },
        schemaProps,
        upper
      );
      expect(result.params).toEqual(["A", "B"]);
    });
  });

  describe("isSearchInCondition", () => {
    it("accepts an in-condition with an array value", () => {
      expect(isSearchInCondition({ value: [1, 2], operator: "in" })).toBe(true);
      expect(isSearchInCondition({ value: [], operator: "in" })).toBe(true);
    });

    it("rejects an in-condition whose value is not an array", () => {
      // The JSON trust boundary: a forged `in` must not reach a builder that
      // assumes it can map over the value.
      expect(isSearchInCondition({ value: "1,2", operator: "in" })).toBe(false);
      expect(isSearchInCondition({ value: 1, operator: "in" })).toBe(false);
    });

    it("does not accept the scalar operators, and `in` is not in the scalar allow-list", () => {
      expect(isSearchInCondition({ value: 1, operator: "=" })).toBe(false);
      // `in` must never reach the code path that interpolates an operator
      // straight into SQL.
      expect(SEARCH_OPERATOR_SET.has("in" as never)).toBe(false);
      expect(isSearchCondition({ value: [1], operator: "in" })).toBe(false);
    });
  });

  describe("normalizeCriterion", () => {
    it("resolves all three criterion shapes", () => {
      expect(normalizeCriterion(5)).toEqual({ kind: "compare", operator: "=", value: 5 });
      expect(normalizeCriterion({ value: 5, operator: "<" })).toEqual({
        kind: "compare",
        operator: "<",
        value: 5,
      });
      expect(normalizeCriterion({ value: [5, 6], operator: "in" })).toEqual({
        kind: "in",
        values: [5, 6],
      });
    });

    it("treats a forged criterion as a literal value rather than an operator", () => {
      const forged = { value: 1, operator: "OR 1=1 --" };
      expect(normalizeCriterion(forged)).toEqual({
        kind: "compare",
        operator: "=",
        value: forged,
      });
    });
  });
});
