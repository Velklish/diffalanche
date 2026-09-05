import type { CSSProperties } from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { FileChange, FileOmission, FileStatus } from "../../core/types.ts";
import { Composer } from "../Composer.tsx";
import { measurePatch } from "../measure.ts";
import type { DiffSlots } from "../renderers/ReactDiffFile.tsx";
import { ReactDiffFile } from "../renderers/ReactDiffFile.tsx";
import type { DiffView } from "../store.ts";
import { useStore } from "../store.ts";

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
 * comment badge, the state chip and the split/unified segments, and under it
 * the diff, mounted only near the viewport.
 *
 * It subscribes to the store by its own id, so opening the composer in one file
 * re-renders one card and not the other 299 — without that it takes thirteen
 * seconds instead of fifteen milliseconds.
 */
export const FileCard = memo(function FileCard({ id, repo, file, index }: FileCardProps) {
  const view = useStore((store) => store.diffView[id] ?? "split");
  const collapsedCard = useStore((store) => store.collapsedFiles[id] === true);
  const count = useStore((store) => store.fileCounts.get(id));
  const composerLine = useStore((store) =>
    store.composer && store.composer.repo === repo && store.composer.path === file.path
      ? store.composer.line
      : null,
  );
  const collapsedHunks = useStore((store) => store.collapsedHunks[id]);
  const setDiffView = useStore((store) => store.setDiffView);
  const toggleFile = useStore((store) => store.toggleFile);
  const toggleHunk = useStore((store) => store.toggleHunk);

  const shape = useMemo(() => measurePatch(file.patch, view), [file.patch, view]);
  const slots = useMemo<DiffSlots>(
    () => ({
      selected: null,
      rows:
        composerLine === null
          ? []
          : [
              {
                line: composerLine,
                node: <Composer label={`${file.path} L${composerLine}`} />,
              },
            ],
    }),
    [composerLine, file.path],
  );

  const chip = CHIPS[file.status];
  const missing = file.omitted;

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
        {count ? <span className={`badge ${count.severity ?? ""}`}>{count.open}</span> : null}
        {chip ? <span className="chip">{chip}</span> : null}
        {missing ? <span className="chip">{CHIP_OMITTED[missing]}</span> : null}
        <span className="spacer" />
        <span className="add">+{file.additions}</span>
        <span className="del">−{file.deletions}</span>
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
      {collapsedCard ? null : missing ? (
        <p className="file-note">{NOTE_OMITTED[missing]}</p>
      ) : (
        <DiffBody
          file={file}
          view={view}
          height={shape.height}
          width={shape.width}
          collapsed={collapsedHunks ?? NO_HUNKS_COLLAPSED}
          onToggleHunk={(hunk) => toggleHunk(id, hunk)}
          slots={slots}
        />
      )}
    </div>
  );
});

type DiffBodyProps = {
  file: FileChange;
  view: DiffView;
  height: number;
  width: number;
  collapsed: Record<number, boolean>;
  onToggleHunk: (hunk: number) => void;
  slots: DiffSlots;
};

/**
 * The diff is mounted when the card comes near the viewport and unmounted when
 * it leaves; until it has been mounted once, the height counted from the patch
 * holds its place, and afterwards the measured one does.
 */
function DiffBody({ file, view, height, width, collapsed, onToggleHunk, slots }: DiffBodyProps) {
  const holder = useRef<HTMLDivElement>(null);
  const spacer = useRef(height);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          setMounted(true);
          return;
        }
        spacer.current = element.getBoundingClientRect().height;
        setMounted(false);
      },
      { rootMargin: "1000px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={mounted ? "file-body mounted" : "file-body"}
      ref={holder}
      style={
        mounted
          ? // The width of the widest line, so the table needs no intrinsic pass.
            ({ "--code-width": `${width}ch` } as CSSProperties)
          : { height: spacer.current }
      }
    >
      {mounted ? (
        <ReactDiffFile
          file={file}
          view={view}
          collapsed={collapsed}
          onToggleHunk={onToggleHunk}
          slots={slots}
        />
      ) : null}
    </div>
  );
}
