/**
 * `GET /api/repos/branches`: every branch the base picker may choose from,
 * summarised over the whole root (`docs/design/HANDOFF.md` section 5). A base
 * is one spec per session applied to every repository separately, so what the
 * picker needs is not one repository's branches but the union of them, with how
 * many repositories carry each.
 *
 * Read-only, and git through the binary, like everything else that touches a
 * reviewed repository (`docs/SPEC.md` section 11).
 */
import type { Config } from "../../core/config/index.ts";
import { gitOrNull } from "../../core/git/run.ts";
import { scan } from "../../core/index.ts";
import { byCodePoint } from "../../core/order.ts";
import type { ScanWarning } from "../../core/types.ts";

/** One branch as the picker lists it. `name` is what `branch:<name>` takes. */
export type BranchCandidate = {
  /** `origin/main` for a branch of a remote, `main` for a local one. */
  name: string;
  /** The remote it belongs to, or `null` when the branch is local. */
  remote: string | null;
  /** In how many repositories of the root this branch resolves. */
  repositories: number;
  /** Whether some repository's remote points its `HEAD` at it. */
  default: boolean;
};

export type BranchList = {
  root: string;
  branches: BranchCandidate[];
  /** Repositories whose refs could not be read; they are named, not hidden. */
  warnings: ScanWarning[];
};

/**
 * One call per repository. The full ref name is what tells a local branch from
 * a remote one — `refname:short` shortens `refs/heads/feature/x` and
 * `refs/remotes/origin/main` into names that look alike — and
 * `%(symref:short)` is what tells `origin/HEAD` from a branch: only a symbolic
 * ref has one, and its target is the remote's default branch. The pointer
 * itself is not a branch and is not listed.
 */
const FORMAT = "%(refname)\t%(refname:short)\t%(symref:short)";

const HEADS = "refs/heads/";
const REMOTES = "refs/remotes/";

export async function listBranches(config: Config): Promise<BranchList> {
  const found = await scan(config.root, {
    roots: config.roots,
    depth: config.depth,
    exclude: config.exclude,
  });
  const warnings = [...found.warnings];

  /** By branch name, because the same branch in ten repositories is one row. */
  const candidates = new Map<string, BranchCandidate>();

  for (const repository of found.repositories) {
    const refs = await gitOrNull(repository.absolutePath, [
      "for-each-ref",
      `--format=${FORMAT}`,
      "refs/heads",
      "refs/remotes",
    ]);
    if (refs === null) {
      warnings.push({ path: repository.path, message: "branches could not be read" });
      continue;
    }
    add(candidates, refs);
  }

  return { root: config.root, branches: [...candidates.values()].sort(byPreference), warnings };
}

/** The refs of one repository, folded into the candidates of the whole root. */
function add(candidates: Map<string, BranchCandidate>, refs: string): void {
  const defaults = new Set<string>();
  const branches: { name: string; remote: string | null }[] = [];

  for (const row of refs.split("\n")) {
    if (row === "") continue;
    const [ref = "", name = "", target = ""] = row.split("\t");
    if (target !== "") {
      // A symbolic ref: `origin/HEAD` naming the remote's default branch.
      defaults.add(target);
      continue;
    }
    if (name === "") continue;
    if (ref.startsWith(HEADS)) branches.push({ name, remote: null });
    else if (ref.startsWith(REMOTES)) {
      const remote = ref.slice(REMOTES.length).split("/")[0] ?? "";
      if (remote !== "") branches.push({ name, remote });
    }
  }

  for (const branch of branches) {
    const held = candidates.get(branch.name);
    if (held === undefined) {
      candidates.set(branch.name, {
        ...branch,
        repositories: 1,
        default: defaults.has(branch.name),
      });
      continue;
    }
    held.repositories += 1;
    held.default = held.default || defaults.has(branch.name);
  }
}

/**
 * Default branches first, then the ones most repositories have, then by name.
 * The order has to be the same under Node and under Bun, so it is code points
 * and not the locale's collation.
 */
function byPreference(left: BranchCandidate, right: BranchCandidate): number {
  if (left.default !== right.default) return left.default ? -1 : 1;
  if (left.repositories !== right.repositories) return right.repositories - left.repositories;
  return byCodePoint(left.name, right.name);
}
