//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Pool } from "pg";
import { ITaskOutputRepository } from "./ITaskOutputRepository";
import { TaskInput, TaskOutput } from "task";
import { makeFingerprint } from "../util/Misc";

export class PostgresTaskOutputRepository implements ITaskOutputRepository {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
    this.setupDatabase();
  }

  private async setupDatabase(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS task_outputs (
        task_type TEXT NOT NULL,
        inputs_hash TEXT NOT NULL,
        output JSONB NOT NULL,
        PRIMARY KEY (task_type, inputs_hash)
      )
    `);
  }

  async saveOutput(taskType: string, inputs: TaskInput, output: TaskOutput): Promise<void> {
    const inputsHash = await makeFingerprint(inputs);
    await this.pool.query(
      `INSERT INTO task_outputs (task_type, inputs_hash, output)
      VALUES ($1, $2, $3)
      ON CONFLICT (task_type, inputs_hash) DO UPDATE
      SET output = EXCLUDED.output`,
      [taskType, inputsHash, JSON.stringify(output)]
    );
  }

  async getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    const inputsHash = await makeFingerprint(inputs);
    const result = await this.pool.query(
      `SELECT output FROM task_outputs WHERE task_type = $1 AND inputs_hash = $2`,
      [taskType, inputsHash]
    );

    if (result.rows.length > 0) {
      return result.rows[0].output as TaskOutput;
    } else {
      return undefined;
    }
  }
}
