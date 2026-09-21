import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { unexpected } from "../scripts/check-package.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("what the npm tarball carries out of dist/", () => {
  it("passes the bundle and the UI and refuses everything else", () => {
    expect(
      unexpected([
        "package.json",
        "README.md",
        "dist/cli.js",
        "dist/ui/index.html",
        "dist/ui/assets/index-abc.js",
        "skills/diffalanche-review/SKILL.md",
      ]),
    ).toEqual([]);
  });

  it("names the checksums manifest, the binaries, and anything else left in dist/", () => {
    expect(
      unexpected([
        "dist/cli.js",
        "dist/SHA256SUMS.txt",
        "dist/diffalanche-linux-x64",
        "dist/cli.js.map",
      ]),
    ).toEqual(["dist/SHA256SUMS.txt", "dist/diffalanche-linux-x64", "dist/cli.js.map"]);
  });
});

describe("the release workflow keeps dist/ what the npm channel ships", () => {
  const release = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");

  it("writes the checksums manifest outside dist/ and uploads it from there", () => {
    // The job publishes to npm from the same tree it built, with no rebuild in
    // between, so anything written into dist/ ships (DA-106).
    expect(release).toContain('manifest="$RUNNER_TEMP/SHA256SUMS.txt"');
    expect(release).toContain('"$RUNNER_TEMP/SHA256SUMS.txt" \\');
    expect(release).not.toContain("dist/SHA256SUMS.txt");
  });

  it("keeps the two checks the checksums step exists for", () => {
    expect(release).toContain('lines=$(wc -l < "$manifest" | tr -d " ")');
    expect(release).toContain('if [ "$lines" -ne 6 ]; then');
    // `-c` resolves the manifest's paths against the current directory, so the
    // re-read still has to happen from inside dist/.
    expect(release).toMatch(/cd dist\n(.*\n)*?\s*sha256sum -c "\$manifest"/);
  });
});
