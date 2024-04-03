//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Database } from "bun:sqlite";
import { TaskOutputRepository } from "./ITaskOutputRepository";
import { TaskInput, TaskOutput } from "task";
import { makeFingerprint } from "../util/Misc";

export class SqliteTaskOutputRepository extends TaskOutputRepository {
  private db: Database;
  constructor(dbOrPath: string) {
    super();
    if (typeof dbOrPath === "string") {
      this.db = new Database(dbOrPath);
    } else {
      this.db = dbOrPath;
    }
    this.setupDatabase();
  }

  private setupDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_outputs (
        task_type TEXT NOT NULL,
        inputs_hash TEXT NOT NULL,
        output TEXT NOT NULL,
        PRIMARY KEY (task_type, inputs_hash) 
      )
    `);
  }

  async saveOutput(taskType: string, inputs: TaskInput, output: TaskOutput): Promise<void> {
    const inputsHash = await makeFingerprint(inputs);
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO task_outputs (task_type, inputs_hash, output)
      VALUES (?, ?, ?)
    `);
    stmt.run(taskType, inputsHash, JSON.stringify(output));
    this.emit("output_saved", taskType);
  }

  async getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    const inputsHash = await makeFingerprint(inputs);
    const stmt = this.db.prepare<{ output: string }, [task_type: string, task_hash: string]>(`
      SELECT output FROM task_outputs WHERE task_type = ? AND inputs_hash = ?
    `);
    const row = stmt.get(taskType, inputsHash) as { output: string } | undefined;
    if (row) {
      this.emit("output_retrieved", taskType);
      return JSON.parse(row.output) as TaskOutput;
    } else {
      return undefined;
    }
  }

  async clear(): Promise<void> {
    this.db.exec(`DELETE FROM task_outputs`);
    this.emit("output_cleared");
  }

  async size(): Promise<number> {
    const stmt = this.db.prepare<{ count: number }, []>(`
      SELECT COUNT(*) AS count FROM task_outputs
    `);
    return stmt.get()?.count ?? 0;
  }
}
