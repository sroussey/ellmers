/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskStatus } from "@workglow/task-graph";
import React from "react";
import { getStatusColorBg } from "../graph/util";

// A standard progress bar for all node types
export const ProgressBar: React.FC<{
  progress: number | undefined;
  status: TaskStatus;
  showText: boolean;
}> = ({ progress, status, showText }) => {
  const isStreaming = status === TaskStatus.STREAMING;
  const isIndeterminate = progress === undefined;

  return (
    <>
      <div className="w-full bg-[rgba(28,35,50,0.6)] rounded-full overflow-hidden h-2 my-2">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-in-out ${
            isStreaming
              ? "bg-blue-500 animate-streaming-pulse"
              : isIndeterminate && status === TaskStatus.PROCESSING
                ? "bg-gradient-to-r from-[#2a8af6] via-[#a853ba] to-[#2a8af6] bg-[length:200%_100%] animate-progress"
                : status === TaskStatus.PROCESSING
                  ? "bg-gradient-to-r from-[#2a8af6] via-[#a853ba] to-[#2a8af6] bg-[length:200%_100%] animate-progress"
                  : getStatusColorBg(status)
          }`}
          style={{
            width: isStreaming || isIndeterminate ? "100%" : `${Math.round(progress)}%`,
          }}
        />
      </div>
      {showText && !isStreaming && !isIndeterminate && (
        <div className="text-xs text-gray-500">Progress: {Math.round(progress)}%</div>
      )}
      {showText && !isStreaming && isIndeterminate && status === TaskStatus.PROCESSING && (
        <div className="text-xs text-gray-500">In progress...</div>
      )}
      {showText && isStreaming && <div className="text-xs text-blue-400">Streaming...</div>}
    </>
  );
};
