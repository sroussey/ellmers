/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { mkdtempSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startWebServer, type WebServerHandle } from "./server";

function demoProgram(): Command {
  const program = new Command();
  const demo = program.command("demo").description("a demo");
  demo.command("echo").description("echo something").argument("<text>", "what to echo");
  return program;
}

function fakeBinary(dir: string): readonly string[] {
  const script = join(dir, "child.mjs");
  writeFileSync(
    script,
    `import { createWriteStream } from "node:fs";
     const out = createWriteStream("", { fd: Number((process.env.WORKGLOW_RUN_EVENTS ?? "").slice(3)) });
     out.write(JSON.stringify({ k: "task_added", id: "t1", type: "T", label: process.argv[4], depth: 0 }) + "\\n");
     out.write(JSON.stringify({ k: "run_end", state: "completed", output: { echoed: process.argv[4] } }) + "\\n");
     out.end(() => process.exit(0));`,
    "utf8"
  );
  return [process.execPath, script];
}

let handle: WebServerHandle | undefined;

async function start(): Promise<WebServerHandle> {
  const dir = mkdtempSync(join(tmpdir(), "wg-server-"));
  handle = await startWebServer({
    port: 0,
    host: "127.0.0.1",
    program: demoProgram(),
    binaryName: "workglow",
    binary: fakeBinary(dir),
    cwd: dir,
    logDir: dir,
  });
  return handle;
}

const auth = (h: WebServerHandle): Record<string, string> => ({ "x-workglow-token": h.token });

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

describe("web server", () => {
  it("serves the command tree to a request carrying the token", async () => {
    const h = await start();
    const response = await fetch(`${h.url}/api/commands`, { headers: auth(h) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { commands: Array<{ name: string }> };
    expect(body.commands[0].name).toBe("demo");
  });

  it("refuses the same request without the token", async () => {
    const h = await start();
    expect((await fetch(`${h.url}/api/commands`)).status).toBe(401);
  });

  it("accepts the token from the query, which is how the event stream carries it", async () => {
    const h = await start();
    expect((await fetch(`${h.url}/api/commands?t=${h.token}`)).status).toBe(200);
  });

  it("refuses a request for a host it is not serving", async () => {
    const h = await start();
    // `fetch` refuses to set Host, so a rebinding attempt needs a raw client —
    // which is exactly what an attacker would be using.
    const status = await rawStatus(h, "evil.example.com");
    expect(status).toBe(403);
    expect(await rawStatus(h, "localhost")).toBe(200);
  });

  it("refuses to start a run whose options the command does not declare", async () => {
    const h = await start();
    const response = await fetch(`${h.url}/api/runs`, {
      method: "POST",
      headers: { ...auth(h), "content-type": "application/json" },
      body: JSON.stringify({ path: ["demo", "echo"], args: ["hi"], options: { nope: "1" } }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as { errors: string[] }).toEqual({
      errors: ['unknown option "nope"'],
    });
    const runs = (await (await fetch(`${h.url}/api/runs`, { headers: auth(h) })).json()) as {
      runs: unknown[];
    };
    expect(runs.runs).toHaveLength(0);
  });

  it("runs a command and streams its events", async () => {
    const h = await start();
    const created = await fetch(`${h.url}/api/runs`, {
      method: "POST",
      headers: { ...auth(h), "content-type": "application/json" },
      body: JSON.stringify({ path: ["demo", "echo"], args: ["hello"], options: {} }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    await new Promise((resolve) => setTimeout(resolve, 700));
    const detail = (await (
      await fetch(`${h.url}/api/runs/${id}`, { headers: auth(h) })
    ).json()) as {
      state: string;
      events: Array<{ seq: number; event: { k: string } }>;
    };
    expect(detail.state).toBe("completed");
    expect(detail.events.map((e) => e.event.k)).toEqual(["run_start", "task_added", "run_end"]);

    const stream = await fetch(`${h.url}/api/runs/${id}/events?t=${h.token}&after=1`, {
      headers: { accept: "text/event-stream" },
    });
    const text = await readSome(stream);
    expect(text).toContain("id: 2");
    expect(text).toContain('"task_added"');
    expect(text).not.toContain("run_start");
  });
});

/** One request with a chosen Host header, which fetch will not send. */
function rawStatus(h: WebServerHandle, host: string): Promise<number> {
  const url = new URL(`${h.url}/api/commands`);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "GET",
        headers: { host, "x-workglow-token": h.token },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/** Reads what the stream has so far, then gives up on the still-open socket. */
async function readSome(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const next = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), 400)
      ),
    ]);
    if (next.done) break;
    text += decoder.decode(next.value, { stream: true });
    if (text.includes("run_end")) break;
  }
  await reader.cancel().catch(() => {});
  return text;
}
