//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Database } from "bun:sqlite";
import { DiscriminatorSchema, KVRepository } from "./KVRepository";
import { makeFingerprint } from "../../util/Misc";

// SqliteKVRepository is a key-value store that uses SQLite as the backend for
// in app data. It supports discriminators.

export class SqliteKVRepository<
  Key = string,
  Value = string,
  Discriminator extends DiscriminatorSchema = DiscriminatorSchema
> extends KVRepository<Key, Value, Discriminator> {
  private db: Database;
  constructor(
    dbOrPath: string,
    public table: string = "kv_store",
    discriminatorsSchema: Discriminator = {} as Discriminator
  ) {
    super();
    if (typeof dbOrPath === "string") {
      this.db = new Database(dbOrPath);
    } else {
      this.db = dbOrPath;
    }
    this.discriminatorsSchema = discriminatorsSchema;
    this.setupDatabase();
  }

  private setupDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        ${this.constructDiscriminatorColumns()}
        key TEXT NOT NULL,
        value TEXT NOT NULL,
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
      case "boolean": // SQLite uses INTEGER for boolean
      case "number":
        return "INTEGER";
      default:
        return "TEXT";
    }
  }

  async put(keySimpleOrObject: Key, value: Value): Promise<void> {
    const { discriminators, key } = this.extractDiscriminators(keySimpleOrObject);
    const id = typeof key === "object" ? await makeFingerprint(key) : String(key);
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ${this.table} (${this.primaryKeyColumnList()}, value)
      VALUES (${this.primaryKeyColumns().map((i) => "?")}, ?)
    `);
    const values = Object.values(discriminators).concat(id, JSON.stringify(value));
    stmt.run(...values);
    this.emit("put", id, discriminators);
  }

  async get(keySimpleOrObject: Key): Promise<Value | undefined> {
    const { discriminators, key } = this.extractDiscriminators(keySimpleOrObject);
    const id = typeof key === "object" ? await makeFingerprint(key) : String(key);

    const whereClauses = this.primaryKeyColumns()
      .map((discriminatorKey) => `${discriminatorKey} = ?`)
      .join(" AND ");

    const stmt = this.db.prepare<{ value: string }, [key: string]>(`
      SELECT value FROM ${this.table} WHERE ${whereClauses}
    `);

    const values = Object.values(discriminators).concat(id);

    const row = stmt.get(...(values as [string])) as { value: string } | undefined;
    if (row) {
      this.emit("get", id, discriminators);
      return JSON.parse(row.value) as Value;
    } else {
      return undefined;
    }
  }

  async clear(): Promise<void> {
    this.db.exec(`DELETE FROM ${this.table}`);
    this.emit("clear");
  }

  async size(): Promise<number> {
    const stmt = this.db.prepare<{ count: number }, []>(`
      SELECT COUNT(*) AS count FROM ${this.table}
    `);
    return stmt.get()?.count || 0;
  }
}
