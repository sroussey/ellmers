/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Select } from "@inkjs/ui";
import { Box, Text, useInput, useWindowSize } from "ink";
import React from "react";

interface SelectPromptAppProps {
  readonly message?: string;
  readonly options: Array<{ label: string; value: string }>;
  readonly onSelect: (value: string) => void;
  readonly onCancel: () => void;
}

// Reserve rows for: message (2), help text (2), padding
const CHROME_ROWS = 5;

export function SelectPromptApp({
  message,
  options,
  onSelect,
  onCancel,
}: SelectPromptAppProps): React.ReactElement {
  const { rows: terminalRows } = useWindowSize();
  const maxVisible = Math.max(3, terminalRows - CHROME_ROWS);
  const visibleCount = Math.min(options.length, maxVisible);
  const isScrollable = options.length > visibleCount;

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column">
      {message && (
        <Box marginBottom={1}>
          <Text bold color="cyan">
            {message}
          </Text>
          {isScrollable && (
            <Text dimColor>
              {" "}
              ({options.length} items, scroll with {"\u2191\u2193"})
            </Text>
          )}
        </Box>
      )}
      <Select options={options} visibleOptionCount={visibleCount} onChange={onSelect} />
      <Box marginTop={1}>
        <Text dimColor>Enter select Esc cancel</Text>
      </Box>
    </Box>
  );
}
