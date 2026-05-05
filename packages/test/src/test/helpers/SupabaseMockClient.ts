/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setLogger } from "@workglow/util";

import { getTestingLogger } from "../../binding/TestingLogger";

export interface IClosableSupabaseClient extends SupabaseClient {
  readonly close: () => Promise<void>;
}

/**
 * Translates a PostgREST `or=(...)` filter expression to a SQL WHERE
 * fragment for the mock client. Only handles the subset emitted by
 * {@link SupabaseTabularStorage} for cursor pagination:
 *
 *   - `col.eq.value`, `col.gt.value`, `col.lt.value`
 *   - `col.is.null`, `col.not.is.null`
 *   - `and(c1,c2,...)` and `or(c1,c2,...)` groupings
 *   - top-level comma-separated list = OR
 *   - values either bare (numbers, booleans) or `"..."`-wrapped with
 *     `\\`-escaped quotes/backslashes
 *
 * The mock backend is PGlite (real Postgres), so we emit standard SQL.
 */
/**
 * Only the top-level `.or()` filter shape used by `SupabaseTabularStorage`
 * is supported here, because that's all the production code ever emits;
 * adding `.and()` support would mean a different join here. Kept as a
 * single-purpose helper rather than a configurable one to avoid a dead
 * parameter that future callers might trust.
 */
function translatePostgrestFilter(filter: string): string {
  let i = 0;
  const s = filter;

  // Each list-style construct (top-level `.or(...)`, `and(...)`, `or(...)`)
  // joins its child expressions with its own operator. Returning each
  // child's pre-rendered SQL fragment and joining at the right level —
  // rather than splitting/rejoining a flat string — preserves the
  // structure of nested groups. Importantly, an `or(...)` group nested
  // inside an `and(...)` group keeps its `OR` operator instead of being
  // mistakenly rewritten to `AND`. SupabaseTabularStorage emits exactly
  // that shape for DESC keyset clauses (`and(eq.x, or(lt.y, is.null))`).
  function parseList(closingChar: string | null, joinOp: " AND " | " OR " = " OR "): string {
    const parts: string[] = [];
    while (i < s.length) {
      const part = parseExpr();
      if (part) parts.push(part);
      if (i < s.length && s[i] === ",") {
        i++;
        continue;
      }
      if (closingChar !== null && s[i] === closingChar) break;
      if (closingChar === null && i >= s.length) break;
      // Trailing whitespace is tolerated by PostgREST; skip it.
      while (i < s.length && /\s/.test(s[i])) i++;
    }
    return parts.join(joinOp);
  }

  function parseExpr(): string {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) return "";
    if (s.startsWith("and(", i)) {
      i += 4;
      return `(${parseGroup(")", " AND ")})`;
    }
    if (s.startsWith("or(", i)) {
      i += 3;
      return `(${parseGroup(")", " OR ")})`;
    }
    return parseAtom();
  }

  function parseGroup(closingChar: string, joinOp: " AND " | " OR "): string {
    const parts: string[] = [];
    while (i < s.length && s[i] !== closingChar) {
      const part = parseExpr();
      if (part) parts.push(part);
      if (s[i] === ",") {
        i++;
      }
    }
    if (s[i] === closingChar) i++;
    return parts.join(joinOp);
  }

  function parseAtom(): string {
    // col.op.value (or col.op for col.is.null) — read until next `,`/`)`
    // unless inside a quoted value.
    let buf = "";
    while (i < s.length) {
      const ch = s[i];
      if (ch === '"') {
        buf += ch;
        i++;
        while (i < s.length) {
          const c = s[i];
          buf += c;
          i++;
          if (c === "\\" && i < s.length) {
            buf += s[i];
            i++;
            continue;
          }
          if (c === '"') break;
        }
        continue;
      }
      if (ch === "," || ch === ")") break;
      buf += ch;
      i++;
    }
    return atomToSql(buf.trim());
  }

  function atomToSql(atom: string): string {
    // Patterns: col.not.is.null (tested first — strictly more specific
    // than `col.is.null`, otherwise the lazy `(.+?)` capture would match
    // a column name of `col.not`), col.is.null, col.OP.value.
    const notIsNullMatch = atom.match(/^(.+?)\.not\.is\.null$/);
    if (notIsNullMatch) return `"${notIsNullMatch[1]}" IS NOT NULL`;
    const isNullMatch = atom.match(/^(.+?)\.is\.null$/);
    if (isNullMatch) return `"${isNullMatch[1]}" IS NULL`;
    // Generic col.op.value — find the first dot, then the second.
    const firstDot = atom.indexOf(".");
    const secondDot = atom.indexOf(".", firstDot + 1);
    if (firstDot < 0 || secondDot < 0) {
      throw new Error(`Cannot parse PostgREST atom: ${atom}`);
    }
    const col = atom.slice(0, firstDot);
    const op = atom.slice(firstDot + 1, secondDot);
    const valueRaw = atom.slice(secondDot + 1);
    const sqlOp = ({ eq: "=", gt: ">", lt: "<", gte: ">=", lte: "<=" } as Record<string, string>)[op];
    if (!sqlOp) throw new Error(`Unsupported PostgREST op in mock: ${op}`);
    let sqlValue: string;
    if (valueRaw.startsWith('"') && valueRaw.endsWith('"')) {
      // Unescape backslash-escaped chars in a single pass. The previous
      // two-step form (`replace(/\\\\/g, "\\")` then `replace(/\\"/g, '"')`)
      // double-unescapes input like `\\\"` — the first pass produces
      // `\\"`, which the second pass then turns into `"` instead of
      // `\"`. A single regex with a callback consumes each escape exactly
      // once.
      const unwrapped = valueRaw.slice(1, -1).replace(/\\(.)/g, (_m, ch) => ch);
      sqlValue = `'${unwrapped.replace(/'/g, "''")}'`;
    } else if (valueRaw === "true" || valueRaw === "false") {
      sqlValue = valueRaw;
    } else {
      sqlValue = valueRaw;
    }
    return `"${col}" ${sqlOp} ${sqlValue}`;
  }

  return parseList(null);
}

/**
 * Creates a mock Supabase client for testing that uses PGlite as the backend.
 * This provides a real PostgreSQL database for testing without needing a Supabase instance.
 */
export function createSupabaseMockClient(): IClosableSupabaseClient {
  const pglite = new PGlite();
  const logger = getTestingLogger();
  setLogger(logger);

  // Create a minimal SupabaseClient-compatible object
  const mockClient = {
    // Remove a realtime channel (cleanup)
    removeChannel: (_channel: any) => {
      // Mock removeChannel - no-op
    },

    // Realtime channel method for subscriptions
    channel: (name: string) => {
      return {
        on: (event: string, filter: any, callback: any) => {
          // Mock realtime subscription - do nothing, just return self for chaining
          return {
            on: (event: string, filter: any, callback: any) => {
              return {
                subscribe: (callback?: any) => {
                  // Mock subscribe - call callback immediately with "SUBSCRIBED" status
                  if (callback) {
                    callback("SUBSCRIBED");
                  }
                  return { unsubscribe: () => {} };
                },
              };
            },
            subscribe: (callback?: any) => {
              // Mock subscribe - call callback immediately with "SUBSCRIBED" status
              if (callback) {
                callback("SUBSCRIBED");
              }
              return { unsubscribe: () => {} };
            },
          };
        },
        subscribe: (callback?: any) => {
          // Mock subscribe - call callback immediately with "SUBSCRIBED" status
          if (callback) {
            callback("SUBSCRIBED");
          }
          return { unsubscribe: () => {} };
        },
      };
    },

    // RPC method for executing raw SQL (used in setup and atomic operations)
    rpc: async (functionName: string, params?: Record<string, any>) => {
      if (functionName === "exec_sql" && params?.query) {
        try {
          const result = await pglite.query(params.query);
          // Return rows for queries with RETURNING clause, otherwise null
          return { data: result.rows.length > 0 ? result.rows : null, error: null };
        } catch (error: any) {
          // Ignore "already exists" errors for tables, types, and indexes
          if (
            error.message?.includes("already exists") ||
            error.code === "42P07" || // relation already exists
            error.code === "42710" || // type already exists
            error.code === "42P06" // schema already exists
          ) {
            return { data: null, error: null };
          }

          // For enum types that don't exist, try to handle gracefully
          if (error.message?.includes("type") && error.message?.includes("does not exist")) {
            logger.info(`Type creation issue: ${error.message}`);
            return { data: null, error: null };
          }

          return { data: null, error };
        }
      }

      // Handle calling arbitrary PostgreSQL functions
      try {
        // Build the function call with parameters
        const paramNames = params ? Object.keys(params) : [];
        const paramValues = params ? Object.values(params) : [];

        // Create parameterized placeholders
        const placeholders = paramNames.map((_, i) => `$${i + 1}`).join(", ");

        // Build the SELECT query to call the function
        const query =
          paramNames.length > 0
            ? `SELECT * FROM ${functionName}(${placeholders})`
            : `SELECT * FROM ${functionName}()`;

        const result = await pglite.query(query, paramValues);
        return { data: result.rows, error: null };
      } catch (error: any) {
        // If function doesn't exist, return appropriate error
        if (error.message?.includes("does not exist")) {
          return { data: null, error: { message: error.message, code: "42883" } };
        }
        return { data: null, error };
      }
    },

    // From method for table operations
    from: (table: string) => {
      const queryBuilder = {
        _table: table,
        _select: "*",
        _filters: [] as Array<{ column: string; operator: string; value: any }>,
        _limit: undefined as number | undefined,
        _offset: undefined as number | undefined,
        _order: [] as Array<{ column: string; ascending: boolean; nullsFirst?: boolean }>,
        _orFilters: [] as string[],
        _single: false,

        select: (columns = "*") => {
          queryBuilder._select = columns;
          return queryBuilder;
        },

        insert: (data: any) => {
          const executeInsert = async () => {
            try {
              const isArray = Array.isArray(data);
              const records = isArray ? data : [data];

              if (records.length === 0) {
                return { data: null, error: new Error("No data to insert") };
              }

              const keys = Object.keys(records[0]);
              const values = records
                .map(
                  (record) =>
                    `(${keys
                      .map((k) => {
                        const val = record[k];
                        if (val === null || val === undefined) return "NULL";
                        if (typeof val === "object")
                          return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
                        if (typeof val === "string") return `'${val.replace(/'/g, "''")}'`;
                        return String(val);
                      })
                      .join(",")})`
                )
                .join(",");

              const query = `INSERT INTO "${queryBuilder._table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES ${values} RETURNING *`;
              const result = await pglite.query(query);

              return { data: result.rows[0], error: null };
            } catch (error: any) {
              return { data: null, error };
            }
          };

          return {
            select: () => {
              return {
                single: async () => {
                  return executeInsert();
                },
              };
            },
            then: async (resolve: any, reject: any) => {
              try {
                const result = await executeInsert();
                resolve(result);
              } catch (error) {
                reject?.(error);
              }
            },
          };
        },

        upsert: (data: any, options?: { onConflict?: string }) => {
          const executeUpsert = async () => {
            try {
              const isArray = Array.isArray(data);
              const records = isArray ? data : [data];

              if (records.length === 0) {
                return { data: [], error: null };
              }

              const keys = Object.keys(records[0]);

              // Use parameterized queries for better type handling (especially arrays)
              const params: any[] = [];
              let paramIndex = 1;

              const values = records
                .map(
                  (record) =>
                    `(${keys
                      .map((k) => {
                        const val = record[k];
                        if (val === null || val === undefined) {
                          return "NULL";
                        }
                        // Use parameterized query for proper type handling
                        params.push(val);
                        const currentIndex = paramIndex++;
                        return `$${currentIndex}`;
                      })
                      .join(",")})`
                )
                .join(",");

              let query = `INSERT INTO "${queryBuilder._table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES ${values}`;

              if (options?.onConflict) {
                const updateSet = keys
                  .filter((k) => !options.onConflict?.includes(k))
                  .map((k) => `"${k}" = EXCLUDED."${k}"`)
                  .join(", ");
                query += ` ON CONFLICT (${options.onConflict}) DO UPDATE SET ${updateSet}`;
              }

              query += " RETURNING *";

              const result = await pglite.query(query, params);
              return { data: result.rows, error: null };
            } catch (error: any) {
              return { data: null, error };
            }
          };

          return {
            select: () => {
              return {
                single: async () => {
                  const result = await executeUpsert();
                  if (result.error) return result;
                  // Return single record or first record from array
                  const singleData = Array.isArray(result.data) ? result.data[0] : result.data;
                  return { data: singleData, error: null };
                },
                then: async (resolve: any, reject: any) => {
                  try {
                    const result = await executeUpsert();
                    resolve(result);
                  } catch (error) {
                    reject?.(error);
                  }
                },
              };
            },
            then: async (resolve: any, reject: any) => {
              try {
                const result = await executeUpsert();
                resolve(result);
              } catch (error) {
                reject?.(error);
              }
            },
          };
        },

        update: (data: any) => {
          const updateBuilder = {
            eq: (column: string, value: any) => {
              queryBuilder._filters.push({ column, operator: "=", value });
              return updateBuilder; // Return self for chaining
            },

            select: () => {
              return {
                single: async () => {
                  try {
                    const setClause = Object.entries(data)
                      .map(([k, v]) => {
                        if (v === null || v === undefined) return `"${k}" = NULL`;
                        if (typeof v === "object")
                          return `"${k}" = '${JSON.stringify(v).replace(/'/g, "''")}'`;
                        if (typeof v === "string") return `"${k}" = '${v.replace(/'/g, "''")}'`;
                        return `"${k}" = ${String(v)}`;
                      })
                      .join(", ");

                    const whereClause = queryBuilder._filters
                      .map((f) => {
                        const val = f.value;
                        if (val === null || val === undefined)
                          return `"${f.column}" ${f.operator} NULL`;
                        if (typeof val === "object")
                          return `"${f.column}" ${f.operator} '${JSON.stringify(val).replace(/'/g, "''")}'`;
                        if (typeof val === "string")
                          return `"${f.column}" ${f.operator} '${val.replace(/'/g, "''")}'`;
                        return `"${f.column}" ${f.operator} ${String(val)}`;
                      })
                      .join(" AND ");

                    const query = `UPDATE "${queryBuilder._table}" SET ${setClause} WHERE ${whereClause} RETURNING *`;
                    const result = await pglite.query(query);

                    return {
                      data: result.rows[0] || null,
                      error: null,
                    };
                  } catch (error: any) {
                    return { data: null, error };
                  }
                },
              };
            },
            then: async (resolve: any, reject: any) => {
              try {
                const setClause = Object.entries(data)
                  .map(([k, v]) => {
                    if (v === null || v === undefined) return `"${k}" = NULL`;
                    if (typeof v === "object")
                      return `"${k}" = '${JSON.stringify(v).replace(/'/g, "''")}'`;
                    if (typeof v === "string") return `"${k}" = '${v.replace(/'/g, "''")}'`;
                    return `"${k}" = ${String(v)}`;
                  })
                  .join(", ");

                const whereClause =
                  queryBuilder._filters.length > 0
                    ? queryBuilder._filters
                        .map((f) => {
                          const val = f.value;
                          if (val === null || val === undefined)
                            return `"${f.column}" ${f.operator} NULL`;
                          if (typeof val === "object")
                            return `"${f.column}" ${f.operator} '${JSON.stringify(val).replace(/'/g, "''")}'`;
                          if (typeof val === "string")
                            return `"${f.column}" ${f.operator} '${val.replace(/'/g, "''")}'`;
                          return `"${f.column}" ${f.operator} ${String(val)}`;
                        })
                        .join(" AND ")
                    : "1=1";

                const query = `UPDATE "${queryBuilder._table}" SET ${setClause} WHERE ${whereClause}`;
                await pglite.query(query);

                resolve?.({ data: null, error: null });
              } catch (error: any) {
                reject?.(error);
              }
            },
          };

          return updateBuilder;
        },

        delete: () => {
          return {
            eq: (column: string, value: any) => {
              queryBuilder._filters.push({ column, operator: "=", value });
              return deleteBuilder;
            },
            neq: (column: string, value: any) => {
              queryBuilder._filters.push({ column, operator: "!=", value });
              return deleteBuilder;
            },
            lt: (column: string, value: any) => {
              queryBuilder._filters.push({ column, operator: "<", value });
              return deleteBuilder;
            },
            lte: (column: string, value: any) => {
              queryBuilder._filters.push({ column, operator: "<=", value });
              return deleteBuilder;
            },
            gt: (column: string, value: any) => {
              queryBuilder._filters.push({ column, operator: ">", value });
              return deleteBuilder;
            },
            gte: (column: string, value: any) => {
              queryBuilder._filters.push({ column, operator: ">=", value });
              return deleteBuilder;
            },
            not: (column: string, operator: string, value: any) => {
              if (operator === "is" && value === null) {
                queryBuilder._filters.push({ column, operator: "IS NOT", value: "NULL" });
              }
              return deleteBuilder;
            },
            then: async (resolve: any, reject: any) => {
              try {
                const result = await executeDelete();
                resolve(result);
              } catch (error) {
                reject?.(error);
              }
            },
          };
        },

        eq: (column: string, value: any) => {
          queryBuilder._filters.push({ column, operator: "=", value });
          return queryBuilder;
        },

        neq: (column: string, value: any) => {
          if (value === null) {
            queryBuilder._filters.push({ column, operator: "IS NOT", value: "NULL" });
          } else {
            queryBuilder._filters.push({ column, operator: "!=", value });
          }
          return queryBuilder;
        },

        lt: (column: string, value: any) => {
          queryBuilder._filters.push({ column, operator: "<", value });
          return queryBuilder;
        },

        lte: (column: string, value: any) => {
          queryBuilder._filters.push({ column, operator: "<=", value });
          return queryBuilder;
        },

        gt: (column: string, value: any) => {
          queryBuilder._filters.push({ column, operator: ">", value });
          return queryBuilder;
        },

        gte: (column: string, value: any) => {
          queryBuilder._filters.push({ column, operator: ">=", value });
          return queryBuilder;
        },

        order: (
          column: string,
          options?: { ascending?: boolean; nullsFirst?: boolean }
        ) => {
          queryBuilder._order.push({
            column,
            ascending: options?.ascending ?? true,
            nullsFirst: options?.nullsFirst,
          });
          return queryBuilder;
        },

        or: (filter: string) => {
          queryBuilder._orFilters.push(filter);
          return queryBuilder;
        },

        limit: (count: number) => {
          queryBuilder._limit = count;
          return queryBuilder;
        },

        range: (start: number, end: number) => {
          queryBuilder._offset = start;
          queryBuilder._limit = end - start + 1;
          return queryBuilder;
        },

        single: async () => {
          queryBuilder._single = true;
          queryBuilder._limit = 1;
          const result = await executeQuery();

          if (result.error) {
            return result;
          }

          if (!result.data || result.data.length === 0) {
            return {
              data: null,
              error: { code: "PGRST116", message: "No rows found" },
            };
          }

          return { data: result.data[0], error: null };
        },
      };

      const executeDelete = async () => {
        try {
          let query = `DELETE FROM "${queryBuilder._table}"`;

          if (queryBuilder._filters.length > 0) {
            const whereClause = queryBuilder._filters
              .map((f) => {
                if (f.operator === "IS NOT" && f.value === "NULL") {
                  return `"${f.column}" IS NOT NULL`;
                }
                const val = f.value;
                if (val === null || val === undefined) return `"${f.column}" ${f.operator} NULL`;
                if (typeof val === "object")
                  return `"${f.column}" ${f.operator} '${JSON.stringify(val).replace(/'/g, "''")}'`;
                if (typeof val === "string")
                  return `"${f.column}" ${f.operator} '${val.replace(/'/g, "''")}'`;
                return `"${f.column}" ${f.operator} ${String(val)}`;
              })
              .join(" AND ");
            query += ` WHERE ${whereClause}`;
          }

          await pglite.query(query);
          return { data: null, error: null };
        } catch (error: any) {
          return { data: null, error };
        }
      };

      const deleteBuilder = {
        eq: (column: string, value: any) => {
          queryBuilder._filters.push({ column, operator: "=", value });
          return deleteBuilder;
        },
        neq: (column: string, value: any) => {
          if (value === null) {
            queryBuilder._filters.push({ column, operator: "IS NOT", value: "NULL" });
          } else {
            queryBuilder._filters.push({ column, operator: "!=", value });
          }
          return deleteBuilder;
        },
        lt: (column: string, value: any) => {
          queryBuilder._filters.push({ column, operator: "<", value });
          return deleteBuilder;
        },
        lte: (column: string, value: any) => {
          queryBuilder._filters.push({ column, operator: "<=", value });
          return deleteBuilder;
        },
        gt: (column: string, value: any) => {
          queryBuilder._filters.push({ column, operator: ">", value });
          return deleteBuilder;
        },
        gte: (column: string, value: any) => {
          queryBuilder._filters.push({ column, operator: ">=", value });
          return deleteBuilder;
        },
        not: (column: string, operator: string, value: any) => {
          if (operator === "is" && value === null) {
            queryBuilder._filters.push({ column, operator: "IS NOT", value: "NULL" });
          }
          return deleteBuilder;
        },
        then: async (resolve: any, reject: any) => {
          try {
            const result = await executeDelete();
            resolve(result);
          } catch (error) {
            reject?.(error);
          }
        },
      };

      const executeQuery = async () => {
        try {
          let query = `SELECT ${queryBuilder._select} FROM "${queryBuilder._table}"`;

          const whereParts: string[] = [];
          if (queryBuilder._filters.length > 0) {
            const whereClause = queryBuilder._filters
              .map((f) => {
                if (f.operator === "IS NOT" && f.value === "NULL") {
                  return `"${f.column}" IS NOT NULL`;
                }
                const val = f.value;
                if (val === null || val === undefined) return `"${f.column}" ${f.operator} NULL`;
                if (typeof val === "object")
                  return `"${f.column}" ${f.operator} '${JSON.stringify(val).replace(/'/g, "''")}'`;
                if (typeof val === "string")
                  return `"${f.column}" ${f.operator} '${val.replace(/'/g, "''")}'`;
                return `"${f.column}" ${f.operator} ${String(val)}`;
              })
              .join(" AND ");
            whereParts.push(whereClause);
          }
          for (const orFilter of queryBuilder._orFilters) {
            whereParts.push(`(${translatePostgrestFilter(orFilter)})`);
          }
          if (whereParts.length > 0) {
            query += ` WHERE ${whereParts.join(" AND ")}`;
          }

          if (queryBuilder._order.length > 0) {
            const orderParts = queryBuilder._order.map((o) => {
              const dir = o.ascending ? "ASC" : "DESC";
              const nulls =
                o.nullsFirst === undefined
                  ? ""
                  : o.nullsFirst
                    ? " NULLS FIRST"
                    : " NULLS LAST";
              return `"${o.column}" ${dir}${nulls}`;
            });
            query += ` ORDER BY ${orderParts.join(", ")}`;
          }

          if (queryBuilder._offset !== undefined) {
            query += ` OFFSET ${queryBuilder._offset}`;
          }

          if (queryBuilder._limit !== undefined) {
            query += ` LIMIT ${queryBuilder._limit}`;
          }

          const result = await pglite.query(query);
          return { data: result.rows, error: null, count: result.rows.length };
        } catch (error: any) {
          return { data: null, error, count: null };
        }
      };

      // Add the missing then method to make it thenable
      return Object.assign(queryBuilder, {
        then: async (resolve: any, reject: any) => {
          try {
            const result = await executeQuery();
            resolve(result);
          } catch (error) {
            reject?.(error);
          }
        },
      });
    },

    close: async () => {
      await pglite.close();
    },
  };

  return mockClient as unknown as IClosableSupabaseClient;
}
