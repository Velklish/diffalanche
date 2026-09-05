import { useMemo } from "react";
import type { FileChange, RepositoryChange } from "../../core/types.ts";
import type { CommentCount } from "../store.ts";
import { useStore } from "../store.ts";
import { SidebarSkeleton } from "./Skeleton.tsx";

/**
 * The 308 px navigation of handoff section 1.3: the tree of repositories with
 * changes, the filter over their names, and the watching footer. The `all
 * files` tab is Phase 2 (DA-37) and stays hidden.
 */
export function Sidebar() {
  const status = useStore((store) => store.status);
  const query = useStore((store) => store.query);
  const setQuery = useStore((store) => store.setQuery);
  const repositories = useStore((store) => store.repositories);

  const tree = useMemo(() => filterTree(repositories, query), [repositories, query]);
  const matches = tree.reduce((sum, entry) => sum + entry.files.length, 0);

  return (
    <nav className="sidebar" aria-label="navigation">
      <div className="sidebar-tabs">
        <span className="tab on">changes</span>
      </div>
      <div className="sidebar-filter">
        <input
          type="search"
          value={query}
          placeholder="filter"
          aria-label="filter"
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="matches">{matches}</span>
      </div>
      {status !== "ready" ? (
        <SidebarSkeleton />
      ) : (
        <div className="tree">
          {/* A review with no changes at all is an empty state of its own (DA-27). */}
          {tree.length === 0 && query.trim() !== "" ? (
            <p className="tree-empty">Nothing matches “{query}”.</p>
          ) : (
            tree.map((entry) => (
              <RepoBranch key={entry.repo.path} repo={entry.repo} files={entry.files} />
            ))
          )}
        </div>
      )}
      <div className="sidebar-foot">
        <span className="dot ok pulse" />
        watching · 127.0.0.1:{location.port || "4880"}
      </div>
    </nav>
  );
}

function RepoBranch({ repo, files }: { repo: RepositoryChange; files: FileChange[] }) {
  const collapsed = useStore((store) => store.collapsedRepos[repo.path] === true);
  const active = useStore((store) => store.repo === repo.path);
  const count = useStore((store) => store.repoCounts.get(repo.path));
  const toggleRepo = useStore((store) => store.toggleRepo);

  return (
    <div className="branch">
      <button
        type="button"
        className={active ? "repo-row on" : "repo-row"}
        aria-expanded={!collapsed}
        onClick={() => toggleRepo(repo.path)}
      >
        <span className="caret">{collapsed ? "▸" : "▾"}</span>
        <span className="repo-name">{repo.path}</span>
        <Counter count={count} />
        <span className="repo-files">· {repo.files.length} files</span>
      </button>
      {collapsed
        ? null
        : files.map((file) => <FileRow key={file.path} repo={repo.path} file={file} />)}
    </div>
  );
}

function FileRow({ repo, file }: { repo: string; file: FileChange }) {
  const id = `${repo}/${file.path}`;
  const selected = useStore((store) => store.repo === repo && store.path === file.path);
  const count = useStore((store) => store.fileCounts.get(id));
  const select = useStore((store) => store.select);

  return (
    <button
      type="button"
      className={selected ? "file-row on" : "file-row"}
      onClick={() => {
        select(repo, file.path);
        document.querySelector(`[data-file="${CSS.escape(id)}"]`)?.scrollIntoView();
      }}
    >
      <span className="file-name">{file.path}</span>
      <span className="spacer" />
      <span className="add">+{file.additions}</span>
      <span className="del">−{file.deletions}</span>
      {count ? <span className={`badge ${count.severity ?? ""}`}>{count.open}</span> : null}
    </button>
  );
}

/** The open comments of a repository, in the colour of the worst of them. */
function Counter({ count }: { count: CommentCount | undefined }) {
  if (!count) return null;
  return <span className={`counter-open ${count.severity ?? ""}`}>{count.open}</span>;
}

type Branch = { repo: RepositoryChange; files: FileChange[] };

/**
 * Substring over the repository path and the file path. A repository whose own
 * path matches keeps all of its files; one that matches through its files keeps
 * the files that matched.
 */
function filterTree(repositories: RepositoryChange[], query: string): Branch[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return repositories.map((repo) => ({ repo, files: repo.files }));

  const branches: Branch[] = [];
  for (const repo of repositories) {
    const files = repo.path.toLowerCase().includes(needle)
      ? repo.files
      : repo.files.filter((file) => file.path.toLowerCase().includes(needle));
    if (files.length > 0) branches.push({ repo, files });
  }
  return branches;
}
