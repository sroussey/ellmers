/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Browser-control tasks + server-side auto-registration (Playwright + filesystem profiles).
 * Import this entry point in Node/Bun server runtimes to get all browser tasks with
 * dependencies pre-registered as a side effect.
 */

import "./task/register.server";
export * from "./task/index";
export * from "./task/BrowserTaskDeps";
export * from "./task/ElectronBackend";
export * from "./task/PlaywrightBackend";
