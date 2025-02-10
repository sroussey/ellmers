//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Pool } from "pg";
import {
  BaseValueSchema,
  BasePrimaryKeySchema,
  BasicKeyType,
  DefaultValueSchema,
  DefaultPrimaryKeySchema,
  DefaultPrimaryKeyType,
  DefaultValueType,
} from "ellmers-core";
import { BaseSqlKVRepository } from "../../../util/base/BaseSqlKVRepository";

/// ******************************************************************
/// *
/// ******************************************************************
/// **********************    NOT TESTED YET   ***********************
/// ******************************************************************
/// *
/// ******************************************************************
/// really... i wrote it and it passes the linter only!

/**
/**
 * A PostgreSQL-based key-value repository implementation that extends BaseSqlKVRepository.
 * This class provides persistent storage for key-value pairs in a PostgreSQL database,
 * making it suitable for multi-user scenarios.
 *
 * @template Key - The type of the primary key, must be a record of basic types
 * @template Value - The type of the stored value, can be any record type
 * @template PrimaryKeySchema - Schema definition for the primary key
 * @template ValueSchema - Schema definition for the value
 * @template Combined - Combined type of Key & Value
 */
export class PostgresKVRepository<
  Key extends Record<string, BasicKeyType> = DefaultPrimaryKeyType,
  Value extends Record<string, any> = DefaultValueType,
  PrimaryKeySchema extends BasePrimaryKeySchema = typeof DefaultPrimaryKeySchema,
  ValueSchema extends BaseValueSchema = typeof DefaultValueSchema,
  Combined extends Record<string, any> = Key & Value,
> extends BaseSqlKVRepository<Key, Value, PrimaryKeySchema, ValueSchema, Combined> {
  private pool: Pool;

  /**
   * Creates a new PostgresKVRepository instance.
   *
   * @param connectionString - PostgreSQL connection string
   * @param table - Name of the table to store key-value pairs (defaults to "kv_store")
   * @param primaryKeySchema - Schema definition for primary key columns
   * @param valueSchema - Schema definition for value columns
   * @param searchable - Array of columns to make searchable
   */
  constructor(
    connectionString: string,
    public table: string = "kv_store",
    primaryKeySchema: PrimaryKeySchema = DefaultPrimaryKeySchema as PrimaryKeySchema,
    valueSchema: ValueSchema = DefaultValueSchema as ValueSchema,
    searchable: Array<keyof Combined> = []
  ) {
    super(table, primaryKeySchema, valueSchema, searchable);
    this.pool = new Pool({ connectionString });
    this.dbPromise = this.setupDatabase();
  }

  private dbPromise: Promise<void> | undefined;

  /**
   * Initializes the database table with the required schema.
   * Creates the table if it doesn't exist with primary key and value columns.
   */
  private async setupDatabase(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS \`${this.table}\` (
        ${this.constructPrimaryKeyColumns()},
        ${this.constructValueColumns()},
        PRIMARY KEY (${this.primaryKeyColumnList()}) 
      )
    `);
    for (const column of this.searchable) {
      if (column !== this.primaryKeyColumns()[0]) {
        /* Makes other columns searchable, but excludes the first column 
         of a primary key (which would be redundant) */
        await this.pool.query(
          `CREATE INDEX IF NOT EXISTS \`${this.table}_${column as string}\` 
             ON \`${this.table}\` (\`${column as string}\`)`
        );
      }
    }
  }

  /**
   * Maps TypeScript/JavaScript types to corresponding PostgreSQL data types.
   *
   * @param type - The TypeScript/JavaScript type to map
   * @returns The corresponding PostgreSQL data type
   */
  protected mapTypeToSQL(type: string): string {
    // Basic type mapping; extend according to your needs
    switch (type) {
      case "string":
        return "TEXT";
      case "boolean":
      case "number":
        return "INTEGER";
      default:
        return "TEXT";
    }
  }

  /**
   * Stores or updates a key-value pair in the database.
   * Uses UPSERT (INSERT ... ON CONFLICT DO UPDATE) for atomic operations.
   *
   * @param key - The primary key object
   * @param value - The value object to store
   * @emits "put" event with the key when successful
   */
  async putKeyValue(key: Key, value: Value): Promise<void> {
    await this.dbPromise;
    const sql = `
    INSERT INTO \`${this.table}\` (
      ${this.primaryKeyColumnList()},
      ${this.valueColumnList()}
    )
    VALUES (
      ${this.primaryKeyColumns().map((i) => "?")}
    )
    ON CONFLICT (${this.primaryKeyColumnList()}) DO UPDATE
    SET 
    ${(this.valueColumns() as string[]).map((col) => `\`${col}\` = EXCLUDED.\`${col}\``).join(", ")}
    `;

    const primaryKeyParams = this.getPrimaryKeyAsOrderedArray(key);
    const valueParams = this.getValueAsOrderedArray(value);
    const params = [...primaryKeyParams, ...valueParams];
    await this.pool.query(sql, params);
    this.emit("put", key);
  }

  /**
   * Retrieves a value from the database by its primary key.
   *
   * @param key - The primary key object to look up
   * @returns The stored value or undefined if not found
   * @emits "get" event with the key when successful
   */
  async getKeyValue(key: Key): Promise<Value | undefined> {
    await this.dbPromise;
    const whereClauses = (this.primaryKeyColumns() as string[])
      .map((discriminatorKey, i) => `\`${discriminatorKey}\` = $${i + 1}`)
      .join(" AND ");

    const params = this.getPrimaryKeyAsOrderedArray(key);

    const result = await this.pool.query(
      `SELECT ${this.valueColumnList()} FROM \`${this.table}\` WHERE ${whereClauses}`,
      params
    );

    if (result.rows.length > 0) {
      this.emit("get", key);
      return result.rows[0] as Value;
    } else {
      return undefined;
    }
  }

  /**
   * Method to be implemented by concrete repositories to search for key-value pairs
   * based on a partial key.
   *
   * @param key - Partial key to search for
   * @returns Promise resolving to an array of combined key-value objects or undefined if not found
   */
  public async search(key: Partial<Combined>): Promise<Combined[] | undefined> {
    await this.dbPromise;
    const search = Object.keys(key);
    if (search.length !== 1) {
      //TODO: make this work with any prefix of primary key
      throw new Error("Search must be a single key");
    }

    const sql = `
      SELECT * FROM \`${this.table}\` 
      WHERE \`${search[0]}\` = ?
    `;
    const result = await this.pool.query<Combined, any[]>(sql, [key[search[0]]]);
    if (result.rows.length > 0) {
      this.emit("search");
      return result.rows;
    } else {
      return undefined;
    }
  }

  /**
   * Deletes a key-value pair from the database.
   *
   * @param key - The primary key object to delete
   * @emits "delete" event with the key when successful
   */
  async deleteKeyValue(key: Key): Promise<void> {
    await this.dbPromise;
    const whereClauses = (this.primaryKeyColumns() as string[])
      .map((key, i) => `\`${key}\` = $${i + 1}`)
      .join(" AND ");

    const params = this.getPrimaryKeyAsOrderedArray(key);
    await this.pool.query(`DELETE FROM \`${this.table}\` WHERE ${whereClauses}`, params);
    this.emit("delete", key);
  }

  /**
   * Retrieves all entries from the database table
   * @returns Promise resolving to an array of entries or undefined if not found
   */
  async getAll(): Promise<Combined[] | undefined> {
    await this.dbPromise;
    const sql = `SELECT * FROM \`${this.table}\``;
    const result = await this.pool.query<Combined, []>(sql);
    return result.rows.length ? result.rows : undefined;
  }

  /**
   * Deletes all key-value pairs from the database table.
   * @emits "clearall" event when successful
   */
  async deleteAll(): Promise<void> {
    await this.dbPromise;
    await this.pool.query(`DELETE FROM \`${this.table}\``);
    this.emit("clearall");
  }

  /**
   * Returns the total number of key-value pairs in the database.
   *
   * @returns Promise resolving to the count of stored items
   */
  async size(): Promise<number> {
    await this.dbPromise;
    const result = await this.pool.query(`SELECT COUNT(*) FROM \`${this.table}\``);
    return parseInt(result.rows[0].count, 10);
  }
}
