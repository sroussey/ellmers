/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Browser-control tasks + Electron auto-registration (ElectronBackend with Playwright fallback).
 * Import this entry point in Electron runtimes to get all browser tasks with
 * dependencies pre-registered as a side effect.
 */

import "./task/register.electron";
export * from "./task/index";
export * from "./task/BrowserTaskDeps";
export * from "./task/ElectronBackend";
export * from "./task/PlaywrightBackend";
