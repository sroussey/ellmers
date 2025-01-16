//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import path from "node:path";
import { readFile, writeFile, rm } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { glob } from "glob";
import {
  BaseValueSchema,
  BasePrimaryKeySchema,
  BasicKeyType,
  DefaultValueType,
  DefaultValueSchema,
  DefaultPrimaryKeyType,
  DefaultPrimaryKeySchema,
  KVRepository,
} from "ellmers-core";

// FileKVRepository is a key-value store that uses the file system as the backend for
// simple scenarios.

export class FileKVRepository<
  Key extends Record<string, BasicKeyType> = DefaultPrimaryKeyType,
  Value extends Record<string, any> = DefaultValueType,
  PrimaryKeySchema extends BasePrimaryKeySchema = typeof DefaultPrimaryKeySchema,
  ValueSchema extends BaseValueSchema = typeof DefaultValueSchema,
  Combined extends Key & Value = Key & Value
> extends KVRepository<Key, Value, PrimaryKeySchema, ValueSchema, Combined> {
  private folderPath: string;

  constructor(
    folderPath: string,
    primaryKeySchema: PrimaryKeySchema = DefaultPrimaryKeySchema as PrimaryKeySchema,
    valueSchema: ValueSchema = DefaultValueSchema as ValueSchema
  ) {
    super(primaryKeySchema, valueSchema);
    this.folderPath = path.dirname(folderPath);
    mkdirSync(this.folderPath, { recursive: true });
  }

  async putKeyValue(key: Key, value: Value): Promise<void> {
    const filePath = await this.getFilePath(key);
    try {
      await writeFile(filePath, JSON.stringify(value));
    } catch (error) {
      console.error("Error writing file", filePath, error);
    }
    this.emit("put", key);
  }

  async getKeyValue(key: Key): Promise<Value | undefined> {
    const filePath = await this.getFilePath(key);
    try {
      const data = await readFile(filePath, "utf-8");
      const value = JSON.parse(data) as Value;
      this.emit("get", key, value);
      return value;
    } catch (error) {
      // console.info("Error getting file (may not exist)", filePath);
      return undefined; // File not found or read error
    }
  }

  async deleteKeyValue(key: Key): Promise<void> {
    const filePath = await this.getFilePath(key);
    try {
      await rm(filePath);
    } catch (error) {
      // console.error("Error deleting file", filePath, error);
    }
    this.emit("delete", key);
  }

  async deleteAll(): Promise<void> {
    // Delete all files in the folder ending in .json
    await rm(this.folderPath, { recursive: true, force: true });
    this.emit("clearall");
  }

  async size(): Promise<number> {
    // Count all files in the folder ending in .json
    const globPattern = path.join(this.folderPath, "*.json");
    const files = await glob(globPattern);
    return files.length;
  }

  private async getFilePath(key: Key | BasicKeyType): Promise<string> {
    const filename = await this.getKeyAsIdString(key);
    const fullPath = path.join(this.folderPath, `${filename}.json`);
    return fullPath;
  }
}
