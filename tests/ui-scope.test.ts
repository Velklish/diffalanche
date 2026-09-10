import { describe, expect, it } from "vitest";
import { assertScope } from "../src/core/domain/scope.ts";
import type { Scope } from "../src/core/storage/types.ts";
import {
  confirmQuestion,
  countScope,
  draftFromScope,
  draftToScope,
  isEmptyDraft,
  pathPicked,
  removedFrom,
  repoMark,
  scopeLabel,
  togglePath,
  toggleRepo,
} from "../src/ui/scope.ts";

/**
 * The scope as the screen holds it (DA-55): the draft the editor and select
 * mode pick into, the count the `SCOPE` pill prints, and the sentence the one
 * destructive confirmation of the product asks.
 *
 * What the draft becomes is checked against the domain's own `assertScope`,
 * the check the server runs before it writes: a picker that could build a scope
 * the format refuses would be a picker whose `Apply` fails at random.
 */

const REPO = "repos/core/cargos-api";
const OTHER = "repos/platform/loads-search";
const FILES = ["app/a.py", "app/b.py", "docs/c.md"];
/** The repositories a scan found, as `assertScope` takes them. */
const FOUND = [REPO, OTHER];

describe("the draft a scope opens on", () => {
  it("is the entries of the scope, a whole repository and a list of paths alike", () => {
    const scope: Scope = [
      { repo: REPO, paths: ["app/a.py"] },
      { repo: OTHER, paths: null },
    ];
    expect(draftFromScope(scope)).toEqual({ [REPO]: ["app/a.py"], [OTHER]: "all" });
  });

  it("is empty for a session with no scope: nothing is narrowed yet", () => {
    expect(isEmptyDraft(draftFromScope(null))).toBe(true);
  });

  it("does not share the scope's own arrays: a pick may not edit what is on disk", () => {
    const paths = ["app/a.py"];
    const draft = draftFromScope([{ repo: REPO, paths }]);
    togglePath(draft, REPO, "app/b.py", FILES);
    expect(paths).toEqual(["app/a.py"]);
  });
});

describe("the ticks", () => {
  it("marks a repository whose files are all picked one by one as picked whole", () => {
    let draft = {};
    for (const file of FILES) draft = togglePath(draft, REPO, file, FILES);
    expect(repoMark(draft, REPO, FILES)).toBe("on");
    // What is written is still the list the reader built, not `paths: null`.
    expect(draftToScope(draft)).toEqual([{ repo: REPO, paths: [...FILES].sort() }]);
  });

  it("marks a repository with some of its files picked as partial", () => {
    const draft = togglePath({}, REPO, "app/a.py", FILES);
    expect(repoMark(draft, REPO, FILES)).toBe("partial");
  });

  it("marks a repository nothing of which is picked as off", () => {
    expect(repoMark({}, REPO, FILES)).toBe("off");
  });

  it("takes the whole repository, and gives it back, on one press of its row", () => {
    const on = toggleRepo({}, REPO, FILES);
    expect(on[REPO]).toBe("all");
    expect(FILES.every((file) => pathPicked(on, REPO, file))).toBe(true);
    expect(toggleRepo(on, REPO, FILES)).toEqual({});
  });

  it("turns a whole repository into the files it keeps when one of them is unpicked", () => {
    // "Everything but that file" is not an entry the format has, so the entry
    // says what it keeps ([ADR-010](../docs/adr/adr-010-review-task-scope.md)).
    const draft = togglePath(toggleRepo({}, REPO, FILES), REPO, "app/b.py", FILES);
    expect(draft[REPO]).toEqual(["app/a.py", "docs/c.md"]);
    expect(repoMark(draft, REPO, FILES)).toBe("partial");
  });

  it("drops a repository whose last file was unpicked: an empty entry is refused", () => {
    const one = togglePath({}, REPO, "app/a.py", FILES);
    expect(togglePath(one, REPO, "app/a.py", FILES)).toEqual({});
  });
});

describe("the scope the editor writes", () => {
  it("is the same list whatever order the picks were made in", () => {
    const first = togglePath(toggleRepo({}, OTHER, FILES), REPO, "docs/c.md", FILES);
    const second = toggleRepo(togglePath({}, REPO, "docs/c.md", FILES), OTHER, FILES);
    expect(draftToScope(first)).toEqual(draftToScope(second));
  });

  it("is one the domain accepts", () => {
    const draft = togglePath(toggleRepo({}, OTHER, FILES), REPO, "app/a.py", FILES);
    expect(() => {
      assertScope(draftToScope(draft), FOUND);
    }).not.toThrow();
  });

  it("is null when nothing is picked, which the editor never applies", () => {
    expect(draftToScope({})).toBeNull();
  });
});

describe("what the SCOPE pill counts", () => {
  it("counts an entry as a repository and the paths it names as files", () => {
    const scope: Scope = [
      { repo: REPO, paths: ["app/a.py", "app/b.py"] },
      { repo: OTHER, paths: ["x.ts", "y.ts", "z.ts"] },
    ];
    expect(countScope(scope)).toEqual({ repos: 2, files: 5 });
    expect(scopeLabel(countScope(scope))).toBe("2 repos · 5 files");
  });

  it("counts no files for a repository the task holds whole", () => {
    expect(scopeLabel(countScope([{ repo: REPO, paths: null }]))).toBe("1 repo");
  });

  it("counts nothing at all for a session with no scope, which has no pill", () => {
    expect(countScope(null)).toEqual({ repos: 0, files: 0 });
  });

  it("says one file in the singular", () => {
    expect(scopeLabel(countScope([{ repo: REPO, paths: ["app/a.py"] }]))).toBe("1 repo · 1 file");
  });
});

describe("what a scope edit takes out of the task", () => {
  const before: Scope = [
    { repo: REPO, paths: ["app/a.py", "app/b.py"] },
    { repo: OTHER, paths: null },
  ];

  it("names a repository the new scope has not", () => {
    expect(removedFrom(before, [{ repo: REPO, paths: ["app/a.py", "app/b.py"] }])).toEqual([OTHER]);
  });

  it("names a path the entry no longer holds, by its full name", () => {
    const after: Scope = [
      { repo: REPO, paths: ["app/a.py"] },
      { repo: OTHER, paths: null },
    ];
    expect(removedFrom(before, after)).toEqual([`${REPO}/app/b.py`]);
  });

  it("names the repository when one held whole starts naming paths", () => {
    const after: Scope = [
      { repo: REPO, paths: ["app/a.py", "app/b.py"] },
      { repo: OTHER, paths: ["x.ts"] },
    ];
    expect(removedFrom(before, after)).toEqual([OTHER]);
  });

  it("names nothing when the edit only widens", () => {
    const after: Scope = [
      { repo: REPO, paths: null },
      { repo: OTHER, paths: null },
    ];
    expect(removedFrom(before, after)).toEqual([]);
  });

  it("names nothing when the task was about the whole root: it had no entries", () => {
    expect(removedFrom(null, [{ repo: REPO, paths: null }])).toEqual([]);
  });
});

describe("the question asked before comments are deleted", () => {
  it("names what is going, how many comments there are, and how many are open", () => {
    // The name is the one `removedFrom` produces — the path with its repository
    // in front of it — because two files of the same name in two repositories
    // would otherwise be the same sentence.
    const [removed] = removedFrom(
      [{ repo: OTHER, paths: ["src/Tariffs/TariffService.cs", "x.ts"] }],
      [{ repo: OTHER, paths: ["x.ts"] }],
    );
    expect(confirmQuestion([removed as string], 3, 1)).toBe(
      `Убрать ${OTHER}/src/Tariffs/TariffService.cs и удалить 3 комментария (1 открыт)?`,
    );
  });

  it("inflects one comment", () => {
    expect(confirmQuestion([REPO], 1, 1)).toBe(
      `Убрать ${REPO} и удалить 1 комментарий (1 открыт)?`,
    );
  });

  it("inflects the teens, which do not follow their last digit", () => {
    expect(confirmQuestion([REPO], 11, 0)).toContain("11 комментариев");
  });

  it("counts the names it does not spell out", () => {
    expect(confirmQuestion(["a", "b", "c", "d"], 2, 0)).toContain("a, b и ещё 2");
  });
});
