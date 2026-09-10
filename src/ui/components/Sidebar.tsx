import { type KeyboardEvent, useMemo } from "react";
import type { FileChange, RepositoryChange } from "../../core/types.ts";
import { revealCard } from "../reveal.ts";
import { countDraft, pathPicked, repoMark, scopeLabel } from "../scope.ts";
import type { Connection, SidebarTab } from "../store.ts";
import { useStore } from "../store.ts";
import type { Counters } from "../types.ts";
import { Tick } from "./ScopeEditor.tsx";
import { SidebarSkeleton } from "./Skeleton.tsx";

/**
 * The 308 px navigation of handoff section 1.3: the tree of repositories with
 * changes, the filter over their names, and the footer that says what the live
 * stream is doing. The `all files` tab is Phase 2 (DA-37) and stays hidden.
 *
 * The `select` tab turns the same tree into a picking surface and puts a bar at
 * its foot (DA-55). Reading is the main scene, so the ticks live in a mode
 * rather than beside every row for ever: outside it the tree is exactly what it
 * was.
 */
export function Sidebar() {
  const status = useStore((store) => store.status);
  const query = useStore((store) => store.query);
  const setQuery = useStore((store) => store.setQuery);
  const repositories = useStore((store) => store.repositories);
  const tab = useStore((store) => store.sidebarTab);

  const tree = useMemo(() => filterTree(repositories, query), [repositories, query]);
  const matches = tree.reduce((sum, entry) => sum + entry.files.length, 0);
  const select = tab === "select";

  return (
    <nav className="sidebar" aria-label="navigation">
      <div className="sidebar-tabs">
        <Tab tab="changes" />
        <Tab tab="select" />
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
const TABS: Record<Exclude<SidebarTab, "all">, string> = {
  changes: "changes",
  select: "select",
};

function Tab({ tab }: { tab: Exclude<SidebarTab, "all"> }) {
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
  select,
}: {
  repo: RepositoryChange;
  files: FileChange[];
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
        <span className="repo-files">· {repo.files.length} files</span>
      </button>
      {collapsed
        ? null
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
  const selected = useStore((store) => store.repo === repo && store.path === file.path);
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

/** The open comments of a repository, in the colour of the worst of them. */
function Counter({ count }: { count: Counters | undefined }) {
  if (!count || count.open === 0) return null;
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
