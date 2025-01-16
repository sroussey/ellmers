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
  BasicValueType,
  DefaultValueSchema,
  DefaultPrimaryKeySchema,
  DefaultPrimaryKeyType,
  DefaultValueType,
  KVRepository,
} from "ellmers-core";

// PostgresKVRepository is a key-value store that uses PostgreSQL as the backend for
// multi-user scenarios. It supports discriminators.

export class PostgresKVRepository<
  Key extends Record<string, BasicKeyType> = DefaultPrimaryKeyType,
  Value extends Record<string, any> = DefaultValueType,
  PrimaryKeySchema extends BasePrimaryKeySchema = typeof DefaultPrimaryKeySchema,
  ValueSchema extends BaseValueSchema = typeof DefaultValueSchema,
  Combined extends Key & Value = Key & Value
> extends KVRepository<Key, Value, PrimaryKeySchema, ValueSchema, Combined> {
  private pool: Pool;

  constructor(
    connectionString: string,
    public table: string = "kv_store",
    primaryKeySchema: PrimaryKeySchema = DefaultPrimaryKeySchema as PrimaryKeySchema,
    valueSchema: ValueSchema = DefaultValueSchema as ValueSchema
  ) {
    super(primaryKeySchema, valueSchema);
    this.pool = new Pool({ connectionString });
    this.setupDatabase();
  }

  private async setupDatabase(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS \`${this.table}\` (
        ${this.constructPrimaryKeyColumns()},
        ${this.constructValueColumns()},
        PRIMARY KEY (${this.primaryKeyColumnList()}) 
      )
    `);
  }

  private constructPrimaryKeyColumns(): string {
    const cols = Object.entries(this.primaryKeySchema)
      .map(([key, type]) => {
        // Convert the provided type to a SQL type, assuming simple mappings; adjust as necessary
        const sqlType = this.mapTypeToSQL(type);
        return `\`${key}\` ${sqlType} NOT NULL`;
      })
      .join(", ");
    return cols;
  }

  private constructValueColumns(): string {
    const cols = Object.entries(this.valueSchema)
      .map(([key, type]) => {
        const sqlType = this.mapTypeToSQL(type);
        return `\`${key}\` ${sqlType} NULL`;
      })
      .join(", ");
    return cols;
  }

  protected primaryKeyColumnList(): string {
    return "`" + this.primaryKeyColumns().join("`, `") + "`";
  }
  protected valueColumnList(): string {
    return "`" + this.valueColumns().join("`, `") + "`";
  }

  private mapTypeToSQL(type: string): string {
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

  // JS objects are not ordered, so we need to convert them to an ordered array
  // so that we can use them as parameters in a SQL query
  // we will order base on the valueSchema
  getValueAsOrderedArray(value: Value): BasicValueType[] {
    const orderedParams: BasicValueType[] = [];
    // Iterate through valueSchema to maintain consistent order
    for (const [key, type] of Object.entries(this.valueSchema)) {
      orderedParams.push(value[key] ?? null);
    }
    return orderedParams;
  }

  // JS objects are not ordered, so we need to convert them to an ordered array
  // so that we can use them as parameters in a SQL query
  // we will order base on the primaryKeySchema
  getPrimaryKeyAsOrderedArray(key: Key): BasicKeyType[] {
    const orderedParams: BasicKeyType[] = [];
    // Iterate through primaryKeySchema to maintain consistent order
    for (const [k, type] of Object.entries(this.primaryKeySchema)) {
      if (k in key) {
        orderedParams.push(key[k]);
      } else {
        throw new Error(`Missing required primary key field: ${k}`);
      }
    }
    return orderedParams;
  }

  async putKeyValue(key: Key, value: Value): Promise<void> {
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

  async getKeyValue(key: Key): Promise<Value | undefined> {
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

  async deleteKeyValue(key: Key): Promise<void> {
    const whereClauses = (this.primaryKeyColumns() as string[])
      .map((key, i) => `\`${key}\` = $${i + 1}`)
      .join(" AND ");

    const params = this.getPrimaryKeyAsOrderedArray(key);
    await this.pool.query(`DELETE FROM \`${this.table}\` WHERE ${whereClauses}`, params);
    this.emit("delete", key);
  }

  async deleteAll(): Promise<void> {
    await this.pool.query(`DELETE FROM \`${this.table}\``);
    this.emit("clearall");
  }

  async size(): Promise<number> {
    const result = await this.pool.query(`SELECT COUNT(*) FROM ${this.table}`);
    return parseInt(result.rows[0].count, 10);
  }
}
