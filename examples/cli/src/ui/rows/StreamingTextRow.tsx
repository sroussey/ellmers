/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatUsage } from "@workglow/ai";
import { Box, Text } from "ink";
import React from "react";
import { TaskStatusProgressRow } from "../components/TaskStatusProgressRow";
import type { TaskRowProps } from "./pickRenderer";
import { useTaskStreamText } from "./useTaskStreamText";
import { useTaskUsage } from "./useTaskUsage";

const MAX_LINES = 8;

function tailLines(text: string, n: number): string {
  const lines = text.split("\n");
  if (lines.length <= n) return text;
  return lines.slice(lines.length - n).join("\n");
}

export function StreamingTextRow({ task, line }: TaskRowProps): React.ReactElement {
  const streamText = useTaskStreamText(task);
  const usage = useTaskUsage(task);
  const isActive = line.status === "PROCESSING";
  const showPanel = isActive && streamText.length > 0;

  return (
    <Box flexDirection="column">
      <TaskStatusProgressRow
        label={line.label}
        status={line.status}
        message={line.message}
        barProgress={line.progress ?? 0}
      />
      {formatUsage(usage, "directional") ? (
        <Text dimColor> {formatUsage(usage, "directional")}</Text>
      ) : null}
      {showPanel && (
        <Box
          flexDirection="column"
          marginTop={0}
          marginLeft={2}
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
        >
          <Text dimColor>{tailLines(streamText, MAX_LINES)}</Text>
        </Box>
      )}
    </Box>
  );
}
