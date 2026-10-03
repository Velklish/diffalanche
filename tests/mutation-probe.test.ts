import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { untouched } from "./helpers/untouched";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/mutation-probe.ts");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A committed repository with one file whose `good` the mutations turn into `bad`. */
function repository(name = "subject.txt"): string {
  const root = mkdtempSync(join(tmpdir(), "diffalanche-probe-"));
  roots.push(root);
  git(root, "init", "-q");
  writeFileSync(join(root, name), "good\n");
  git(root, "add", ".");
  git(root, "-c", "user.email=f@example.com", "-c", "user.name=f", "commit", "-qm", "init");
  return root;
}

function probe(root: string, ...args: string[]): { code: number | null; out: string } {
  const run = spawnSync("bun", [SCRIPT, ...args], { cwd: root, encoding: "utf8" });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

const quoted = (arg: string) => `'${arg.replaceAll("'", `'\\''`)}'`;

const subject = (root: string) => readFileSync(join(root, "subject.txt"), "utf8");

describe("the mutation probe", () => {
  it("passes a check red with the mutation and green without it, and puts the file back", () => {
    const root = repository();
    const check = `grep -q good subject.txt || { echo " FAIL  |unit| subject > says good"; exit 3; }`;
    const run = probe(root, "subject.txt", "--mutate", "s|good|bad|", "--run", check);
    expect(run.out).toContain("mutated → exit 3");
    expect(run.out).toContain("FAIL  |unit| subject > says good");
    expect(run.out).toContain("restored → exit 0");
    expect(run.code).toBe(0);
    expect(subject(root)).toBe("good\n");
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("refuses a mutation that changes nothing, and never runs the command", () => {
    const root = repository();
    const unwritten = untouched(join(root, "subject.txt"));
    const run = probe(root, "subject.txt", "--mutate", "s|absent|bad|", "--run", "touch ran");
    expect(run.out).toContain("the mutation changed nothing in subject.txt");
    expect(run.code).toBe(2);
    expect(existsSync(join(root, "ran"))).toBe(false);
    unwritten();
  });

  it("refuses a dirty tree before it touches anything, and names what is dirty", () => {
    const root = repository();
    writeFileSync(join(root, "draft.txt"), "uncommitted work\n");
    const unwritten = [untouched(join(root, "subject.txt")), untouched(join(root, "draft.txt"))];
    const run = probe(root, "subject.txt", "--mutate", "s|good|bad|", "--run", "touch ran");
    expect(run.out).toContain("the tree is not clean");
    expect(run.out).toContain("?? draft.txt");
    expect(run.code).toBe(2);
    expect(existsSync(join(root, "ran"))).toBe(false);
    for (const check of unwritten) check();
  });

  it("names a check that stays green with the mutation as one that does not see the file", () => {
    const root = repository();
    const run = probe(root, "subject.txt", "--mutate", "s|good|bad|", "--run", "true");
    expect(run.out).toContain("it does not see subject.txt");
    expect(run.code).toBe(1);
    expect(subject(root)).toBe("good\n");
  });

  it("stops the whole check and puts the file back when it is stopped while the check runs", () => {
    const root = repository();
    const check = "(sleep 1; echo late > late.txt) & kill -TERM $PPID; wait";
    const run = probe(root, "subject.txt", "--mutate", "s|good|bad|", "--run", check);
    expect(run.out).toContain("SIGTERM during the mutated run — subject.txt restored");
    expect(run.code).toBe(143);
    spawnSync("sleep", ["2"]);
    expect(existsSync(join(root, "late.txt"))).toBe(false);
    expect(subject(root)).toBe("good\n");
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("puts the file back when it is stopped in the run on the restored file", () => {
    const root = repository();
    const check =
      "if grep -q good subject.txt; then echo changed > subject.txt; kill -TERM $PPID; sleep 10; else exit 1; fi";
    const run = probe(root, "subject.txt", "--mutate", "s|good|bad|", "--run", check);
    expect(run.out).toContain("SIGTERM during the restored run — subject.txt restored");
    expect(run.code).toBe(143);
    expect(subject(root)).toBe("good\n");
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("names what the run on the restored file wrote, then puts the file back", () => {
    const root = repository();
    const check = "if grep -q good subject.txt; then echo changed > subject.txt; else exit 1; fi";
    const run = probe(root, "subject.txt", "--mutate", "s|good|bad|", "--run", check);
    expect(run.out).toContain("the command left the tree dirty");
    expect(run.out).toContain(" M subject.txt");
    expect(run.code).toBe(1);
    expect(subject(root)).toBe("good\n");
  });

  it("puts the file back when git status fails after the run on the restored file", () => {
    const root = repository();
    const check =
      "if grep -q good subject.txt; then echo changed > subject.txt; echo junk > .git/index; else exit 1; fi";
    const run = probe(root, "subject.txt", "--mutate", "s|good|bad|", "--run", check);
    expect(run.out).toContain("git status failed");
    expect(run.code).toBe(2);
    expect(subject(root)).toBe("good\n");
  });

  it("puts the file back when writing the mutation fails part way", () => {
    const root = repository();
    const mutate = `s|good|${"x".repeat(3000)}|`;
    // A 512-byte file-size limit cuts the write short: EFBIG after the file was truncated.
    const shell = `trap '' XFSZ; ulimit -f 1; exec bun ${quoted(SCRIPT)} subject.txt --mutate ${quoted(mutate)} --run 'touch ran'`;
    const run = spawnSync("sh", ["-c", shell], { cwd: root, encoding: "utf8" });
    expect(`${run.stdout}${run.stderr}`).toContain("EFBIG");
    expect(run.status).not.toBe(0);
    expect(existsSync(join(root, "ran"))).toBe(false);
    expect(subject(root)).toBe("good\n");
  });

  it("hands a test file to the default command as one argument, never through a shell", () => {
    const name = "odd$(touch pwned)`touch pwned`$HOME.test.ts";
    const root = repository(name);
    writeFileSync(join(root, "package.json"), '{ "scripts": { "test": "grep -q good" } }\n');
    git(root, "add", ".");
    git(root, "-c", "user.email=f@example.com", "-c", "user.name=f", "commit", "-qm", "test");
    const run = probe(root, name, "--mutate", "s|good|bad|");
    expect(run.out).toContain(`· bun run test -- ${name}`);
    expect(run.out).toContain("restored → exit 0");
    expect(run.code).toBe(0);
    expect(existsSync(join(root, "pwned"))).toBe(false);
    expect(readFileSync(join(root, name), "utf8")).toBe("good\n");
  });
});
