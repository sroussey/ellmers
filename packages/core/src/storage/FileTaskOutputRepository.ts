//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import { TaskInput, TaskOutput } from "task";
import { ITaskOutputRepository } from "./ITaskOutputRepository";

export class FileTaskOutputRepository implements ITaskOutputRepository {
  private folderPath: string;

  constructor(folderPath: string) {
    this.folderPath = folderPath;
  }

  async saveOutput(taskType: string, inputs: TaskInput, output: TaskOutput): Promise<void> {
    const filePath = this.getFilePath(taskType, inputs);
    await writeFile(filePath, JSON.stringify(output));
  }

  async getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    const filePath = this.getFilePath(taskType, inputs);
    try {
      const data = await readFile(filePath, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      return undefined; // File not found or read error
    }
  }

  private getFilePath(taskType: string, inputs: TaskInput): string {
    // Generate a unique file path based on the task ID and its inputs
    const inputsHash = this.hashInputs(inputs);
    return path.join(this.folderPath, `${taskType}_${inputsHash}.json`);
  }

  private hashInputs(inputs: TaskInput): string {
    // Implement a hashing function that creates a unique hash based on the inputs
    return crypto.createHash("sha1").update(JSON.stringify(inputs)).digest("hex");
  }
}
