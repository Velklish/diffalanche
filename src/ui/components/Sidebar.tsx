import { type KeyboardEvent, useEffect, useMemo } from "react";
import { byCodePoint } from "../../core/order.ts";
import type { FileChange, RepositoryChange } from "../../core/types.ts";
import { revealCard } from "../reveal.ts";
import { countDraft, pathPicked, repoMark, scopeLabel } from "../scope.ts";
import type { Connection, SidebarTab, TreeState } from "../store.ts";
import { useStore } from "../store.ts";
import type { Counters } from "../types.ts";
import { PanelAway } from "./PanelAway.tsx";
import { Tick } from "./ScopeEditor.tsx";
import { SidebarSkeleton } from "./Skeleton.tsx";

/** The 308 px navigation of handoff section 1.3 and its three tabs; what each shows is in
 * [08-ui.md](../../../docs/reference/08-ui.md), "Navigation" and "Browse mode". */
export function Sidebar() {
  const status = useStore((store) => store.status);
  const query = useStore((store) => store.query);
  const setQuery = useStore((store) => store.setQuery);
  const repositories = useStore((store) => store.repositories);
  const tab = useStore((store) => store.sidebarTab);
  const trees = useStore((store) => store.trees);
  const all = tab === "all";

  const tree = useMemo(
    () => (all ? allFiles(repositories, trees, query) : filterTree(repositories, query)),
    [all, repositories, trees, query],
  );
  const matches = tree.reduce((sum, entry) => sum + (entry.rows ?? entry.files).length, 0);
  const select = tab === "select";

  // The trees are read when the tab asks for them, and again after every read of the review.
  useEffect(() => {
    if (!all || status !== "ready") return;
    const store = useStore.getState();
    for (const repo of repositories) {
      if (store.trees[repo.path] === undefined) void store.loadTree(repo.path);
    }
  }, [all, status, repositories]);

  return (
    <nav className="sidebar" aria-label="navigation">
      <div className="sidebar-tabs">
        <Tab tab="changes" />
        <Tab tab="all" />
        <Tab tab="select" />
        <span className="spacer" />
        <PanelAway side="sidebar" />
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
          <RowKeys />
          {/* A review with no changes at all is the centre panel's own screen
              (components/NoChanges.tsx); the tree only speaks about the filter. */}
          {tree.length === 0 && query.trim() !== "" ? (
            <p className="tree-empty">Nothing matches “{query}”.</p>
          ) : (
            tree.map((entry) => (
              <RepoBranch
                key={entry.repo.path}
                repo={entry.repo}
                files={entry.files}
                rows={entry.rows}
                select={select}
              />
            ))
          )}
        </div>
      )}
      {select ? <SelectBar /> : null}
      <Watching />
    </nav>
  );
}

/** What each tab is called, in the order the handoff draws them. */
const TABS: Record<SidebarTab, string> = {
  changes: "changes",
  all: "all files",
  select: "select",
};

function Tab({ tab }: { tab: SidebarTab }) {
  const on = useStore((store) => store.sidebarTab === tab);
  const setSidebarTab = useStore((store) => store.setSidebarTab);
  return (
    <button
      type="button"
      className={on ? "tab on" : "tab"}
      aria-pressed={on}
      onClick={() => setSidebarTab(tab)}
    >
      {TABS[tab]}
    </button>
  );
}

/**
 * The foot of select mode: what is picked, and the task it becomes. The count
 * is the scope's own, so it says the same thing the `SCOPE` pill of the task
 * will say once it exists ([scope.ts](../scope.ts)).
 */
function SelectBar() {
  const draft = useStore((store) => store.selectDraft);
  const openNewTask = useStore((store) => store.openNewTask);
  const clearSelection = useStore((store) => store.clearSelection);
  const counted = countDraft(draft);
  const empty = counted.repos === 0;

  return (
    <div className="select-bar">
      <span className="select-count">{empty ? "ничего не выбрано" : scopeLabel(counted)}</span>
      <span className="spacer" />
      {empty ? null : (
        <button type="button" className="ghost small" onClick={clearSelection}>
          Clear
        </button>
      )}
      <button
        type="button"
        className="primary small"
        disabled={empty}
        onClick={() => openNewTask(true)}
      >
        New task…
      </button>
    </div>
  );
}

/** The dot beside the state: alive while the stream is, and quiet before it. */
const DOT: Record<Connection, string> = {
  watching: "ok pulse",
  reconnecting: "warn pulse",
  connecting: "",
};

/**
 * The footer of handoff section 1.3, saying what the live stream is doing. The
 * dot pulses while the page is being told about changes and while it is getting
 * that back; it stops only before the first frame has ever arrived
 * ([live.ts](../live.ts)).
 */
function Watching() {
  const connection = useStore((store) => store.connection);
  return (
    <div className="sidebar-foot">
      <span className={`dot ${DOT[connection]}`} />
      {connection} · 127.0.0.1:{location.port || "4880"}
    </div>
  );
}

/**
 * The sentence every repository row points at, once. The row's second action is
 * reachable only by the key: an assistive technology that activates the row
 * synthesises a click whose target is the row itself, which jumps, and the
 * caret is `aria-hidden` because it draws a state the row already carries. So
 * the keys are said out loud rather than left to be discovered by pressing them
 * (DA-54).
 */
const KEYS_ID = "repo-row-keys";

/** One sentence for the whole tree; every row's `aria-describedby` names it. */
function RowKeys() {
  const select = useStore((store) => store.sidebarTab === "select");
  return (
    <p id={KEYS_ID} className="visually-hidden">
      {select
        ? "Enter picks this repository for a new task, Space collapses and expands its files."
        : "Enter goes to this repository in the diff, Space collapses and expands its files."}
    </p>
  );
}

/**
 * The row of handoff section 1.3, and its two targets: the caret puts the
 * branch away, the rest of the row goes to that repository in the reading
 * column — or, in select mode, picks it. It is one tab stop and one focus ring
 * — the row itself — and the two actions are told apart twice: the pointer by
 * where it landed, the keyboard by which key was pressed. `Enter` acts, `Space`
 * toggles (DA-54).
 */
function RepoBranch({
  repo,
  files,
  rows,
  select,
}: {
  repo: RepositoryChange;
  files: FileChange[];
  rows: TreeRow[] | null;
  select: boolean;
}) {
  const collapsed = useStore((store) => store.collapsedRepos[repo.path] === true);
  const active = useStore((store) => store.repo === repo.path);
  const count = useStore((store) => store.repoCounts.get(repo.path));
  const draft = useStore((store) => store.selectDraft);
  const toggleRepo = useStore((store) => store.toggleRepo);
  const pickTreeRepo = useStore((store) => store.pickTreeRepo);
  const paths = repo.files.map((file) => file.path);
  const mark = repoMark(draft, repo.path, paths);
  const act = select
    ? () => pickTreeRepo(repo.path, paths)
    : () => void revealCard(`[data-repo-section="${CSS.escape(repo.path)}"]`);
  const toggle = () => toggleRepo(repo.path);
  // `mixed` is what ARIA has for a repository some of whose files are picked.
  // The tick is `aria-hidden`, so the row is where that state has to live, and
  // without `mixed` it would say "not picked" while the tick says otherwise.
  const pressed = select
    ? { "aria-pressed": mark === "partial" ? ("mixed" as const) : mark === "on" }
    : {};

  return (
    <div className="branch">
      <button
        type="button"
        className={active && !select ? "repo-row on" : "repo-row"}
        aria-expanded={!collapsed}
        aria-keyshortcuts="Enter Space"
        aria-describedby={KEYS_ID}
        {...pressed}
        onClick={(event) => {
          const caret = event.target instanceof Element && event.target.closest(".repo-toggle");
          if (caret) toggle();
          else act();
        }}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          // A button acts on both keys by itself; this row has two things to do
          // and the key is what says which, so the native activation has to be
          // stopped before it fires the click.
          event.preventDefault();
          if (event.key === "Enter") act();
          else toggle();
        }}
      >
        {/* The state it changes is on the row, where a screen reader reads it
            when the row takes the focus; the glyph itself is for the eye and
            for the pointer. */}
        <span className="caret repo-toggle" aria-hidden="true">
          {collapsed ? "▸" : "▾"}
        </span>
        {select ? <Tick mark={mark} /> : null}
        <span className="repo-name">{repo.path}</span>
        <Counter count={count} />
        <span className="repo-files">· {(rows ?? repo.files).length} files</span>
      </button>
      {collapsed
        ? null
        : rows !== null
          ? rows.map((row) =>
              row.file === null ? (
                <UnchangedRow key={row.path} repo={repo.path} path={row.path} />
              ) : (
                <FileRow
                  key={row.path}
                  repo={repo.path}
                  file={row.file}
                  select={false}
                  paths={paths}
                />
              ),
            )
          : files.map((file) => (
              <FileRow key={file.path} repo={repo.path} file={file} select={select} paths={paths} />
            ))}
    </div>
  );
}

function FileRow({
  repo,
  file,
  select,
  paths,
}: {
  repo: string;
  file: FileChange;
  select: boolean;
  paths: string[];
}) {
  const id = `${repo}/${file.path}`;
  const selected = useStore(
    (store) => store.repo === repo && store.path === file.path && !store.browse,
  );
  const count = useStore((store) => store.fileCounts.get(id));
  const picked = useStore((store) => pathPicked(store.selectDraft, repo, file.path));
  const setCurrent = useStore((store) => store.select);
  const pickTreePath = useStore((store) => store.pickTreePath);

  return (
    <button
      type="button"
      className={selected && !select ? "file-row on" : "file-row"}
      {...(select ? { "aria-pressed": picked } : {})}
      onClick={() => {
        if (select) {
          pickTreePath(repo, file.path, paths);
          return;
        }
        // A changed file is read in its card, so choosing one from browse mode leaves it.
        if (useStore.getState().browse) useStore.getState().closeBrowse();
        setCurrent(repo, file.path);
        void revealCard(`[data-file="${CSS.escape(id)}"]`);
      }}
    >
      {select ? <Tick mark={picked ? "on" : "off"} /> : null}
      <span className="file-name">{file.path}</span>
      <span className="spacer" />
      <span className="add">+{file.additions}</span>
      <span className="del">−{file.deletions}</span>
      {count && count.open > 0 ? (
        <span className={`badge ${count.severity ?? ""}`}>{count.open}</span>
      ) : null}
    </button>
  );
}

/** A file the review does not carry: it opens whole, in browse mode. */
function UnchangedRow({ repo, path }: { repo: string; path: string }) {
  const id = `${repo}/${path}`;
  const selected = useStore(
    (store) => store.browse && store.repo === repo && store.plainPath === path,
  );
  const count = useStore((store) => store.fileCounts.get(id));
  return (
    <button
      type="button"
      className={selected ? "file-row unchanged on" : "file-row unchanged"}
      onClick={() => useStore.getState().openBrowse(repo, path)}
    >
      <span className="file-name">{path}</span>
      <span className="spacer" />
      <span className="unchanged-tag">unchanged</span>
      {count && count.open > 0 ? (
        <span className={`badge ${count.severity ?? ""}`}>{count.open}</span>
      ) : null}
    </button>
  );
}

/** The open comments of a repository, in the colour of the worst of them. */
function Counter({ count }: { count: Counters | undefined }) {
  if (!count || count.open === 0) return null;
  return <span className={`counter-open ${count.severity ?? ""}`}>{count.open}</span>;
}

/** A row of the `all files` tab: a file of the change set, or an unchanged one (`file: null`). */
type TreeRow = { path: string; file: FileChange | null };

/** `rows` is the `all files` tab's list, and `null` on the other two tabs. */
type Branch = { repo: RepositoryChange; files: FileChange[]; rows: TreeRow[] | null };

/**
 * Substring over the repository path and the file path. A repository whose own
 * path matches keeps all of its files; one that matches through its files keeps
 * the files that matched.
 */
function filterTree(repositories: RepositoryChange[], query: string): Branch[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return repositories.map((repo) => ({ repo, files: repo.files, rows: null }));

  const branches: Branch[] = [];
  for (const repo of repositories) {
    const files = repo.path.toLowerCase().includes(needle)
      ? repo.files
      : repo.files.filter((file) => file.path.toLowerCase().includes(needle));
    if (files.length > 0) branches.push({ repo, files, rows: null });
  }
  return branches;
}

/** Every file of each repository: what is on disk and what the change set carries besides, a
 * deletion; a path only the base has and the change set does not is a rename's old name. */
function allFiles(
  repositories: RepositoryChange[],
  trees: Record<string, TreeState>,
  query: string,
): Branch[] {
  const needle = query.trim().toLowerCase();
  const branches: Branch[] = [];
  for (const repo of repositories) {
    const changed = new Map(repo.files.map((file) => [file.path, file]));
    const paths = new Set(repo.files.map((file) => file.path));
    for (const entry of trees[repo.path]?.tree?.files ?? []) {
      if (entry.worktree) paths.add(entry.path);
    }
    const whole = needle === "" || repo.path.toLowerCase().includes(needle);
    const rows = [...paths]
      .filter((path) => whole || path.toLowerCase().includes(needle))
      .sort(byCodePoint)
      .map((path) => ({ path, file: changed.get(path) ?? null }));
    if (rows.length > 0) branches.push({ repo, files: repo.files, rows });
  }
  return branches;
}
