/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from "ink";
import React from "react";
import { TaskStatusProgressRow } from "../components/TaskStatusProgressRow";
import type { TaskRowProps } from "./pickRenderer";
import { useTaskStreamText } from "./useTaskStreamText";
import { useTaskUsageLine } from "./useTaskUsageLine";

const MAX_LINES = 8;

function tailLines(text: string, n: number): string {
  const lines = text.split("\n");
  if (lines.length <= n) return text;
  return lines.slice(lines.length - n).join("\n");
}

export function StreamingTextRow({ task, line }: TaskRowProps): React.ReactElement {
  const streamText = useTaskStreamText(task);
  const usageLine = useTaskUsageLine(task);
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
      {usageLine ? <Text dimColor> {usageLine}</Text> : null}
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
