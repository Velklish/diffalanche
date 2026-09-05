import type { ReactNode } from "react";
import { useMemo } from "react";
import type { ChangeData, HunkData } from "react-diff-view";
import {
  computeNewLineNumber,
  Decoration,
  Diff,
  getChangeKey,
  Hunk,
  parseDiff,
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
import type { DiffView } from "../store.ts";

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

/**
 * Where the project puts its own rows into the library's table: the range the
 * composer is being drawn over, and the rows that follow a line — the composer
 * itself (DA-22) and the inline thread cards (DA-23). Both speak in line
 * numbers of the new side, as the store does; the change keys the library wants
 * are worked out here, where the hunks are.
 */
export type DiffSlots = {
  selected: { from: number; to: number } | null;
  rows: { line: number; node: ReactNode }[];
};

export type ReactDiffFileProps = {
  file: FileChange;
  view: DiffView;
  /** Hunks whose outer context lines are hidden, by index in the file. */
  collapsed: Record<number, boolean>;
  onToggleHunk: (index: number) => void;
  slots: DiffSlots;
};

export function ReactDiffFile({ file, view, collapsed, onToggleHunk, slots }: ReactDiffFileProps) {
  /**
   * `zip` pairs a deletion with the insertion beside it, so the two columns of
   * the split view line up instead of running one block after the other.
   */
  const parsed = useMemo(
    () => parseDiff(file.patch, { nearbySequences: "zip" })[0] ?? null,
    [file.patch],
  );

  const shown = useMemo(
    () => (parsed?.hunks ?? []).map((hunk, index) => trimContext(hunk, collapsed[index] === true)),
    [parsed, collapsed],
  );

  const tokens = useMemo(() => {
    const language = LANGUAGES[file.path.split(".").pop() ?? ""];
    if (!language || !refractor.registered(language)) return null;
    return tokenize(
      shown.map((one) => one.hunk),
      { highlight: true, refractor: highlighter, language },
    );
  }, [shown, file.path]);

  const widgets = useMemo(() => keyed(shown, slots), [shown, slots]);

  if (!parsed) return null;

  return (
    <Diff
      viewType={view}
      diffType={parsed.type}
      hunks={shown.map((one) => one.hunk)}
      widgets={widgets.rows}
      selectedChanges={widgets.selected}
      className={view === "split" ? "dc-split" : "dc-unified"}
      {...(tokens ? { tokens } : {})}
    >
      {(hunks) =>
        hunks.flatMap((hunk, index) => [
          <Decoration key={`head-${hunk.content}`} className="hunk-head">
            <div className="hunk-head-row">
              <span className="hunk-at">{hunk.content}</span>
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
 * The bundle holds three context lines around every change (`git diff -U3`), so
 * this is the whole of what can be shown or hidden today; Phase 2 asks the
 * server for more and the same control grows a second step.
 */
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

/** Turns the slots' line numbers into the change keys the library indexes by. */
function keyed(
  shown: { hunk: HunkData }[],
  slots: DiffSlots,
): { rows: Record<string, ReactNode>; selected: string[] } {
  const rows: Record<string, ReactNode> = {};
  const selected: string[] = [];
  if (slots.rows.length === 0 && slots.selected === null) return { rows, selected };

  const byLine = new Map<number, ChangeData>();
  for (const { hunk } of shown) {
    for (const change of hunk.changes) {
      const line = computeNewLineNumber(change);
      if (line > 0) byLine.set(line, change);
    }
  }

  for (const row of slots.rows) {
    const change = byLine.get(row.line);
    if (change) rows[getChangeKey(change)] = row.node;
  }
  if (slots.selected) {
    for (let line = slots.selected.from; line <= slots.selected.to; line += 1) {
      const change = byLine.get(line);
      if (change) selected.push(getChangeKey(change));
    }
  }
  return { rows, selected };
}
