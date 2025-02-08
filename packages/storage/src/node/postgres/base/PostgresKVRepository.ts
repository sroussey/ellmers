//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Sql } from "postgres";
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
  private sql: Sql;

  /**
   * Creates a new PostgresKVRepository instance.
   *
   * @param sql - PostgreSQL connection instance
   * @param table - Name of the table to store key-value pairs (defaults to "kv_store")
   * @param primaryKeySchema - Schema definition for primary key columns
   * @param valueSchema - Schema definition for value columns
   * @param searchable - Array of columns to make searchable
   */
  constructor(
    sql: Sql,
    public table: string = "kv_store",
    primaryKeySchema: PrimaryKeySchema = DefaultPrimaryKeySchema as PrimaryKeySchema,
    valueSchema: ValueSchema = DefaultValueSchema as ValueSchema,
    searchable: Array<keyof Combined> = []
  ) {
    super(table, primaryKeySchema, valueSchema, searchable);
    this.sql = sql;
  }

  /**
   * Initializes the database table with the required schema.
   * Creates the table if it doesn't exist with primary key and value columns.
   */
  public async setupDatabase(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS ${this.sql(this.table)} (
        ${this.constructPrimaryKeyColumns()},
        ${this.constructValueColumns()},
        PRIMARY KEY (${this.primaryKeyColumnList()})
      )
    `;

    for (const column of this.searchable) {
      if (column !== this.primaryKeyColumns()[0]) {
        const indexName = `${this.table}_${String(column)}`;
        /* Makes other columns searchable, but excludes the first column 
         of a primary key (which would be redundant) */
        await this.sql`
          CREATE INDEX IF NOT EXISTS ${this.sql(indexName)}
          ON ${this.sql(this.table)} (${this.sql(column as string)})
        `;
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
        return "BOOLEAN";
      case "number":
        return "NUMERIC";
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
    const primaryKeyParams = this.getPrimaryKeyAsOrderedArray(key);
    const valueParams = this.getValueAsOrderedArray(value);
    const params = [...primaryKeyParams, ...valueParams].map((param) =>
      typeof param === "bigint" ? param.toString() : param
    );

    const columnNames = [...this.primaryKeyColumns(), ...this.valueColumns()] as string[];

    const updateSet = this.valueColumns()
      .map((col) => `${this.sql(col as string)} = EXCLUDED.${this.sql(col as string)}`)
      .join(", ");

    await this.sql`
      INSERT INTO ${this.sql(this.table)} (${this.sql(columnNames)})
      VALUES (${this.sql(params)})
      ON CONFLICT (${this.sql(this.primaryKeyColumns() as string[])})
      DO UPDATE SET ${this.sql.unsafe(updateSet)}
    `;

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
    const params = Object.entries(key).map(([col, param]) => [
      col,
      typeof param === "bigint" ? param.toString() : param,
    ]);

    const pkey = Object.fromEntries(params);

    const whereConditions = this.primaryKeyColumns()
      .map((col) => `${this.sql(col as string)} = ${pkey[col as string]}`)
      .join(" AND ");

    const result = await this.sql`
      SELECT ${this.sql(this.valueColumns() as string[])}
      FROM ${this.sql(this.table)}
      WHERE ${this.sql.unsafe(whereConditions)}
    `;

    if (result.length > 0) {
      this.emit("get", key);
      return result[0] as unknown as Value;
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
    const search = Object.keys(key);
    if (search.length !== 1) {
      //TODO: make this work with any prefix of primary key
      throw new Error("Search must be a single key");
    }

    const param = key[search[0]];
    const paramValue = typeof param === "bigint" ? param.toString() : param;

    const result = await this.sql`
      SELECT * FROM ${this.sql(this.table)}
      WHERE "${this.sql(search[0] as string)}" = ${paramValue}
    `;

    if (result.length > 0) {
      this.emit("search");
      return result as unknown as Combined[];
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
    const params = Object.entries(key).map(([col, param]) => [
      col,
      typeof param === "bigint" ? param.toString() : param,
    ]);

    const pkey = Object.fromEntries(params);

    const whereConditions = this.primaryKeyColumns()
      .map((col) => this.sql`${this.sql(col as string)} = ${pkey[col as string]}`)
      .join(" AND ");

    await this.sql`
      DELETE FROM ${this.sql(this.table)}
      WHERE ${whereConditions}
    `;
  }

  /**
   * Retrieves all entries from the database table
   * @returns Promise resolving to an array of entries or undefined if not found
   */
  async getAll(): Promise<Combined[] | undefined> {
    const result = await this.sql.unsafe(`SELECT * FROM ${this.sql(this.table)}`);
    return result.length ? (result as unknown as Combined[]) : undefined;
  }

  /**
   * Deletes all key-value pairs from the database table.
   * @emits "clearall" event when successful
   */
  async deleteAll(): Promise<void> {
    await this.sql.unsafe(`DELETE FROM ${this.sql(this.table)}`);
    this.emit("clearall");
  }

  /**
   * Returns the total number of key-value pairs in the database.
   *
   * @returns Promise resolving to the count of stored items
   */
  async size(): Promise<number> {
    const result = await this.sql.unsafe(`SELECT COUNT(*) FROM ${this.sql(this.table)}`);
    return parseInt(result[0].count, 10);
  }
}
