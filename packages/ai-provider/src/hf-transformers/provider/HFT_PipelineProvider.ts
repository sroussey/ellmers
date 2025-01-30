import type { JobQueueLlmTask, Model } from "ellmers-ai";

interface StatusFileBookends {
  status: "initiate" | "download" | "done";
  name: string;
  file: string;
}

interface StatusFileProgress {
  status: "progress";
  name: string;
  file: string;
  loaded: number;
  progress: number;
  total: number;
}

interface StatusRunReady {
  status: "ready";
  model: string;
  task: string;
}
interface StatusRunUpdate {
  status: "update";
  output: string;
}
interface StatusRunComplete {
  status: "complete";
  output: string[];
}

type StatusFile = StatusFileBookends | StatusFileProgress;
type StatusRun = StatusRunReady | StatusRunUpdate | StatusRunComplete;
export type CallbackStatus = StatusFile | StatusRun;

export interface PipelineProvider {
  getPipeline(task: JobQueueLlmTask, model: Model, options?: any): Promise<any>;
  downloadProgressCallback(task: JobQueueLlmTask): (status: any) => void;
  generateProgressCallback(task: JobQueueLlmTask): (text: string) => void;
}

let pipelineProvider: PipelineProvider;
export function getPipelineProvider(): PipelineProvider {
  return pipelineProvider;
}

export function setPipelineProvider(provider: PipelineProvider): void {
  pipelineProvider = provider;
}