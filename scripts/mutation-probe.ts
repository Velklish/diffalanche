/** `npm run probe -- <file> --mutate 's|<regexp>|<replacement>|[flags]' [--run <command>]`: the
 * check is red with one mutation of the file and green without it (README, "Development"). */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { constants } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { argv, cwd, stdout } from "node:process";
import { stripVTControlCharacters } from "node:util";

const USAGE =
  "usage: npm run probe -- <file> --mutate 's|<regexp>|<replacement>|[flags]' [--run <command>]";
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

class Refusal extends Error {}

const say = (line: string) => stdout.write(`${line}\n`);

function parse(args: string[]): { file: string; mutate: string; run: string | null } {
  let file: string | null = null;
  let mutate: string | null = null;
  let run: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (arg === "--mutate" || arg === "--run") {
      index += 1;
      const value = args[index];
      if (value === undefined) throw new Refusal(`${arg} takes a value\n${USAGE}`);
      if (arg === "--mutate") mutate = value;
      else run = value;
    } else if (arg.startsWith("-")) throw new Refusal(`unknown option ${arg}\n${USAGE}`);
    else if (file === null) file = arg;
    else throw new Refusal(`one file is probed at a time\n${USAGE}`);
  }
  if (file === null || mutate === null) throw new Refusal(USAGE);
  return { file, mutate, run };
}

/** The mutation as a JavaScript regexp; the separator is the character after `s`. */
function substitution(mutate: string): { pattern: RegExp; replacement: string } {
  const parts = /^s(.)(.*?)\1(.*)\1([a-z]*)$/s.exec(mutate);
  if (parts === null)
    throw new Refusal(`--mutate takes s|<regexp>|<replacement>|[flags], not ${mutate}`);
  const [, , source, replacement, flags] = parts as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  // String.replace writes the two characters `\n`, not a line break, so the edit is not the one meant.
  if (replacement.includes("\\n"))
    throw new Refusal("--mutate: the replacement holds the \\n escape");
  try {
    return { pattern: new RegExp(source, flags), replacement };
  } catch (error) {
    throw new Refusal(`--mutate: ${(error as Error).message}`);
  }
}

function porcelain(root: string): string[] {
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  if (status.status !== 0)
    throw new Refusal(`git status failed in ${root}: ${status.stderr.trim()}`);
  return status.stdout.split("\n").filter((line) => line !== "");
}

type Command = { shell: string } | { argv: [string, ...string[]] };

let child: ChildProcess | null = null;
let stopped: (typeof SIGNALS)[number] | null = null;

function execute(command: Command, root: string): Promise<{ code: number; lines: string[] }> {
  return new Promise((done, fail) => {
    let output = "";
    const words: string[] = "argv" in command ? command.argv : [command.shell];
    const spawned = spawn(words[0] as string, words.slice(1), {
      cwd: root,
      // Its own process group, so a stop reaches every descendant of the check, not only the shell.
      detached: true,
      shell: "shell" in command,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child = spawned;
    spawned.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    spawned.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    spawned.on("error", fail);
    spawned.on("close", (code, signal) => {
      child = null;
      const killed = signal === null ? 1 : 128 + constants.signals[signal];
      done({ code: code ?? killed, lines: stripVTControlCharacters(output).split("\n") });
    });
  });
}

function stop(signal: (typeof SIGNALS)[number]) {
  stopped ??= signal;
  if (child?.pid === undefined) return;
  try {
    // SIGKILL, not the signal received: nothing the check started may write after the restore.
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // The group is gone already: its close event is on its way.
  }
}

const failed = (lines: string[]) => [...new Set(lines.filter((line) => /^\s*FAIL\s/.test(line)))];
const summary = (lines: string[]) => lines.filter((line) => /^\s*Tests\s/.test(line));

async function probe(args: string[]): Promise<number> {
  const options = parse(args);
  const root = cwd();
  // Before anything is touched: the restore puts back the probed file, never an edit beside it.
  const dirty = porcelain(root);
  if (dirty.length > 0) {
    say("✖ probe: the tree is not clean — commit first, then probe:");
    for (const line of dirty) say(`    ${line}`);
    return 2;
  }
  const file = relative(root, resolve(root, options.file));
  if (file.startsWith("..") || isAbsolute(file))
    throw new Refusal(`${options.file} is outside ${root}`);
  if (!statSync(file, { throwIfNoEntry: false })?.isFile())
    throw new Refusal(`no such file: ${file}`);
  if (options.run === null && !/\.test\.tsx?$/.test(file))
    throw new Refusal(`${file} is not a test file — name the command with --run`);
  const command: Command =
    options.run === null ? { argv: ["bun", "run", "test", "--", file] } : { shell: options.run };
  const shown = "shell" in command ? command.shell : command.argv.join(" ");
  const { pattern, replacement } = substitution(options.mutate);

  const before = readFileSync(file);
  const text = before.toString("utf8");
  const mutated = text.replace(pattern, replacement);
  if (mutated === text)
    throw new Refusal(`the mutation changed nothing in ${file} — nothing to prove`);

  const restore = () => writeFileSync(file, before);
  for (const signal of SIGNALS) process.on(signal, () => stop(signal));
  const halted = (stage: string) => {
    if (stopped === null) return null;
    say(`✖ probe: ${stopped} ${stage} — ${file} restored`);
    return 128 + constants.signals[stopped];
  };
  let red: { code: number; lines: string[] };
  try {
    writeFileSync(file, mutated);
    red = await execute(command, root);
  } finally {
    restore();
  }
  const early = halted("during the mutated run");
  if (early !== null) return early;
  let green: { code: number; lines: string[] };
  let left: string[] = [];
  try {
    green = await execute(command, root);
  } finally {
    // What the command wrote is read before the probed file is put back a second time.
    try {
      if (stopped === null) left = porcelain(root);
    } finally {
      restore();
    }
  }
  const late = halted("during the restored run");
  if (late !== null) return late;

  say(`probe: ${file} · ${shown}`);
  say(`  mutated → exit ${red.code}`);
  const names = failed(red.lines);
  for (const line of [...names, ...summary(red.lines)]) say(`    ${line.trim()}`);
  say(`  restored → exit ${green.code}`);
  for (const line of summary(green.lines)) say(`    ${line.trim()}`);
  if (red.code !== 0 && names.length === 0) {
    say(
      "  warning: no FAIL line names a verdict — a run that stops before its tests reads as red too",
    );
    for (const line of red.lines.filter((row) => row.trim() !== "").slice(-5)) say(`    ${line}`);
  }

  if (red.code === 0) {
    say(`✖ probe: the check passed WITH the mutation in place — it does not see ${file}`);
    return 1;
  }
  if (green.code !== 0) {
    say("✖ probe: the check is red without the mutation too — its red proves nothing about it");
    return 1;
  }
  if (left.length > 0) {
    say(`✖ probe: the command left the tree dirty — it wrote (${file} is put back):`);
    for (const line of left) say(`    ${line}`);
    return 1;
  }
  say(`✔ probe: red with the mutation (exit ${red.code}), green without it — ${file}`);
  return 0;
}

probe(argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (!(error instanceof Refusal)) throw error;
    say(`✖ probe: ${error.message}`);
    process.exitCode = 2;
  },
);
