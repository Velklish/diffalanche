import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileChange, ReviewBundle } from "../core/types.ts";
import { afterPaint, perf } from "./perf.ts";
import { GitDiffFile } from "./renderers/GitDiffFile.tsx";
import { ReactDiffFile } from "./renderers/ReactDiffFile.tsx";
import type { Variant } from "./variant.ts";
import { variantName } from "./variant.ts";

type Entry = { id: string; index: number; repo: string; file: FileChange };

type ComposerTarget = { id: string; line: number };

/** Height a virtualised card keeps before its diff has ever been mounted. */
const ROW_HEIGHT = 21;

export function App({ variant }: { variant: Variant }) {
  const [bundle, setBundle] = useState<ReviewBundle | null>(null);
  const [composer, setComposer] = useState<ComposerTarget | null>(null);

  useEffect(() => {
    fetch("/api/review")
      .then((response) => response.json() as Promise<ReviewBundle>)
      .then((data) => {
        perf.responseAt = performance.now();
        setBundle(data);
      });
  }, []);

  const entries = useMemo<Entry[]>(() => {
    if (!bundle) return [];
    let index = 0;
    return bundle.repositories.flatMap((repo) =>
      repo.files.map((file) => ({
        id: `${repo.path}/${file.path}`,
        index: index++,
        repo: repo.path,
        file,
      })),
    );
  }, [bundle]);

  const indexById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry.index])),
    [entries],
  );

  const openComposer = useCallback(async () => {
    const entry = entries[0];
    if (!entry) throw new Error("the review has no files");
    const line = firstNewLine(entry.file);
    const start = performance.now();
    setComposer({ id: entry.id, line });
    const painted = await afterPaint();
    return painted - start;
  }, [entries]);

  const jumpToFile = useCallback(async (index: number) => {
    const target = document.querySelector(`[data-file-index="${index}"]`);
    if (!target) throw new Error(`no file card ${index}`);
    const start = performance.now();
    target.scrollIntoView();
    const painted = await afterPaint();
    return painted - start;
  }, []);

  useEffect(() => {
    if (!bundle) return;
    perf.openComposer = openComposer;
    perf.jumpToFile = jumpToFile;
    perf.files = entries.length;
    perf.variant = variantName(variant);
    afterPaint().then((painted) => {
      perf.firstRender = perf.responseAt === null ? null : painted - perf.responseAt;
      perf.ready = true;
    });
  }, [bundle, entries.length, jumpToFile, openComposer, variant]);

  if (!bundle) {
    return <div className="skeleton">loading the review…</div>;
  }

  return (
    <div className="shell">
      <nav className="sidebar">
        {bundle.repositories.map((repo) => (
          <div key={repo.path}>
            <div className="sidebar-repo">
              {repo.path} · {repo.files.length} files
            </div>
            {repo.files.map((file) => (
              <button
                key={file.path}
                type="button"
                className="sidebar-file"
                onClick={() => jumpToFile(indexById.get(`${repo.path}/${file.path}`) ?? 0)}
              >
                {file.path}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <main className="main">
        {bundle.repositories.map((repo) => (
          <section key={repo.path}>
            <h2 className="repo-head">
              {repo.path}
              <span>
                {repo.branch} ← {repo.base} · {repo.files.length} files
              </span>
            </h2>
            {repo.files.map((file) => {
              const id = `${repo.path}/${file.path}`;
              return (
                <FileCard
                  key={id}
                  index={indexById.get(id) ?? 0}
                  file={file}
                  variant={variant}
                  composerLine={composer && composer.id === id ? composer.line : null}
                />
              );
            })}
          </section>
        ))}
      </main>
    </div>
  );
}

type FileCardProps = {
  file: FileChange;
  index: number;
  variant: Variant;
  composerLine: number | null;
};

/** Memoised: opening the composer in one file must not re-render the other 299. */
const FileCard = memo(function FileCard({ file, index, variant, composerLine }: FileCardProps) {
  const holder = useRef<HTMLDivElement>(null);
  const spacer = useRef(estimateHeight(file));
  const [mounted, setMounted] = useState(!variant.virtual);

  useEffect(() => {
    if (!variant.virtual) return;
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
  }, [variant.virtual]);

  return (
    <div className="file-card" data-file-index={index}>
      <div className="file-head">
        <span>{file.path}</span>
        <span className="add">+{file.additions}</span>
        <span className="del">−{file.deletions}</span>
      </div>
      <div ref={holder} style={mounted ? undefined : { height: spacer.current }}>
        {mounted ? (
          variant.renderer === "git-diff-view" ? (
            <GitDiffFile file={file} composerLine={composerLine} highlight={variant.highlight} />
          ) : (
            <ReactDiffFile file={file} composerLine={composerLine} highlight={variant.highlight} />
          )
        ) : null}
      </div>
    </div>
  );
});

/** Split view puts an added and a deleted line side by side, so a pair is one row. */
function estimateHeight(file: FileChange): number {
  const rows = file.patch.split("\n").length;
  return (rows - Math.min(file.additions, file.deletions)) * ROW_HEIGHT;
}

function firstNewLine(file: FileChange): number {
  const header = file.patch.split("\n").find((line) => line.startsWith("@@")) ?? "";
  const match = /\+(\d+)/.exec(header);
  return match?.[1] ? Number(match[1]) : 1;
}
