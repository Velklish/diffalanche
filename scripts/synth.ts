/**
 * Generator of the synthetic review: the fixture the performance gate, the diff
 * rendering spike, and the scanner and storage tests all measure against.
 *
 * Everything is derived from the seed, including the git author, committer, and
 * dates, so two runs with the same seed produce byte-identical trees outside
 * `.git`. Node-only APIs are used on purpose: the Vitest suite runs under Node
 * and imports this file directly.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { devNull } from "node:os";
import { dirname, join, resolve } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

export interface Profile {
  /** Repositories that carry changes. The sibling worktree is not one of them. */
  repos: number;
  /** Files in the change set, tracked edits and untracked files together. */
  files: number;
  /** Changed lines in the change set: insertions plus deletions. */
  lines: number;
  /** Comments written into the single review session. */
  comments: number;
}

export const PROFILES = {
  full: { repos: 21, files: 300, lines: 30_000, comments: 200 },
  small: { repos: 3, files: 20, lines: 2_000, comments: 20 },
} as const satisfies Record<string, Profile>;

export interface SynthOptions {
  /** Root of the generated review. Created if missing, emptied if it exists. */
  out: string;
  seed?: number;
  profile?: Profile;
}

export interface SynthReport {
  /** Repositories under `repos/`, including the clean sibling worktree. */
  repositories: number;
  tracked: { files: number; lines: number };
  untracked: { files: number; lines: number };
  changeSet: { files: number; lines: number };
  comments: number;
}

const DEFAULT_SEED = 1;
/** Fewest changed lines a file may be given: below this an edit stops looking like one. */
const MIN_CHANGED = 4;
const SESSION_NAME = "synth";
/** Every timestamp in the data directory is this instant plus a whole minute. */
const EPOCH = Date.parse("2026-09-01T09:00:00Z");
const GIT_DATE = "2026-09-01T09:00:00+00:00";
const GIT_USER = { name: "synth", email: "synth@diffalanche.invalid" };

// ---------------------------------------------------------------------------
// seeded randomness
// ---------------------------------------------------------------------------

type Random = () => number;

function makeRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function int(rnd: Random, min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1));
}

function pick<T>(rnd: Random, values: readonly T[]): T {
  const value = values[Math.floor(rnd() * values.length)];
  if (value === undefined) {
    throw new Error("pick from an empty list");
  }
  return value;
}

// ---------------------------------------------------------------------------
// content
// ---------------------------------------------------------------------------

type Language = "ts" | "cs" | "py" | "go" | "md";

const LANGUAGES: readonly Language[] = ["ts", "cs", "py", "go", "md"];

const NOUNS = [
  "cargo",
  "flag",
  "route",
  "carrier",
  "quote",
  "payload",
  "shipment",
  "tariff",
  "region",
  "invoice",
  "contract",
  "vehicle",
] as const;

const VERBS = ["resolve", "normalize", "collect", "validate", "expand", "merge", "rank"] as const;

const NOTES = [
  "the request carries the raw values, the resolver normalises them",
  "callers rely on the order of the returned list",
  "an empty list means the defaults, not an error",
  "the cache is keyed by region and by tariff revision",
  "this path runs once per request, keep it allocation free",
  "the contract guarantees a non-null collection here",
] as const;

function pascal(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** One coherent block of code or prose, unique through `seq`. */
function unit(lang: Language, rnd: Random, seq: number): string[] {
  const noun = pick(rnd, NOUNS);
  const verb = pick(rnd, VERBS);
  const note = pick(rnd, NOTES);
  const name = `${verb}${pascal(noun)}${seq}`;
  const type = `${pascal(noun)}Set${seq}`;

  switch (lang) {
    case "ts":
      return [
        `/** ${pascal(note)}. */`,
        `export function ${name}(request: ${type}Request): ${type} {`,
        `  const ${noun}s = request.${noun}s ?? [];`,
        `  if (${noun}s.length === 0) {`,
        `    return DEFAULT_${noun.toUpperCase()}S_${seq};`,
        "  }",
        `  return ${noun}s.map((item) => normalize${seq}(item)).filter(Boolean);`,
        "}",
        "",
      ];
    case "cs":
      return [
        `/// <summary>${pascal(note)}.</summary>`,
        `public sealed class ${type}Resolver`,
        "{",
        `    private readonly ILogger<${type}Resolver> _logger;`,
        "",
        `    public ${type} ${pascal(verb)}(${type}Request request)`,
        "    {",
        `        var ${noun}s = request.${pascal(noun)}s ?? Array.Empty<${pascal(noun)}${seq}>();`,
        `        _logger.LogDebug("${verb}d {Count} ${noun}s", ${noun}s.Length);`,
        `        return new ${type}(${noun}s);`,
        "    }",
        "}",
        "",
      ];
    case "py":
      return [
        `def ${verb}_${noun}s_${seq}(request: ${type}Request) -> ${type}:`,
        `    """${pascal(note)}."""`,
        `    ${noun}s = request.${noun}s or []`,
        `    if not ${noun}s:`,
        `        return DEFAULT_${noun.toUpperCase()}S_${seq}`,
        `    return [normalize_${seq}(item) for item in ${noun}s if item.enabled]`,
        "",
      ];
    case "go":
      return [
        `// ${pascal(verb)}${pascal(noun)}s${seq} ${note}.`,
        `func ${pascal(verb)}${pascal(noun)}s${seq}(request ${type}Request) (${type}, error) {`,
        `\t${noun}s := request.${pascal(noun)}s`,
        `\tif len(${noun}s) == 0 {`,
        `\t\treturn default${type}, nil`,
        "\t}",
        `\treturn normalize${seq}(${noun}s), nil`,
        "}",
        "",
      ];
    case "md":
      return [
        `## ${pascal(verb)} ${noun}s (${seq})`,
        "",
        `${pascal(note)}. The resolver reads them from the request and returns`,
        "the normalised set; the defaults apply when the request carries none.",
        "",
        `- \`${noun}s\` — the raw list taken from the request`,
        `- \`default${pascal(noun)}s\` — used when the list is empty`,
        "",
      ];
  }
}

/** A single line, used to reach an exact line count without a torn unit. */
function filler(lang: Language, rnd: Random, seq: number): string {
  const note = pick(rnd, NOTES);
  switch (lang) {
    case "ts":
      return `// note ${seq}: ${note}`;
    case "cs":
      return `    // note ${seq}: ${note}`;
    case "py":
      return `# note ${seq}: ${note}`;
    case "go":
      return `// note ${seq}: ${note}`;
    case "md":
      return `- note ${seq}: ${note}`;
  }
}

/** The counter that makes every generated line unique, and so every diff exact. */
interface Sequence {
  next: number;
}

/** Exactly `count` lines of `lang`, whole units first, fillers for the rest. */
function lines(lang: Language, rnd: Random, count: number, seq: Sequence): string[] {
  const out: string[] = [];
  while (true) {
    const block = unit(lang, rnd, seq.next);
    if (out.length + block.length > count) {
      break;
    }
    seq.next += 1;
    out.push(...block);
  }
  while (out.length < count) {
    out.push(filler(lang, rnd, seq.next));
    seq.next += 1;
  }
  return out;
}

function filePath(lang: Language, rnd: Random, seq: number): string {
  const noun = pick(rnd, NOUNS);
  const stem = `${noun}-${seq}`;
  switch (lang) {
    case "ts":
      return `src/${noun}/${stem}.ts`;
    case "cs":
      return `src/${pascal(noun)}s/${pascal(noun)}Service${seq}.cs`;
    case "py":
      return `app/${noun}/${stem.replace(/-/g, "_")}.py`;
    case "go":
      return `internal/${noun}/${stem}.go`;
    case "md":
      return `docs/${stem}.md`;
  }
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

const GIT_CONFIG = [
  "-c",
  "init.defaultBranch=main",
  "-c",
  `user.name=${GIT_USER.name}`,
  "-c",
  `user.email=${GIT_USER.email}`,
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.autocrlf=false",
  "-c",
  "protocol.file.allow=always",
];

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: GIT_USER.name,
  GIT_AUTHOR_EMAIL: GIT_USER.email,
  GIT_AUTHOR_DATE: GIT_DATE,
  GIT_COMMITTER_NAME: GIT_USER.name,
  GIT_COMMITTER_EMAIL: GIT_USER.email,
  GIT_COMMITTER_DATE: GIT_DATE,
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...GIT_CONFIG, ...args], {
    env: GIT_ENV,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

const GROUPS = ["core", "platform", "services", "tools"] as const;

const REPO_NAMES = [
  "cargos-api",
  "loads-search",
  "quotes-worker",
  "routing-engine",
  "tariff-store",
  "carrier-registry",
  "billing-gateway",
  "notify-relay",
  "geo-index",
  "audit-log",
  "contracts-api",
  "vehicle-catalog",
  "payments-adapter",
  "search-indexer",
  "region-sync",
  "invoice-render",
  "shipment-tracker",
  "fleet-monitor",
  "pricing-rules",
  "document-store",
  "identity-broker",
  "metrics-collector",
  "schedule-planner",
  "webhook-fanout",
] as const;

interface FilePlan {
  lang: Language;
  path: string;
  /** Changed lines this file contributes: insertions plus deletions. */
  changed: number;
  untracked: boolean;
  /** Committed content. Empty for an untracked file. */
  base: string[];
  /** Working-tree content. */
  work: string[];
  /** 1-based first line of the replaced block, on both sides. */
  start: number;
  deleted: number;
  inserted: number;
}

interface RepoPlan {
  group: string;
  name: string;
  /** Path relative to the root, the identity of a repository in the spec. */
  slug: string;
  dir: string;
  files: FilePlan[];
}

/**
 * Splits `total` over `parts` so the sum is exact, the parts differ, and none
 * falls below `min`. The floor is handed out first and only the remainder is
 * spread, so the result can never add up to more than `total` — the top-up pass
 * can raise a change set towards the profile but has no way to lower one.
 */
function spread(rnd: Random, total: number, parts: number, min = 0): number[] {
  const rest = total - min * parts;
  if (rest < 0) {
    throw new Error(`cannot split ${total} over ${parts} parts of at least ${min}`);
  }
  const weights = Array.from({ length: parts }, () => 0.6 + rnd());
  const sum = weights.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let acc = 0;
  let done = 0;
  for (let i = 0; i < parts; i += 1) {
    acc += weights[i] ?? 0;
    const upto = i === parts - 1 ? rest : Math.round((rest * acc) / sum);
    out.push(min + upto - done);
    done = upto;
  }
  return out;
}

function planRepos(rnd: Random, profile: Profile, seq: Sequence): RepoPlan[] {
  const repos: RepoPlan[] = [];
  for (let i = 0; i < profile.repos; i += 1) {
    const group = GROUPS[i % GROUPS.length] ?? "core";
    const name = REPO_NAMES[i % REPO_NAMES.length] ?? `repo-${i}`;
    const slug = `repos/${group}/${name}`;
    repos.push({ group, name, slug, dir: slug, files: [] });
  }

  const perRepo = spreadCount(profile.files, profile.repos);
  const changed = spread(rnd, profile.lines, profile.files, MIN_CHANGED);
  let index = 0;

  for (const [repoIndex, repo] of repos.entries()) {
    const count = perRepo[repoIndex] ?? 0;
    for (let f = 0; f < count; f += 1) {
      const lang = LANGUAGES[index % LANGUAGES.length] ?? "ts";
      // One untracked file per repository, always the last one planned.
      const untracked = f === count - 1;
      const total = changed[index] ?? MIN_CHANGED;
      index += 1;

      if (untracked) {
        const work = lines(lang, rnd, total, seq);
        repo.files.push({
          lang,
          path: filePath(lang, rnd, seq.next),
          changed: total,
          untracked: true,
          base: [],
          work,
          start: 1,
          deleted: 0,
          inserted: total,
        });
        continue;
      }

      const deleted = Math.max(1, Math.round(total * 0.35));
      const inserted = total - deleted;
      const baseLength = deleted + int(rnd, 80, 140);
      const base = lines(lang, rnd, baseLength, seq);
      const start = int(rnd, 4, baseLength - deleted - 3);
      const block = lines(lang, rnd, inserted, seq);
      const work = [...base.slice(0, start - 1), ...block, ...base.slice(start - 1 + deleted)];
      repo.files.push({
        lang,
        path: filePath(lang, rnd, seq.next),
        changed: total,
        untracked: false,
        base,
        work,
        start,
        deleted,
        inserted,
      });
    }
  }
  return repos;
}

/** Splits a count over parts as evenly as git would show it: no randomness. */
function spreadCount(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const extra = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

// ---------------------------------------------------------------------------
// comments
// ---------------------------------------------------------------------------

const SEVERITIES = ["critical", "warning", "nit", "question"] as const;

const BODIES = [
  "Null check is unreachable: the contract guarantees a non-null collection.",
  "This allocates on every request; hoist the default out of the loop.",
  "The name says filter, the body maps. Rename or split it.",
  "Missing the region in the cache key: two tariffs collide here.",
  "Why is the empty list an error in this branch and a default in the next one?",
  "Log level is wrong: a resolved request is not a debug event.",
  "The list order is part of the contract, sorting it here breaks callers.",
  "Duplicate of the helper two files up; call that one instead.",
] as const;

const REPLIES = [
  "Fixed: removed the fallback, the contract guarantees non-null.",
  "Fixed: the default is hoisted, the loop allocates nothing now.",
  "Renamed to match the body.",
  "Declined: the order is incidental here, no caller depends on it — the list is built per request and consumed immediately, and the sort keeps the output stable between runs.",
  "Fixed: the region is part of the cache key now.",
] as const;

function commentId(rnd: Random): string {
  let out = "c_";
  for (let i = 0; i < 6; i += 1) {
    out += "0123456789abcdefghijklmnopqrstuvwxyz"[int(rnd, 0, 35)];
  }
  return out;
}

function stamp(minutes: number): string {
  return new Date(EPOCH + minutes * 60_000).toISOString().replace(".000Z", "Z");
}

interface Anchor {
  lineContent: string;
  hunk: string;
  before: string[];
  after: string[];
}

function anchorOf(file: FilePlan, line: number): Anchor {
  const context = 3;
  const oldStart = Math.max(1, file.start - context);
  const oldCount = file.deleted + (file.start - oldStart) + context;
  const newCount = file.inserted + (file.start - oldStart) + context;
  return {
    lineContent: file.work[line - 1] ?? "",
    hunk: `@@ -${oldStart},${oldCount} +${oldStart},${newCount} @@`,
    before: file.work.slice(Math.max(0, line - 1 - 2), line - 1),
    after: file.work.slice(line, line + 2),
  };
}

function buildComments(rnd: Random, repos: RepoPlan[], count: number): unknown[] {
  const targets: { repo: RepoPlan; file: FilePlan }[] = [];
  for (const repo of repos) {
    for (const file of repo.files) {
      targets.push({ repo, file });
    }
  }

  const comments: unknown[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = commentId(rnd);
    const created = stamp(i * 3);
    const severity = SEVERITIES[i % SEVERITIES.length] ?? "warning";
    const body = pick(rnd, BODIES);

    // Every fifteenth comment anchors above a line: file, repository, review.
    const level = i % 15;
    const target = targets[i % targets.length];
    if (!target) {
      break;
    }

    const replies =
      i % 3 === 0
        ? [
            {
              id: "r_1",
              author: "claude",
              role: "agent",
              body: pick(rnd, REPLIES),
              createdAt: stamp(i * 3 + 1),
            },
          ]
        : [];
    const resolved = i % 7 === 0;

    const common = {
      id,
      severity,
      status: resolved ? "resolved" : "open",
      author: i % 9 === 0 ? "claude" : "kim.p",
      role: i % 9 === 0 ? "agent" : "human",
      body,
      createdAt: created,
      resolvedAt: resolved ? stamp(i * 3 + 2) : null,
      resolvedBy: resolved ? "kim.p" : null,
      replies,
    };

    if (level === 0) {
      comments.push({ ...common, repo: null, path: null, side: null, line: null, anchor: null });
      continue;
    }
    if (level === 5) {
      comments.push({
        ...common,
        repo: target.repo.slug,
        path: null,
        side: null,
        line: null,
        anchor: null,
      });
      continue;
    }
    if (level === 10) {
      comments.push({
        ...common,
        repo: target.repo.slug,
        path: target.file.path,
        side: null,
        line: null,
        anchor: null,
      });
      continue;
    }

    // A line anchor points inside the block this file actually changed.
    const line = target.file.start + int(rnd, 0, Math.max(0, target.file.inserted - 1));
    const range = i % 4 === 0 && target.file.inserted > 3;
    comments.push({
      ...common,
      repo: target.repo.slug,
      path: target.file.path,
      side: "new",
      line,
      endLine: range ? Math.min(line + 2, target.file.start + target.file.inserted - 1) : null,
      anchor: anchorOf(target.file, line),
    });
  }
  return comments;
}

// ---------------------------------------------------------------------------
// generation
// ---------------------------------------------------------------------------

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function writeLines(path: string, body: string[]): void {
  write(path, body.length === 0 ? "" : `${body.join("\n")}\n`);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Counts lines the way git does: a trailing newline does not add one. */
function countLines(content: string): number {
  if (content === "") {
    return 0;
  }
  return content.endsWith("\n") ? content.split("\n").length - 1 : content.split("\n").length;
}

/**
 * Raises the change set to the planned line count.
 *
 * A planned edit of `deleted` old lines into `inserted` new ones does not
 * produce `deleted + inserted` changed lines: realistic code repeats `}` and
 * blank lines, git matches those across the replaced block, and they become
 * context instead of changes — about a quarter of the plan on the profiles
 * here. The lines appended here carry the sequence counter, so no line matches
 * another and every one of them counts.
 */
function topUp(rnd: Random, repos: RepoPlan[], deficit: number, seq: Sequence): void {
  const targets = repos.flatMap((repo) => repo.files.filter((file) => !file.untracked));
  if (targets.length === 0) {
    return;
  }
  for (let i = 0; i < deficit; i += 1) {
    const file = targets[i % targets.length];
    if (!file) {
      return;
    }
    file.work.push(filler(file.lang, rnd, seq.next));
    seq.next += 1;
  }
}

function writeWork(out: string, repos: RepoPlan[]): void {
  for (const repo of repos) {
    for (const file of repo.files) {
      writeLines(join(out, repo.dir, file.path), file.work);
    }
  }
}

/**
 * Refuses an `--out` that was not written by this generator. The directory is
 * erased before it is filled, and `--out .` in a checkout would take the working
 * tree and its `.git` with it; a `.diffalanche/` from an earlier run is the only
 * thing that makes erasing safe.
 */
function assertOverwritable(out: string): void {
  if (!existsSync(out)) {
    return;
  }
  if (!statSync(out).isDirectory()) {
    throw new Error(`${out} is not a directory`);
  }
  const entries = readdirSync(out);
  if (entries.length === 0 || entries.includes(".diffalanche")) {
    return;
  }
  throw new Error(`${out} is not empty and holds no .diffalanche/ from an earlier run`);
}

export function generate(options: SynthOptions): SynthReport {
  const out = resolve(options.out);
  const seed = options.seed ?? DEFAULT_SEED;
  const profile = options.profile ?? PROFILES.full;
  const rnd = makeRandom(seed);
  const seq: Sequence = { next: 1 };

  assertOverwritable(out);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const repos = planRepos(rnd, profile, seq);

  // The submodule source lives outside `repos/`, so a scan never sees it as a
  // repository of its own — only as the nested submodule it is cloned into.
  const source = join(out, "sources/vendor-lib");
  mkdirSync(source, { recursive: true });
  git(source, "init", "-q");
  writeLines(join(source, "lib.md"), lines("md", rnd, 40, seq));
  git(source, "add", "-A");
  git(source, "commit", "-q", "-m", "vendor library base");

  for (const [index, repo] of repos.entries()) {
    const dir = join(out, repo.dir);
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q");
    writeLines(join(dir, "README.md"), [`# ${repo.name}`, "", `Part of the ${repo.group} group.`]);
    for (const file of repo.files) {
      if (!file.untracked) {
        writeLines(join(dir, file.path), file.base);
      }
    }
    if (index === 0) {
      git(dir, "submodule", "add", "-q", "../../../sources/vendor-lib", "vendor/lib");
    }
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "base state");
  }

  // A worktree checked out as a sibling directory: a scan lists it as its own
  // repository, and it carries no changes, so the review does not show it.
  const first = repos[0];
  if (first) {
    const main = join(out, first.dir);
    git(main, "worktree", "add", "-q", "-b", "synth-worktree", `../${first.name}-worktree`, "HEAD");
  }

  writeWork(out, repos);
  let result = measure(out, repos, profile.comments);
  for (let round = 0; round < 3 && result.changeSet.lines < profile.lines; round += 1) {
    topUp(rnd, repos, profile.lines - result.changeSet.lines, seq);
    writeWork(out, repos);
    result = measure(out, repos, profile.comments);
  }
  if (result.changeSet.files !== profile.files || result.changeSet.lines !== profile.lines) {
    throw new Error(
      `change set is ${result.changeSet.files} files and ${result.changeSet.lines} lines, ` +
        `the profile asks for ${profile.files} and ${profile.lines}; the top-up pass only ` +
        "adds lines, so a plan that overshoots the profile cannot be corrected here",
    );
  }

  const comments = buildComments(rnd, repos, profile.comments);
  const data = join(out, ".diffalanche");
  write(
    join(data, "config.json"),
    json({ roots: ["repos"], depth: 2, exclude: [], user: "kim.p", port: 4880, lsp: {} }),
  );
  write(
    join(data, "reviews", SESSION_NAME, "review.json"),
    json({
      version: 1,
      name: SESSION_NAME,
      title: "Synthetic review",
      base: { mode: "head" },
      createdAt: stamp(0),
      updatedAt: stamp(profile.comments * 3),
    }),
  );
  write(join(data, "reviews", SESSION_NAME, "comments.json"), json({ version: 1, comments }));

  return result;
}

function measure(out: string, repos: RepoPlan[], comments: number): SynthReport {
  const tracked = { files: 0, lines: 0 };
  const untracked = { files: 0, lines: 0 };

  for (const repo of repos) {
    const dir = join(out, repo.dir);
    for (const row of git(dir, "diff", "--numstat").split("\n")) {
      if (row === "") {
        continue;
      }
      const [added, removed] = row.split("\t");
      tracked.files += 1;
      tracked.lines += Number(added ?? 0) + Number(removed ?? 0);
    }
    for (const row of git(dir, "status", "--porcelain", "--untracked-files=all").split("\n")) {
      if (!row.startsWith("?? ")) {
        continue;
      }
      untracked.files += 1;
      untracked.lines += countLines(readFileSync(join(dir, row.slice(3)), "utf8"));
    }
  }

  return {
    repositories: repos.length + 1,
    tracked,
    untracked,
    changeSet: {
      files: tracked.files + untracked.files,
      lines: tracked.lines + untracked.lines,
    },
    comments,
  };
}

// ---------------------------------------------------------------------------
// command line
// ---------------------------------------------------------------------------

const USAGE = `Usage: bun run synth -- --out <dir> [--seed <n>] [--small]

  --out <dir>   root of the generated review; the directory is emptied first
  --seed <n>    seed for every random choice (default ${DEFAULT_SEED})
  --small       small profile for unit tests: ${PROFILES.small.repos} repositories,
                ${PROFILES.small.files} files, ${PROFILES.small.lines} changed lines
`;

function parse(args: string[]): SynthOptions {
  let out: string | undefined;
  let seed = DEFAULT_SEED;
  let profile: Profile = PROFILES.full;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--out") {
      i += 1;
      out = args[i];
    } else if (arg === "--seed") {
      i += 1;
      seed = Number(args[i]);
    } else if (arg === "--small") {
      profile = PROFILES.small;
    } else if (arg === "--help" || arg === "-h") {
      stdout.write(USAGE);
      exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}\n\n${USAGE}`);
    }
  }

  if (out === undefined || out === "") {
    throw new Error(`--out is required\n\n${USAGE}`);
  }
  if (!Number.isFinite(seed)) {
    throw new Error(`--seed must be a number\n\n${USAGE}`);
  }
  return { out, seed, profile };
}

function report(out: string, result: SynthReport): string {
  const row = (label: string, files: number, count: number) =>
    `  ${label.padEnd(16)}${String(files).padStart(4)} files${String(count).padStart(8)} lines`;
  return [
    `synthetic review at ${out}`,
    `  ${String(result.repositories - 1).padStart(4)} repositories with changes; a scan finds ${result.repositories}, the extra one`,
    "       being the clean sibling worktree",
    row("git diff", result.tracked.files, result.tracked.lines),
    row("untracked", result.untracked.files, result.untracked.lines),
    row("change set", result.changeSet.files, result.changeSet.lines),
    `  ${String(result.comments).padStart(4)} comments in reviews/${SESSION_NAME}/comments.json`,
    "",
  ].join("\n");
}

function isMain(): boolean {
  const entry = argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const options = parse(argv.slice(2));
    const result = generate(options);
    stdout.write(report(resolve(options.out), result));
  } catch (error) {
    stderr.write(`synth: ${error instanceof Error ? error.message : String(error)}\n`);
    exit(1);
  }
}
