import { useEffect } from "react";
import type { ScannedRepository } from "../store.ts";
import { useStore } from "../store.ts";
import type { BaseMode } from "../types.ts";
import { Logo } from "./Logo.tsx";

/**
 * The first-run screen of handoff section 10: what a root shows when no review
 * session has ever been made in it. `GET /api/review` refuses such a root with
 * `no-current-session`, and this is what that refusal means to a person
 * ([07-server.md](../../../docs/reference/07-server.md)).
 *
 * The three metrics come from `GET /api/scan`, the one route that reads git per
 * request: without a session there is no change set to answer them from.
 */
export function FirstRun() {
  const scan = useStore((store) => store.scan);
  const name = useStore((store) => store.newName);
  const switching = useStore((store) => store.switching);
  const setNewName = useStore((store) => store.setNewName);
  const create = useStore((store) => store.createSession);
  const loadScan = useStore((store) => store.loadScan);

  // The screen can also be reached by a session being deleted under an open
  // page, in which case the scan behind it was never asked for.
  useEffect(() => {
    if (scan === null) void loadScan();
  }, [scan, loadScan]);

  // `null`, not an empty list: nothing has been counted until the scan answers,
  // and a zero is a claim where a dash is the truth.
  const repositories = scan?.repositories ?? null;

  return (
    <main className="first-run">
      <div className="first-run-panel">
        <Logo size={34} />
        <h1 className="first-run-title">Ни одной сессии review</h1>
        <p className="first-run-note">
          diffalanche читает изменения всех репозиториев под этой папкой как одно ревью. Сессия —
          это имя, база и комментарии; создайте первую, чтобы открыть ревью.
        </p>

        <div className="metrics">
          <Metric value={count(repositories, () => true)} label="репозиториев найдено" />
          <Metric value={count(repositories, (one) => one.hasChanges)} label="с изменениями" />
          <Metric value={count(repositories, (one) => one.kind === "worktree")} label="worktree" />
        </div>

        <form
          className="first-run-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <input
            className="first-run-name"
            value={name}
            aria-label="session name"
            placeholder="ls-240588"
            onChange={(event) => setNewName(event.target.value)}
          />
          <BaseDraft />
          <button type="submit" className="primary" disabled={switching || name.trim() === ""}>
            Create
          </button>
        </form>

        <p className="first-run-cli">
          то же из терминала:{" "}
          <code>diffalanche review new {name.trim() || "ls-240588"} --base branch</code>
        </p>
      </div>
    </main>
  );
}

/**
 * The base of the session about to be made. The handoff's screen has a `BASE`
 * button opening the picker of section 5, and the picker cannot serve this
 * screen: it applies a base to a session, and there is none yet. So the modes
 * are here, and what they write is `newBase` — the same field the sessions
 * menu's own form writes and `createSession` reads, in the grammar the CLI and
 * the server share.
 */
function BaseDraft() {
  const base = useStore((store) => store.newBase);
  const setBase = useStore((store) => store.setNewBase);
  const mode = modeOf(base);

  return (
    <span className="base-draft">
      <span className="tag">BASE</span>
      <span className="segments">
        {(["head", "branch", "ref"] as BaseMode[]).map((one) => (
          <button
            key={one}
            type="button"
            className={mode === one ? "segment on" : "segment"}
            aria-pressed={mode === one}
            onClick={() => setBase(one === "head" ? "head" : one === "branch" ? "branch" : "")}
          >
            {one}
          </button>
        ))}
      </span>
      {mode === "head" ? null : (
        <input
          className="base-draft-field"
          value={mode === "branch" ? base.slice("branch".length).replace(/^:/, "") : base}
          aria-label={mode === "branch" ? "branch" : "ref"}
          placeholder={
            mode === "branch" ? "default branch" : "v0.3.1 · 4f21ac9 · origin/release/2026.9"
          }
          onChange={(event) =>
            setBase(
              mode === "branch"
                ? event.target.value.trim() === ""
                  ? "branch"
                  : `branch:${event.target.value}`
                : event.target.value,
            )
          }
        />
      )}
    </span>
  );
}

/** Which of the three modes a base argument is written in ([base.ts](../base.ts)). */
function modeOf(base: string): BaseMode {
  if (base === "head") return "head";
  return base === "branch" || base.startsWith("branch:") ? "branch" : "ref";
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="metric">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}

/** A dash rather than a zero while the scan has not answered: nothing is claimed. */
function count(
  repositories: ScannedRepository[] | null,
  keep: (one: ScannedRepository) => boolean,
): string {
  if (repositories === null) return "—";
  return String(repositories.filter(keep).length);
}
