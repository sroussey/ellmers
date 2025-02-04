//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  BaseValueSchema,
  BasicKeyType,
  BasePrimaryKeySchema,
  DefaultValueType,
  DefaultValueSchema,
  DefaultPrimaryKeyType,
  DefaultPrimaryKeySchema,
  BasicValueType,
} from "ellmers-core";
import { KVRepository } from "./KVRepository";
// BaseKVRepository is a key-value store that uses SQLite and Postgres use as common code

/**
 * Base class for SQL-based key-value repositories that implements common functionality
 * for both SQLite and PostgreSQL database implementations.
 *
 * @template Key - The type of the primary key object, must be a record of basic types
 * @template Value - The type of the value object being stored
 * @template PrimaryKeySchema - Schema definition for the primary key
 * @template ValueSchema - Schema definition for the value
 * @template Combined - Combined type of Key & Value in case just combining them is not enough
 */
export abstract class BaseSqlKVRepository<
  Key extends Record<string, BasicKeyType> = DefaultPrimaryKeyType,
  Value extends Record<string, any> = DefaultValueType,
  PrimaryKeySchema extends BasePrimaryKeySchema = typeof DefaultPrimaryKeySchema,
  ValueSchema extends BaseValueSchema = typeof DefaultValueSchema,
  Combined extends Record<string, any> = Key & Value,
> extends KVRepository<Key, Value, PrimaryKeySchema, ValueSchema, Combined> {
  /**
   * Creates a new instance of BaseSqlKVRepository
   * @param table - The name of the database table to use for storage
   * @param primaryKeySchema - Schema defining the structure of the primary key
   * @param valueSchema - Schema defining the structure of the stored values
   * @param searchable - Array of columns to make searchable
   */
  constructor(
    public table: string = "kv_store",
    primaryKeySchema: PrimaryKeySchema = DefaultPrimaryKeySchema as PrimaryKeySchema,
    valueSchema: ValueSchema = DefaultValueSchema as ValueSchema,
    protected searchable: Array<keyof Combined> = []
  ) {
    super(primaryKeySchema, valueSchema, searchable);
    this.validateTableAndSchema();
  }

  /**
   * Maps JavaScript/TypeScript types to their corresponding SQL type
   * Must be implemented by derived classes for specific SQL dialects
   */
  protected abstract mapTypeToSQL(type: string): string;

  /**
   * Generates the SQL column definitions for primary key fields
   * @returns SQL string containing primary key column definitions
   */
  protected constructPrimaryKeyColumns(): string {
    const cols = Object.entries(this.primaryKeySchema)
      .map(([key, type]) => {
        const sqlType = this.mapTypeToSQL(type);
        return `\`${key}\` ${sqlType} NOT NULL`;
      })
      .join(", ");
    return cols;
  }

  /**
   * Generates the SQL column definitions for value fields
   * @returns SQL string containing value column definitions
   */
  protected constructValueColumns(): string {
    const cols = Object.entries(this.valueSchema)
      .map(([key, type]) => {
        const sqlType = this.mapTypeToSQL(type);
        return `\`${key}\` ${sqlType} NULL`;
      })
      .join(", ");
    return cols;
  }

  /**
   * Returns a comma-separated list of primary key column names
   * @returns Formatted string of primary key column names
   */
  protected primaryKeyColumnList(): string {
    return "`" + this.primaryKeyColumns().join("`, `") + "`";
  }

  /**
   * Returns a comma-separated list of value column names
   * @returns Formatted string of value column names
   */
  protected valueColumnList(): string {
    return "`" + this.valueColumns().join("`, `") + "`";
  }

  /**
   * Converts a value object into an ordered array based on the valueSchema
   * This ensures consistent parameter ordering for SQL queries
   * @param value - The value object to convert
   * @returns Array of values ordered according to the schema
   * @throws Error if a required field is missing
   */
  protected getValueAsOrderedArray(value: Value): BasicValueType[] {
    const orderedParams: BasicValueType[] = [];
    for (const [key, type] of Object.entries(this.valueSchema)) {
      if (key in value) {
        orderedParams.push(value[key]);
      } else {
        throw new Error(`Missing required value field: ${key}`);
      }
    }
    return orderedParams;
  }

  /**
   * Converts a primary key object into an ordered array based on the primaryKeySchema
   * This ensures consistent parameter ordering for SQL queries
   * @param key - The primary key object to convert
   * @returns Array of key values ordered according to the schema
   * @throws Error if a required primary key field is missing
   */
  protected getPrimaryKeyAsOrderedArray(key: Key): BasicKeyType[] {
    const orderedParams: BasicKeyType[] = [];
    for (const [k, type] of Object.entries(this.primaryKeySchema)) {
      if (k in key) {
        orderedParams.push(key[k]);
      } else {
        throw new Error(`Missing required primary key field: ${k}`);
      }
    }
    return orderedParams;
  }

  /**
   * Validates table name and schema configurations
   * Checks for:
   * 1. Valid table name format
   * 2. Valid schema key names
   * 3. No duplicate keys between primary key and value schemas
   * This is a sanity check to make sure the table and schema are valid,
   * and to prevent dumb mistakes and mischevious behavior.
   * @throws Error if validation fails
   */
  protected validateTableAndSchema(): void {
    // Check for invalid characters in table name
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(this.table)) {
      throw new Error(
        `Invalid table name: ${this.table}. Must start with letter/underscore and contain only alphanumeric/underscore characters`
      );
    }

    // Validate schema key naming
    const validateSchemaKeys = (schema: Record<string, any>) => {
      Object.keys(schema).forEach((key) => {
        if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(key)) {
          throw new Error(
            `Invalid schema key: ${key}. Must start with letter/underscore and contain only alphanumeric/underscore characters`
          );
        }
      });
    };
    validateSchemaKeys(this.primaryKeySchema);
    validateSchemaKeys(this.valueSchema);

    // Check for key name collisions between schemas
    const primaryKeys = new Set(Object.keys(this.primaryKeySchema));
    const valueKeys = Object.keys(this.valueSchema);
    const duplicates = valueKeys.filter((key) => primaryKeys.has(key));
    if (duplicates.length > 0) {
      throw new Error(`Duplicate keys found in schemas: ${duplicates.join(", ")}`);
    }
  }
}
