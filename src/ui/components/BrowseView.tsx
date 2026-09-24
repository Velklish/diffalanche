import type { MouseEvent, ReactNode } from "react";
import { Fragment, memo, useEffect, useMemo } from "react";
import { worstSeverity } from "../../core/domain/counters.ts";
import { Composer } from "../Composer.tsx";
import { splitLines } from "../context.ts";
import { useStore } from "../store.ts";
import type { Comment, FileRevision, Side } from "../types.ts";
import { InlineThread } from "./FileCard.tsx";

/** Shared, for a file nobody has commented on. */
const NO_THREADS: Comment[] = [];

/** Lines per block: a drag re-renders the blocks its range enters or leaves, not the file (DA-37.1). */
const BLOCK_LINES = 200;

/** A browsed line is written on the side the view reads: the disk is `new`, the base is `old`. */
const SIDE: Record<FileRevision, Side> = { worktree: "new", base: "old" };

const OMITTED = {
  binary: "binary file — not shown",
  "too-large": "over the size limit — not shown",
};

/** Browse mode of handoff section 8: one file whole, numbered from 1, read-only, in place of the
 * review ([08-ui.md](../../../docs/reference/08-ui.md), "Browse mode"). */
export function BrowseView() {
  const repo = useStore((store) => store.plainRepo) ?? "";
  const path = useStore((store) => store.plainPath) ?? "";
  const rev = useStore((store) => store.plainRev);
  const plain = useStore((store) => store.plain);
  const target = useStore((store) => store.plainLine);
  const listed = useStore((store) =>
    store.files.find((one) => one.repo === repo && one.file.path === path),
  );
  const sha = useStore((store) => store.repositories.find((one) => one.path === repo)?.base?.sha);
  const entry = useStore((store) =>
    store.trees[repo]?.tree?.files.find((one) => one.path === path),
  );
  const open = useStore((store) => store.fileCounts.get(`${repo}/${path}`)?.open ?? 0);
  const severity = useStore((store) => store.fileCounts.get(`${repo}/${path}`)?.severity ?? null);
  const composerOnFile = useStore(
    (store) =>
      store.composer !== null &&
      store.composer.repo === repo &&
      store.composer.path === path &&
      store.composer.line === null,
  );

  const status = listed?.file.status;
  // The tree says where the file is once it has arrived; the change set says it before that.
  const inWorktree = entry?.worktree ?? status !== "deleted";
  const inBase = sha !== undefined && (entry?.base ?? status !== "added");

  // The reader is taken to the top of the file, or to the line they came for once it is drawn.
  useEffect(() => {
    if (plain.status !== "ready") return;
    const row = target === null ? null : document.querySelector(`[data-plain-line="${target}"]`);
    if (row === null) window.scrollTo(0, 0);
    else row.scrollIntoView({ block: "center" });
  }, [plain.status, target]);

  const back = () => useStore.getState().toggleBrowse();
  const commentOnFile = () =>
    useStore.getState().openComposer({ repo, path, side: null, line: null });

  return (
    <div className="file-card plain-card" data-plain={`${repo}/${path}`}>
      <div className="file-head">
        <button type="button" className="ghost small" onClick={back}>
          ← back to review
        </button>
        <span className="file-path">{path}</span>
        {open > 0 ? <span className={`badge ${severity ?? ""}`}>{open}</span> : null}
        {listed === undefined ? <span className="chip">not in this review</span> : null}
        <span className="spacer" />
        <span className="plain-repo">{repo}</span>
        <button type="button" className="ghost small" onClick={commentOnFile}>
          Comment on file
        </button>
        <span className="segments">
          <Segment rev="worktree" on={rev === "worktree"} enabled={inWorktree}>
            working tree
          </Segment>
          <Segment rev="base" on={rev === "base"} enabled={inBase}>
            base {sha?.slice(0, 7) ?? ""}
          </Segment>
        </span>
      </div>
      {composerOnFile ? (
        <div className="composer-loose" data-testid="file-composer">
          <Composer />
        </div>
      ) : null}
      {plain.status === "loading" ? (
        <p className="file-note">
          reading {rev === "base" ? "the base revision" : "the working tree"}…
        </p>
      ) : plain.content === null ? (
        <p className="file-note">{plain.failure}</p>
      ) : plain.content.text === null ? (
        <p className="file-note">{plain.content.omitted ? OMITTED[plain.content.omitted] : null}</p>
      ) : (
        <PlainLines repo={repo} path={path} side={SIDE[rev]} text={plain.content.text} />
      )}
    </div>
  );
}

function Segment({
  rev,
  on,
  enabled,
  children,
}: {
  rev: FileRevision;
  on: boolean;
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={on ? "segment on" : "segment"}
      aria-pressed={on}
      disabled={!enabled}
      onClick={() => useStore.getState().setPlainRev(rev)}
    >
      {children}
    </button>
  );
}

/** The lines, one row each, and under a row the threads that end on it and the open composer. */
function PlainLines({
  repo,
  path,
  side,
  text,
}: {
  repo: string;
  path: string;
  side: Side;
  text: string;
}) {
  const lines = useMemo(() => splitLines(text), [text]);
  const threads = useStore((store) => store.threadsByFile.get(`${repo}/${path}`) ?? NO_THREADS);
  const onFile = (store: ReturnType<typeof useStore.getState>) =>
    store.sel !== null &&
    store.sel.repo === repo &&
    store.sel.path === path &&
    store.sel.side === side;
  const selFrom = useStore((store) =>
    onFile(store) ? Math.min(store.sel?.a ?? 0, store.sel?.b ?? 0) : null,
  );
  const selTo = useStore((store) =>
    onFile(store) ? Math.max(store.sel?.a ?? 0, store.sel?.b ?? 0) : null,
  );
  const composerLine = useStore((store) =>
    store.composer !== null &&
    store.composer.repo === repo &&
    store.composer.path === path &&
    store.composer.side === side
      ? (store.composerEnd ?? store.composer.line)
      : null,
  );

  const byLine = useMemo(() => {
    const grouped = new Map<number, Comment[]>();
    for (const thread of threads) {
      if (thread.line === null || thread.side !== side) continue;
      const line = thread.endLine ?? thread.line;
      grouped.set(line, [...(grouped.get(line) ?? []), thread]);
    }
    return grouped;
  }, [threads, side]);

  // One listener for the whole file rather than one per row: a long file is thousands of rows.
  const lineOf = (event: MouseEvent) => {
    const row = (event.target as Element).closest<HTMLElement>("[data-plain-line]");
    return row === null ? null : Number(row.dataset.plainLine);
  };
  const onMouseDown = (event: MouseEvent) => {
    const line = lineOf(event);
    if (event.button !== 0 || line === null) return;
    event.preventDefault();
    const store = useStore.getState();
    if (
      event.shiftKey &&
      store.sel !== null &&
      store.sel.repo === repo &&
      store.sel.path === path
    ) {
      store.extendTo(line);
      return;
    }
    store.startSelect(repo, path, side, line);
  };
  const onMouseMove = (event: MouseEvent) => {
    const line = lineOf(event);
    if (line === null) return;
    const store = useStore.getState();
    if (event.buttons > 0) store.extendSelect(line);
    else store.endSelect();
  };

  const starts = useMemo(
    () =>
      Array.from({ length: Math.ceil(lines.length / BLOCK_LINES) }, (_, at) => at * BLOCK_LINES),
    [lines],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the drag is the pointer's; `C` is the keyboard's way in.
    <div className="plain-lines" onMouseDown={onMouseDown} onMouseMove={onMouseMove}>
      {starts.map((start) => {
        const end = Math.min(start + BLOCK_LINES, lines.length);
        // What of the range and the form falls in this block; a block they miss gets `null`.
        const inside = selFrom !== null && selTo !== null && selTo > start && selFrom <= end;
        return (
          <PlainBlock
            key={start}
            lines={lines}
            start={start}
            end={end}
            byLine={byLine}
            from={inside ? Math.max(selFrom, start + 1) : null}
            to={inside ? Math.min(selTo, end) : null}
            composerLine={
              composerLine !== null && composerLine > start && composerLine <= end
                ? composerLine
                : null
            }
          />
        );
      })}
    </div>
  );
}

/** Lines `start + 1` to `end`, and under a row the threads that end on it and the open form. */
const PlainBlock = memo(function PlainBlock({
  lines,
  start,
  end,
  byLine,
  from,
  to,
  composerLine,
}: {
  lines: string[];
  start: number;
  end: number;
  byLine: Map<number, Comment[]>;
  from: number | null;
  to: number | null;
  composerLine: number | null;
}) {
  return (
    <>
      {lines.slice(start, end).map((line, offset) => {
        const number = start + offset + 1;
        const selected = from !== null && to !== null && number >= from && number <= to;
        const here = byLine.get(number);
        const worst =
          here === undefined
            ? null
            : (worstSeverity(here.filter((one) => one.status === "open")) ?? here[0]?.severity);
        const marked = worst === null || worst === undefined ? "" : ` marked ${worst}`;
        return (
          <Fragment key={number}>
            <div
              className={`plain-line${selected ? " selected" : ""}${marked}`}
              data-plain-line={number}
            >
              <span className="plain-ln">{number}</span>
              <span className="plain-code">{line}</span>
            </div>
            {here !== undefined || composerLine === number ? (
              <div className="widget-row plain-widgets">
                {here === undefined ? null : (
                  <div className="thread-widgets">
                    {here.map((thread) => (
                      <InlineThread key={thread.id} thread={thread} />
                    ))}
                  </div>
                )}
                {composerLine === number ? <Composer /> : null}
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
});
