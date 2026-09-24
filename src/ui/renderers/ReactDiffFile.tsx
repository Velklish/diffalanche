import type { ReactNode } from "react";
import { useMemo } from "react";
import type { ChangeData, EventMap, HunkData } from "react-diff-view";
import {
  computeNewLineNumber,
  computeOldLineNumber,
  Decoration,
  Diff,
  getChangeKey,
  Hunk,
  tokenize,
} from "react-diff-view";
import "react-diff-view/style/index.css";
import { refractor } from "refractor/core";
import csharp from "refractor/csharp";
import go from "refractor/go";
import javascript from "refractor/javascript";
import json from "refractor/json";
import jsx from "refractor/jsx";
import markdown from "refractor/markdown";
import python from "refractor/python";
import tsx from "refractor/tsx";
import typescript from "refractor/typescript";
import type { FileChange } from "../../core/types.ts";
import { CONTEXT_STEP, gapsAbove, withLinesAbove } from "../context.ts";
import type { ChangedHunks } from "../patch.ts";
import { mergedPatch } from "../patch.ts";
import type { DiffView } from "../store.ts";
import { useStore } from "../store.ts";
import { elapsed } from "../time.ts";
import type { Severity } from "../types.ts";
import { SEVERITIES } from "../types.ts";

/**
 * The core of refractor plus the nine grammars below: the root export of the
 * package registers every Prism language and puts them all in the bundle.
 * Each grammar registers the ones it builds on, so `tsx` brings `jsx` and
 * `typescript` with it.
 */
for (const language of [csharp, go, javascript, json, jsx, markdown, python, tsx, typescript]) {
  refractor.register(language);
}

/** The languages the synthetic review and the reviewed repositories are written in. */
const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  cs: "csharp",
  py: "python",
  go: "go",
  md: "markdown",
  json: "json",
};

/**
 * `react-diff-view` was written against refractor 3, whose `highlight` returned
 * the array of nodes; refractor 5 returns a hast root. The shim keeps the
 * current refractor without pinning the library to an old major.
 */
const highlighter = {
  highlight: (value: string, language: string) => refractor.highlight(value, language).children,
} as unknown as { highlight: typeof refractor.highlight };

/** A diff row by the line it shows: a deleted line is `old`, every other row `new`, whichever side
 * a thread on a context line names (DA-37.2). */
export type DiffRow = { side: "old" | "new"; line: number };

export function rowKey(row: DiffRow): string {
  return `${row.side}:${row.line}`;
}

/** The composer's range, in new-side lines, and the rows put under a line — the composer and the
 * thread cards; the change keys are worked out here, where the hunks are (08-ui.md). */
export type DiffSlots = {
  selected: { from: number; to: number } | null;
  rows: (DiffRow & { node: ReactNode })[];
};

/**
 * How the card is told about the drag that selects a range. The library binds
 * the handlers to its own cells, which is where the line a pointer is over is
 * known; the store turns them into a selection (DA-22).
 */
export type LineEvents = {
  /** `mousedown` on a line of the new side, with whether shift was held. */
  onLineDown: (line: number, shift: boolean) => void;
  /**
   * `mouseenter` over a line. `held` is whether a button is still down: a
   * pointer that comes back over the diff with none held was let go outside
   * the window, and the drag ended there rather than going on for ever.
   */
  onLineEnter: (line: number, held: boolean) => void;
};

/**
 * The bar a line with a thread carries in its gutter, in the colour of the
 * worst open severity on it (`docs/design/HANDOFF.md`, "Границы"). It is a
 * class on the row and a `box-shadow` in the stylesheet: the library calls
 * `generateLineClassName` once per row, and anything drawn per *cell* — a
 * `renderGutter` that returns an element — costs about a millisecond of the
 * eight the scrolled frame has (DA-23).
 */
export type LineMarkers = {
  /** By `rowKey`. */
  severityByRow: Map<string, Severity>;
  /**
   * The hunks of this file that changed while the review has been open, by
   * their `@@` header, and when they did. The header of such a hunk takes the
   * accent border and says how long ago, which is what the handoff's live
   * update asks for instead of a repainted card (DA-25).
   */
  changed: ChangedHunks | null;
};

/** The working tree's lines, once fetched, and how many of them each hunk has above it; `null`
 * for a file whose hunks cannot grow — an added, deleted or type-changed one. */
export type HunkLines = { lines: string[] | null; above: Record<number, number> };

type ReactDiffFileProps = {
  file: FileChange;
  view: DiffView;
  /** Hunks whose outer context lines are hidden, by index in the file. */
  collapsed: Record<number, boolean>;
  onToggleHunk: (index: number) => void;
  context: HunkLines | null;
  /** `max` is how many lines lie above the hunk at all. */
  onExpand: (index: number, count: number, max: number) => void;
  slots: DiffSlots;
  lines: LineEvents;
  markers: LineMarkers;
};

export function ReactDiffFile({
  file,
  view,
  collapsed,
  onToggleHunk,
  context,
  onExpand,
  slots,
  lines,
  markers,
}: ReactDiffFileProps) {
  /**
   * `zip` pairs a deletion with the insertion beside it, so the two columns of
   * the split view line up instead of running one block after the other.
   */
  // Every patch of the entry, not the first: this card is the one place both
  // halves of a file that changed type are shown.
  const parsed = useMemo(() => mergedPatch(file.patch, file.status), [file.patch, file.status]);

  const shown = useMemo(
    () =>
      (parsed?.hunks ?? []).map((hunk, index) => {
        const count = context?.lines ? (context.above[index] ?? 0) : 0;
        const grown = context?.lines ? withLinesAbove(hunk, context.lines, count) : hunk;
        return trimContext(grown, collapsed[index] === true);
      }),
    [parsed, collapsed, context],
  );
  // What is still out of sight above each hunk, counted on the patch as it came.
  const gaps = useMemo(() => gapsAbove(parsed?.hunks ?? []), [parsed]);

  const tokens = useMemo(() => {
    const language = LANGUAGES[file.path.split(".").pop() ?? ""];
    if (!language || !refractor.registered(language)) return null;
    return tokenize(
      shown.map((one) => one.hunk),
      { highlight: true, refractor: highlighter, language },
    );
  }, [shown, file.path]);

  const widgets = useMemo(() => keyed(shown, slots, view), [shown, slots, view]);

  /**
   * A selection runs over the new column, so the old one starts nothing and
   * extends nothing, and neither does a cell with no line on the new side — a
   * deletion, or the filler beside it. The unified view has one column and
   * names no side. `preventDefault` on the press is what stops the browser
   * from selecting the code as text underneath the drag.
   */
  const events = useMemo<EventMap>(
    () => ({
      onMouseDown: ({ side, change }, event) => {
        // The primary button only: a right-click opens a menu, not a range.
        if (event.button !== 0) return;
        const line = newLine(side, change);
        if (line === null) return;
        event.preventDefault();
        lines.onLineDown(line, event.shiftKey);
      },
      onMouseEnter: ({ side, change }, event) => {
        const line = newLine(side, change);
        if (line !== null) lines.onLineEnter(line, event.buttons > 0);
      },
    }),
    [lines],
  );

  /** Only where there is something to mark; a split pair takes the worst of its two sides, and a
   * bar on each side that has threads. */
  const generateLineClassName = useMemo(
    () =>
      ({
        changes,
        defaultGenerate,
      }: {
        changes: (ChangeData | null)[];
        defaultGenerate: () => string;
      }) => {
        const own = defaultGenerate();
        const found = changes.flatMap((change) => {
          const row = change === null ? null : rowOf(change);
          const severity = row === null ? undefined : markers.severityByRow.get(rowKey(row));
          return row === null || severity === undefined ? [] : [{ side: row.side, severity }];
        });
        if (found.length === 0) return own;
        const severity = SEVERITIES.find((one) => found.some((mark) => mark.severity === one));
        const sides = [...new Set(found.map((mark) => ` on-${mark.side}`))].join("");
        return `${own} marked ${severity}${sides}`;
      },
    [markers],
  );

  if (!parsed) return null;

  return (
    <Diff
      viewType={view}
      diffType={parsed.type}
      hunks={shown.map((one) => one.hunk)}
      widgets={widgets.rows}
      selectedChanges={widgets.selected}
      className={view === "split" ? "dc-split" : "dc-unified"}
      gutterEvents={events}
      codeEvents={events}
      {...(markers.severityByRow.size > 0 ? { generateLineClassName } : {})}
      {...(tokens ? { tokens } : {})}
    >
      {(hunks) =>
        hunks.flatMap((hunk, index) => [
          <Decoration
            key={`head-${hunk.content}`}
            className={markers.changed?.hunks.has(hunk.content) ? "hunk-head changed" : "hunk-head"}
          >
            <div className="hunk-head-row">
              <span className="hunk-at">{hunk.content}</span>
              {markers.changed?.hunks.has(hunk.content) ? (
                <HunkUpdated at={markers.changed.at} />
              ) : null}
              {context === null || collapsed[index] === true ? null : (
                <HunkExpandButton
                  hidden={(gaps[index] ?? 0) - (context.above[index] ?? 0)}
                  onExpand={(count) => onExpand(index, count, gaps[index] ?? 0)}
                />
              )}
              <HunkContextButton
                hidden={shown[index]?.hidden ?? 0}
                collapsed={collapsed[index] === true}
                onClick={() => onToggleHunk(index)}
              />
            </div>
          </Decoration>,
          <Hunk key={`hunk-${hunk.content}`} hunk={hunk} />,
        ])
      }
    </Diff>
  );
}

/**
 * How long ago this hunk changed, recounted from the store's clock every five
 * seconds. Only a hunk that has changed mounts one, so the review's other three
 * hundred cards subscribe to nothing.
 */
function HunkUpdated({ at }: { at: number }) {
  const now = useStore((store) => store.tick);
  return <span className="hunk-updated">updated {elapsed(at, now)}</span>;
}

/** `↑ N lines`: the working tree's lines above the hunk, a step at a time (DA-37). */
function HunkExpandButton({
  hidden,
  onExpand,
}: {
  hidden: number;
  onExpand: (count: number) => void;
}) {
  if (hidden <= 0) return null;
  const count = Math.min(CONTEXT_STEP, hidden);
  return (
    <button type="button" className="hunk-expand" onClick={() => onExpand(count)}>
      ↑ {count} lines
    </button>
  );
}

/** The bundled context (`git diff -U3`) hidden or shown, with what `↑ N lines` added to it. */
function HunkContextButton({
  hidden,
  collapsed,
  onClick,
}: {
  hidden: number;
  collapsed: boolean;
  onClick: () => void;
}) {
  if (hidden === 0) return null;
  return (
    <button type="button" className="hunk-context" onClick={onClick}>
      {collapsed ? `↑ ${hidden} lines` : "collapse context"}
    </button>
  );
}

/** Drops the context lines that lead and trail a hunk, keeping what changed. */
function trimContext(hunk: HunkData, collapse: boolean): { hunk: HunkData; hidden: number } {
  const changes = hunk.changes;
  let from = 0;
  while (from < changes.length && changes[from]?.type === "normal") from += 1;
  let to = changes.length;
  while (to > from && changes[to - 1]?.type === "normal") to -= 1;
  const hidden = changes.length - (to - from);
  if (!collapse || hidden === 0) return { hunk, hidden };
  return { hunk: { ...hunk, changes: changes.slice(from, to) }, hidden };
}

/** The new-side line of a cell or a row, or `null` when it has none. */
function newLine(side: "old" | "new" | undefined, change: ChangeData | null): number | null {
  if (side === "old" || change === null) return null;
  const line = computeNewLineNumber(change);
  return line > 0 ? line : null;
}

/** The row a change is on: a deletion by its old line, anything else by its new one. */
function rowOf(change: ChangeData): DiffRow {
  return change.type === "delete"
    ? { side: "old", line: computeOldLineNumber(change) }
    : { side: "new", line: computeNewLineNumber(change) };
}

/** Turns the slots' rows into the change keys the library indexes by. */
function keyed(
  shown: { hunk: HunkData }[],
  slots: DiffSlots,
  view: DiffView,
): { rows: Record<string, ReactNode>; selected: string[] } {
  const rows: Record<string, ReactNode> = {};
  const selected: string[] = [];
  if (slots.rows.length === 0 && slots.selected === null) return { rows, selected };

  const byRow = new Map<string, ChangeData>();
  for (const { hunk } of shown) {
    for (const change of hunk.changes) {
      const row = rowOf(change);
      if (row.line > 0) byRow.set(rowKey(row), change);
    }
  }

  for (const row of slots.rows) {
    const change = byRow.get(rowKey(row));
    if (change) rows[getChangeKey(change)] = row.node;
  }
  // A split pair gets one cell across the row only for a node both sides carry: always one, with
  // a slot per side, so a second side arriving mounts beside the first and remounts nothing.
  if (view === "split") {
    for (const { hunk } of shown) {
      hunk.changes.forEach((change, at) => {
        const next = hunk.changes[at + 1];
        if (change.type !== "delete" || next?.type !== "insert") return;
        const [old, now] = [getChangeKey(change), getChangeKey(next)];
        if (rows[old] === undefined && rows[now] === undefined) return;
        const both = (
          <>
            {rows[old] ?? null}
            {rows[now] ?? null}
          </>
        );
        rows[old] = both;
        rows[now] = both;
      });
    }
  }
  if (slots.selected) {
    for (let line = slots.selected.from; line <= slots.selected.to; line += 1) {
      const change = byRow.get(rowKey({ side: "new", line }));
      if (change) selected.push(getChangeKey(change));
    }
  }
  return { rows, selected };
}
