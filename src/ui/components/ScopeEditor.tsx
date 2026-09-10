import type { Mark } from "../scope.ts";
import { countDraft, draftToScope, pathPicked, repoMark, scopeLabel } from "../scope.ts";
import type { ScopeConfirm } from "../store.ts";
import { useStore } from "../store.ts";
import type { CandidateRepository } from "../types.ts";
import { Overlay } from "./Overlay.tsx";

/**
 * The scope editor of handoff section 12: an overlay over the **whole root**,
 * with a tick per repository and per file and the count of what is picked.
 *
 * It is the one surface of the product that shows what the task is not about,
 * and that is the whole reason it exists as an overlay rather than as a mode of
 * the tree: a scope cannot be widened from a tree that already hides what is
 * missing ([ADR-010](../../../docs/adr/adr-010-review-task-scope.md), decision
 * 2). It is opened from the `SCOPE` pill, by hand, and closes again.
 */
export function ScopeEditor() {
  const status = useStore((store) => store.candidatesStatus);
  const candidates = useStore((store) => store.candidates);
  const draft = useStore((store) => store.scopeDraft);
  const applying = useStore((store) => store.applying);
  const openScope = useStore((store) => store.openScope);
  const applyScope = useStore((store) => store.applyScope);

  const counted = countDraft(draft);

  return (
    <Overlay width={640} className="scope" label="состав задачи" onClose={() => openScope(false)}>
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
        // `mixed` is what ARIA has for a repository some of whose files are
        // picked: without it the row would say "not picked" while the tick
        // says otherwise, and the tick is `aria-hidden` on purpose.
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

/**
 * The tick of a row, here and in select mode. The partial mark is a repository
 * some of whose files are picked — a state the on-disk scope has no entry for,
 * which is why it is drawn here and never written. The state itself is on the
 * row, in `aria-pressed`, so the glyph is for the eye.
 */
export function Tick({ mark }: { mark: Mark }) {
  return (
    <span className={`tick ${mark}`} aria-hidden="true">
      {mark === "on" ? "✓" : mark === "partial" ? "◆" : ""}
    </span>
  );
}

/**
 * The one question in the product that stands in front of destroyed review
 * data: a scope edit that removes an entry deletes the comments anchored under
 * it, and the count comes from the server's own refusal — a 409 that wrote
 * nothing (ADR-010, decision 6). Cancelling writes nothing either: the refusal
 * already left `comments.json` where it was.
 */
export function ScopeConfirmation({ confirm }: { confirm: ScopeConfirm }) {
  const applying = useStore((store) => store.applying);
  const cancel = useStore((store) => store.cancelScopeConfirm);
  const applyScope = useStore((store) => store.applyScope);

  return (
    // The dialog's name is the question itself: a confirmation is read out by
    // what it asks, and a screen reader entering it should hear the file and
    // the count rather than a category.
    <Overlay width={460} className="confirm" label={confirm.question} onClose={cancel}>
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

/**
 * `New task…` of select mode: the name and the base of the task being made out
 * of what the tree has picked. It is written with `use: false` — the UI never
 * moves `current` — and this window opens what it made (ADR-010, decisions 4
 * and 7).
 */
export function NewTaskForm() {
  const name = useStore((store) => store.newName);
  const base = useStore((store) => store.newBase);
  const switching = useStore((store) => store.switching);
  const draft = useStore((store) => store.selectDraft);
  const openNewTask = useStore((store) => store.openNewTask);

  const counted = countDraft(draft);

  return (
    <Overlay width={420} label="новая задача" onClose={() => openNewTask(false)}>
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
            // The form is opened by a press, so the field the reader came for
            // is where the ring goes.
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
