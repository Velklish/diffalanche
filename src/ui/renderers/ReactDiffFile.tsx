import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  computeNewLineNumber,
  Diff,
  getChangeKey,
  Hunk,
  parseDiff,
  tokenize,
} from "react-diff-view";
import "react-diff-view/style/index.css";
import { refractor } from "refractor/core";
import csharp from "refractor/csharp";
import go from "refractor/go";
import javascript from "refractor/javascript";
import json from "refractor/json";
import jsx from "refractor/jsx";
import markdown from "refractor/markdown";
import python from "refractor/python";
import tsx from "refractor/tsx";
import typescript from "refractor/typescript";
import { Composer } from "../Composer.tsx";
import type { FileRendererProps } from "./GitDiffFile.tsx";

/**
 * The core of refractor plus the nine grammars below: the root export of the
 * package registers every Prism language and puts them all in the bundle.
 * Each grammar registers the ones it builds on, so `tsx` brings `jsx` and
 * `typescript` with it.
 */
for (const language of [csharp, go, javascript, json, jsx, markdown, python, tsx, typescript]) {
  refractor.register(language);
}

/** The languages the synthetic review and the reviewed repositories are written in. */
const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  cs: "csharp",
  py: "python",
  go: "go",
  md: "markdown",
  json: "json",
};

/**
 * `react-diff-view` was written against refractor 3, whose `highlight` returned
 * the array of nodes; refractor 5 returns a hast root. The shim keeps the
 * current refractor without pinning the library to an old major.
 */
const highlighter = {
  highlight: (value: string, language: string) => refractor.highlight(value, language).children,
} as unknown as { highlight: typeof refractor.highlight };

export function ReactDiffFile({ file, composerLine, highlight }: FileRendererProps) {
  const parsed = useMemo(() => parseDiff(file.patch)[0] ?? null, [file]);

  const tokens = useMemo(() => {
    if (!highlight || !parsed) return null;
    const language = LANGUAGES[file.path.split(".").pop() ?? ""];
    if (!language || !refractor.registered(language)) return null;
    return tokenize(parsed.hunks, { highlight: true, refractor: highlighter, language });
  }, [highlight, parsed, file.path]);

  if (!parsed) return null;

  const widgets: Record<string, ReactNode> = {};
  if (composerLine !== null) {
    for (const hunk of parsed.hunks) {
      for (const change of hunk.changes) {
        if (computeNewLineNumber(change) === composerLine) {
          widgets[getChangeKey(change)] = <Composer label={`${file.path} L${composerLine}`} />;
        }
      }
    }
  }

  return (
    <Diff
      viewType="split"
      diffType={parsed.type}
      hunks={parsed.hunks}
      widgets={widgets}
      {...(tokens ? { tokens } : {})}
    >
      {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
    </Diff>
  );
}
