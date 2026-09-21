/** `bun run check:package`: what the npm tarball may carry out of `dist/`,
 * against what `npm pack` would pack (`docs/reference/11-perf.md`). */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

/** The npm channel is the bundle and the UI ([11-perf.md](../docs/reference/11-perf.md)). */
const ALLOWED = ["dist/cli.js"];
const ALLOWED_TREES = ["dist/ui/"];

/** Entries of `dist/` the tarball must not carry: the binaries, and whatever
 * else a build or a release step left behind. */
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
  // An unbuilt `dist/` has nothing to be unexpected in, and the check would
  // pass by having looked at nothing.
  if (!files.includes("dist/cli.js")) {
    stderr.write(
      "check:package: the tarball carries no dist/cli.js, so there is nothing to check. " +
        "Run `bun run build:cli && bun run build:ui` first.\n",
    );
    exit(1);
  }
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
