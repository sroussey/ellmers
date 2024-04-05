//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Pool } from "pg";
import { DiscriminatorSchema, KVRepository } from "./KVRepository";
import { makeFingerprint } from "../../util/Misc";

// PostgresKVRepository is a key-value store that uses PostgreSQL as the backend for
// multi-user scenarios. It supports discriminators.

export class PostgresKVRepository<
  Key = string,
  Value = string,
  Discriminator extends DiscriminatorSchema = DiscriminatorSchema,
> extends KVRepository<Key, Value, Discriminator> {
  private pool: Pool;

  constructor(
    connectionString: string,
    public table: string = "kv_store",
    discriminatorsSchema: Discriminator = {} as Discriminator
  ) {
    super();
    this.discriminatorsSchema = discriminatorsSchema;
    this.pool = new Pool({ connectionString });
    this.setupDatabase(table);
  }

  private async setupDatabase(table: string): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        ${this.constructDiscriminatorColumns()}
        key TEXT NOT NULL,
        value JSONB NOT NULL,
        PRIMARY KEY (${this.primaryKeyColumnList()}) 
      )
    `);
  }

  private constructDiscriminatorColumns(): string {
    const cols = Object.entries(this.discriminatorsSchema)
      .map(([key, type]) => {
        // Convert the provided type to a SQL type, assuming simple mappings; adjust as necessary
        const sqlType = this.mapTypeToSQL(type);
        return `${key} ${sqlType} NOT NULL`;
      })
      .join(", ");
    if (cols.length > 0) {
      return `${cols}, `;
    }
    return "";
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

  async put(keySimpleOrObject: Key, value: Value): Promise<void> {
    const { discriminators, key } = this.extractDiscriminators(keySimpleOrObject);
    const id = typeof key === "object" ? await makeFingerprint(key) : String(key);
    const values = Object.values(discriminators).concat(id, JSON.stringify(value));
    await this.pool.query(
      `INSERT INTO ${this.table} (${this.primaryKeyColumnList()}, value)
      VALUES (${this.primaryKeyColumns().map((i) => "?")}, ?)
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value`,
      values
    );
    this.emit("put", id, discriminators);
  }

  async get(keySimpleOrObject: Key): Promise<Value | undefined> {
    const { discriminators, key } = this.extractDiscriminators(keySimpleOrObject);
    const id = typeof key === "object" ? await makeFingerprint(key) : String(key);

    const whereClauses = this.primaryKeyColumns()
      .map((discriminatorKey, i) => `${discriminatorKey} = $${i + 1}`)
      .join(" AND ");

    const values = Object.values(discriminators).concat(id);

    const result = await this.pool.query(
      `SELECT value FROM ${this.table} WHERE ${whereClauses}`,
      values
    );

    if (result.rows.length > 0) {
      this.emit("get", id, discriminators);
      return result.rows[0].value as Value;
    } else {
      return undefined;
    }
  }

  async clear(): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table}`);
    this.emit("clear");
  }

  async size(): Promise<number> {
    const result = await this.pool.query(`SELECT COUNT(*) FROM ${this.table}`);
    return parseInt(result.rows[0].count, 10);
  }
}
