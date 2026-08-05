/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, TaskConfig } from "@workglow/task-graph";
import { CreateWorkflow, TaskAbortedError, Workflow } from "@workglow/task-graph";
import { readFile } from "node:fs/promises";

import type { FileLoaderTaskInput, FileLoaderTaskOutput } from "./FileLoaderTask";
import { FileLoaderTask as BaseFileLoaderTask } from "./FileLoaderTask";

export type { FileLoaderTaskInput, FileLoaderTaskOutput };

/**
 * Server-only task for loading documents from the filesystem.
 * Uses Node.js/Bun file APIs directly for better performance.
 * Only available in Node.js and Bun environments.
 *
 * For cross-platform document loading (including browser), use FileLoaderTask with URLs.
 */
export class FileLoaderTask extends BaseFileLoaderTask {
  override async execute(
    input: FileLoaderTaskInput,
    context: IExecuteContext
  ): Promise<FileLoaderTaskOutput> {
    let { url, format = "auto" } = input;

    if (url.startsWith("http://") || url.startsWith("https://")) {
      return super.execute(input, context);
    }

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(0, "Detecting file format");

    if (url.startsWith("file://")) {
      url = url.slice(7);
    }

    const detectedFormat = this.detectFormat(url, format);
    const title = url.split("/").pop() || url;

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(10, `Reading ${detectedFormat} file from filesystem`);

    if (detectedFormat === "json") {
      const fileContent = await readFile(url, { encoding: "utf-8" });
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      await context.updateProgress(50, "Parsing JSON content");
      const jsonData = this.parseJsonContent(fileContent);
      const content = JSON.stringify(jsonData, null, 2);
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      await context.updateProgress(100, "File loaded successfully");
      return {
        text: undefined,
        json: jsonData,
        csv: undefined,
        image: undefined,
        pdf: undefined,
        frontmatter: undefined,
        metadata: {
          url,
          format: detectedFormat,
          size: content.length,
          title,
          mimeType: "application/json",
        },
      };
    }

    if (detectedFormat === "csv") {
      const fileContent = await readFile(url, { encoding: "utf-8" });
      if (!fileContent) {
        throw new Error(`Failed to load CSV from ${url}`);
      }
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      await context.updateProgress(50, "Parsing CSV content");
      const csvData = await this.parseCsvContent(fileContent);
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      await context.updateProgress(100, "File loaded successfully");
      return {
        text: undefined,
        json: undefined,
        csv: csvData,
        image: undefined,
        pdf: undefined,
        frontmatter: undefined,
        metadata: {
          url,
          format: detectedFormat,
          size: fileContent.length,
          title,
          mimeType: "text/csv",
        },
      };
    }

    if (detectedFormat === "image") {
      const fileBuffer = await readFile(url);
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      await context.updateProgress(50, "Converting image to base64");
      const mimeType = this.getImageMimeType(url);
      const blob = new Blob([fileBuffer], { type: mimeType });
      const imageData = await this.blobToBase64DataURL(blob, mimeType);
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      await context.updateProgress(100, "File loaded successfully");
      return {
        text: undefined,
        json: undefined,
        csv: undefined,
        image: imageData,
        pdf: undefined,
        frontmatter: undefined,
        metadata: {
          url,
          format: detectedFormat,
          size: fileBuffer.length,
          title,
          mimeType,
        },
      };
    }

    if (detectedFormat === "pdf") {
      const fileBuffer = await readFile(url);
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      await context.updateProgress(50, "Converting PDF to base64");
      const mimeType = "application/pdf";
      const blob = new Blob([fileBuffer], { type: mimeType });
      const pdfData = await this.blobToBase64DataURL(blob, mimeType);
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      await context.updateProgress(100, "File loaded successfully");
      return {
        text: undefined,
        json: undefined,
        csv: undefined,
        image: undefined,
        pdf: pdfData,
        frontmatter: undefined,
        metadata: {
          url,
          format: detectedFormat,
          size: fileBuffer.length,
          title,
          mimeType,
        },
      };
    }

    // text, markdown, or html
    const fileContent = await readFile(url, { encoding: "utf-8" });
    if (!fileContent) {
      throw new Error(`Failed to load content from ${url}`);
    }
    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(50, `Parsing ${detectedFormat} content`);
    const mimeType =
      detectedFormat === "markdown"
        ? "text/markdown"
        : detectedFormat === "html"
          ? "text/html"
          : "text/plain";
    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(100, "File loaded successfully");

    if (detectedFormat === "markdown") {
      const { frontmatter, body } = this.parseFrontmatter(fileContent);
      return {
        text: body,
        json: undefined,
        csv: undefined,
        image: undefined,
        pdf: undefined,
        frontmatter,
        metadata: {
          url,
          format: detectedFormat,
          size: fileContent.length,
          title,
          mimeType,
        },
      };
    }

    return {
      text: fileContent,
      json: undefined,
      csv: undefined,
      image: undefined,
      pdf: undefined,
      frontmatter: undefined,
      metadata: {
        url,
        format: detectedFormat,
        size: fileContent.length,
        title,
        mimeType,
      },
    };
  }
}

export const fileLoader = (input: FileLoaderTaskInput, config?: TaskConfig) => {
  return new FileLoaderTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    fileLoader: CreateWorkflow<FileLoaderTaskInput, FileLoaderTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.fileLoader = CreateWorkflow(FileLoaderTask);
