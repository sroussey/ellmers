/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export * from "@workglow/ai";
export * from "@workglow/knowledge-base";
export * from "@workglow/job-queue";
export * from "@workglow/sqlite/storage";
export * from "@workglow/sqlite/job-queue";
export * from "@workglow/postgres/storage";
export * from "@workglow/postgres/job-queue";
export * from "@workglow/storage";
export * from "@workglow/task-graph";
export * from "@workglow/tasks";
export * from "@workglow/util";
export * from "@workglow/util/schema";
export * from "@workglow/util/graph";
export * from "@workglow/util/media";
export * from "@workglow/util/compress";
export * from "./logging";

// Override the default ConsoleLogger with tslog.
import { TsLogLogger } from "./logging";
import { setLogger } from "@workglow/util";
setLogger(new TsLogLogger());
