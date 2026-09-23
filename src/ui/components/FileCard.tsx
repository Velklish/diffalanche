import type { CSSProperties, ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { worstSeverity } from "../../core/domain/counters.ts";
import type { FileChange, FileOmission, FileStatus } from "../../core/types.ts";
import { Composer } from "../Composer.tsx";
import { linesAbove, newSideLines } from "../context.ts";
import {
  codeColumnChars,
  hiddenLines,
  measureLines,
  measurePatch,
  measureThreads,
} from "../measure.ts";
import type { DiffSlots, HunkLines, LineEvents, LineMarkers } from "../renderers/ReactDiffFile.tsx";
import { ReactDiffFile } from "../renderers/ReactDiffFile.tsx";
import type { DiffView } from "../store.ts";
import { useStore } from "../store.ts";
import type { Comment, Severity } from "../types.ts";
import { ThreadCard } from "./ThreadCard.tsx";

/** Why a file is listed without its content, in the words of the card. */
const CHIP_OMITTED: Record<FileOmission, string> = {
  binary: "binary",
  "too-large": "too large",
};

const NOTE_OMITTED: Record<FileOmission, string> = {
  binary: "binary file — not shown",
  "too-large": "the diff is over the size limit — not shown",
};

/** Shared, so a card with nothing collapsed keeps the same reference every render. */
const NO_HUNKS_COLLAPSED: Record<number, boolean> = {};

/** How far outside the viewport a card keeps its diff mounted, in pixels. */
const MOUNT_MARGIN = 1000;

/** Shared too, for a file nobody has commented on — which is most of them. */
const NO_THREADS: Comment[] = [];

/** And for a file with no context brought in above its hunks. */
const NO_ABOVE: Record<number, number> = {};

/** The lines of a patch that nothing asked to place anything on. */
const NO_LINES = { lines: new Set<number>(), starts: [] as number[] };

const CHIPS: Record<FileStatus, string | null> = {
  added: "new file",
  deleted: "deleted",
  renamed: "renamed",
  modified: null,
};

export type FileCardProps = {
  id: string;
  repo: string;
  file: FileChange;
  index: number;
};

/**
 * The file card of handoff section 1.4: header with the caret, the path, the
 * comment badge, the state chip, the file-level comment and the split/unified
 * segments, and under it the diff, mounted only near the viewport.
 *
 * It subscribes to the store by its own id, so opening the composer in one file
 * re-renders one card and not the other 299 — without that it takes thirteen
 * seconds instead of fifteen milliseconds.
 */
export const FileCard = memo(function FileCard({ id, repo, file, index }: FileCardProps) {
  const view = useStore((store) => store.diffView[id] ?? "split");
  const collapsedCard = useStore((store) => store.collapsedFiles[id] === true);
  const open = useStore((store) => store.fileCounts.get(id)?.open ?? 0);
  const severity = useStore((store) => store.fileCounts.get(id)?.severity ?? null);
  // Two scalars, not a range whose new identity would re-render the card on any store change;
  // browse mode draws the selection and the form of its own file (08-ui.md, "Browse mode").
  const selFrom = useStore((store) =>
    store.browse ? null : rangeOf(store.sel, repo, file.path, Math.min),
  );
  const selTo = useStore((store) =>
    store.browse ? null : rangeOf(store.sel, repo, file.path, Math.max),
  );
  const composerLine = useStore((store) =>
    !store.browse &&
    store.composer &&
    store.composer.repo === repo &&
    store.composer.path === file.path
      ? (store.composerEnd ?? store.composer.line)
      : null,
  );
  // The file level has no line to sit under, so its form opens under the header
  // — the one place in the card that belongs to the whole file.
  const composerOnFile = useStore(
    (store) =>
      !store.browse &&
      store.composer !== null &&
      store.composer.repo === repo &&
      store.composer.path === file.path &&
      store.composer.line === null,
  );
  const threads = useStore((store) => store.threadsByFile.get(id) ?? NO_THREADS);
  // A reply being written in one of this card's widgets. Since DA-94 the rail
  // does not draw that field, so this card holds the only one there is.
  const replyingHere = useStore(
    (store) =>
      store.replyAt === "widget" &&
      store.replyId !== null &&
      (store.threadsByFile.get(id) ?? NO_THREADS).some((one) => one.id === store.replyId),
  );
  const changed = useStore((store) => store.changed.get(id) ?? null);
  const collapsedHunks = useStore((store) => store.collapsedHunks[id]);
  // Lines fetched for an older patch are numbered for it, so they are dropped with it.
  const context = useStore((store) => {
    const held = store.context[id];
    return held !== undefined && held.patch === file.patch ? held : null;
  });
  const expandAbove = useStore((store) => store.expandAbove);
  const setDiffView = useStore((store) => store.setDiffView);
  const toggleFile = useStore((store) => store.toggleFile);
  const toggleHunk = useStore((store) => store.toggleHunk);
  const openComposer = useStore((store) => store.openComposer);

  // How many characters a code column holds, or `null` when nothing wraps: the
  // estimate counts the rows a wrapped line really takes (DA-107).
  const columns = useStore((store) =>
    store.wrap ? codeColumnChars(view, file.status, store.centreWidth) : null,
  );
  const shape = useMemo(() => measurePatch(file.patch, view, columns), [file.patch, view, columns]);
  const hunks = collapsedHunks ?? NO_HUNKS_COLLAPSED;

  /**
   * The threads of this file grouped by the line their widget sits under. A
   * line a collapsed hunk hides has no row to sit under, so its thread has no
   * widget, no marker, and no height here either — it is still in the rail,
   * which is where it is reached from.
   */
  const hidden = useMemo(() => hiddenLines(file.patch, hunks), [file.patch, hunks]);
  // Parsed only for a card that has threads to place or context brought in: most have neither.
  const placing = threads.length > 0 || context !== null;
  const onPatch = useMemo(
    () => (placing ? newSideLines(file.patch) : NO_LINES),
    [placing, file.patch],
  );
  const above = context?.above ?? NO_ABOVE;
  // The lines `↑ N lines` put in, less those of a hunk whose context is collapsed away.
  const brought = useMemo(() => {
    const byHunk = linesAbove(onPatch.starts, above);
    return [...byHunk].flatMap(([hunk, lines]) => (hunks[hunk] === true ? [] : lines));
  }, [onPatch, above, hunks]);
  const shown = useMemo(() => {
    const extra = new Set(brought);
    return (line: number) => (onPatch.lines.has(line) || extra.has(line)) && !hidden.has(line);
  }, [onPatch, brought, hidden]);
  const anchored = useMemo(() => groupByLine(threads, shown), [threads, shown]);
  const extra = useMemo(
    () =>
      measureLines(
        brought.map((line) => context?.lines[line - 1] ?? ""),
        columns,
      ),
    [brought, context, columns],
  );
  const expandable = useMemo(
    () =>
      (file.status === "modified" || file.status === "renamed") &&
      !file.patch.includes("\ndiff --git "),
    [file.status, file.patch],
  );
  const hunkLines = useMemo<HunkLines | null>(
    () => (expandable ? { lines: context?.lines ?? null, above } : null),
    [expandable, context, above],
  );
  // The widgets are part of the card, so they are part of the height it claims
  // before it has ever been mounted; without them the scrollbar drifts.
  const widgets = useMemo(
    () => [...anchored.values()].reduce((sum, group) => sum + measureThreads(group), 0),
    [anchored],
  );

  const slots = useMemo<DiffSlots>(
    () => ({
      selected: selFrom === null || selTo === null ? null : { from: selFrom, to: selTo },
      rows: widgetRows(anchored, composerLine),
    }),
    [anchored, composerLine, selFrom, selTo],
  );

  const markers = useMemo<LineMarkers>(
    () => ({ severityByLine: severityByLine(anchored), changed }),
    [anchored, changed],
  );

  const lines = useMemo<LineEvents>(
    () => ({
      onLineDown: (line, shift) => {
        const store = useStore.getState();
        const sel = store.sel;
        if (shift && sel !== null && sel.repo === repo && sel.path === file.path) {
          store.extendTo(line);
          return;
        }
        store.startSelect(repo, file.path, "new", line);
      },
      onLineEnter: (line, held) => {
        const store = useStore.getState();
        if (held) store.extendSelect(line);
        else store.endSelect();
      },
    }),
    [repo, file.path],
  );

  const commentOnFile = useCallback(
    () => openComposer({ repo, path: file.path, side: null, line: null }),
    [openComposer, repo, file.path],
  );

  const chip = CHIPS[file.status];
  const missing = file.omitted;
  // A card the reader is writing in stays mounted: a drag, a composer or a
  // reply outrank the observer ([ADR-008](../../../docs/adr/adr-008-diff-rendering-verdict.md)).
  const busy = composerLine !== null || selFrom !== null || replyingHere;

  return (
    <div
      className="file-card"
      data-file-index={index}
      data-file={id}
      data-repo={repo}
      data-path={file.path}
    >
      <div className="file-head">
        <button
          type="button"
          className="caret"
          aria-label={collapsedCard ? "expand" : "collapse"}
          onClick={() => toggleFile(id)}
        >
          {collapsedCard ? "▸" : "▾"}
        </button>
        <span className="file-path">
          {file.status === "renamed" && file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        {open > 0 ? <span className={`badge ${severity ?? ""}`}>{open}</span> : null}
        {chip ? <span className="chip">{chip}</span> : null}
        {missing ? <span className="chip">{CHIP_OMITTED[missing]}</span> : null}
        <span className="spacer" />
        <span className="add">+{file.additions}</span>
        <span className="del">−{file.deletions}</span>
        <button type="button" className="ghost small" onClick={commentOnFile}>
          Comment on file
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={() => useStore.getState().openBrowse(repo, file.path)}
        >
          Browse repo
        </button>
        <span className="segments">
          {(["split", "unified"] as DiffView[]).map((one) => (
            <button
              key={one}
              type="button"
              className={view === one ? "segment on" : "segment"}
              aria-pressed={view === one}
              onClick={() => setDiffView(id, one)}
            >
              {one}
            </button>
          ))}
        </span>
      </div>
      {composerOnFile ? (
        <div className="composer-loose" data-testid="file-composer">
          <Composer />
        </div>
      ) : null}
      {collapsedCard ? null : missing ? (
        <p className="file-note">{NOTE_OMITTED[missing]}</p>
      ) : (
        <DiffBody
          file={file}
          view={view}
          height={shape.height + widgets + extra.height}
          width={Math.max(shape.width, extra.width)}
          collapsed={hunks}
          onToggleHunk={(hunk) => toggleHunk(id, hunk)}
          context={hunkLines}
          onExpand={(hunk, count, max) => void expandAbove(id, repo, file, hunk, count, max)}
          slots={slots}
          lines={lines}
          markers={markers}
          keepMounted={busy}
        />
      )}
    </div>
  );
});

/** The end of the selection this card carries, or `null` when it carries none. */
function rangeOf(
  sel: { repo: string; path: string; a: number; b: number } | null,
  repo: string,
  path: string,
  pick: (a: number, b: number) => number,
): number | null {
  if (sel === null || sel.repo !== repo || sel.path !== path) return null;
  return pick(sel.a, sel.b);
}

/**
 * A thread's widget sits under the last line of its anchor, where the composer
 * that opened it sat; a thread on the whole file has no line and is shown in
 * the rail only.
 */
function groupByLine(threads: Comment[], shown: (line: number) => boolean): Map<number, Comment[]> {
  const byLine = new Map<number, Comment[]>();
  for (const thread of threads) {
    if (thread.line === null) continue;
    const line = thread.endLine ?? thread.line;
    if (!shown(line)) continue;
    const bucket = byLine.get(line);
    if (bucket === undefined) byLine.set(line, [thread]);
    else bucket.push(thread);
  }
  return byLine;
}

/** The colour of a line's bar: the worst severity of the threads that end on it. */
function severityByLine(anchored: Map<number, Comment[]>): Map<number, Severity> {
  const severities = new Map<number, Severity>();
  for (const [line, threads] of anchored) {
    const worst = worstSeverity(threads.filter((thread) => thread.status === "open"));
    severities.set(line, worst ?? (threads[0] as Comment).severity);
  }
  return severities;
}

/**
 * The rows the library inserts under a line. A line can carry both the threads
 * already written on it and the composer for the next one, and the library
 * indexes one row per line, so the two are one node.
 */
function widgetRows(
  anchored: Map<number, Comment[]>,
  composerLine: number | null,
): { line: number; node: ReactNode }[] {
  const rows = [...anchored].map(([line, threads]) => ({
    line,
    node: (
      <div className="widget-row">
        <div className="thread-widgets">
          {threads.map((thread) => (
            <InlineThread key={thread.id} thread={thread} />
          ))}
        </div>
        {line === composerLine ? <Composer /> : null}
      </div>
    ),
  }));
  if (composerLine !== null && !anchored.has(composerLine)) {
    rows.push({
      line: composerLine,
      node: (
        <div className="widget-row">
          <Composer />
        </div>
      ),
    });
  }
  return rows;
}

/** The card of the rail, under the line it is about. */
export function InlineThread({ thread }: { thread: Comment }) {
  return (
    <div className="thread-widget" data-thread-anchor={thread.id}>
      <ThreadCard
        thread={thread}
        scope="file"
        place="widget"
        onFocus={(id) => useStore.getState().focusThread(id)}
      />
    </div>
  );
}

type DiffBodyProps = {
  file: FileChange;
  view: DiffView;
  height: number;
  width: number;
  collapsed: Record<number, boolean>;
  onToggleHunk: (hunk: number) => void;
  context: HunkLines | null;
  onExpand: (hunk: number, count: number, max: number) => void;
  slots: DiffSlots;
  lines: LineEvents;
  markers: LineMarkers;
  keepMounted: boolean;
};

/** The diff mounts near the viewport and unmounts when it leaves; the height
 * counted from the patch holds its place until one was measured at this width. */
function DiffBody({
  file,
  view,
  height,
  width,
  collapsed,
  onToggleHunk,
  context,
  onExpand,
  slots,
  lines,
  markers,
  keepMounted,
}: DiffBodyProps) {
  const holder = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const busy = useRef(keepMounted);
  busy.current = keepMounted;

  // A measurement belongs to the width it was taken at, so a new estimate drops
  // it in the same render rather than after one the placeholder already used.
  const [measured, setMeasured] = useState<number | null>(null);
  const [estimate, setEstimate] = useState(height);
  if (estimate !== height) {
    setEstimate(height);
    setMeasured(null);
  }

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          setNear(true);
          return;
        }
        if (busy.current) return;
        setMeasured(element.getBoundingClientRect().height);
        setNear(false);
      },
      { rootMargin: `${MOUNT_MARGIN}px 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The crossing the observer missed: a card held mounted for its composer stays
  // mounted until somebody scrolls past it again.
  useEffect(() => {
    const element = holder.current;
    if (keepMounted || element === null) return;
    const box = element.getBoundingClientRect();
    if (box.bottom > -MOUNT_MARGIN && box.top < window.innerHeight + MOUNT_MARGIN) return;
    setMeasured(box.height);
    setNear(false);
  }, [keepMounted]);

  const mounted = near || keepMounted;

  return (
    <div
      className={mounted ? "file-body mounted" : "file-body"}
      ref={holder}
      style={
        mounted
          ? // The width of the widest line, so the table needs no intrinsic pass.
            ({ "--code-width": `${width}ch` } as CSSProperties)
          : { height: measured ?? height }
      }
    >
      {mounted ? (
        <ReactDiffFile
          file={file}
          view={view}
          collapsed={collapsed}
          onToggleHunk={onToggleHunk}
          context={context}
          onExpand={onExpand}
          slots={slots}
          lines={lines}
          markers={markers}
        />
      ) : null}
    </div>
  );
}
