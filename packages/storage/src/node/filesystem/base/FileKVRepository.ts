//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import path from "node:path";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { DiscriminatorSchema, KVRepository } from "ellmers-core";
import { makeFingerprint } from "../../../util/Misc";
import { glob } from "glob";

// FileKVRepository is a key-value store that uses the file system as the backend for
// simple scenarios. It does support discriminators.

export class FileKVRepository<
  Key = string,
  Value = string,
  Discriminator extends DiscriminatorSchema = DiscriminatorSchema
> extends KVRepository<Key, Value, Discriminator> {
  private folderPath: string;

  constructor(folderPath: string, discriminatorsSchema: Discriminator = {} as Discriminator) {
    super();
    this.discriminatorsSchema = discriminatorsSchema;
    this.folderPath = folderPath;
    mkdir(this.folderPath, { recursive: true });
  }

  async put(keySimpleOrObject: Key, value: Value): Promise<void> {
    const { discriminators, key } = this.extractDiscriminators(keySimpleOrObject);
    const id = typeof key === "object" ? await makeFingerprint(key) : String(key);
    const filePath = await this.getFilePath(key, discriminators);
    await writeFile(filePath, JSON.stringify(value));
    this.emit("put", key);
  }

  async get(keySimpleOrObject: Key): Promise<Value | undefined> {
    const { discriminators, key } = this.extractDiscriminators(keySimpleOrObject);
    const id = typeof key === "object" ? await makeFingerprint(key) : String(key);
    const filePath = await this.getFilePath(key, discriminators);
    try {
      const data = await readFile(filePath, "utf-8");
      this.emit("get", key);
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
    this.emit("clear");
  }

  async size(): Promise<number> {
    // Count all files in the folder ending in .json
    const globPattern = path.join(this.folderPath, "*.json");
    const files = await glob(globPattern);
    return files.length;
  }

  private async getFilePath(
    key: Key,
    discriminators: Record<string, string | number | boolean>
  ): Promise<string> {
    const id = typeof key === "object" ? await makeFingerprint(key) : String(key);
    const filename = Object.values(discriminators).concat(id).join("_");
    return path.join(this.folderPath, `${filename}.json`);
  }
}
