//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Database } from "bun:sqlite";
import crypto from "crypto";
import { ITaskOutputRepository } from "./ITaskOutputRepository";
import { TaskInput, TaskOutput } from "task";

export class SqliteTaskOutputRepository implements ITaskOutputRepository {
  private db: Database;
  constructor(dbOrPath: string) {
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
  private hashInputs(inputs: TaskInput): string {
    // Implement a hashing function that creates a unique hash based on the inputs
    return crypto.createHash("sha1").update(JSON.stringify(inputs)).digest("hex");
  }
  async saveOutput(taskId: string, inputs: TaskInput, output: TaskOutput): Promise<void> {
    const inputsHash = this.hashInputs(inputs);
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO task_outputs (task_type, inputs_hash, output)
      VALUES (?, ?, ?)
    `);
    stmt.run(taskId, inputsHash, JSON.stringify(output));
  }
  async getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    const inputsHash = this.hashInputs(inputs);
    const stmt = this.db.prepare<{ output: string }, [task_type: string, task_hash: string]>(`
      SELECT output FROM task_outputs WHERE task_type = ? AND inputs_hash = ?
    `);
    const row = stmt.get(taskType, inputsHash) as { output: string } | undefined;
    if (row) {
      return JSON.parse(row.output) as TaskOutput;
    } else {
      return undefined;
    }
  }
}
