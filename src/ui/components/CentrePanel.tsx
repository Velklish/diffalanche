import { useEffect, useLayoutEffect } from "react";
import type { RepositoryChange, ResolvedBase } from "../../core/types.ts";
import { Composer } from "../Composer.tsx";
import { PROBE_Y } from "../reveal.ts";
import { useStore } from "../store.ts";
import { BrowseView } from "./BrowseView.tsx";
import { FileCard } from "./FileCard.tsx";
import { NoChanges } from "./NoChanges.tsx";
import { FileCardSkeleton } from "./Skeleton.tsx";

/** The quiet before the sidebar follows the scroll: one hit test at `PROBE_Y` when it stops, not
 * an intersection per card per frame (08-ui.md, "Navigation"). */
const SETTLE_MS = 120;

/** A review that could not be read; on a `?review=` task of its own the way back is named too,
 * since a mistyped name is fixable by hand (08-ui.md, "The task this window is on"). */
function Failure() {
  const failure = useStore((store) => store.failure);
  const task = useStore((store) => store.reviewName);
  const showTask = useStore((store) => store.showTask);

  if (task === null) return <p className="failure">The review could not be loaded: {failure}</p>;
  return (
    <div className="no-changes">
      <h2 className="no-changes-title">Задача «{task}» не открылась</h2>
      <p className="failure">{failure}</p>
      <p className="no-changes-note">
        Адрес этого окна называет задачу <code>?review={task}</code>. Проверьте имя или откройте
        текущую сессию.
      </p>
      <div className="no-changes-actions">
        <button type="button" className="ghost accent" onClick={() => void showTask(null)}>
          Текущая сессия
        </button>
      </div>
    </div>
  );
}

/** The centre column of handoff section 1.4: one section per repository. */
export function CentrePanel() {
  const status = useStore((store) => store.status);
  const repositories = useStore((store) => store.repositories);
  const browse = useStore((store) => store.browse);

  useCurrentFile(status);
  useReturnFromBrowse(browse);

  if (status === "failed") {
    return (
      <main className="centre">
        <Failure />
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

  // A session whose base resolves to what the working trees already hold: the
  // review is there and has nothing in it (DA-27).
  if (repositories.length === 0) {
    return (
      <main className="centre">
        <NoChanges />
      </main>
    );
  }

  // Browsing folds the review away rather than unmounting it: its cards keep their heights, and
  // `← back to review` lands where the reader left ([08-ui.md](../../../docs/reference/08-ui.md)).
  return (
    <main className="centre">
      {browse ? <BrowseView /> : null}
      <div className={browse ? "review-body away" : "review-body"}>
        <ReviewComposer />
        {repositories.map((repo) => (
          <RepoSection key={repo.path} repo={repo} />
        ))}
      </div>
    </main>
  );
}

/** Back from browsing: the page scrolls to where the review was left, before it is painted. */
function useReturnFromBrowse(browse: boolean): void {
  useLayoutEffect(() => {
    if (browse) return;
    const back = useStore.getState().browseBack;
    if (back === null) return;
    window.scrollTo(0, back.scrollY);
    useStore.setState({ browseBack: null });
  }, [browse]);
}

/** A comment on the whole review has no diff to sit under, so it opens at the top of the reading
 * column — the one place that belongs to every repository. */
function ReviewComposer() {
  const open = useStore((store) => store.composer !== null && store.composer.repo === null);
  return open ? (
    <div className="composer-loose" data-testid="review-composer">
      <Composer />
    </div>
  ) : null;
}

function RepoSection({ repo }: { repo: RepositoryChange }) {
  const additions = repo.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = repo.files.reduce((sum, file) => sum + file.deletions, 0);
  const openComposer = useStore((store) => store.openComposer);
  const composing = useStore(
    (store) =>
      store.composer !== null && store.composer.repo === repo.path && store.composer.path === null,
  );

  return (
    <section className="repo" data-repo-section={repo.path}>
      {/* Sticky inside its own section, so the next one pushes it out; the path is not a jump
          target (08-ui.md, "The page"). */}
      <div className="repo-head">
        <span className="repo-path">{repo.path}</span>
        <span className="repo-base">
          {repo.branch} ← {baseLine(repo.base)}
        </span>
        <span className="spacer" />
        <span className="repo-count">{repo.files.length} files</span>
        <span className="add">+{additions}</span>
        <span className="del">−{deletions}</span>
        <button
          type="button"
          className="ghost"
          onClick={() => openComposer({ repo: repo.path, path: null, side: null, line: null })}
        >
          Comment on repo
        </button>
      </div>
      {composing ? (
        <div className="composer-loose" data-testid="repo-composer">
          <Composer />
        </div>
      ) : null}
      {repo.files.map((file) => {
        const id = `${repo.path}/${file.path}`;
        return <FileCard key={id} id={id} repo={repo.path} file={file} />;
      })}
    </section>
  );
}

/** `<base> · merge-base <sha>` of the handoff; the word is only true in `branch` mode, and in the
 * others the revision is the ref itself. */
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
