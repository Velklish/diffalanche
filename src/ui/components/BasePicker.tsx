import { baseArgument } from "../base.ts";
import { useStore } from "../store.ts";
import type { BaseMode, BranchCandidate } from "../types.ts";
import { Overlay } from "./Overlay.tsx";

/**
 * The base picker of handoff section 5: three modes, the branch candidates of
 * the whole root under the one that needs them, a free field under the other,
 * and a footer that says what will be applied. A base is one spec per session,
 * resolved in every repository separately (`docs/SPEC.md` section 3, decision
 * 4), which is why the candidates are counted across repositories rather than
 * listed per repository.
 */
const MODES: { mode: BaseMode; title: string; about: string }[] = [
  { mode: "head", title: "head", about: "рабочее дерево против HEAD" },
  { mode: "branch", title: "branch", about: "merge-base с выбранной веткой" },
  { mode: "ref", title: "ref", about: "тег, коммит или ветка целиком" },
];

export function BasePicker() {
  const mode = useStore((store) => store.baseMode);
  const name = useStore((store) => store.baseName);
  const refText = useStore((store) => store.refText);
  const switching = useStore((store) => store.switching);
  const openBase = useStore((store) => store.openBase);
  const setBaseMode = useStore((store) => store.setBaseMode);
  const applyBase = useStore((store) => store.applyBase);

  const argument = baseArgument(mode, name, refText);

  return (
    <Overlay width={460} label="base" onClose={() => openBase(false)}>
      <form
        className="picker"
        onSubmit={(event) => {
          event.preventDefault();
          void applyBase();
        }}
      >
        {MODES.map((one) => (
          <div key={one.mode} className={one.mode === mode ? "picker-mode on" : "picker-mode"}>
            <button type="button" className="picker-head" onClick={() => setBaseMode(one.mode)}>
              <span className="picker-check">{one.mode === mode ? "✓" : ""}</span>
              <span className="picker-title">{one.title}</span>
              <span className="picker-about">{one.about}</span>
            </button>
            {one.mode === mode && mode === "branch" ? <Candidates /> : null}
            {one.mode === mode && mode === "ref" ? (
              <input
                className="picker-ref"
                value={refText}
                placeholder="v0.3.1 · 4f21ac9 · origin/release/2026.9"
                aria-label="ref"
                onChange={(event) => useStore.getState().setRefText(event.target.value)}
              />
            ) : null}
          </div>
        ))}

        <div className="picker-foot">
          <span className="picker-summary">{argument ?? "—"}</span>
          <span className="spacer" />
          <span className="hint">
            <span className="key">⏎</span>применить
          </span>
          <button type="submit" className="primary" disabled={switching || argument === null}>
            Apply
          </button>
        </div>
      </form>
    </Overlay>
  );
}

/**
 * The branches of every repository under the root, folded into one list. An
 * empty one is not a mistake: a root of repositories that were never cloned has
 * no remote and no branch but its own.
 */
function Candidates() {
  const branches = useStore((store) => store.branches);
  const status = useStore((store) => store.branchesStatus);
  const chosen = useStore((store) => store.baseName);

  if (status === "loading") return <p className="picker-note">…</p>;
  if (status === "failed") return <p className="picker-note">Ветки не прочитались.</p>;
  if (branches.length === 0) return <p className="picker-note">Веток, кроме текущей, нет.</p>;

  return (
    <div className="picker-list">
      <button
        type="button"
        className={chosen === "" ? "picker-branch on" : "picker-branch"}
        onClick={() => useStore.getState().setBaseName("")}
      >
        <span className="picker-source">—</span>
        <span className="picker-name">default branch</span>
        <span className="picker-note-inline">та, на которую смотрит remote</span>
      </button>
      {branches.map((branch) => (
        <Branch key={branch.name} branch={branch} on={branch.name === chosen} />
      ))}
    </div>
  );
}

function Branch({ branch, on }: { branch: BranchCandidate; on: boolean }) {
  return (
    <button
      type="button"
      className={on ? "picker-branch on" : "picker-branch"}
      onClick={() => useStore.getState().setBaseName(branch.name)}
    >
      <span className="picker-source">{branch.remote ?? "local"}</span>
      <span className="picker-name">{branch.name}</span>
      <span className="picker-note-inline">
        {branch.default ? "default branch · " : ""}
        {branch.repositories} repos
      </span>
    </button>
  );
}
