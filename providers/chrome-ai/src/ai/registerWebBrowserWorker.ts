/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "@workglow/ai/provider-utils";
import { WEB_BROWSER_RUN_FNS } from "./common/WebBrowser_JobRunFns";
import { WebBrowserProvider } from "./WebBrowserProvider";

export async function registerWebBrowserWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) => new WebBrowserProvider(WEB_BROWSER_RUN_FNS).registerOnWorkerServer(ws),
    "Web browser"
  );
}
