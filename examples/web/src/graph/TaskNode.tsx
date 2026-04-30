/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ITask, TaskStatus, type StreamEvent } from "@workglow/task-graph";
import { ArrayTask } from "@workglow/tasks";
import { Node, NodeProps } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { FiCloud, FiCloudLightning } from "react-icons/fi";
import { ProgressBar } from "../components/ProgressBar";
import { TaskDataButtons } from "../components/TaskDataButtons";
import { NodeContainer } from "./NodeContainer";
import { NodeHeader } from "./NodeHeader";

export type TaskNodeData = {
  task: ITask;
};

/**
 * Calculate consolidated progress from subtasks if available, otherwise use task's own progress
 */
function calculateConsolidatedProgress(task: ITask): number {
  if (task.hasChildren()) {
    const tasks = task.subGraph.getTasks();
    if (tasks.length > 0) {
      const totalProgress = tasks.reduce((acc, t) => acc + (t.progress ?? 0), 0);
      return Math.round(totalProgress / tasks.length);
    }
  }
  return task.progress ?? 0;
}

export function TaskNode(props: NodeProps<Node<TaskNodeData, string>>) {
  const { data, isConnectable } = props;
  const [status, setStatus] = useState<TaskStatus>(data.task.status);
  const [progress, setProgress] = useState<number>(calculateConsolidatedProgress(data.task));
  const [subTasks, setSubTasks] = useState<ITask[]>([]);
  const [isExpanded, setIsExpanded] = useState(data.task instanceof ArrayTask);
  const [isExpandable, setIsExpandable] = useState(false);
  const [streamingText, setStreamingText] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const streamingTextRef = useRef<string>("");

  useEffect(() => {
    const task = data.task;

    setStatus(task.status);
    setProgress(calculateConsolidatedProgress(task));
    if (task.hasChildren()) {
      setSubTasks(task.subGraph.getTasks());
    }
    setIsExpandable(task.hasChildren());

    const unsubscribes: (() => void)[] = [];

    // Helper to update consolidated progress
    const updateConsolidatedProgress = () => {
      setProgress(calculateConsolidatedProgress(task));
    };

    unsubscribes.push(
      task.subscribe("status", () => {
        setStatus(task.status);
        updateConsolidatedProgress();
      })
    );

    unsubscribes.push(
      task.subscribe("progress", () => {
        updateConsolidatedProgress();
      })
    );

    unsubscribes.push(
      task.subscribe("stream_start", () => {
        setIsStreaming(true);
        setStreamingText("");
        streamingTextRef.current = "";
      })
    );

    unsubscribes.push(
      task.subscribe("stream_chunk", (event: StreamEvent) => {
        if (event.type === "text-delta") {
          streamingTextRef.current += event.textDelta;
          setStreamingText(streamingTextRef.current);
        } else if (event.type === "snapshot") {
          const text = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
          streamingTextRef.current = text;
          setStreamingText(text);
        }
      })
    );

    unsubscribes.push(
      task.subscribe("stream_end", () => {
        setIsStreaming(false);
      })
    );

    if (task.hasChildren()) {
      const tasks = task.subGraph.getTasks();
      tasks.forEach((subTask) => {
        unsubscribes.push(subTask.subscribe("progress", updateConsolidatedProgress));
        unsubscribes.push(subTask.subscribe("status", updateConsolidatedProgress));
      });

      // Subscribe to subgraph events to handle new tasks
      unsubscribes.push(
        task.subGraph.subscribe("task_added", () => {
          setSubTasks(task.subGraph.getTasks());
          // Subscribe to new task's progress
          const newTasks = task.subGraph.getTasks();
          const lastTask = newTasks[newTasks.length - 1];
          unsubscribes.push(lastTask.subscribe("progress", updateConsolidatedProgress));
          unsubscribes.push(lastTask.subscribe("status", updateConsolidatedProgress));
          updateConsolidatedProgress();
        })
      );
    }

    unsubscribes.push(
      task.subscribe("regenerate", () => {
        setSubTasks(task.subGraph.getTasks());
        updateConsolidatedProgress();
      })
    );

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [data.task, data.task.subGraph]);

  return (
    <>
      <NodeContainer isConnectable={isConnectable} status={status}>
        <NodeHeader
          title={data.task.type}
          description={data.task.config?.title || ""}
          status={status}
        />
        <TaskDataButtons task={data.task} />
        <ProgressBar progress={progress} status={status} showText={true} />

        {(isStreaming || (status === TaskStatus.STREAMING && streamingText)) && (
          <div className="mt-2 p-2 bg-[rgba(28,35,50,0.6)] rounded-sm text-xs font-mono max-h-24 overflow-y-auto">
            <div className="flex items-center gap-1 mb-1">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-streaming-pulse" />
              <span className="text-blue-400 text-[10px]">Streaming</span>
            </div>
            <pre className="whitespace-pre-wrap text-gray-300 break-words">{streamingText}</pre>
          </div>
        )}

        {isExpandable && (
          <div className="flex items-center justify-between mt-3 mb-1">
            <div className="text-xs font-semibold">
              {data.task instanceof ArrayTask ? "Array" : "Graph"} Task
            </div>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs bg-gray-800 hover:bg-gray-700 rounded-sm px-2 py-0.5 transition-colors"
            >
              {isExpanded ? "Hide" : "Show"} sub-graph
            </button>
          </div>
        )}
        {/* Sub-tasks progress */}
        {isExpanded && (
          <div className="mt-3">
            <div className="text-xs font-semibold mb-2">
              <span className="text-gray-500 ml-2">
                {subTasks.filter((t) => t.status === TaskStatus.COMPLETED).length}/{subTasks.length}{" "}
                completed
              </span>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {subTasks.map((subTask) => (
                <SubTask key={subTask.id as string} subTask={subTask} />
              ))}
            </div>
          </div>
        )}
      </NodeContainer>
      <div className="cloud gradient">
        <div>
          {data.task.status === TaskStatus.PROCESSING ||
          data.task.status === TaskStatus.STREAMING ? (
            <FiCloudLightning />
          ) : (
            <FiCloud />
          )}
        </div>
      </div>
    </>
  );
}

function SubTask({ subTask }: { subTask: ITask }) {
  const [progress, setProgress] = useState<number>(subTask.progress ?? 0);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [status, setStatus] = useState<TaskStatus>(subTask.status);
  const [progressDetails, setProgressDetails] = useState<Array<{ file: string; progress: number }>>(
    []
  );

  useEffect(() => {
    setProgress(subTask.progress || 0);
    setStatus(subTask.status);

    const unsubscribes: (() => void)[] = [];

    unsubscribes.push(
      subTask.subscribe("start", () => {
        setProgressDetails([]);
        setProgressMessage("");
        setProgress(0);
      })
    );

    unsubscribes.push(
      subTask.subscribe("status", () => {
        setStatus(subTask.status);
        setProgress(subTask.progress ?? 0);
        if (subTask.status === TaskStatus.COMPLETED && subTask.runOutputData.text) {
          setProgressMessage(subTask.runOutputData.text as string);
        }
      })
    );

    unsubscribes.push(
      subTask.subscribe("progress", (progress, message, details) => {
        setProgress(progress ?? 0);
        setProgressMessage(details?.text || details?.file || message);

        // Track file-based progress details
        if (details?.file) {
          setProgressDetails((oldDetails) => {
            const fileProgress = details.progress ?? progress;
            // Remove files that have reached 100%
            const filteredDetails = (oldDetails ?? []).filter((d) => d.progress < 100);

            // If this file is at 100%, don't add it back
            if (fileProgress >= 100) {
              return filteredDetails;
            }

            if (filteredDetails.length === 0) {
              return [{ file: details.file, progress: fileProgress }];
            }
            const found = filteredDetails.find((d) => d.file === details.file);
            if (found) {
              return filteredDetails.map((d) =>
                d.file === details.file ? { file: details.file, progress: fileProgress } : d
              );
            }
            return [...filteredDetails, { file: details.file, progress: fileProgress }];
          });
        }
      })
    );

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [subTask.progress, subTask.status]);

  // Calculate overall progress from all files or use single progress
  const overallProgress =
    progressDetails.length > 0
      ? progressDetails.reduce((sum, d) => sum + d.progress, 0) / progressDetails.length
      : progress;

  const hasFileProgress = progressDetails.length > 0;

  return (
    <div key={subTask.id as string} className="text-xs subtask-progress">
      {hasFileProgress ? (
        <>
          {/* Overall progress section - only show when there are multiple files */}
          <div className="mb-2">
            <div className="flex justify-between mb-1">
              <span className="truncate font-semibold">Overall Progress</span>
              <span className="text-gray-500">{Math.round(overallProgress || 0)}%</span>
            </div>
            <div className="progress-container">
              <ProgressBar progress={overallProgress || 0} status={status} showText={false} />
            </div>
          </div>

          {/* Individual file progress details */}
          <div className="mt-2 space-y-1.5 pl-2 border-l-2 border-gray-700">
            {progressDetails.map((detail) => (
              <div key={detail.file} className="text-xs">
                <div className="flex justify-between mb-0.5">
                  <span className="truncate text-gray-400">{detail.file}</span>
                  <span className="text-gray-500">{Math.round(detail.progress || 0)}%</span>
                </div>
                <div className="progress-container">
                  <ProgressBar progress={detail.progress || 0} status={status} showText={false} />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        /* Single progress bar when there's only one message stream */
        <div>
          <div className="flex justify-between mb-1">
            <span className="truncate">{progressMessage || "Progress"}</span>
            <span className="text-gray-500">{Math.round(progress || 0)}%</span>
          </div>
          <div className="progress-container">
            <ProgressBar progress={progress || 0} status={status} showText={false} />
          </div>
        </div>
      )}
    </div>
  );
}
