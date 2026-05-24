/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai/provider-utils";
import type { ILlamaCppServerProviderOptions } from "./common/LlamaCppServer_Client";
import { buildLlamaCppServerRunFns } from "./common/LlamaCppServer_JobRunFns";
import { LlamaCppServerProvider } from "./LlamaCppServerProvider";

/**
 * Worker-server-side registration. Supports both transport and externalUrl
 * modes — the transport object is constructed inside this worker runtime
 * by the caller and held by closure in the run-fns. No port transfer.
 *
 * This is the primary registration path in production. Callers in the
 * Builder construct `MessagePortBackendsTransport` locally in the worker
 * renderer and pass it straight here.
 */
export async function registerLlamaCppServerWorker(
  options: ILlamaCppServerProviderOptions = {}
): Promise<void> {
  await registerProviderWorker(
    (ws) =>
      new LlamaCppServerProvider(buildLlamaCppServerRunFns(options)).registerOnWorkerServer(ws),
    "LlamaCppServer"
  );
}
