/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatUsage } from "@workglow/ai";
import type { IRunConfig, ITask, Usage } from "@workglow/task-graph";
import { Box, Static, Text } from "ink";
import path from "node:path";
import React, { useEffect, useRef, useState } from "react";
import { startTaskInstancePoll, type TaskFileProgressRow } from "./cliTaskUi";
import { useCliTheme } from "./CliThemeContext";
import { CLI_SPINNER_FRAMES } from "./components/CliSpinner";
import { ProgressBar } from "./components/ProgressBar";
import { StreamOutput } from "./components/StreamOutput";
import { TaskStatusProgressRow } from "./components/TaskStatusProgressRow";
import { HumanInteractionHost } from "./HumanInteractionHost";
import { isRedundantSubgraph, SubtaskRows } from "./rows/SubtaskRows";
import { useSubtaskRows } from "./rows/useSubtaskRows";
import { useTaskUsage } from "./rows/useTaskUsage";
import { cliTaskLabel } from "./taskGraphCliSubscriptions";

interface TaskRunAppProps {
  readonly task: ITask;
  readonly taskType: string;
  readonly overrides?: Record<string, unknown>;
  readonly runConfig?: Partial<IRunConfig>;
  readonly onComplete: (result: unknown) => void;
  readonly onError: (error: Error) => void;
}

interface LogLine {
  readonly id: number;
  readonly text: string;
}

/** Batched progress UI when there is no per-file download list (keeps Ink calm). */
interface TaskRunDisplayBatch {
  readonly spin: number;
  readonly progress: number;
  readonly message: string | undefined;
}

const SPINNER_MOD = CLI_SPINNER_FRAMES.length;

function mapTaskFiles(task: unknown): TaskFileProgressRow[] {
  const t = task as { files?: TaskFileProgressRow[] };
  return Array.isArray(t.files) ? t.files.map((f) => ({ file: f.file, progress: f.progress })) : [];
}

function fileListsEqual(
  a: readonly TaskFileProgressRow[],
  b: readonly TaskFileProgressRow[]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].file !== b[i].file || a[i].progress !== b[i].progress) return false;
  }
  return true;
}

/** Matches per-file {@link ProgressBar} width in download mode. */
const DOWNLOAD_PROGRESS_BAR_WIDTH = 10;

export function TaskRunApp({
  task,
  taskType,
  overrides,
  runConfig,
  onComplete,
  onError,
}: TaskRunAppProps): React.ReactElement {
  const theme = useCliTheme();
  const bodyColor = theme.level === "advanced" ? theme.fg : undefined;
  const [status, setStatus] = useState("PENDING");
  const progressRef = useRef({ prog: 0, msg: undefined as string | undefined });
  const [batch, setBatch] = useState<TaskRunDisplayBatch>({
    spin: 0,
    progress: 0,
    message: undefined,
  });
  const [downloadFiles, setDownloadFiles] = useState<TaskFileProgressRow[]>([]);
  const [streamText, setStreamText] = useState("");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [runUsage, setRunUsage] = useState<Usage | undefined>(undefined);
  const runUsageLine = formatUsage(runUsage, "directional");
  const subtasks = useSubtaskRows(task);
  const usage = useTaskUsage(task);
  const usageLine = formatUsage(usage, "directional");

  useEffect(() => {
    const graph = task.subGraph;
    const onUsage = (total: Usage): void => setRunUsage(total);
    graph.subscribe("graph_usage", onUsage);
    return () => {
      graph.off("graph_usage", onUsage);
    };
  }, [task]);

  const showFileDownloadList = downloadFiles.length > 0;
  /** One header row + optional file list — avoids a pre-files row (default bar width) then a second row after `files` appears. */
  const isModelDownloadTask = taskType === "ModelDownloadTask";

  useEffect(() => {
    let logCounter = 0;

    const flushTaskDisplay = (): void => {
      const fileList = mapTaskFiles(task);
      const prog = typeof task.progress === "number" ? task.progress : progressRef.current.prog;
      const msg = progressRef.current.msg;
      if (fileList.length > 0) {
        setDownloadFiles((prev) => (fileListsEqual(prev, fileList) ? prev : fileList));
        setBatch((prev) => ({
          spin: (prev.spin + 1) % SPINNER_MOD,
          progress: prog,
          message: msg,
        }));
        return;
      }
      setDownloadFiles([]);
      setBatch((prev) => ({
        spin: (prev.spin + 1) % SPINNER_MOD,
        progress: prog,
        message: msg,
      }));
    };

    task.events.on("status", (newStatus: string) => {
      setStatus(newStatus);
    });

    task.events.on("progress", (prog: number | undefined, msg?: string) => {
      if (prog !== undefined) progressRef.current.prog = prog;
      if (msg) progressRef.current.msg = msg;
    });

    task.events.on("stream_chunk", (event: { type: string; text?: string }) => {
      if (event.type === "text-delta" && event.text) {
        setStreamText((prev) => prev + event.text);
      }
    });

    task.events.on("stream_end", () => {
      setStreamText((prev) => {
        if (prev) {
          setLogs((logs) => [...logs, { id: logCounter++, text: prev }]);
        }
        return "";
      });
    });

    const stopPollTask = startTaskInstancePoll(() => task, setStatus);

    flushTaskDisplay();
    /** 200ms batches high-frequency download updates so Ink stays responsive. */
    const displayInterval = setInterval(flushTaskDisplay, 200);

    task
      .run(overrides, runConfig)
      .then((result) => onComplete(result))
      .catch((err) => onError(err));

    return () => {
      clearInterval(displayInterval);
      stopPollTask();
    };
  }, [onComplete, onError, task, taskType, overrides, runConfig]);

  /** Job queue may register multiple subgraph tasks of the same type (mirrors); hide when all match the parent. */
  const subgraphIsAllSameTypeMirror =
    isModelDownloadTask &&
    subtasks.rows.length > 1 &&
    subtasks.rows.every((t) => t.type === taskType);
  /** Per-file download UI already reflects progress; subgraph rows duplicate the parent row (often another ModelDownloadTask). */
  const hideSubtasksWhileDownloadFileUi = isModelDownloadTask && showFileDownloadList;
  const showSubtasksSection =
    !hideSubtasksWhileDownloadFileUi &&
    !isRedundantSubgraph(subtasks.rows, taskType) &&
    !subgraphIsAllSameTypeMirror;

  return (
    <HumanInteractionHost>
      <Box flexDirection="column">
        <Static items={logs}>
          {(log) => (
            <Text key={log.id} color={bodyColor}>
              {log.text}
            </Text>
          )}
        </Static>

        <Box flexDirection="column">
          <TaskStatusProgressRow
            label={cliTaskLabel(task)}
            status={status}
            message={isModelDownloadTask ? undefined : batch.message}
            barProgress={batch.progress}
            spinnerFrame={batch.spin}
            progressBarWidth={isModelDownloadTask ? DOWNLOAD_PROGRESS_BAR_WIDTH : undefined}
          />
          {usageLine ? <Text dimColor> {usageLine}</Text> : null}
          {showFileDownloadList && (
            <Box paddingLeft={2} flexDirection="column">
              {downloadFiles.map((f) => (
                <Box key={f.file} flexDirection="row" flexWrap="nowrap" alignItems="center">
                  <Box flexGrow={1} minWidth={0} overflow="hidden" marginRight={1}>
                    <Text dimColor wrap="truncate-end">
                      {path.basename(f.file)}
                    </Text>
                  </Box>
                  <Box flexShrink={0}>
                    <ProgressBar progress={f.progress} width={DOWNLOAD_PROGRESS_BAR_WIDTH} />
                  </Box>
                </Box>
              ))}
            </Box>
          )}
          {streamText && <StreamOutput text={streamText} />}
          {showSubtasksSection && (
            <SubtaskRows
              rows={subtasks.rows}
              tasks={subtasks.tasks}
              iterationSlots={subtasks.iterationSlots}
              overallProgress={subtasks.overallProgress}
              variant="chrome"
            />
          )}
          {runUsageLine ? <Text>{`Tokens ${runUsageLine}`}</Text> : null}
        </Box>
      </Box>
    </HumanInteractionHost>
  );
}
