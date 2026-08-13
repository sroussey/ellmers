/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CoveringIndexQueryOptions,
  OrderBy,
  PageRequest,
  QueryOptions,
  SearchCriteria,
} from "./ITabularStorage";
import {
  ALLOWED_SEARCH_OPERATORS,
  isSearchCondition,
  isSearchInCondition,
  SEARCH_OPERATOR_SET,
} from "./ITabularStorage";
import {
  StorageEmptyCriteriaError,
  StorageInvalidColumnError,
  StorageInvalidLimitError,
  StorageValidationError,
} from "./StorageError";

/** The `properties` map of the storage's full (primary key + value) schema. */
export type SchemaProperties = Record<string, unknown>;

/**
 * Validates the `orderBy` clause of a page/query request: column names must
 * exist in the schema and directions must be `"ASC"` or `"DESC"`.
 */
export function validateOrderBy<Entity>(
  schemaProperties: SchemaProperties,
  orderBy: ReadonlyArray<OrderBy<Entity>> | undefined
): void {
  if (!orderBy) return;
  const validDirections = ["ASC", "DESC"];
  for (const { column, direction } of orderBy) {
    if (typeof column !== "string") {
      throw new StorageInvalidColumnError(String(column));
    }
    if (!(column in schemaProperties)) {
      throw new StorageInvalidColumnError(String(column));
    }
    if (!validDirections.includes(direction)) {
      throw new StorageValidationError(
        `Invalid sort direction "${direction}". Must be "ASC" or "DESC"`
      );
    }
  }
}

/**
 * Validates query parameters: criteria columns, options, and operator values.
 * `validateOrderByFn` is the caller's (overridable) order-by validator, so a
 * subclass that tightens `validateOrderBy` still runs here.
 */
export function validateQueryParams<Entity>(
  schemaProperties: SchemaProperties,
  criteria: SearchCriteria<Entity>,
  options: QueryOptions<Entity> | undefined,
  validateOrderByFn: (orderBy: ReadonlyArray<OrderBy<Entity>> | undefined) => void
): void {
  const criteriaKeys = Object.keys(criteria) as Array<keyof Entity>;

  if (criteriaKeys.length === 0) {
    throw new StorageEmptyCriteriaError();
  }

  if (options?.limit !== undefined && options.limit <= 0) {
    throw new StorageInvalidLimitError(options.limit);
  }

  if (options?.offset !== undefined && options.offset < 0) {
    throw new StorageValidationError(`Query offset must be non-negative, got ${options.offset}`);
  }

  for (const column of criteriaKeys) {
    if (!(column in schemaProperties)) {
      throw new StorageInvalidColumnError(String(column));
    }
    const criterion = criteria[column];
    if (isSearchCondition(criterion)) {
      // Read from the shared allow-list rather than a local copy: a literal
      // here silently rejects any operator added to the union, which is exactly
      // how `!=` came to be unreachable despite every backend implementing it.
      if (!SEARCH_OPERATOR_SET.has(criterion.operator)) {
        throw new StorageValidationError(
          `Invalid operator "${criterion.operator}". Must be one of: ` +
            ALLOWED_SEARCH_OPERATORS.join(", ")
        );
      }
    } else if (
      typeof criterion === "object" &&
      criterion !== null &&
      (criterion as { operator?: unknown }).operator === "in" &&
      !isSearchInCondition(criterion)
    ) {
      // An `in` criterion whose value is not an array passes neither guard,
      // so it would fall through to `normalizeCriterion` as a literal value
      // and match nothing. Nobody means that — fail loudly instead.
      throw new StorageValidationError(
        `Criterion for column "${String(column)}" uses operator "in" but its value is not an array`
      );
    }
  }

  validateOrderByFn(options?.orderBy);
}

/** Validates the limit/offset/orderBy of a `getAll` options bag. */
export function validateGetAllOptions<Entity>(
  options: QueryOptions<Entity> | undefined,
  validateOrderByFn: (orderBy: ReadonlyArray<OrderBy<Entity>> | undefined) => void
): void {
  if (!options) return;

  if (options.limit !== undefined && options.limit <= 0) {
    throw new StorageInvalidLimitError(options.limit);
  }

  if (options.offset !== undefined && options.offset < 0) {
    throw new StorageValidationError(`Query offset must be non-negative, got ${options.offset}`);
  }

  validateOrderByFn(options.orderBy);
}

/** Validates the limit and orderBy of a cursor-paginated request. */
export function validatePageRequest<Entity>(
  request: PageRequest<Entity>,
  validateOrderByFn: (orderBy: ReadonlyArray<OrderBy<Entity>> | undefined) => void
): void {
  if (request.limit !== undefined) {
    if (!Number.isInteger(request.limit) || request.limit <= 0) {
      throw new StorageInvalidLimitError(request.limit);
    }
  }
  validateOrderByFn(request.orderBy);
}

/**
 * Validates the `select` array in a covering-index query: throws when
 * `select` is empty or names a column that is not in the schema.
 */
export function validateSelect<Entity, K extends keyof Entity & string>(
  schemaProperties: SchemaProperties,
  options: CoveringIndexQueryOptions<Entity, K>
): void {
  if (!options.select || options.select.length === 0) {
    throw new StorageValidationError("queryIndex requires a non-empty select array");
  }
  const schemaProps = Object.keys(schemaProperties);
  for (const col of options.select) {
    const colStr = String(col);
    if (!schemaProps.includes(colStr)) {
      throw new StorageValidationError(`queryIndex select column "${colStr}" is not in schema`);
    }
  }
}
