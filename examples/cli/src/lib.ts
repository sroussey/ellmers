/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  DEFAULT_WEB_HOST,
  DEFAULT_WEB_PORT,
  registerWebCommand,
  type RegisterWebCommandOptions,
} from "./commands/web";
export { loadConfig, type CliConfig } from "./config";
export {
  withCli,
  type Tasklike,
  type WithCliGraphHandle,
  type WithCliHandle,
  type WithCliOptions,
  type WithCliTaskHandle,
  type WithCliWorkflowHandle,
} from "./run-interactive";
export {
  createAgentRepository,
  createMcpStorage,
  createModelRepository,
  createWorkflowRepository,
} from "./storage";
export { renderTaskInstanceRun, renderTaskRun, renderWorkflowRun } from "./ui/render";
export type { WebInvocation } from "./web/argv";
export { registerCommandSchemaProvider, type CommandSchemaProvider } from "./web/commandFields";
export {
  registerWebFieldWidget,
  registerWebPanel,
  registerWebStatusWidget,
  type PanelData,
  type WebFieldWidget,
  type WebFieldWidgetItem,
  type WebPanel,
  type WebPanelContext,
  type WebStatusMeter,
  type WebStatusWidget,
} from "./web/extensions";
