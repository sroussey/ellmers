import { URL as NodeURL, pathToFileURL } from "url";
import type { WorkerOptions } from "worker_threads";
import { Worker as NodeWorker, isMainThread, parentPort } from "worker_threads";

class WorkerPolyfill extends NodeWorker {
  constructor(scriptUrl: string | NodeURL, options?: WorkerOptions) {
    const resolved: string =
      scriptUrl instanceof NodeURL ? scriptUrl.toString() : pathToFileURL(scriptUrl).toString();
    super(resolved, options);
  }

  addEventListener(event: "message" | "error", listener: (...args: any[]) => void) {
    if (event === "message") this.on("message", listener);
    if (event === "error") this.on("error", listener);
  }

  removeEventListener(event: "message" | "error", listener: (...args: any[]) => void) {
    if (event === "message") this.off("message", listener);
    if (event === "error") this.off("error", listener);
  }
}

const Worker = isMainThread ? WorkerPolyfill : parentPort;
export { Worker, parentPort };

import { globalServiceRegistry } from "../di";
import type { WorkerServerBaseOptions } from "./WorkerServerBase";
import { WORKER_SERVER, WorkerServerBase } from "./WorkerServerBase";
export { WORKER_SERVER };
export class WorkerServer extends WorkerServerBase {
  constructor(options?: WorkerServerBaseOptions) {
    parentPort?.addEventListener("message", async (event) => {
      const msg = {
        type: event.type,
        data: (event as unknown as { readonly data: unknown }).data,
      };
      await this.handleMessage(msg);
    });
    super(options);
  }
}

globalServiceRegistry.register(WORKER_SERVER, () => new WorkerServer(), true);
