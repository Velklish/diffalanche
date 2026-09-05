import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view-pure.css";
import type { FileChange } from "../../core/types.ts";
import { Composer } from "../Composer.tsx";

export type FileRendererProps = {
  file: FileChange;
  /** Line of the new side the composer placeholder sits under, or `null`. */
  composerLine: number | null;
  highlight: boolean;
};

export function GitDiffFile({ file, composerLine, highlight }: FileRendererProps) {
  const extend =
    composerLine === null
      ? {}
      : {
          extendData: { newFile: { [composerLine]: { data: file.path } } },
          renderExtendLine: () => <Composer label={`${file.path} L${composerLine}`} />,
        };
  return (
    <DiffView<string>
      data={{
        hunks: [file.patch],
        oldFile: { fileName: file.oldPath ?? file.path },
        newFile: { fileName: file.path },
      }}
      diffViewMode={DiffModeEnum.Split}
      diffViewTheme="dark"
      diffViewHighlight={highlight}
      diffViewWrap={false}
      {...extend}
    />
  );
}
