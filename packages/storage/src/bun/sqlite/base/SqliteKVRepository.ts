//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Database } from "bun:sqlite";
import {
  BaseValueSchema,
  BasicKeyType,
  BasePrimaryKeySchema,
  DefaultValueType,
  DefaultValueSchema,
  DefaultPrimaryKeyType,
  DefaultPrimaryKeySchema,
} from "ellmers-core";
import { BaseSqlKVRepository } from "../../../util/base/BaseSqlKVRepository";

// SqliteKVRepository is a key-value store that uses SQLite as the backend for
// in app data.

/**
 * A SQLite-based key-value repository implementation.
 * @template Key - The type of the primary key object, must be a record of basic types
 * @template Value - The type of the value object being stored
 * @template PrimaryKeySchema - Schema definition for the primary key
 * @template ValueSchema - Schema definition for the value
 * @template Combined - Combined type of Key & Value
 */
export class SqliteKVRepository<
  Key extends Record<string, BasicKeyType> = DefaultPrimaryKeyType,
  Value extends Record<string, any> = DefaultValueType,
  PrimaryKeySchema extends BasePrimaryKeySchema = typeof DefaultPrimaryKeySchema,
  ValueSchema extends BaseValueSchema = typeof DefaultValueSchema,
  Combined extends Record<string, any> = Key & Value,
> extends BaseSqlKVRepository<Key, Value, PrimaryKeySchema, ValueSchema, Combined> {
  /** The SQLite database instance */
  private db: Database;

  /**
   * Creates a new SQLite key-value repository
   * @param dbOrPath - Either a Database instance or a path to the SQLite database file
   * @param table - The name of the table to use for storage (defaults to 'kv_store')
   * @param primaryKeySchema - Schema defining the structure of the primary key
   * @param valueSchema - Schema defining the structure of the values
   * @param searchable - Array of columns to make searchable
   */
  constructor(
    dbOrPath: string,
    table: string = "kv_store",
    primaryKeySchema: PrimaryKeySchema = DefaultPrimaryKeySchema as PrimaryKeySchema,
    valueSchema: ValueSchema = DefaultValueSchema as ValueSchema,
    searchable: Array<keyof Combined> = []
  ) {
    super(table, primaryKeySchema, valueSchema, searchable);
    if (typeof dbOrPath === "string") {
      this.db = new Database(dbOrPath);
    } else {
      this.db = dbOrPath;
    }
    this.setupDatabase();
  }

  /**
   * Creates the database table if it doesn't exist with the defined schema
   */
  public setupDatabase(): void {
    const sql = `
      CREATE TABLE IF NOT EXISTS \`${this.table}\` (
        ${this.constructPrimaryKeyColumns()},
        ${this.constructValueColumns()},
        PRIMARY KEY (${this.primaryKeyColumnList()}) 
      )
    `;
    this.db.exec(sql);
    for (const column of this.searchable) {
      /* Makes other columns searchable, but excludes the first column 
         of a primary key (which would be redundant) */
      if (column !== this.primaryKeyColumns()[0]) {
        this.db.exec(
          `CREATE INDEX IF NOT EXISTS \`${this.table}_${column as string}\`
             ON \`${this.table}\` (\`${column as string}\`)`
        );
      }
    }
  }

  /**
   * Maps TypeScript/JavaScript types to their SQLite column type equivalents
   * @param type - The TypeScript/JavaScript type to map
   * @returns The corresponding SQLite column type
   */
  protected mapTypeToSQL(type: string): string {
    // Basic type mapping; extend according to your needs
    switch (type) {
      case "string":
        return "TEXT";
      case "boolean": // SQLite uses INTEGER for boolean
      case "number":
        return "INTEGER";
      default:
        return "TEXT";
    }
  }

  /**
   * Stores a key-value pair in the database
   * @param key - The primary key object
   * @param value - The value object to store
   * @emits 'put' event when successful
   */
  async putKeyValue(key: Key, value: Value): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO \`${
        this.table
      }\` (${this.primaryKeyColumnList()}, ${this.valueColumnList()})
      VALUES (
        ${this.primaryKeyColumns().map((i) => "?")},
        ${this.valueColumns().map((i) => "?")}
      )
    `;
    const stmt = this.db.prepare(sql);

    const primaryKeyParams = this.getPrimaryKeyAsOrderedArray(key);
    const valueParams = this.getValueAsOrderedArray(value);
    const params = [...primaryKeyParams, ...valueParams];

    const result = stmt.run(...params);

    this.emit("put", key);
  }

  /**
   * Retrieves a value from the database by its key
   * @param key - The primary key object to look up
   * @returns The stored value or undefined if not found
   * @emits 'get' event when successful
   */
  async getKeyValue(key: Key): Promise<Value | undefined> {
    const whereClauses = (this.primaryKeyColumns() as string[])
      .map((key) => `\`${key}\` = ?`)
      .join(" AND ");

    const sql = `
      SELECT ${this.valueColumnList()} FROM \`${this.table}\` WHERE ${whereClauses}
    `;
    const stmt = this.db.prepare<Value, BasicKeyType[]>(sql);
    const params = this.getPrimaryKeyAsOrderedArray(key);
    const value = stmt.get(...params);
    if (value) {
      this.emit("get", key, value);
      return value;
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

    const sql = `
      SELECT * FROM \`${this.table}\` 
      WHERE \`${search[0]}\` = ?
    `;
    const stmt = this.db.prepare<Combined, any[]>(sql);
    const value = stmt.all(key[search[0]]);
    if (value) {
      this.emit("search");
      return value;
    } else {
      return undefined;
    }
  }

  /**
   * Deletes a key-value pair from the database
   * @param key - The primary key object to delete
   * @emits 'delete' event when successful
   */
  async deleteKeyValue(key: Key): Promise<void> {
    const whereClauses = (this.primaryKeyColumns() as string[])
      .map((key) => `${key} = ?`)
      .join(" AND ");
    const params = this.getPrimaryKeyAsOrderedArray(key);
    const stmt = this.db.prepare(`DELETE FROM ${this.table} WHERE ${whereClauses}`);
    stmt.run(...params);
    this.emit("delete", key);
  }

  /**
   * Retrieves all entries from the database table
   * @returns Promise resolving to an array of entries or undefined if not found
   */
  async getAll(): Promise<Combined[] | undefined> {
    const sql = `SELECT * FROM \`${this.table}\``;
    const stmt = this.db.prepare<Combined, []>(sql);
    const value = stmt.all();
    return value.length ? value : undefined;
  }

  /**
   * Deletes all entries from the database table
   * @emits 'clearall' event when successful
   */
  async deleteAll(): Promise<void> {
    this.db.exec(`DELETE FROM ${this.table}`);
    this.emit("clearall");
  }

  /**
   * Gets the total number of entries in the database table
   * @returns The count of entries
   */
  async size(): Promise<number> {
    const stmt = this.db.prepare<{ count: number }, []>(`
      SELECT COUNT(*) AS count FROM ${this.table}
    `);
    return stmt.get()?.count || 0;
  }
}
