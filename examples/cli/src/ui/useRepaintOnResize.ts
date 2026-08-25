/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { useStdout } from "ink";
import { useEffect, useRef } from "react";

/**
 * Erase the visible screen and home the cursor. Deliberately not the full
 * `clearTerminal` (which adds `ESC[3J`): scrollback is the operator's record of
 * what the run has already printed, and a resize is no reason to take it.
 */
const ERASE_SCREEN_AND_HOME = "\u001B[2J\u001B[H";

/**
 * Repaints from a clean screen when the terminal changes width.
 *
 * A live region is erased by walking the cursor up as many lines as were
 * written. Narrowing the window invalidates that count before it is used: the
 * terminal has already reflowed each of those lines into two rows, so the walk
 * covers half the frame and leaves the top half stranded — one orphaned copy
 * per resize, stacking up above the run.
 *
 * Height changes need none of this. Nothing reflows, the line count still
 * holds, and the renderer's own full clear covers a frame that no longer fits.
 * So this fires on width alone, and the screen is left intact for the resize
 * that does not break it.
 */
export function useRepaintOnResize(columns: number): void {
  const { write } = useStdout();
  const lastColumns = useRef<number | undefined>(undefined);

  useEffect(() => {
    const previous = lastColumns.current;
    lastColumns.current = columns;
    // Nothing has been drawn at the previous width yet on the first pass.
    if (previous === undefined || previous === columns) return;
    write(ERASE_SCREEN_AND_HOME);
  }, [columns, write]);
}
