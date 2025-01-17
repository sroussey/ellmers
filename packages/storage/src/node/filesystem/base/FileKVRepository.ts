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

/**
 * A key-value repository implementation that uses the filesystem for storage.
 * Each key-value pair is stored as a separate JSON file in the specified directory.
 *
 * @template Key - The type of the primary key object, defaults to DefaultPrimaryKeyType
 * @template Value - The type of the value object, defaults to DefaultValueType
 * @template PrimaryKeySchema - The schema for the primary key, defaults to DefaultPrimaryKeySchema
 * @template ValueSchema - The schema for the value, defaults to DefaultValueSchema
 * @template Combined - The combined type of Key & Value
 */
export class FileKVRepository<
  Key extends Record<string, BasicKeyType> = DefaultPrimaryKeyType,
  Value extends Record<string, any> = DefaultValueType,
  PrimaryKeySchema extends BasePrimaryKeySchema = typeof DefaultPrimaryKeySchema,
  ValueSchema extends BaseValueSchema = typeof DefaultValueSchema,
  Combined extends Key & Value = Key & Value
> extends KVRepository<Key, Value, PrimaryKeySchema, ValueSchema, Combined> {
  private folderPath: string;

  /**
   * Creates a new FileKVRepository instance.
   *
   * @param folderPath - The directory path where the JSON files will be stored
   * @param primaryKeySchema - Schema defining the structure of the primary key
   * @param valueSchema - Schema defining the structure of the values
   * @param searchable - Array of keys that can be used for searching (Note: search is not supported in this implementation)
   */
  constructor(
    folderPath: string,
    primaryKeySchema: PrimaryKeySchema = DefaultPrimaryKeySchema as PrimaryKeySchema,
    valueSchema: ValueSchema = DefaultValueSchema as ValueSchema,
    searchable: Array<keyof Combined> = []
  ) {
    super(primaryKeySchema, valueSchema, searchable);
    this.folderPath = path.dirname(folderPath);
    mkdirSync(this.folderPath, { recursive: true });
  }

  /**
   * Stores a key-value pair in the repository
   * @param key - The primary key object
   * @param value - The value object to store
   * @emits 'put' event with the fingerprint ID when successful
   */
  async putKeyValue(key: Key, value: Value): Promise<void> {
    const filePath = await this.getFilePath(key);
    try {
      await writeFile(filePath, JSON.stringify(value));
    } catch (error) {
      console.error("Error writing file", filePath, error);
    }
    this.emit("put", key);
  }

  /**
   * Retrieves a value by its key
   * @param key - The primary key object to look up
   * @returns The value object if found, undefined otherwise
   * @emits 'get' event with the fingerprint ID and value when found
   */
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

  /**
   * Deletes an entry by its key
   * @param key - The primary key object of the entry to delete
   * @emits 'delete' event with the fingerprint ID when successful
   */
  async deleteKeyValue(key: Key): Promise<void> {
    const filePath = await this.getFilePath(key);
    try {
      await rm(filePath);
    } catch (error) {
      // console.error("Error deleting file", filePath, error);
    }
    this.emit("delete", key);
  }

  /**
   * Removes all entries from the repository
   * @emits 'clearall' event when successful
   */
  async deleteAll(): Promise<void> {
    // Delete all files in the folder ending in .json
    await rm(this.folderPath, { recursive: true, force: true });
    this.emit("clearall");
  }

  /**
   * Returns the number of entries in the repository
   * @returns The total count of stored key-value pairs
   */
  async size(): Promise<number> {
    // Count all files in the folder ending in .json
    const globPattern = path.join(this.folderPath, "*.json");
    const files = await glob(globPattern);
    return files.length;
  }

  /**
   * Search is not supported in the filesystem implementation.
   * @throws {Error} Always throws an error indicating search is not supported
   */
  async search(key: Partial<Combined>): Promise<Combined[] | undefined> {
    throw new Error("Search not supported for FileKVRepository");
  }

  /**
   * Generates the full filesystem path for a given key.
   * @private
   */
  private async getFilePath(key: Key | BasicKeyType): Promise<string> {
    const filename = await this.getKeyAsIdString(key);
    const fullPath = path.join(this.folderPath, `${filename}.json`);
    return fullPath;
  }
}
