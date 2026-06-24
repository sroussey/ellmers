/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext } from "react";
import type { CliTheme } from "../terminal/detectTerminalTheme";
import { DEFAULT_CLI_THEME } from "../terminal/detectTerminalTheme";

const CliThemeContext = createContext<CliTheme>(DEFAULT_CLI_THEME);

export function CliThemeProvider({
  value,
  slot,
}: {
  readonly value: CliTheme;
  readonly slot: React.ReactNode;
}): React.ReactElement {
  return <CliThemeContext.Provider value={value}>{slot}</CliThemeContext.Provider>;
}

export function useCliTheme(): CliTheme {
  return useContext(CliThemeContext);
}
