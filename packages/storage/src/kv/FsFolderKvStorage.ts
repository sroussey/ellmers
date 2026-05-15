/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import { JsonSchema } from "@workglow/util/schema";
import { mkdir, readFile, rm, unlink, writeFile } from "fs/promises";
import path from "path";
import { IKvStorage } from "./IKvStorage";
import { KvStorage } from "./KvStorage";

export const FS_FOLDER_KV_REPOSITORY = createServiceToken<IKvStorage<string, any, any>>(
  "storage.kvRepository.fsFolder"
);

/**
 * A key-value repository implementation that stores each value as a file in a specified folder.
 * Uses the file system for persistence, with each key mapped to a file path.
 *
 * @template Key - The type of the primary key
 * @template Value - The type of the value being stored
 * @template Combined - Combined type of Key & Value
 */
export class FsFolderKvStorage<
  Key extends string = string,
  Value extends any = any,
  Combined = { key: Key; value: Value },
> extends KvStorage<Key, Value, Combined> {
  /**
   * Creates a new KvStorage instance
   */
  constructor(
    public folderPath: string,
    public pathWriter: (key: Key) => string,
    keySchema: JsonSchema = { type: "string" },
    valueSchema: JsonSchema = { contentEncoding: "blob" }
  ) {
    super(keySchema, valueSchema);
  }

  /**
   * Sets up the directory for the repository (creates directory)
   */
  private async setupDirectory(): Promise<void> {
    try {
      await mkdir(this.folderPath, { recursive: true });
    } catch (error) {
      // CI system sometimes has issues temporarily
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        await mkdir(this.folderPath, { recursive: true });
      } catch {
        // Ignore error if directory already exists
      }
    }
  }

  /**
   * Stores a row in the repository.
   * @param key - The primary key
   * @param value - The value to store
   */
  public async put(key: Key, value: Value): Promise<void> {
    const localPath = path.join(this.folderPath, this.pathWriter(key).replaceAll("..", "_"));

    let content: string;
    const schemaType =
      typeof this.valueSchema === "object" &&
      this.valueSchema !== null &&
      "type" in this.valueSchema
        ? this.valueSchema.type
        : undefined;
    if (value === null) {
      content = "";
    } else if (schemaType === "object") {
      content = JSON.stringify(value);
    } else if (typeof value === "object") {
      // Handle 'json' type schema from tests
      content = JSON.stringify(value);
    } else {
      content = String(value);
    }

    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, content);
    this.events.emit("put", key, value);
  }

  /**
   * Stores multiple rows in the repository in a bulk operation.
   * @param items - Array of key-value pairs to store
   */
  public async putBulk(items: Array<{ key: Key; value: Value }>): Promise<void> {
    await this.setupDirectory();
    await Promise.all(items.map(async ({ key, value }) => this.put(key, value)));
  }

  /**
   * Retrieves multiple values by their keys via parallel single-file reads.
   * Missing keys are dropped from the result.
   */
  public async getBulk(keys: readonly Key[]): Promise<Combined[]> {
    if (keys.length === 0) return [];
    const settled = await Promise.all(
      keys.map(async (key) => {
        const value = await this.get(key);
        if (value === undefined) return undefined;
        return { key, value } as Combined;
      })
    );
    const combined = settled.filter((r) => r !== undefined) as Combined[];
    this.events.emit("getBulk", keys, combined);
    return combined;
  }

  /**
   * Retrieves a value by its key.
   * This is a convenience method that automatically converts simple types to structured format if using default schema.
   *
   * @param key - Primary key to look up (basic key like default schema)
   * @returns The stored value or undefined if not found
   */
  public async get(key: Key): Promise<Value | undefined> {
    const localPath = path.join(this.folderPath, this.pathWriter(key).replaceAll("..", "_"));
    const typeDef = this.valueSchema;
    try {
      const encoding =
        typeof typeDef === "object" &&
        typeDef !== null &&
        "contentEncoding" in typeDef &&
        typeDef.contentEncoding === "blob"
          ? "binary"
          : "utf-8";
      const content = (await readFile(localPath, { encoding })).toString().trim();

      let value: Value;
      if (encoding === "utf-8") {
        const schemaType =
          typeof typeDef === "object" && typeDef !== null && "type" in typeDef
            ? typeDef.type
            : undefined;
        if (
          schemaType === "object" ||
          (content.startsWith("{") && content.endsWith("}")) ||
          (content.startsWith("[") && content.endsWith("]"))
        ) {
          try {
            value = JSON.parse(content) as Value;
          } catch (e) {
            // If JSON parsing fails, return as string
            value = content as unknown as Value;
          }
        } else {
          value = content as unknown as Value;
        }
      } else {
        value = content as unknown as Value;
      }

      this.events.emit("get", key, value);
      return value;
    } catch (error) {
      this.events.emit("get", key, undefined);
      return undefined;
    }
  }

  /**
   * Deletes a row from the repository.
   * @param key - The primary key of the row to delete
   */
  public async delete(key: Key): Promise<void> {
    const localPath = path.join(this.folderPath, this.pathWriter(key).replaceAll("..", "_"));
    await unlink(localPath);
    this.events.emit("delete", key);
  }

  /**
   * Retrieves all rows from the repository.
   * @returns An array of all rows in the repository or undefined if empty
   */
  public async getAll(): Promise<Combined[] | undefined> {
    throw new Error("Not implemented");
  }

  /**
   * Deletes all rows from the repository.
   */
  public async deleteAll(): Promise<void> {
    const localPath = path.join(this.folderPath);
    await rm(localPath, { recursive: true, force: true });
    this.events.emit("deleteall");
  }

  /**
   * Retrieves the number of rows in the repository.
   * @returns The number of rows in the repository
   */
  public async size(): Promise<number> {
    throw new Error("Not implemented");
  }
}
