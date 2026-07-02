const Worker = globalThis.Worker;
const parentPort = self;
export { parentPort, Worker };

import { globalServiceRegistry } from "../di";
import type { WorkerServerBaseOptions } from "./WorkerServerBase";
import { WORKER_SERVER, WorkerServerBase } from "./WorkerServerBase";
export { WORKER_SERVER };
export class WorkerServer extends WorkerServerBase {
  constructor(options?: WorkerServerBaseOptions) {
    parentPort?.addEventListener("message", async (event) => {
      const msg = {
        type: event.type,
        data: event.data,
      };
      await this.handleMessage(msg);
    });
    super(options);
  }
}

globalServiceRegistry.register(WORKER_SERVER, () => new WorkerServer(), true);
