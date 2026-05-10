/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderInline } from "@workglow/ai/provider-utils";
import { WEB_BROWSER_RUN_FNS } from "./common/WebBrowser_JobRunFns";
import { WebBrowserProvider } from "./WebBrowserProvider";

export async function registerWebBrowserInline(options?: AiProviderRegisterOptions): Promise<void> {
  await registerProviderInline(
    new WebBrowserProvider(WEB_BROWSER_RUN_FNS),
    "Web browser",
    options
  );
}
