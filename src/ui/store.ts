/**
 * The store of the review workspace. The slices are the ones the handoff's
 * "State Management" section names — theme and base, sessions, navigation,
 * commenting, threads, search and overlays, feed, scanner — plus `review`,
 * which holds what the server sends; the prototype had that data written into
 * the page, so it has no counterpart there.
 *
 * A slice carries the state its screen needs from the first task that renders
 * it and the actions of the task that makes it interactive: DA-22 to DA-27 fill
 * in the actions of the composer, the rail, the header, and the keyboard map.
 */
import { create } from "zustand";
import type { FileChange, RepositoryChange } from "../core/types.ts";
import { perf } from "./perf.ts";
import type {
  BaseMode,
  Comment,
  ReviewBundle,
  ReviewCounters,
  ReviewSession,
  ScanWarning,
  Severity,
  Side,
} from "./types.ts";
import { SEVERITY_ORDER } from "./types.ts";

export type Theme = "dark" | "light";
export type SidebarTab = "changes" | "all";
export type DiffView = "split" | "unified";
export type RailScope = "file" | "all";
export type ExportView = "rendered" | "raw";
export type LoadStatus = "loading" | "ready" | "failed";

/** One file of the change set with the repository it belongs to. */
export type FileEntry = {
  /** `<repo>/<path>`: the identity of a file card across the whole review. */
  id: string;
  /** Position in the centre panel, the order the perf harness jumps by. */
  index: number;
  repo: string;
  file: FileChange;
};

/** What a navigation badge shows: how many open comments, and the worst of them. */
export type CommentCount = { open: number; severity: Severity | null };

/** Where the composer sits while it is open. */
export type ComposerTarget = { repo: string; path: string; side: Side; line: number };

/** An event of the activity feed; the server sends them from DA-25 on. */
export type ActivityEvent = {
  who: string;
  verb: string;
  target: string;
  sub: string;
  at: number;
  kind: "working" | "replied" | "diff";
};

const THEME_KEY = "diffalanche.theme";

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
  /** Open comments per file card, keyed by `FileEntry.id`. */
  fileCounts: Map<string, CommentCount>;
  /** Open comments per repository, keyed by the repository path. */
  repoCounts: Map<string, CommentCount>;
  loadReview: () => Promise<void>;
};

type ThemeAndBaseSlice = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** The base picker's draft (DA-24); the applied base lives in `session.base`. */
  baseMode: BaseMode;
  baseSource: string;
  baseName: string;
  refText: string;
  baseOpen: boolean;
};

type SessionsSlice = {
  session: ReviewSession | null;
  sessions: ReviewSession[];
  sessionMenuOpen: boolean;
  newName: string;
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
};

type CommentingSlice = {
  sel: { a: number; b: number } | null;
  dragging: boolean;
  composer: ComposerTarget | null;
  composerEnd: number | null;
  sev: Severity;
  body: string;
  sugIdx: number;
  openComposer: (target: ComposerTarget) => void;
  closeComposer: () => void;
};

type ThreadsSlice = {
  focusId: string | null;
  replyId: string | null;
  replyText: string;
  railScope: RailScope;
  unansweredOnly: boolean;
};

type SearchAndOverlaysSlice = {
  paletteOpen: boolean;
  paletteQuery: string;
  palIdx: number;
  exportOpen: boolean;
  exportView: ExportView;
  toast: string | null;
  setToast: (toast: string | null) => void;
};

type FeedSlice = {
  events: ActivityEvent[];
  feedOpen: boolean;
  /** Bumped every five seconds so relative times in the feed redraw. */
  tick: number;
};

type ScannerSlice = {
  warnings: ScanWarning[];
  warningsDismissed: boolean;
};

export type Store = ReviewSlice &
  ThemeAndBaseSlice &
  SessionsSlice &
  NavigationSlice &
  CommentingSlice &
  ThreadsSlice &
  SearchAndOverlaysSlice &
  FeedSlice &
  ScannerSlice;

export const useStore = create<Store>()((set, get) => ({
  // review
  status: "loading",
  failure: null,
  root: "",
  repositories: [],
  files: [],
  comments: [],
  counters: { open: 0, awaiting: 0, resolved: 0 },
  fileCounts: new Map(),
  repoCounts: new Map(),
  loadReview: async () => {
    try {
      const response = await fetch("/api/review");
      if (!response.ok) throw new Error(`the server answered ${response.status}`);
      const bundle = (await response.json()) as ReviewBundle;
      // Stamped here, not after the render: the harness measures from the moment
      // the response was parsed to the frame that showed it.
      perf.responseAt = performance.now();
      set(fromBundle(bundle));
    } catch (error) {
      set({ status: "failed", failure: error instanceof Error ? error.message : String(error) });
    }
  },

  // theme and base
  theme: readTheme(),
  setTheme: (theme) => {
    writeTheme(theme);
    set({ theme });
  },
  baseMode: "head",
  baseSource: "origin",
  baseName: "",
  refText: "",
  baseOpen: false,

  // sessions
  session: null,
  sessions: [],
  sessionMenuOpen: false,
  newName: "",

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

  // commenting
  sel: null,
  dragging: false,
  composer: null,
  composerEnd: null,
  sev: "warning",
  body: "",
  sugIdx: 0,
  openComposer: (composer) => set({ composer }),
  closeComposer: () => set({ composer: null, composerEnd: null, sel: null }),

  // threads
  focusId: null,
  replyId: null,
  replyText: "",
  railScope: "file",
  unansweredOnly: false,

  // search and overlays
  paletteOpen: false,
  paletteQuery: "",
  palIdx: 0,
  exportOpen: false,
  exportView: "rendered",
  toast: null,
  setToast: (toast) => set({ toast }),

  // feed
  events: [],
  feedOpen: false,
  tick: 0,

  // scanner
  warnings: [],
  warningsDismissed: false,
}));

/** The whole review in one response: everything derived from it is derived once. */
function fromBundle(bundle: ReviewBundle): Partial<Store> {
  let index = 0;
  const files = bundle.repositories.flatMap((repo) =>
    repo.files.map((file) => ({
      id: `${repo.path}/${file.path}`,
      index: index++,
      repo: repo.path,
      file,
    })),
  );
  const first = files[0];
  return {
    status: "ready",
    root: bundle.root,
    repositories: bundle.repositories,
    files,
    comments: bundle.comments,
    counters: countReview(bundle.comments),
    fileCounts: countBy(bundle.comments, (comment) =>
      comment.repo && comment.path ? `${comment.repo}/${comment.path}` : null,
    ),
    repoCounts: countBy(bundle.comments, (comment) => comment.repo),
    session: bundle.session,
    sessions: bundle.session ? [bundle.session] : [],
    warnings: bundle.warnings,
    repo: first?.repo ?? null,
    path: first?.file.path ?? null,
  };
}

/**
 * `open` is every thread that is not resolved — an orphaned one included, since
 * nobody has closed it — and `awaiting` is the part of it whose last message
 * came from an agent.
 */
export function countReview(comments: Comment[]): ReviewCounters {
  let open = 0;
  let awaiting = 0;
  let resolved = 0;
  for (const comment of comments) {
    if (comment.status === "resolved") {
      resolved += 1;
      continue;
    }
    open += 1;
    if (lastRole(comment) === "agent") awaiting += 1;
  }
  return { open, awaiting, resolved };
}

function lastRole(comment: Comment): string {
  return comment.replies.at(-1)?.role ?? comment.role;
}

/** Open comments per key, with the worst severity among them for the badge colour. */
function countBy(
  comments: Comment[],
  keyOf: (comment: Comment) => string | null,
): Map<string, CommentCount> {
  const counts = new Map<string, CommentCount>();
  for (const comment of comments) {
    if (comment.status === "resolved") continue;
    const key = keyOf(comment);
    if (key === null) continue;
    const current = counts.get(key) ?? { open: 0, severity: null };
    counts.set(key, {
      open: current.open + 1,
      severity: worst(current.severity, comment.severity),
    });
  }
  return counts;
}

function worst(left: Severity | null, right: Severity): Severity {
  if (left === null) return right;
  return SEVERITY_ORDER.indexOf(left) <= SEVERITY_ORDER.indexOf(right) ? left : right;
}

function readTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

function writeTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
}
