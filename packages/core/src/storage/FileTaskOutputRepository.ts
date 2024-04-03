//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import path from "node:path";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { TaskInput, TaskOutput } from "task";
import { ITaskOutputRepository } from "./ITaskOutputRepository";
import { makeFingerprint } from "../util/Misc";
import { glob } from "glob";

export class FileTaskOutputRepository implements ITaskOutputRepository {
  private folderPath: string;

  constructor(folderPath: string) {
    this.folderPath = folderPath;
  }

  async saveOutput(taskType: string, inputs: TaskInput, output: TaskOutput): Promise<void> {
    const filePath = await this.getFilePath(taskType, inputs);
    await writeFile(filePath, JSON.stringify(output));
  }

  async getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    const filePath = await this.getFilePath(taskType, inputs);
    try {
      const data = await readFile(filePath, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      return undefined; // File not found or read error
    }
  }

  async clear(): Promise<void> {
    // Delete all files in the folder ending in .json
    const globPattern = path.join(this.folderPath, "*.json");
    const filesToDelete = await glob(globPattern);
    await Promise.all(filesToDelete.map((file) => unlink(file)));
  }

  async size(): Promise<number> {
    // Count all files in the folder ending in .json
    const globPattern = path.join(this.folderPath, "*.json");
    const files = await glob(globPattern);
    return files.length;
  }

  private async getFilePath(taskType: string, inputs: TaskInput): Promise<string> {
    // Generate a unique file path based on the task ID and its inputs
    const inputsHash = await makeFingerprint(inputs);
    return path.join(this.folderPath, `${taskType}_${inputsHash}.json`);
  }
}
