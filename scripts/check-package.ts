/**
 * What the npm tarball is allowed to carry out of `dist/`, checked against what
 * `npm pack` would actually pack (DA-106).
 *
 *   bun run check:package
 *
 * `files` in `package.json` says `dist` minus the binaries, so every future
 * by-product of a build or a release step lands in the tarball unless something
 * asks. This is that something.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

/** The npm channel is the bundle and the UI ([11-perf.md](../docs/reference/11-perf.md)). */
const ALLOWED = ["dist/cli.js"];
const ALLOWED_TREES = ["dist/ui/"];

/**
 * Entries of `dist/` the tarball must not carry: the six binaries, which are
 * release assets, and anything else a step left behind — a checksums manifest
 * listing files the tarball does not contain, above all.
 */
export function unexpected(files: string[]): string[] {
  return files.filter(
    (file) =>
      file.startsWith("dist/") &&
      !ALLOWED.includes(file) &&
      !ALLOWED_TREES.some((tree) => file.startsWith(tree)),
  );
}

/** What `npm pack --dry-run --json` says this tree would pack. */
function packed(cwd: string): string[] {
  const stdoutText = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const report = JSON.parse(stdoutText) as { files?: { path: string }[] }[];
  return (report[0]?.files ?? []).map((one) => one.path);
}

function isMain(): boolean {
  const entry = argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const root = resolve(fileURLToPath(import.meta.url), "../..");
  const files = packed(root);
  const strays = unexpected(files);
  if (strays.length > 0) {
    stderr.write(
      `check:package: the tarball carries ${strays.length} unexpected entr${strays.length === 1 ? "y" : "ies"} out of dist/:\n` +
        `${strays.map((file) => `  ${file}\n`).join("")}` +
        "Only dist/cli.js and dist/ui/ belong to the npm channel; everything else in dist/ is a release asset or a by-product.\n",
    );
    exit(1);
  }
  stdout.write(`check:package: ${files.length} files, nothing unexpected out of dist/\n`);
}
