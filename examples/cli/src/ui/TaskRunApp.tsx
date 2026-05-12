/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRunConfig, ITask } from "@workglow/task-graph";
import { Box, Static, Text } from "ink";
import path from "node:path";
import React, { useEffect, useRef, useState } from "react";
import {
  sortCliTaskLinesForDisplay,
  startGraphTaskPoll,
  startTaskInstancePoll,
  type TaskFileProgressRow,
} from "./cliTaskUi";
import { useCliTheme } from "./CliThemeContext";
import { CLI_SPINNER_FRAMES } from "./components/CliSpinner";
import { ProgressBar } from "./components/ProgressBar";
import { StreamOutput } from "./components/StreamOutput";
import { TaskStatusProgressRow } from "./components/TaskStatusProgressRow";
import { HumanInteractionHost } from "./HumanInteractionHost";
import type { CliTaskLine, IterationSlotRow } from "./taskGraphCliSubscriptions";
import {
  iterationSlotToTaskStatus,
  sortIterationSlotsForDisplay,
  subscribeTaskGraphForCli,
} from "./taskGraphCliSubscriptions";

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
  const [subTaskInfos, setSubTaskInfos] = useState<Map<string, CliTaskLine>>(new Map());
  const [subOverallProgress, setSubOverallProgress] = useState<number | undefined>(undefined);
  const [subIterationSlots, setSubIterationSlots] = useState<Map<string, IterationSlotRow[]>>(
    new Map()
  );

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

    let unsubSubgraph: (() => void) | undefined;
    let stopSubPoll: (() => void) | undefined;

    /** Attach once when `hasChildren()` becomes true (may happen after `run()` starts). */
    const tryAttachSubgraph = (): void => {
      if (unsubSubgraph) return;
      if (!task.hasChildren() || !task.subGraph) return;
      unsubSubgraph = subscribeTaskGraphForCli(
        task.subGraph,
        setSubTaskInfos,
        undefined,
        setSubOverallProgress,
        setSubIterationSlots
      );
      stopSubPoll = startGraphTaskPoll(task.subGraph, setSubTaskInfos);
    };

    tryAttachSubgraph();
    const attachInterval = setInterval(tryAttachSubgraph, 150);

    flushTaskDisplay();
    /** 200ms batches high-frequency download updates so Ink stays responsive. */
    const displayInterval = setInterval(flushTaskDisplay, 200);

    task
      .run(overrides, runConfig)
      .then((result) => onComplete(result))
      .catch((err) => onError(err));

    return () => {
      clearInterval(attachInterval);
      clearInterval(displayInterval);
      stopPollTask();
      unsubSubgraph?.();
      stopSubPoll?.();
    };
  }, []);

  const subOrder =
    task.hasChildren() && task.subGraph
      ? new Map(task.subGraph.getTasks().map((t, i) => [String(t.id), i]))
      : new Map<string, number>();
  const orderedSubTasks = sortCliTaskLinesForDisplay(Array.from(subTaskInfos.values()), subOrder);
  /** One child with the same type as the parent is usually the same logical work (e.g. job mirror); hide to avoid duplicate rows. */
  const subgraphIsRedundantDuplicate =
    orderedSubTasks.length === 1 && orderedSubTasks[0]?.type === taskType;
  /** Job queue may register multiple subgraph tasks of the same type (mirrors); hide when all match the parent. */
  const subgraphIsAllSameTypeMirror =
    isModelDownloadTask &&
    orderedSubTasks.length > 1 &&
    orderedSubTasks.every((t) => t.type === taskType);
  /** Per-file download UI already reflects progress; subgraph rows duplicate the parent row (often another ModelDownloadTask). */
  const hideSubtasksWhileDownloadFileUi = isModelDownloadTask && showFileDownloadList;
  const showSubtasksSection =
    !hideSubtasksWhileDownloadFileUi &&
    !subgraphIsRedundantDuplicate &&
    !subgraphIsAllSameTypeMirror &&
    (subTaskInfos.size > 0 || subOverallProgress !== undefined);

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
            type={taskType}
            status={status}
            message={isModelDownloadTask ? undefined : batch.message}
            barProgress={batch.progress}
            spinnerFrame={batch.spin}
            progressBarWidth={isModelDownloadTask ? DOWNLOAD_PROGRESS_BAR_WIDTH : undefined}
          />
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
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>Subtasks</Text>
              <Box paddingLeft={2} flexDirection="column">
                {subOverallProgress !== undefined && (
                  <Box flexDirection="row" justifyContent="space-between" width="100%">
                    <Text color={bodyColor}>Subgraph: </Text>
                    <Box flexShrink={0} marginLeft={1}>
                      <ProgressBar progress={subOverallProgress} />
                    </Box>
                  </Box>
                )}
                {orderedSubTasks.map((t) => {
                  const slots = subIterationSlots.get(t.id);
                  const sortedSlots = slots ? sortIterationSlotsForDisplay(slots) : [];
                  return (
                    <Box key={t.id} flexDirection="column">
                      <TaskStatusProgressRow
                        type={t.type}
                        status={t.status}
                        message={t.message}
                        barProgress={t.progress ?? 0}
                      />
                      {sortedSlots.map((slot) => (
                        <Box
                          key={`${t.id}-iter-${slot.index}`}
                          flexDirection="column"
                          paddingLeft={2}
                        >
                          <TaskStatusProgressRow
                            type={`#${slot.index + 1}`}
                            status={iterationSlotToTaskStatus(slot.status)}
                            message={slot.status === "completed" ? undefined : slot.message}
                            barProgress={slot.progress ?? 0}
                            suppressProgressBar={
                              slot.status !== "running" || slot.progress === undefined
                            }
                          />
                        </Box>
                      ))}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </HumanInteractionHost>
  );
}
