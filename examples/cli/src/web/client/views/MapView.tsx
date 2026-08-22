/** @jsxImportSource preact */
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JSX } from "preact";
import { unicodeBar } from "../../../ui/model/progressBar";
import type { IterationMap } from "../state";

/**
 * Two renderings of one map, over the same slot data.
 *
 * Rows are the terminal's answer: what the workers are doing right now, capped
 * so the height is set by concurrency rather than by the map. The grid is what
 * a browser can add: every iteration at once, which is where a failure is
 * visible without scrolling. The grid needs per-index state, so above the
 * tracking cap it is not offered — a grid of unknown cells would be a lie
 * about what the run knows.
 */
export function MapView({
  taskId,
  map,
  tick,
  view = "rows",
}: {
  taskId: string;
  map: IterationMap;
  tick: number;
  view?: "rows" | "grid";
}): JSX.Element | null {
  if (map.count === 0) return null;
  const queued = Math.max(0, map.count - map.done - map.running.size);

  if (view === "grid" && map.slots) {
    const cells = [];
    for (let index = 0; index < map.count; index++) {
      const status = map.slots.get(index) ?? "pending";
      cells.push(
        <div
          key={index}
          className={`cell${status === "completed" ? " done" : status === "running" ? " run" : ""}`}
          title={`#${index + 1}`}
        />
      );
    }
    return (
      <div className="maphost">
        <div className="mapgrid">{cells}</div>
        <div className="maplegend">
          <span>
            <i style="background:var(--scr-ok)" />
            {map.done} done
          </span>
          <span>
            <i style="background:var(--scr-run)" />
            {map.running.size} running
          </span>
          <span>
            <i style="background:rgba(255,255,255,.10)" />
            {queued} queued
          </span>
        </div>
      </div>
    );
  }

  const running = [...map.running].sort((a, b) => a - b);
  return (
    <div className="maphost">
      {running.map((index) => {
        const progress = map.progress.get(index);
        return (
          <div className="row d1 st-PROCESSING" key={`${taskId}:${index}`}>
            <span className="guide" />
            <span className="gl">{["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"][tick % 8]}</span>
            <span className="lab">iteration #{index + 1}</span>
            <span className="bar">{progress === undefined ? "" : unicodeBar(progress, 12)}</span>
            <span className="pct">{progress === undefined ? "" : `${Math.round(progress)}%`}</span>
          </div>
        );
      })}
      <div className="mapmore">
        {map.done} done · {queued} queued
        {map.slots ? "" : " · tracking running iterations only"}
      </div>
    </div>
  );
}
