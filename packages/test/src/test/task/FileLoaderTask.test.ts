/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileLoaderTask, registerSafeFetch, type SafeFetchFn } from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const mock = vi.fn;

// Mock fetch for testing — stubbed into SafeFetch so we bypass the real
// server impl (DNS + undici) during unit tests.
const mockFetch = mock((_url: string, _options: RequestInit & { allowPrivate?: boolean }) =>
  Promise.resolve(new Response("test", { status: 200 }))
);
const mockSafeFetch: SafeFetchFn = (url, options) => mockFetch(url, options);

describe("FileLoaderTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let prevSafeFetch: SafeFetchFn;
  beforeAll(() => {
    prevSafeFetch = registerSafeFetch(mockSafeFetch);
  });

  afterAll(() => {
    registerSafeFetch(prevSafeFetch);
  });

  beforeEach(() => {
    mockFetch.mockClear();
  });

  test("loads text file successfully", async () => {
    const textContent = "Hello, World!";
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(textContent, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      )
    );

    const task = new FileLoaderTask({
      defaults: { url: "https://example.com/test.txt", format: "text" },
    });
    const result = await task.run();

    expect(result.text).toBe(textContent);
    expect(result.metadata.format).toBe("text");
    expect(result.metadata.mimeType).toBe("text/plain");
    expect(result.metadata.size).toBe(textContent.length);
    expect(result.metadata.title).toBe("test.txt");
  });

  test("loads markdown file with auto-detection", async () => {
    const markdownContent = "# Hello\n\nThis is markdown.";
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(markdownContent, {
          status: 200,
          headers: { "Content-Type": "text/markdown" },
        })
      )
    );

    const task = new FileLoaderTask({
      defaults: { url: "https://example.com/test.md", format: "auto" },
    });
    const result = await task.run();

    expect(result.text).toBe(markdownContent);
    expect(result.metadata.format).toBe("markdown");
    expect(result.metadata.mimeType).toBe("text/markdown");
  });

  test("loads JSON file and parses content", async () => {
    const jsonData = { name: "Test", value: 42, nested: { key: "value" } };
    const jsonString = JSON.stringify(jsonData);

    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(jsonString, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const task = new FileLoaderTask({
      defaults: { url: "https://example.com/test.json", format: "auto" },
    });
    const result = await task.run();

    expect(result.json).toEqual(jsonData);
    expect(result.metadata.format).toBe("json");
    expect(result.metadata.mimeType).toBe("application/json");
  });

  test("loads CSV file and parses to array of objects", async () => {
    const csvContent = `name,age,city
John,30,New York
Jane,25,London
Bob,35,Paris`;

    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(csvContent, {
          status: 200,
          headers: { "Content-Type": "text/csv" },
        })
      )
    );

    const task = new FileLoaderTask({
      defaults: { url: "https://example.com/test.csv", format: "auto" },
    });
    const result = await task.run();

    expect(result.metadata.format).toBe("csv");
    expect(result.metadata.mimeType).toBe("text/csv");
    expect(result.csv).toHaveLength(3);
    expect(result.csv![0]).toEqual({ name: "John", age: "30", city: "New York" });
    expect(result.csv![1]).toEqual({ name: "Jane", age: "25", city: "London" });
    expect(result.csv![2]).toEqual({ name: "Bob", age: "35", city: "Paris" });
  });

  test("handles CSV with quoted values", async () => {
    const csvContent = `name,description,price
"Product A","Contains, commas",10.99
"Product B","Has ""quotes""",20.50`;

    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(csvContent, {
          status: 200,
          headers: { "Content-Type": "text/csv" },
        })
      )
    );

    const task = new FileLoaderTask({ defaults: { url: "https://example.com/products.csv" } });
    const result = await task.run();

    expect(result.csv).toHaveLength(2);
    expect(result.csv![0]).toEqual({
      name: "Product A",
      description: "Contains, commas",
      price: "10.99",
    });
    expect(result.csv![1]).toEqual({
      name: "Product B",
      description: 'Has "quotes"',
      price: "20.50",
    });
  });

  test("loads image file and converts to base64", async () => {
    // Create a mock blob for an image
    const imageData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header
    const blob = new Blob([imageData], { type: "image/png" });

    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(blob, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        })
      )
    );

    const task = new FileLoaderTask({
      defaults: { url: "https://example.com/test.png", format: "auto" },
    });
    const result = await task.run();

    expect(result.image).toContain("data:image/png;base64,");
    expect(result.metadata.format).toBe("image");
    expect(result.metadata.mimeType).toBe("image/png");
    expect(result.metadata.size).toBe(imageData.length);
  });

  test("detects image format from different extensions", async () => {
    const extensions = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];

    for (const ext of extensions) {
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: `image/${ext}` });

      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(blob, {
            status: 200,
            headers: { "Content-Type": `image/${ext}` },
          })
        )
      );

      const task = new FileLoaderTask({
        defaults: { url: `https://example.com/test.${ext}`, format: "auto" },
      });
      const result = await task.run();

      expect(result.metadata.format).toBe("image");
      expect(result.image).toContain("data:");
      expect(result.image).toContain("base64");
    }
  });

  test("loads PDF file and converts to base64", async () => {
    // Create a mock blob for a PDF
    const pdfData = new Uint8Array([37, 80, 68, 70, 45]); // %PDF- header
    const blob = new Blob([pdfData], { type: "application/pdf" });

    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(blob, {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        })
      )
    );

    const task = new FileLoaderTask({
      defaults: { url: "https://example.com/test.pdf", format: "auto" },
    });
    const result = await task.run();

    expect(result.pdf).toContain("data:application/pdf;base64,");
    expect(result.metadata.format).toBe("pdf");
    expect(result.metadata.mimeType).toBe("application/pdf");
    expect(result.metadata.size).toBe(pdfData.length);
  });

  test("handles explicit format override", async () => {
    const textContent = "This is actually text";
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(textContent, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      )
    );

    // Even though URL ends with .json, force it as text
    const task = new FileLoaderTask({
      defaults: { url: "https://example.com/data.json", format: "text" },
    });
    const result = await task.run();

    expect(result.metadata.format).toBe("text");
    expect(result.text).toBe(textContent);
  });

  test("handles empty CSV correctly", async () => {
    const csvContent = "header1,header2\n";

    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(csvContent, {
          status: 200,
          headers: { "Content-Type": "text/csv" },
        })
      )
    );

    const task = new FileLoaderTask({ defaults: { url: "https://example.com/empty.csv" } });
    const result = await task.run();

    expect(result.csv).toEqual([]);
  });

  test("handles empty text file without error", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response("", {
          status: 200,
        })
      )
    );

    const task = new FileLoaderTask({ defaults: { url: "https://example.com/empty.txt" } });
    const result = await task.run();

    expect(result.text).toBe("");
    expect(result.metadata.format).toBe("text");
  });

  test("handles empty image file gracefully", async () => {
    // Empty blob is technically valid, just has no content
    const emptyBlob = new Blob([], { type: "image/png" });
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(emptyBlob, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        })
      )
    );

    const task = new FileLoaderTask({ defaults: { url: "https://example.com/empty.png" } });
    const result = await task.run();

    expect(result.image).toContain("data:image/png;base64,");
    expect(result.metadata.format).toBe("image");
    expect(result.metadata.size).toBe(0);
  });

  test("handles empty PDF file gracefully", async () => {
    // Empty blob is technically valid, just has no content
    const emptyBlob = new Blob([], { type: "application/pdf" });
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(emptyBlob, {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        })
      )
    );

    const task = new FileLoaderTask({ defaults: { url: "https://example.com/empty.pdf" } });
    const result = await task.run();

    expect(result.pdf).toContain("data:application/pdf;base64,");
    expect(result.metadata.format).toBe("pdf");
    expect(result.metadata.size).toBe(0);
  });

  test("case-insensitive file extension detection", async () => {
    const jsonData = { test: "value" };

    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(jsonData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const task = new FileLoaderTask({
      defaults: { url: "https://example.com/TEST.JSON", format: "auto" },
    });
    const result = await task.run();

    expect(result.metadata.format).toBe("json");
    expect(result.json).toEqual(jsonData);
  });

  test("defaults to text for unknown file extensions", async () => {
    const content = "Unknown file content";

    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(content, {
          status: 200,
        })
      )
    );

    const task = new FileLoaderTask({
      defaults: { url: "https://example.com/file.xyz", format: "auto" },
    });
    const result = await task.run();

    expect(result.metadata.format).toBe("text");
    expect(result.text).toBe(content);
  });

  test("handles CSV with empty fields", async () => {
    const csvContent = `name,age,city
John,,New York
,25,
Bob,35,`;

    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(csvContent, {
          status: 200,
        })
      )
    );

    const task = new FileLoaderTask({ defaults: { url: "https://example.com/sparse.csv" } });
    const result = await task.run();

    expect(result.csv).toHaveLength(3);
    expect(result.csv![0]).toEqual({ name: "John", age: "", city: "New York" });
    expect(result.csv![1]).toEqual({ name: "", age: "25", city: "" });
    expect(result.csv![2]).toEqual({ name: "Bob", age: "35", city: "" });
  });

  test("metadata includes all required fields", async () => {
    const content = "test content";
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(content, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      )
    );

    const url = "https://example.com/folder/file.txt";
    const task = new FileLoaderTask({ defaults: { url, format: "text" } });
    const result = await task.run();

    expect(result.metadata).toHaveProperty("url", url);
    expect(result.metadata).toHaveProperty("format", "text");
    expect(result.metadata).toHaveProperty("size");
    expect(result.metadata).toHaveProperty("title", "file.txt");
    expect(result.metadata).toHaveProperty("mimeType", "text/plain");
  });

  test("handles complex nested JSON", async () => {
    const jsonData = {
      users: [
        { id: 1, name: "Alice", tags: ["admin", "user"] },
        { id: 2, name: "Bob", tags: ["user"] },
      ],
      metadata: {
        version: "1.0",
        created: "2025-01-01",
      },
    };

    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(jsonData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const task = new FileLoaderTask({ defaults: { url: "https://example.com/complex.json" } });
    const result = await task.run();

    expect(result.json).toEqual(jsonData);
    const json = result.json as typeof jsonData;
    expect(json.users).toHaveLength(2);
    expect(json.users[0].tags).toContain("admin");
  });

  test("parses markdown frontmatter", async () => {
    const markdownContent = `---
title: Hello World
date: 2025-01-15
draft: false
tags:
  - javascript
  - typescript
---

# Hello World

This is the body.`;
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(markdownContent, {
          status: 200,
          headers: { "Content-Type": "text/markdown" },
        })
      )
    );

    const task = new FileLoaderTask({
      defaults: { url: "https://example.com/post.md", format: "auto" },
    });
    const result = await task.run();

    expect(result.metadata.format).toBe("markdown");
    expect(result.frontmatter).toEqual({
      title: "Hello World",
      date: "2025-01-15",
      draft: false,
      tags: ["javascript", "typescript"],
    });
    expect(result.text).toBe("# Hello World\n\nThis is the body.");
  });

  test("returns undefined frontmatter for markdown without frontmatter", async () => {
    const markdownContent = "# Hello\n\nNo frontmatter here.";
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(markdownContent, {
          status: 200,
          headers: { "Content-Type": "text/markdown" },
        })
      )
    );

    const task = new FileLoaderTask({ defaults: { url: "https://example.com/plain.md" } });
    const result = await task.run();

    expect(result.frontmatter).toBeUndefined();
    expect(result.text).toBe(markdownContent);
  });

  test("parses MDX frontmatter with auto-detection", async () => {
    const mdxContent = `---
title: Component Page
layout: docs
---

import { Button } from './Button';
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";

# Component Page

<Button />`;
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(mdxContent, {
          status: 200,
          headers: { "Content-Type": "text/markdown" },
        })
      )
    );

    const task = new FileLoaderTask({
      defaults: { url: "https://example.com/page.mdx", format: "auto" },
    });
    const result = await task.run();

    expect(result.metadata.format).toBe("markdown");
    expect(result.frontmatter).toEqual({
      title: "Component Page",
      layout: "docs",
    });
    expect(result.text).toContain("import { Button }");
  });

  test("parses frontmatter with various value types", async () => {
    const markdownContent = `---
string_val: hello
number_int: 42
number_float: 3.14
bool_true: true
bool_false: false
null_val: null
quoted: "quoted value"
single_quoted: 'single quoted'
---

Body content.`;
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(markdownContent, {
          status: 200,
          headers: { "Content-Type": "text/markdown" },
        })
      )
    );

    const task = new FileLoaderTask({ defaults: { url: "https://example.com/types.md" } });
    const result = await task.run();

    expect(result.frontmatter).toEqual({
      string_val: "hello",
      number_int: 42,
      number_float: 3.14,
      bool_true: true,
      bool_false: false,
      null_val: null,
      quoted: "quoted value",
      single_quoted: "single quoted",
    });
  });

  test("returns undefined frontmatter for non-markdown formats", async () => {
    const textContent = "---\ntitle: Not Parsed\n---\nBody";
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(textContent, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      )
    );

    const task = new FileLoaderTask({
      defaults: { url: "https://example.com/test.txt", format: "text" },
    });
    const result = await task.run();

    expect(result.frontmatter).toBeUndefined();
    expect(result.text).toBe(textContent);
  });

  test("parses JSON correctly", async () => {
    const jsonData = { test: "value" };
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(jsonData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const task = new FileLoaderTask({ defaults: { url: "https://example.com/test.json" } });
    const result = await task.run();

    expect(result.json).toEqual(jsonData);
  });
});
