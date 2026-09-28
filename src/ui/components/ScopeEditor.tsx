import type { Mark } from "../scope.ts";
import { countDraft, draftToScope, pathPicked, repoMark, scopeLabel } from "../scope.ts";
import type { ScopeConfirm } from "../store.ts";
import { useStore } from "../store.ts";
import type { CandidateRepository } from "../types.ts";
import { Overlay } from "./Overlay.tsx";

/** The scope editor of handoff section 12, an overlay over the whole root: a scope cannot be
 * widened from a tree that hides what is missing (08-ui.md, "The scope editor"). */
export function ScopeEditor() {
  const status = useStore((store) => store.candidatesStatus);
  const candidates = useStore((store) => store.candidates);
  const draft = useStore((store) => store.scopeDraft);
  const applying = useStore((store) => store.applying);
  const openScope = useStore((store) => store.openScope);
  const applyScope = useStore((store) => store.applyScope);

  const counted = countDraft(draft);

  return (
    <Overlay
      width={640}
      className="scope"
      label="состав задачи"
      ladder="scope"
      onClose={() => openScope(false)}
    >
      <form
        className="scope-form"
        onSubmit={(event) => {
          event.preventDefault();
          void applyScope();
        }}
      >
        <div className="scope-head">
          <span className="tag">SCOPE</span>
          <span className="scope-about">весь корень — отметьте, о чём эта задача</span>
        </div>

        <div className="scope-body">
          {status === "loading" ? <p className="picker-note">…</p> : null}
          {status === "failed" ? (
            <p className="picker-note">Изменения корня не прочитались.</p>
          ) : null}
          {status === "ready" && candidates.length === 0 ? (
            <p className="picker-note">Под корнем нет изменений, из которых собирается задача.</p>
          ) : null}
          {candidates.map((repository) => (
            <Candidate key={repository.path} repository={repository} />
          ))}
        </div>

        <div className="picker-foot">
          <span className="picker-summary">{scopeLabel(counted)}</span>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={() => openScope(false)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={applying || counted.repos === 0}>
            Apply
          </button>
        </div>
      </form>
    </Overlay>
  );
}

/** One repository of the whole root, with the files that changed in it. */
function Candidate({ repository }: { repository: CandidateRepository }) {
  const draft = useStore((store) => store.scopeDraft);
  const pickRepo = useStore((store) => store.pickScopeRepo);
  const pickPath = useStore((store) => store.pickScopePath);
  const files = repository.files.map((file) => file.path);
  const mark = repoMark(draft, repository.path, files);

  return (
    <div className="scope-repo">
      <button
        type="button"
        className="scope-row"
        // Some files picked is `mixed`: the tick is `aria-hidden`, so the row carries the state
        // (08-ui.md, "Select mode").
        aria-pressed={mark === "partial" ? "mixed" : mark === "on"}
        onClick={() => pickRepo(repository.path, files)}
      >
        <Tick mark={mark} />
        <span className="repo-name">{repository.path}</span>
        <span className="spacer" />
        <span className="repo-files">· {repository.files.length} files</span>
      </button>
      {repository.files.map((file) => {
        const picked = pathPicked(draft, repository.path, file.path);
        return (
          <button
            key={file.path}
            type="button"
            className="scope-row scope-file"
            aria-pressed={picked}
            onClick={() => pickPath(repository.path, file.path, files)}
          >
            <Tick mark={picked ? "on" : "off"} />
            <span className="file-name">{file.path}</span>
            <span className="spacer" />
            <span className="add">+{file.additions}</span>
            <span className="del">−{file.deletions}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The tick of a row, here and in select mode; the partial mark is drawn and never written, and
 * the state itself is the row's `aria-pressed` (08-ui.md, "The scope editor"). */
export function Tick({ mark }: { mark: Mark }) {
  return (
    <span className={`tick ${mark}`} aria-hidden="true">
      {mark === "on" ? "✓" : mark === "partial" ? "◆" : ""}
    </span>
  );
}

/** The one question in front of destroyed review data, counted from the server's 409 that wrote
 * nothing (ADR-010, decision 6; 08-ui.md, "The confirmation"). */
export function ScopeConfirmation({ confirm }: { confirm: ScopeConfirm }) {
  const applying = useStore((store) => store.applying);
  const cancel = useStore((store) => store.cancelScopeConfirm);
  const applyScope = useStore((store) => store.applyScope);

  return (
    // Named by the question itself, so a screen reader hears the file and the count rather than
    // a category.
    <Overlay
      width={460}
      className="confirm"
      label={confirm.question}
      ladder="scope"
      onClose={cancel}
    >
      <p className="confirm-question">{confirm.question}</p>
      <p className="confirm-note">
        Комментарии удаляются вместе с записью состава. Отмена не пишет ничего.
      </p>
      <div className="picker-foot">
        <span className="spacer" />
        <button type="button" className="ghost" onClick={cancel}>
          Отмена
        </button>
        <button
          type="button"
          className="primary danger"
          disabled={applying}
          onClick={() => void applyScope(true)}
        >
          Убрать и удалить
        </button>
      </div>
    </Overlay>
  );
}

/** `New task…` of select mode, created with `use: false` and opened in this window (ADR-010,
 * decisions 4 and 7; 08-ui.md, "The task this window is on"). */
export function NewTaskForm() {
  const name = useStore((store) => store.newName);
  const base = useStore((store) => store.newBase);
  const switching = useStore((store) => store.switching);
  const draft = useStore((store) => store.selectDraft);
  const openNewTask = useStore((store) => store.openNewTask);

  const counted = countDraft(draft);

  return (
    <Overlay width={420} label="новая задача" ladder="scope" onClose={() => openNewTask(false)}>
      <form
        className="picker"
        onSubmit={(event) => {
          event.preventDefault();
          void useStore.getState().createSession(draftToScope(useStore.getState().selectDraft));
        }}
      >
        <p className="confirm-note">Состав новой задачи: {scopeLabel(counted)}</p>
        <div className="menu-create">
          <input
            value={name}
            placeholder="ls-240588"
            aria-label="name"
            // The form is opened by a press, so the field the reader came for takes the ring.
            // biome-ignore lint/a11y/noAutofocus: the overlay exists for this field
            autoFocus
            onChange={(event) => useStore.getState().setNewName(event.target.value)}
          />
          <input
            className="menu-base"
            value={base}
            placeholder="head"
            aria-label="base"
            onChange={(event) => useStore.getState().setNewBase(event.target.value)}
          />
          <button
            type="submit"
            className="primary small"
            disabled={switching || name.trim() === ""}
          >
            Create
          </button>
        </div>
        {/* The grammar is the CLI's own, so one base is written one way everywhere. */}
        <div className="menu-hint">head · branch · branch:origin/develop · v0.3.1</div>
      </form>
    </Overlay>
  );
}
