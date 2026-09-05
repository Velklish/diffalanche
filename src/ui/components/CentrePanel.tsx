import { useEffect, useMemo } from "react";
import type { RepositoryChange, ResolvedBase } from "../../core/types.ts";
import { useStore } from "../store.ts";
import { FileCard } from "./FileCard.tsx";
import { FileCardSkeleton } from "./Skeleton.tsx";

/**
 * How long the scroll has to settle before the sidebar follows it, and where the
 * page is asked which card is being read — just under the header. One hit test
 * when the scroll stops, rather than three hundred intersections per frame: the
 * harness scrolls the whole review in five seconds and the budget is 8.3 ms of
 * CPU per frame.
 */
const SETTLE_MS = 120;
const PROBE_Y = 62;

/** The centre column of handoff section 1.4: one section per repository. */
export function CentrePanel() {
  const status = useStore((store) => store.status);
  const failure = useStore((store) => store.failure);
  const repositories = useStore((store) => store.repositories);
  const files = useStore((store) => store.files);
  const indexById = useMemo(() => new Map(files.map((entry) => [entry.id, entry.index])), [files]);

  useCurrentFile(status);

  if (status === "failed") {
    return (
      <main className="centre">
        <p className="failure">The review could not be loaded: {failure}</p>
      </main>
    );
  }

  if (status !== "ready") {
    return (
      <main className="centre">
        <FileCardSkeleton />
      </main>
    );
  }

  return (
    <main className="centre">
      {repositories.map((repo) => (
        <RepoSection key={repo.path} repo={repo} indexById={indexById} />
      ))}
    </main>
  );
}

function RepoSection({
  repo,
  indexById,
}: {
  repo: RepositoryChange;
  indexById: Map<string, number>;
}) {
  const additions = repo.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = repo.files.reduce((sum, file) => sum + file.deletions, 0);

  return (
    <section className="repo">
      <div className="repo-head">
        <div>
          <div className="repo-path">{repo.path}</div>
          <div className="repo-base">
            {repo.branch} ← {baseLine(repo.base)}
          </div>
        </div>
        <span className="spacer" />
        <span className="repo-count">{repo.files.length} files</span>
        <span className="add">+{additions}</span>
        <span className="del">−{deletions}</span>
        <button type="button" className="ghost" disabled>
          Comment on repo
        </button>
      </div>
      {repo.files.map((file) => {
        const id = `${repo.path}/${file.path}`;
        return (
          <FileCard key={id} id={id} repo={repo.path} file={file} index={indexById.get(id) ?? 0} />
        );
      })}
    </section>
  );
}

/**
 * `<base> · merge-base <sha>` of the handoff. The word is only true in `branch`
 * mode; in the others the revision is the ref itself, and the line says so.
 */
function baseLine(base: ResolvedBase | null): string {
  if (base === null) return "no base — outside the review";
  const sha = base.sha.slice(0, 7);
  return base.mode === "branch" ? `${base.ref} · merge-base ${sha}` : `${base.ref} · ${sha}`;
}

/** The current file follows the reading position: the card under the header wins. */
function useCurrentFile(status: string): void {
  useEffect(() => {
    if (status !== "ready") return;

    const pick = () => {
      const centre = document.querySelector(".centre")?.getBoundingClientRect();
      if (!centre) return;
      const card = document
        .elementFromPoint(centre.left + centre.width / 2, PROBE_Y)
        ?.closest<HTMLElement>("[data-repo]");
      const repo = card?.dataset.repo;
      const path = card?.dataset.path;
      if (repo && path) useStore.getState().select(repo, path);
    };

    let settle: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(settle);
      settle = setTimeout(pick, SETTLE_MS);
    };

    pick();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(settle);
      window.removeEventListener("scroll", onScroll);
    };
  }, [status]);
}
