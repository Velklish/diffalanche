/**
 * The store of the review workspace. The slices are the ones the handoff's
 * "State Management" section names — theme and base, sessions, navigation,
 * commenting, threads, search and overlays, feed, scanner — plus `review`,
 * which holds what the server sends; the prototype had that data written into
 * the page, so it has no counterpart there.
 *
 * A slice carries the state its screen needs from the first task that renders
 * it and the actions of the task that makes it interactive: DA-23 to DA-27 fill
 * in the actions of the rail, the header, and the keyboard map.
 */
import { create } from "zustand";
import { countReview } from "../core/domain/counters.ts";
import { byCodePoint } from "../core/order.ts";
import type { FileChange, RepositoryChange } from "../core/types.ts";
import { firstAddedLine } from "./anchor.ts";
import { baseArgument } from "./base.ts";
import type { ChangedHunks } from "./patch.ts";
import { changedHunks, hasNewLine, mergeRepository } from "./patch.ts";
import { perf } from "./perf.ts";
import type {
  ActivityEvent,
  BaseMode,
  BranchCandidate,
  BranchList,
  Comment,
  CommentStatus,
  Counters,
  Reply,
  Review,
  ReviewCounters,
  ReviewDocument,
  ScanWarning,
  SessionList,
  SessionSummary,
  Severity,
  Side,
} from "./types.ts";

export type Theme = "dark" | "light";
export type SidebarTab = "changes" | "all";
export type DiffView = "split" | "unified";
export type RailScope = "file" | "all";
export type ExportView = "rendered" | "raw";
/**
 * `no-session` is the root the tool has never been used in: `GET /api/review`
 * refuses with `no-current-session` and the first-run screen is what that means
 * on the screen ([07-server.md](../../docs/reference/07-server.md)).
 */
export type LoadStatus = "loading" | "ready" | "no-session" | "failed";

/** One file of the change set with the repository it belongs to. */
export type FileEntry = {
  /** `<repo>/<path>`: the identity of a file card across the whole review. */
  id: string;
  /** Position in the centre panel, the order the perf harness jumps by. */
  index: number;
  repo: string;
  file: FileChange;
};

/**
 * Where the composer sits while it is open. The nulls are the anchor level of
 * `docs/SPEC.md` section 7, the same ones the request carries: no `repo` is the
 * whole review, no `path` a repository, no `line` a file.
 */
export type ComposerTarget = {
  repo: string | null;
  path: string | null;
  side: Side | null;
  line: number | null;
};

/**
 * The lines the reader is dragging over, or the range the open composer is
 * being written for. The handoff calls this `{a, b}`; the file it belongs to is
 * carried with it, because one review holds three hundred diffs and a range
 * without its file cannot be drawn on one of them.
 */
export type Selection = { repo: string; path: string; side: Side; a: number; b: number };

/** What the sidebar footer says about the live stream ([08-ui.md]). */
export type Connection = "connecting" | "watching" | "reconnecting";

/** How long a write keeps its author counted as live in the feed's header. */
export const LIVE_WINDOW_MS = 120_000;

/** How many feed lines the page keeps; the server's own ring is the same size. */
const ACTIVITY_KEPT = 200;

const THEME_KEY = "diffalanche.theme";
/** Which session's warnings were put away; kept for the tab, not for ever. */
const DISMISSED_KEY = "diffalanche.warningsDismissed";

/** The counters of a review with nothing in it: what the header shows while it loads. */
const NO_COUNTERS: ReviewCounters = {
  counters: { total: 0, open: 0, resolved: 0, unanswered: 0, awaiting: 0, severity: null },
  repositories: [],
};

type ReviewSlice = {
  status: LoadStatus;
  /** Why the review could not be loaded; `null` while it can still arrive. */
  failure: string | null;
  root: string;
  repositories: RepositoryChange[];
  /** Every file of the change set, flattened in the order the centre panel renders. */
  files: FileEntry[];
  comments: Comment[];
  counters: ReviewCounters;
  /** The counters of every file that carries comments, keyed by `FileEntry.id`. */
  fileCounts: Map<string, Counters>;
  /** The counters of every repository that carries comments, keyed by its path. */
  repoCounts: Map<string, Counters>;
  /** The threads of every file that carries any, keyed by `FileEntry.id`. */
  threadsByFile: Map<string, Comment[]>;
  /** `user` of `config.json`: what a comment written here is signed with. */
  user: string;
  loadReview: () => Promise<void>;
};

type ThemeAndBaseSlice = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** The base picker's draft; the applied base lives in `session.base`. */
  baseMode: BaseMode;
  baseName: string;
  refText: string;
  baseOpen: boolean;
  /** Every branch of the root, from `GET /api/repos/branches`; asked for once. */
  branches: BranchCandidate[];
  branchesStatus: LoadStatus;
  openBase: (open: boolean) => void;
  setBaseMode: (mode: BaseMode) => void;
  setBaseName: (name: string) => void;
  setRefText: (ref: string) => void;
  applyBase: () => Promise<void>;
};

type SessionsSlice = {
  /**
   * The sessions this page has just written — through `use`, `new`, or a change
   * of base — with the moment of each write. The watcher sees such a write like
   * any other and sends `session-changed` back; the page has already read the
   * review it names, so the frame it caused is skipped rather than costing a
   * second read of megabytes ([live.ts](live.ts)).
   *
   * A map and not one slot: two switches in a row are two writes in flight, and
   * the frame for the first can land after the second was made. And every entry
   * carries its moment, because a write does not always produce a frame — a
   * switch away and back inside the watcher's debounce leaves `current` where
   * it was, and nothing is emitted at all. Without the moment that entry would
   * sit there for the life of the page and swallow the next real event for that
   * session.
   */
  selfSessions: Map<string, number>;
  /** Remembers a session write of this page's own, and forgets the stale ones. */
  markSelfSession: (name: string) => void;
  /**
   * Whether this frame is the page's own write coming back. The entry is taken
   * when it matches: one write, one frame.
   */
  claimSelfSession: (name: string) => boolean;
  session: Review | null;
  /** The history: every session with its counters, most recently updated first. */
  sessions: SessionSummary[];
  sessionMenuOpen: boolean;
  /** The create form of handoff section 7. */
  newName: string;
  newBase: string;
  /** True while a session is being created, switched to, or its base applied. */
  switching: boolean;
  setSessionMenu: (open: boolean) => void;
  setNewName: (name: string) => void;
  setNewBase: (base: string) => void;
  createSession: () => Promise<void>;
  /**
   * `use` and then the whole review again: a session is a different set of
   * everything, not a filter over the same set. Not named after the CLI's own
   * `review use`, because a `use…` in a React file is read as a hook.
   */
  switchSession: (name: string) => Promise<void>;
};

type NavigationSlice = {
  repo: string | null;
  path: string | null;
  /** Repositories the sidebar tree has collapsed; `true` means collapsed. */
  collapsedRepos: Record<string, boolean>;
  sidebarTab: SidebarTab;
  query: string;
  browse: boolean;
  plainPath: string | null;
  plainRev: string | null;
  /** Split or unified per file card, remembered across renders. */
  diffView: Record<string, DiffView>;
  /** Collapsed file cards, keyed by `FileEntry.id`. */
  collapsedFiles: Record<string, boolean>;
  /** Hunks whose context lines are hidden, by file id and then by hunk index. */
  collapsedHunks: Record<string, Record<number, boolean>>;
  setQuery: (query: string) => void;
  toggleRepo: (repo: string) => void;
  /** The current file: set by a click in the sidebar and by the centre panel's scroll. */
  select: (repo: string, path: string | null) => void;
  setDiffView: (id: string, view: DiffView) => void;
  toggleFile: (id: string) => void;
  toggleHunk: (id: string, hunk: number) => void;
  /** Every hunk of one file shown in full again; what a hidden anchor needs. */
  expandHunks: (id: string) => void;
};

type CommentingSlice = {
  sel: Selection | null;
  dragging: boolean;
  composer: ComposerTarget | null;
  composerEnd: number | null;
  sev: Severity;
  body: string;
  sugIdx: number;
  /** True from the moment `Comment` is pressed until the server has answered. */
  sending: boolean;
  /** `mousedown` on a line of the new side: the range starts and ends there. */
  startSelect: (repo: string, path: string, side: Side, line: number) => void;
  /** `mouseenter` while the button is down; ignored when nothing is being dragged. */
  extendSelect: (line: number) => void;
  /** Shift-click: widens the range that is already there, dragging or not. */
  extendTo: (line: number) => void;
  /** `mouseup` anywhere on the document: the range is fixed and the composer opens. */
  endSelect: () => void;
  openComposer: (target: ComposerTarget, endLine?: number) => void;
  /** `C`: the composer on the first added line of the file being read. */
  commentOnCurrentFile: () => void;
  closeComposer: () => void;
  setSeverity: (sev: Severity) => void;
  setBody: (body: string) => void;
  submitComment: () => Promise<void>;
};

type ThreadsSlice = {
  /** The thread the rail and the diff both point at; the keyboard map reads it (DA-26). */
  focusId: string | null;
  /** The thread whose reply field is open; one at a time, as the handoff has it. */
  replyId: string | null;
  replyText: string;
  railScope: RailScope;
  unansweredOnly: boolean;
  /** The other half of the same question: threads an agent has answered and nobody has closed. */
  awaitingOnly: boolean;
  /**
   * The threads a write is in flight on, by id. Per thread and not one flag:
   * two threads are two rollbacks, and answering one must not swallow the
   * press on the other.
   */
  busy: Record<string, boolean>;
  setRailScope: (scope: RailScope) => void;
  toggleUnanswered: () => void;
  toggleAwaiting: () => void;
  /** The header's counters: the whole review, filtered the way the number was counted. */
  filterRail: (filter: "open" | "awaiting") => void;
  /** Focusing a thread makes its file the current one, so the diff can be scrolled to it. */
  focusThread: (id: string) => void;
  openReply: (id: string | null) => void;
  setReplyText: (text: string) => void;
  sendReply: (id: string) => Promise<void>;
  /** `resolve` and `reopen`: only a human ever calls them ([ADR-004]). */
  setStatus: (id: string, status: CommentStatus) => Promise<void>;
  /**
   * `J` and `K`: the next or previous open thread in reading order — by
   * repository, then file, then line, across the whole review — wrapping at
   * both ends. It focuses the thread and answers with its id, so the caller can
   * bring the diff to it as well.
   */
  stepThread: (delta: 1 | -1) => string | null;
  /** `R`: resolves the focused thread, and nothing when it is already closed. */
  resolveFocused: () => Promise<void>;
};

type SearchAndOverlaysSlice = {
  paletteOpen: boolean;
  paletteQuery: string;
  palIdx: number;
  exportOpen: boolean;
  exportView: ExportView;
  /** The markdown of `GET /api/export`, and the comments the rendered view lays out. */
  exportRaw: string;
  exportComments: Comment[];
  exportStatus: LoadStatus;
  toast: string | null;
  setToast: (toast: string | null) => void;
  /** `⌘K` and `⇧⇧`. Opening starts from an empty field, as the handoff's does. */
  setPalette: (open: boolean) => void;
  setPaletteQuery: (query: string) => void;
  /** The selected row: `↑` / `↓` move it, and the pointer sets it directly. */
  setPalIdx: (index: number) => void;
  openExport: (open: boolean) => void;
  setExportView: (view: ExportView) => void;
  copyExport: () => Promise<void>;
};

type FeedSlice = {
  /** The feed as the server has it, oldest first ([05-watcher.md]). */
  events: ActivityEvent[];
  feedOpen: boolean;
  /**
   * The clock the relative times on screen are counted from, moved every five
   * seconds. A number rather than a counter, so a component that shows `12s
   * ago` reads the moment and the redraw from one subscription.
   */
  tick: number;
  toggleFeed: () => void;
  /** Lines from the stream or from the ring read on connect, merged by id. */
  pushActivity: (events: ActivityEvent[]) => void;
  bumpTick: () => void;
};

/**
 * What `GET /api/scan` answers, as the first-run screen reads it. The server
 * declares the same shape as `ScanSummary` in `src/server/review.ts`; the UI
 * cannot import it, because that module reaches the Node API and the browser
 * bundle is compiled with `"types": []`.
 */
export type ScannedRepository = {
  path: string;
  kind: "repo" | "worktree";
  branch: string;
  hasChanges: boolean;
  files: number;
};

export type ScanSummary = {
  root: string;
  repositories: ScannedRepository[];
  warnings: ScanWarning[];
};

/**
 * The first-run screen (DA-27): the scan behind its three metrics. The form on
 * it is the sessions slice's own — `newName`, `newBase`, `createSession` — so a
 * session is created one way whichever screen asks for it.
 */
type FirstRunSlice = {
  /** `null` until `GET /api/scan` has answered; the screen shows dashes until then. */
  scan: ScanSummary | null;
  loadScan: () => Promise<void>;
};

type ScannerSlice = {
  warnings: ScanWarning[];
  /** What the stream's `warnings` frame brings: the list as the scan now has it. */
  setWarnings: (warnings: ScanWarning[]) => void;
  /**
   * The session whose warnings have been dismissed. Per session, because a
   * warning is about the base that session resolves, and the next one resolves
   * its own.
   */
  warningsDismissedFor: string | null;
  dismissWarnings: () => void;
};

/**
 * What the live stream does to the review the page already holds (DA-25). The
 * events name; this patches ([live.ts](live.ts)).
 */
type LiveSlice = {
  connection: Connection;
  /** The hunks that changed while the review was open, by `FileEntry.id`. */
  changed: Map<string, ChangedHunks>;
  setConnection: (connection: Connection) => void;
  /**
   * One repository's change set as it now stands, or `null` when it has left
   * the review. Every file that says the same thing keeps the object it was
   * rendered from, so its card is not re-rendered and its DOM survives.
   */
  applyRepositoryDiff: (path: string, next: RepositoryChange | null) => void;
  /** One thread as the server now has it: added when it is new, replaced when it is not. */
  patchThread: (comment: Comment) => void;
};

export type Store = ReviewSlice &
  ThemeAndBaseSlice &
  SessionsSlice &
  NavigationSlice &
  CommentingSlice &
  ThreadsSlice &
  SearchAndOverlaysSlice &
  FeedSlice &
  ScannerSlice &
  LiveSlice &
  FirstRunSlice;

export const useStore = create<Store>()((set, get) => ({
  // review
  status: "loading",
  failure: null,
  root: "",
  repositories: [],
  files: [],
  comments: [],
  counters: NO_COUNTERS,
  fileCounts: new Map(),
  repoCounts: new Map(),
  threadsByFile: new Map(),
  user: "",
  loadReview: async () => {
    try {
      const response = await fetch("/api/review");
      if (!response.ok) {
        const refused = await refusal(response);
        // A root nobody has opened a session in is not a failure: it is the
        // first-run screen, and the scan behind its metrics is asked for here.
        if (refused.code === "no-current-session") {
          set({ status: "no-session", failure: null });
          await get().loadScan();
          return;
        }
        throw new Error(refused.message);
      }
      const document = (await response.json()) as ReviewDocument;
      // Stamped here, not after the render: the harness measures from the moment
      // the response was parsed to the frame that showed it.
      perf.responseAt = performance.now();
      set(fromDocument(document, get().diffView, get().session?.name ?? null));
    } catch (error) {
      set({ status: "failed", failure: reason(error) });
      return;
    }
    // After the review and not with it: the name only appears on a reply the
    // reader has not sent yet, and the first render is measured from the
    // review's own response.
    try {
      const response = await fetch("/api/config");
      if (!response.ok) return;
      const config = (await response.json()) as { user?: unknown };
      if (typeof config.user === "string") set({ user: config.user });
    } catch {
      // The page works unsigned; the server signs what it writes anyway.
    }
  },

  // theme and base
  theme: readTheme(),
  setTheme: (theme) => {
    writeTheme(theme);
    set({ theme });
  },
  baseMode: "head",
  baseName: "",
  refText: "",
  baseOpen: false,
  branches: [],
  branchesStatus: "loading",
  openBase: (baseOpen) => {
    const session = get().session;
    // The picker opens on the base the session has, so `Apply` on an untouched
    // form applies what is already applied rather than `head`.
    set({
      baseOpen,
      ...(baseOpen && session
        ? {
            baseMode: session.base.mode,
            baseName: session.base.mode === "branch" ? (session.base.branch ?? "") : "",
            refText: session.base.mode === "ref" ? session.base.ref : "",
          }
        : {}),
    });
    if (baseOpen && get().branchesStatus !== "ready") void loadBranches(set);
  },
  setBaseMode: (baseMode) => set({ baseMode }),
  setBaseName: (baseName) => set({ baseName }),
  setRefText: (refText) => set({ refText }),
  applyBase: async () => {
    const { session, baseMode, baseName, refText, switching } = get();
    if (session === null || switching) return;
    const base = baseArgument(baseMode, baseName, refText);
    if (base === null) return;
    set({ switching: true });
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.name)}/base`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ base }),
      });
      if (!response.ok) throw new Error((await refusal(response)).message);
      set({ baseOpen: false });
      get().markSelfSession(session.name);
      // The change set is computed against the base, so the whole review is
      // read again rather than patched ([03-storage.md]).
      await get().loadReview();
      set({ switching: false, toast: `База сессии: ${base}` });
    } catch (error) {
      set({ switching: false, toast: reason(error) });
    }
  },

  // sessions
  session: null,
  selfSessions: new Map(),
  markSelfSession: (name) => {
    const held = fresh(get().selfSessions);
    held.set(name, Date.now());
    set({ selfSessions: held });
  },
  claimSelfSession: (name) => {
    const held = fresh(get().selfSessions);
    const mine = held.delete(name);
    set({ selfSessions: held });
    return mine;
  },
  sessions: [],
  sessionMenuOpen: false,
  newName: "",
  newBase: "head",
  switching: false,
  setSessionMenu: (sessionMenuOpen) => {
    set({ sessionMenuOpen });
    if (sessionMenuOpen) void loadSessions(set);
  },
  setNewName: (newName) => set({ newName }),
  setNewBase: (newBase) => set({ newBase }),
  createSession: async () => {
    const { newName, newBase, switching } = get();
    const name = newName.trim();
    if (name === "" || switching) return;
    set({ switching: true });
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, base: newBase }),
      });
      if (!response.ok) throw new Error((await refusal(response)).message);
      // Creating a session makes it current, so the review that comes next is
      // already the new one's ([04-domain.md]).
      set({ sessionMenuOpen: false, newName: "" });
      get().markSelfSession(name);
      await get().loadReview();
      set({ switching: false, toast: `review new ${name}` });
      void loadSessions(set);
    } catch (error) {
      set({ switching: false, toast: reason(error) });
    }
  },
  switchSession: async (name) => {
    if (get().switching || get().session?.name === name) {
      set({ sessionMenuOpen: false });
      return;
    }
    set({ switching: true });
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(name)}/use`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) throw new Error((await refusal(response)).message);
      set({ sessionMenuOpen: false });
      get().markSelfSession(name);
      await get().loadReview();
      set({ switching: false, toast: `review use ${name}` });
      void loadSessions(set);
    } catch (error) {
      set({ switching: false, toast: reason(error) });
    }
  },

  // navigation
  repo: null,
  path: null,
  collapsedRepos: {},
  sidebarTab: "changes",
  query: "",
  browse: false,
  plainPath: null,
  plainRev: null,
  diffView: {},
  collapsedFiles: {},
  collapsedHunks: {},
  setQuery: (query) => set({ query }),
  toggleRepo: (repo) =>
    set({ collapsedRepos: { ...get().collapsedRepos, [repo]: !get().collapsedRepos[repo] } }),
  select: (repo, path) => set({ repo, path }),
  setDiffView: (id, view) => set({ diffView: { ...get().diffView, [id]: view } }),
  toggleFile: (id) =>
    set({ collapsedFiles: { ...get().collapsedFiles, [id]: !get().collapsedFiles[id] } }),
  toggleHunk: (id, hunk) => {
    const all = get().collapsedHunks;
    const file = all[id] ?? {};
    // Per file, so collapsing a hunk in one card leaves every other card's
    // reference alone and none of them re-renders or re-tokenizes.
    set({ collapsedHunks: { ...all, [id]: { ...file, [hunk]: !file[hunk] } } });
  },
  expandHunks: (id) => {
    const all = get().collapsedHunks;
    if (all[id] === undefined) return;
    const { [id]: _shown, ...rest } = all;
    set({ collapsedHunks: rest });
  },

  // commenting
  sel: null,
  dragging: false,
  composer: null,
  composerEnd: null,
  sev: "warning",
  body: "",
  sugIdx: 0,
  sending: false,
  startSelect: (repo, path, side, line) =>
    set({
      sel: { repo, path, side, a: line, b: line },
      dragging: true,
      composer: null,
      composerEnd: null,
    }),
  extendSelect: (line) => {
    const { sel, dragging } = get();
    if (!dragging || sel === null || sel.b === line) return;
    set({ sel: { ...sel, b: line } });
  },
  extendTo: (line) => {
    const { sel } = get();
    if (sel === null) return;
    const widened = { ...sel, b: line };
    set({ sel: widened, ...(get().composer === null ? {} : composerOver(widened)) });
  },
  endSelect: () => {
    const { sel, dragging } = get();
    if (!dragging) return;
    if (sel === null) {
      set({ dragging: false });
      return;
    }
    set({ dragging: false, ...composerOver(sel), sev: "warning", body: "", sending: false });
  },
  openComposer: (composer, endLine) => {
    const file =
      composer.repo === null || composer.path === null ? null : `${composer.repo}/${composer.path}`;
    set({
      composer,
      composerEnd: endLine ?? null,
      dragging: false,
      sev: "warning",
      body: "",
      sending: false,
      sel:
        composer.repo !== null && composer.path !== null && composer.line !== null
          ? {
              repo: composer.repo,
              path: composer.path,
              side: composer.side ?? "new",
              a: composer.line,
              b: endLine ?? composer.line,
            }
          : null,
      // A form on a collapsed card would have nowhere to appear, and `C` and
      // the header's own button can both be pressed on one.
      ...(file !== null && get().collapsedFiles[file] === true
        ? { collapsedFiles: { ...get().collapsedFiles, [file]: false } }
        : {}),
    });
  },
  commentOnCurrentFile: () => {
    const { repo, path, files } = get();
    if (repo === null || path === null) return;
    const entry = files.find((one) => one.repo === repo && one.file.path === path);
    if (entry === undefined) return;
    const line = firstAddedLine(entry.file.patch);
    get().openComposer({ repo, path, side: "new", line });
  },
  closeComposer: () =>
    set({ composer: null, composerEnd: null, sel: null, dragging: false, body: "" }),
  setSeverity: (sev) => set({ sev }),
  setBody: (body) => set({ body }),
  submitComment: async () => {
    const { composer, composerEnd, sev, body, session, sending } = get();
    if (composer === null || sending) return;
    const text = body.trim();
    if (text === "") return;
    set({ sending: true });
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: composer.repo,
          path: composer.path,
          side: composer.side,
          line: composer.line,
          // A single line has no end: the domain reads a range from `endLine`
          // being there at all (`docs/SPEC.md` section 7).
          endLine:
            composer.line !== null && composerEnd !== null && composerEnd > composer.line
              ? composerEnd
              : null,
          severity: sev,
          body: text,
        }),
      });
      if (!response.ok) throw new Error((await refusal(response)).message);
      const comment = (await response.json()) as Comment;
      set({
        ...withComments([...get().comments, comment], get().threadsByFile),
        composer: null,
        composerEnd: null,
        sel: null,
        body: "",
        sending: false,
        focusId: comment.id,
        toast: `Комментарий сохранён в reviews/${session?.name ?? "?"}/comments.json`,
      });
    } catch (error) {
      set({ sending: false, toast: reason(error) });
    }
  },

  // threads
  focusId: null,
  replyId: null,
  replyText: "",
  railScope: "file",
  unansweredOnly: false,
  awaitingOnly: false,
  busy: {},
  setRailScope: (railScope) => set({ railScope }),
  toggleUnanswered: () => set({ unansweredOnly: !get().unansweredOnly, awaitingOnly: false }),
  toggleAwaiting: () => set({ awaitingOnly: !get().awaitingOnly, unansweredOnly: false }),
  filterRail: (filter) =>
    set({
      railScope: "all",
      unansweredOnly: false,
      awaitingOnly: filter === "awaiting",
    }),
  focusThread: (focusId) => {
    const thread = get().comments.find((comment) => comment.id === focusId);
    if (thread === undefined) return;
    set({
      focusId,
      ...(thread.repo === null || thread.path === null
        ? {}
        : { repo: thread.repo, path: thread.path }),
    });
  },
  openReply: (replyId) => set({ replyId, replyText: "" }),
  setReplyText: (replyText) => set({ replyText }),
  sendReply: async (id) => {
    const text = get().replyText.trim();
    if (text === "" || get().busy[id] === true) return;
    // The reply is on the card before the server has it, signed the way the
    // server will sign it; the answer replaces it, and a refusal takes it away
    // again together with the field it was typed in.
    const draft: Reply = {
      id: "r_pending",
      author: get().user,
      role: "human",
      body: text,
      createdAt: new Date().toISOString(),
    };
    const sent = await write(
      set,
      get,
      id,
      `/api/comments/${id}/replies`,
      { body: text },
      (comment) => ({
        ...comment,
        replies: [...comment.replies, draft],
      }),
    );
    if (sent) set({ replyId: null, replyText: "" });
  },
  stepThread: (delta) => {
    const focusId = get().focusId;
    const order = readingOrder(get());
    if (order.length === 0) return null;
    const at = order.findIndex((thread) => thread.id === focusId);
    // Nothing focused yet: `J` starts at the first thread of the review and `K`
    // at the last, rather than at whichever end the arithmetic would land on.
    const next =
      at < 0 ? (delta === 1 ? 0 : order.length - 1) : (at + delta + order.length) % order.length;
    const thread = order[next];
    if (thread === undefined) return null;
    get().focusThread(thread.id);
    return thread.id;
  },
  resolveFocused: async () => {
    const { focusId, comments } = get();
    if (focusId === null) return;
    const thread = comments.find((comment) => comment.id === focusId);
    // The key of the handoff's map is `resolve`, not a toggle: `Reopen` is a
    // press on the card, so a thread cannot be reopened by a stray keystroke.
    if (thread === undefined || thread.status === "resolved") return;
    await get().setStatus(focusId, "resolved");
  },
  setStatus: async (id, status) => {
    if (get().busy[id] === true) return;
    const verb = status === "resolved" ? "resolve" : "reopen";
    await write(set, get, id, `/api/comments/${id}/${verb}`, {}, (comment) => ({
      ...comment,
      status,
      resolvedAt: status === "resolved" ? new Date().toISOString() : null,
      resolvedBy: status === "resolved" ? get().user : null,
    }));
  },

  // search and overlays
  paletteOpen: false,
  paletteQuery: "",
  palIdx: 0,
  exportOpen: false,
  exportView: "rendered",
  exportRaw: "",
  exportComments: [],
  exportStatus: "loading",
  toast: null,
  setToast: (toast) => set({ toast }),
  setPalette: (paletteOpen) => set({ paletteOpen, paletteQuery: "", palIdx: 0 }),
  setPaletteQuery: (paletteQuery) => set({ paletteQuery, palIdx: 0 }),
  setPalIdx: (palIdx) => set({ palIdx }),
  openExport: (exportOpen) => {
    set({ exportOpen });
    // Read again every time: the export is of the open comments, and they
    // change while the modal is closed.
    if (exportOpen) void loadExport(set);
  },
  setExportView: (exportView) => set({ exportView }),
  copyExport: async () => {
    const raw = get().exportRaw;
    if (raw === "") return;
    try {
      await navigator.clipboard.writeText(raw);
      set({ toast: "Markdown скопирован" });
    } catch (error) {
      set({ toast: reason(error) });
    }
  },

  // feed
  events: [],
  feedOpen: false,
  tick: Date.now(),
  toggleFeed: () => set({ feedOpen: !get().feedOpen }),
  pushActivity: (arriving) => {
    const events = merge(get().events, arriving);
    if (events !== get().events) set({ events });
  },
  bumpTick: () => set({ tick: Date.now() }),

  // scanner
  warnings: [],
  warningsDismissedFor: readDismissed(),
  dismissWarnings: () => {
    const name = get().session?.name ?? null;
    writeDismissed(name);
    set({ warningsDismissedFor: name });
  },
  setWarnings: (warnings) => {
    const before = get().warnings;
    if (before.length === warnings.length && before.every(sameWarning(warnings))) return;
    // A warning the scan has just found is news even to a reader who put the
    // bar away: what was dismissed was the list before it (`docs/SPEC.md`
    // section 5 — nothing is silently dropped). The remembered dismiss goes
    // with it, or a reload would hide a bar the reader has never seen.
    writeDismissed(null);
    set({ warnings, warningsDismissedFor: null });
  },

  // live
  connection: "connecting",
  changed: new Map(),
  setConnection: (connection) => set({ connection }),
  applyRepositoryDiff: (path, next) => {
    const repositories = get().repositories;
    const at = repositories.findIndex((one) => one.path === path);
    if (next === null) {
      if (at < 0) return;
      const left = fromRepositories([...repositories.slice(0, at), ...repositories.slice(at + 1)]);
      set(left);
      // The cards of that repository are gone, and so is everything that
      // pointed at one. A form left open on a file that is no longer on the
      // screen is a form the reader cannot see, cannot send and cannot reopen;
      // there is no anchor left to move it to either — the repository itself
      // has no card any more — so it is closed and said out loud.
      if (get().composer?.repo === path) {
        set({
          composer: null,
          composerEnd: null,
          sel: null,
          toast: `${path} больше нечего ревьюить — форма закрыта`,
        });
      }
      if (get().repo === path) {
        const first = left.files?.[0];
        set({ repo: first?.repo ?? null, path: first?.file.path ?? null });
      }
      return;
    }
    const before = at < 0 ? null : (repositories[at] as RepositoryChange);
    const merged = before === null ? next : mergeRepository(before, next);
    // Nothing in this repository says anything new: the watcher woke on a file
    // the change set does not carry, and the review must not re-render for it.
    if (merged === before) return;
    const list =
      at < 0
        ? [...repositories, merged].sort((a, b) => byCodePoint(a.path, b.path))
        : [...repositories.slice(0, at), merged, ...repositories.slice(at + 1)];
    set({ ...fromRepositories(list), changed: marked(get().changed, before, merged) });
    revalidate(set, get, merged);
  },
  // first run
  scan: null,
  loadScan: async () => {
    try {
      const response = await fetch("/api/scan");
      if (!response.ok) return;
      set({ scan: (await response.json()) as ScanSummary });
    } catch {
      // The screen says what it knows: without the scan its metrics are dashes.
    }
  },

  patchThread: (comment) => {
    const comments = get().comments;
    const held = comments.some((one) => one.id === comment.id);
    set(
      withComments(
        held
          ? comments.map((one) => (one.id === comment.id ? comment : one))
          : [...comments, comment],
        get().threadsByFile,
      ),
    );
  },
}));

/** The session history behind the pill's menu; asked for when the menu opens. */
async function loadSessions(set: (partial: Partial<Store>) => void): Promise<void> {
  try {
    const response = await fetch("/api/sessions");
    if (!response.ok) return;
    const list = (await response.json()) as SessionList;
    if (Array.isArray(list.sessions)) set({ sessions: list.sessions });
  } catch {
    // The pill keeps the session it has; the menu shows what it already knows.
  }
}

/** The branches of the root, for the picker's `branch` mode. One request, once. */
async function loadBranches(set: (partial: Partial<Store>) => void): Promise<void> {
  set({ branchesStatus: "loading" });
  try {
    const response = await fetch("/api/repos/branches");
    if (!response.ok) throw new Error((await refusal(response)).message);
    const list = (await response.json()) as BranchList;
    set({ branches: list.branches, branchesStatus: "ready" });
  } catch {
    set({ branchesStatus: "failed" });
  }
}

/**
 * Both halves of the export in one pass: the markdown `Copy .md` writes to the
 * clipboard, and the comments the rendered view lays out. Rendering the same
 * markdown twice would mean a markdown parser in a page that has the comments
 * already ([04-domain.md](../../docs/reference/04-domain.md)).
 */
async function loadExport(set: (partial: Partial<Store>) => void): Promise<void> {
  set({ exportStatus: "loading" });
  try {
    const [raw, comments] = await Promise.all([
      fetch("/api/export?status=open&format=md").then(readExport),
      fetch("/api/export?status=open&format=json").then(readExport),
    ]);
    set({
      exportRaw: typeof raw === "string" ? raw : "",
      exportComments: Array.isArray(comments) ? (comments as Comment[]) : [],
      exportStatus: "ready",
    });
  } catch {
    set({ exportStatus: "failed" });
  }
}

async function readExport(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error((await refusal(response)).message);
  const type = response.headers.get("content-type") ?? "";
  return type.includes("json") ? await response.json() : await response.text();
}

/**
 * How long a write of this page's own may still be waiting for the frame it
 * caused. The watcher debounces a change for 100 ms and walks a tree it cannot
 * watch every 250 ms ([05-watcher.md](../../docs/reference/05-watcher.md)), so
 * a frame that is coming has arrived long before this; anything older was
 * caused by a write that produced no frame at all, and must not be allowed to
 * swallow somebody else's.
 */
const SELF_WRITE_WINDOW_MS = 5_000;

/** The marks of writes that could still have a frame coming, in a copy. */
function fresh(held: Map<string, number>): Map<string, number> {
  const since = Date.now() - SELF_WRITE_WINDOW_MS;
  return new Map([...held].filter(([, at]) => at >= since));
}

/**
 * The open threads of the whole review in reading order: by repository as the
 * centre panel lists them, then by file inside it, then by line. The anchors
 * that have no line come first in their scope — a thread on the review before
 * every repository, one on a repository before its files — because that is the
 * order the page reads in ([08-ui.md](../../docs/reference/08-ui.md)).
 */
function readingOrder(store: Store): Comment[] {
  const repoAt = new Map(store.repositories.map((repo, index) => [repo.path, index]));
  const fileAt = new Map(store.files.map((entry) => [entry.id, entry.index]));
  const place = (comment: Comment): [number, number, number] => [
    comment.repo === null ? -1 : (repoAt.get(comment.repo) ?? Number.MAX_SAFE_INTEGER),
    comment.path === null || comment.repo === null
      ? -1
      : (fileAt.get(`${comment.repo}/${comment.path}`) ?? Number.MAX_SAFE_INTEGER),
    comment.line ?? -1,
  ];
  return store.comments
    .filter((comment) => comment.status === "open")
    .map((comment) => ({ comment, at: place(comment) }))
    .sort(
      (a, b) =>
        a.at[0] - b.at[0] ||
        a.at[1] - b.at[1] ||
        a.at[2] - b.at[2] ||
        byCodePoint(a.comment.id, b.comment.id),
    )
    .map((one) => one.comment);
}

/**
 * The feed with what arrived merged into it, by id and oldest first. A
 * reconnect replays the frames the page missed and reads the ring as well, so
 * the same line arrives twice; and the list only changes when something in it
 * did, so a re-read of the ring alone re-renders nothing.
 */
function merge(held: ActivityEvent[], arriving: ActivityEvent[]): ActivityEvent[] {
  const known = new Set(held.map((event) => event.id));
  const fresh = arriving.filter((event) => !known.has(event.id));
  if (fresh.length === 0) return held;
  const events = [...held, ...fresh].sort((a, b) => a.id - b.id);
  return events.length > ACTIVITY_KEPT ? events.slice(events.length - ACTIVITY_KEPT) : events;
}

function sameWarning(list: ScanWarning[]): (warning: ScanWarning, index: number) => boolean {
  return (warning, index) =>
    warning.path === list[index]?.path && warning.message === list[index]?.message;
}

/**
 * The hunks of a repository that have just changed, added to the marks the page
 * already carries. A file the patch left alone keeps the mark it had: the
 * accent border says what changed while the review has been open, not what
 * changed in the last event.
 */
function marked(
  before: Map<string, ChangedHunks>,
  was: RepositoryChange | null,
  now: RepositoryChange,
): Map<string, ChangedHunks> {
  if (was === null) return before;
  const held = new Map(was.files.map((file) => [file.path, file]));
  let marks: Map<string, ChangedHunks> | null = null;
  const at = Date.now();
  for (const file of now.files) {
    const old = held.get(file.path);
    if (old === undefined || old.patch === file.patch) continue;
    const hunks = changedHunks(old.patch, file.patch);
    if (hunks.size === 0) continue;
    marks ??= new Map(before);
    marks.set(`${now.path}/${file.path}`, { hunks, at });
  }
  return marks ?? before;
}

/**
 * The open composer against the file it is on. Its line is a row of the diff,
 * and an edit can take that row away — the renderer would then have nothing to
 * key the form to and it would leave the screen without a word. What is written
 * in it is kept: the form drops to the file anchor, which every file has.
 */
function revalidate(
  set: (partial: Partial<Store>) => void,
  get: () => Store,
  repository: RepositoryChange,
): void {
  const { composer, composerEnd } = get();
  if (composer === null || composer.line === null) return;
  if (composer.repo !== repository.path) return;
  const file = repository.files.find((one) => one.path === composer.path);
  const gone =
    file === undefined ||
    !hasNewLine(file.patch, composer.line) ||
    (composerEnd !== null && !hasNewLine(file.patch, composerEnd));
  if (!gone) return;
  set({
    composer: { ...composer, side: null, line: null },
    composerEnd: null,
    sel: null,
    toast: "Строка изменилась — комментарий теперь на файле",
  });
}

/** The change set after a repository was patched: the files and the tree again. */
function fromRepositories(repositories: RepositoryChange[]): Partial<Store> {
  let index = 0;
  return {
    repositories,
    files: repositories.flatMap((repo) =>
      repo.files.map((file) => ({
        id: `${repo.path}/${file.path}`,
        index: index++,
        repo: repo.path,
        file,
      })),
    ),
  };
}

/**
 * One write on one thread: the change is on the card before the server has it,
 * the server is asked, and its answer replaces it — or, when it refuses, the
 * thread comes back as it was and the refusal goes to the toast
 * ([07-server.md](../../docs/reference/07-server.md)).
 *
 * What is rolled back is the one comment, not the whole list: a reply on one
 * thread and a resolve on another are two writes, and the refusal of one may
 * not undo the other. `busy` is per thread for the same reason.
 */
async function write(
  set: (partial: Partial<Store>) => void,
  get: () => Store,
  id: string,
  route: string,
  body: Record<string, unknown>,
  optimistic: (comment: Comment) => Comment,
): Promise<boolean> {
  const before = get().comments.find((comment) => comment.id === id);
  if (before === undefined) return false;
  set({ busy: { ...get().busy, [id]: true }, ...replace(get, id, optimistic(before)) });
  try {
    const response = await fetch(route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error((await refusal(response)).message);
    const answered = (await response.json()) as Comment;
    set({ busy: without(get().busy, id), ...replace(get, id, answered) });
    return true;
  } catch (error) {
    set({ busy: without(get().busy, id), ...replace(get, id, before), toast: reason(error) });
    return false;
  }
}

/** The comments with one of them swapped, and everything derived from them again. */
function replace(get: () => Store, id: string, comment: Comment) {
  return withComments(
    get().comments.map((one) => (one.id === id ? comment : one)),
    get().threadsByFile,
  );
}

function without(busy: Record<string, boolean>, id: string): Record<string, boolean> {
  const { [id]: _gone, ...rest } = busy;
  return rest;
}

/** The composer under the last line of a range, whichever way the drag ran. */
function composerOver(sel: Selection): Pick<Store, "composer" | "composerEnd" | "sel"> {
  const from = Math.min(sel.a, sel.b);
  const to = Math.max(sel.a, sel.b);
  return {
    composer: { repo: sel.repo, path: sel.path, side: sel.side, line: from },
    composerEnd: to,
    sel: { ...sel, a: from, b: to },
  };
}

/**
 * The whole review in one response: everything derived from it is derived once.
 *
 * `held` is the session the page had before this answer. A *different* session
 * is a different review and takes the working state with it; the *same* session
 * read again — which the stream asks for whenever anything under `reviews/`
 * changes — must not, or a draft would disappear from under the reader because
 * a watcher woke.
 */
function fromDocument(
  document: ReviewDocument,
  previous: Record<string, DiffView>,
  held: string | null,
): Partial<Store> {
  let index = 0;
  const files = document.repositories.flatMap((repo) =>
    repo.files.map((file) => ({
      id: `${repo.path}/${file.path}`,
      index: index++,
      repo: repo.path,
      file,
    })),
  );
  const first = files[0];
  const switched = document.session?.name !== held;
  return {
    status: "ready",
    root: document.root,
    repositories: document.repositories,
    files,
    comments: document.comments,
    ...indexCounters(document.counters),
    threadsByFile: byFile(document.comments),
    session: document.session,
    warnings: document.warnings,
    ...(switched
      ? {
          repo: first?.repo ?? null,
          path: first?.file.path ?? null,
          // Another session is another review: a draft, a selection, an open
          // reply and a focused thread all point at comments and lines that are
          // no longer on the screen, so none of them survives.
          composer: null,
          composerEnd: null,
          sel: null,
          dragging: false,
          sev: "warning",
          body: "",
          sending: false,
          focusId: null,
          replyId: null,
          replyText: "",
          busy: {},
          collapsedHunks: {},
          collapsedFiles: {},
          // The marks are about edits made while *this* review was open; the
          // next one has its own, and a hunk of it whose header happens to
          // match would otherwise be shown as freshly changed.
          changed: new Map(),
        }
      : {}),
    // Split or unified is about a file and not about a review, so it is kept
    // for the files that are still in one.
    diffView: keptFor(files, previous),
  };
}

/** The per-file view choices of the files the new review still has. */
function keptFor(files: FileEntry[], previous: Record<string, DiffView>): Record<string, DiffView> {
  const kept: Record<string, DiffView> = {};
  const here = new Set(files.map((entry) => entry.id));
  for (const [id, view] of Object.entries(previous)) {
    if (here.has(id)) kept[id] = view;
  }
  return kept;
}

/**
 * The comments after a write, with the counters recounted. The server counts
 * the same way and its answer arrives with the next read; this is what keeps
 * the badges honest between the two.
 */
export function withComments(
  comments: Comment[],
  previous?: Map<string, Comment[]>,
): Pick<Store, "comments" | "counters" | "fileCounts" | "repoCounts" | "threadsByFile"> {
  return {
    comments,
    ...indexCounters(countReview(comments)),
    threadsByFile: byFile(comments, previous),
  };
}

/**
 * The threads of every file that carries one, in the order they were written.
 * A card reads its own entry, and a file whose list came out the same keeps the
 * array it already had: a reply in one file must not give the other 299 cards a
 * new reference to re-render on.
 */
function byFile(comments: Comment[], previous?: Map<string, Comment[]>): Map<string, Comment[]> {
  const threads = new Map<string, Comment[]>();
  for (const comment of comments) {
    if (comment.repo === null || comment.path === null) continue;
    const key = `${comment.repo}/${comment.path}`;
    const bucket = threads.get(key);
    if (bucket === undefined) threads.set(key, [comment]);
    else bucket.push(comment);
  }
  if (previous === undefined) return threads;
  for (const [key, list] of threads) {
    const before = previous.get(key);
    if (before !== undefined && before.length === list.length && before.every(same(list))) {
      threads.set(key, before);
    }
  }
  return threads;
}

function same(list: Comment[]): (comment: Comment, index: number) => boolean {
  return (comment, index) => comment === list[index];
}

/** The counters of the review indexed the way the tree and the cards ask for them. */
function indexCounters(
  counters: ReviewCounters,
): Pick<Store, "counters" | "fileCounts" | "repoCounts"> {
  const repoCounts = new Map<string, Counters>();
  const fileCounts = new Map<string, Counters>();
  for (const repository of counters.repositories) {
    repoCounts.set(repository.repo, repository.counters);
    for (const file of repository.files) {
      fileCounts.set(`${repository.repo}/${file.path}`, file.counters);
    }
  }
  return { counters, fileCounts, repoCounts };
}

/** The server's own refusal — `{ error, message }` — rather than the status code. */
async function refusal(response: Response): Promise<{ code: string | null; message: string }> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    const code = typeof body.error === "string" ? body.error : null;
    if (typeof body.message === "string" && body.message !== "") {
      return { code, message: body.message };
    }
    return { code, message: `the server answered ${response.status}` };
  } catch {
    // A body that is not the refusal shape leaves the status to say it.
    return { code: null, message: `the server answered ${response.status}` };
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Browser storage, and `null` where there is none. This store is also created
 * by the unit tests, which run under Node — where the globals are declared but,
 * with nothing behind them, carry none of their methods.
 */
function storage(which: "local" | "session"): Storage | null {
  const found =
    which === "local"
      ? typeof localStorage === "undefined"
        ? null
        : localStorage
      : typeof sessionStorage === "undefined"
        ? null
        : sessionStorage;
  return typeof found?.getItem === "function" ? found : null;
}

function readTheme(): Theme {
  return storage("local")?.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

function writeTheme(theme: Theme): void {
  storage("local")?.setItem(THEME_KEY, theme);
}

/**
 * The theme is a preference and lives in `localStorage`; a dismissed warning is
 * not. It says "I have read this about this session", which is true for as long
 * as the tab is open and no longer — a reload of the same review should not
 * bring the bar back, and tomorrow's run should not still be hiding it.
 */
/**
 * What a page opened now would find: the dismissed session, or `null`. Exported
 * because it is the only way to ask that question without reaching for the
 * global — which the store guards for a reason, since `sessionStorage` is a
 * browser's and the unit suite runs on two runtimes, one of which does not
 * declare it ([11-perf.md](../../docs/reference/11-perf.md)).
 */
export function readDismissed(): string | null {
  return storage("session")?.getItem(DISMISSED_KEY) ?? null;
}

function writeDismissed(name: string | null): void {
  const store = storage("session");
  if (store === null) return;
  if (name === null) store.removeItem(DISMISSED_KEY);
  else store.setItem(DISMISSED_KEY, name);
}
