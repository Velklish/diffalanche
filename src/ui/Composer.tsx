import type { KeyboardEvent } from "react";
import { useEffect, useRef } from "react";
import { composerLabel } from "./anchor.ts";
import type { SuggestPanel } from "./store.ts";
import { useStore } from "./store.ts";
import { autoSeverity, SUGGESTION_SLOTS } from "./suggest.ts";
import type { Suggestion } from "./types.ts";
import { SEVERITIES } from "./types.ts";

/** The comment form of handoff section 2, with its suggestions from history; what each part does
 * and why is [08-ui.md](../../docs/reference/08-ui.md), "Commenting". */
export function Composer() {
  const target = useStore((store) => store.composer);
  const endLine = useStore((store) => store.composerEnd);
  const sev = useStore((store) => store.sev);
  const body = useStore((store) => store.body);
  const sending = useStore((store) => store.sending);
  const modelAway = useStore((store) => store.modelAway);
  const suggest = useStore((store) => store.suggest);
  const said = useStore((store) => store.said);
  const setSeverity = useStore((store) => store.setSeverity);
  const setBody = useStore((store) => store.setBody);
  const submit = useStore((store) => store.submitComment);
  const close = useStore((store) => store.closeComposer);
  const field = useRef<HTMLTextAreaElement>(null);

  // The form is written in straight away: it opens because the reader has just
  // said where the finding is, and the next thing they do is type it.
  useEffect(() => {
    field.current?.focus();
  }, []);

  if (target === null) return null;

  return (
    <form
      className="composer"
      data-testid="composer"
      aria-label="new comment"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="composer-inner">
        <div className="composer-head">
          <span className="composer-anchor">{composerLabel(target, endLine)}</span>
          <span className="spacer" />
          <span className="key">esc</span>
        </div>

        <div className="composer-severity">
          {/* Out of reach, not gone, while the model is away: it comes back without a jump. */}
          <button
            type="button"
            className={sev === "auto" ? "sev-chip auto on" : "sev-chip auto"}
            aria-pressed={sev === "auto"}
            disabled={modelAway !== null}
            title={modelAway ?? undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setSeverity("auto")}
          >
            AUTO · {autoSeverity(suggest.answer).toUpperCase()}
          </button>
          {SEVERITIES.map((one) => (
            <button
              key={one}
              type="button"
              className={one === sev ? `sev-chip on ${one}` : "sev-chip"}
              aria-pressed={one === sev}
              // The press does not take the caret out of the field: the
              // severity is picked mid-sentence and typing goes on after it.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setSeverity(one)}
            >
              {one.toUpperCase()}
            </button>
          ))}
          <span className="composer-note">
            {sev === "auto"
              ? "модель разметит при отправке, агент подтвердит"
              : "severity задан вручную"}
          </span>
        </div>

        <textarea
          ref={field}
          className="composer-field"
          value={body}
          placeholder="Что не так с этими строками?"
          aria-label="comment"
          readOnly={sending}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onSuggestionKey}
        />

        <div className="composer-actions">
          <button type="submit" className="primary" disabled={sending || body.trim() === ""}>
            Comment
          </button>
          <button type="button" className="ghost" onClick={close}>
            Cancel
          </button>
          <span className="spacer" />
          <span className="composer-note">потяните по строкам — диапазон · ⌘⏎ отправить</span>
        </div>

        <Suggestions suggest={suggest} away={modelAway} />
        {/* A new node per saying, so the same words said again are spoken again (DA-36.1). */}
        <p className="visually-hidden" role="status">
          {said === null ? null : <span key={said.seq}>{said.text}</span>}
        </p>
      </div>
    </form>
  );
}

/** `↑` from the draft's first line and `↓` from its last choose a row; `TAB` takes only a row they
 * chose. Every other press stays the field's, and one mid-composition the input method's. */
function onSuggestionKey(event: KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
  if (event.nativeEvent.isComposing) return;
  const store = useStore.getState();
  const { value, selectionStart, selectionEnd } = event.currentTarget;
  if (event.key === "ArrowUp" && value.lastIndexOf("\n", selectionStart - 1) === -1) {
    if (store.moveSuggestion(-1)) event.preventDefault();
    return;
  }
  if (event.key === "ArrowDown" && value.indexOf("\n", selectionEnd) === -1) {
    if (store.moveSuggestion(1)) event.preventDefault();
    return;
  }
  if (event.key === "Tab" && store.sugIdx >= 0 && store.suggest.answer !== null) {
    event.preventDefault();
    store.acceptSuggestion(store.sugIdx);
  }
}

/** `FROM YOUR HISTORY`: five rows of fixed height from the start, blank or silhouettes until an
 * answer fills them, so typing never moves the diff under the form (The No-Jump Rule). */
function Suggestions({ suggest, away }: { suggest: SuggestPanel; away: string | null }) {
  const sugIdx = useStore((store) => store.sugIdx);
  const accept = useStore((store) => store.acceptSuggestion);
  const rows = suggest.answer?.suggestions ?? [];
  const note =
    suggest.failure ??
    (suggest.answer !== null && rows.length === 0
      ? "в истории пока нет комментариев"
      : suggest.answer === null && !suggest.asking
        ? (away ?? "похожие прошлые комментарии появятся, пока вы пишете")
        : null);
  const silhouettes = suggest.answer === null && suggest.failure === null && suggest.asking;
  // What a test waits out before it watches the card: the panel's own answer changes its DOM.
  const state = suggest.failure !== null ? "failed" : suggest.answer !== null ? "ready" : "idle";

  return (
    <section
      className="composer-suggest"
      aria-label="suggestions from your history"
      data-state={suggest.asking ? "asking" : state}
    >
      <div className="suggest-head">
        <span className="suggest-title">FROM YOUR HISTORY</span>
        <span className="suggest-count">
          {rows.length === 0 ? "" : `${sugIdx < 0 ? "–" : sugIdx + 1} / ${rows.length}`}
        </span>
        <span className="spacer" />
        <span className="suggest-hint">↑↓ выбрать · TAB принять</span>
      </div>
      <div className="suggest-rows">
        {Array.from({ length: SUGGESTION_SLOTS }, (_, index) => (
          <Slot
            // biome-ignore lint/suspicious/noArrayIndexKey: a slot is a place, not a row.
            key={index}
            row={rows[index]}
            on={index === sugIdx}
            note={index === 0 ? note : null}
            silhouette={silhouettes}
            onAccept={() => accept(index)}
          />
        ))}
      </div>
    </section>
  );
}

/** One of the five places: a row, the sentence that says why there are none, or an empty slot. */
function Slot({
  row,
  on,
  note,
  silhouette,
  onAccept,
}: {
  row: Suggestion | undefined;
  on: boolean;
  note: string | null;
  silhouette: boolean;
  onAccept: () => void;
}) {
  if (row !== undefined) return <SuggestionRow row={row} on={on} onAccept={onAccept} />;
  if (note !== null) return <p className="suggestion note">{note}</p>;
  return (
    <span
      className={silhouette ? "suggestion silhouette" : "suggestion blank"}
      aria-hidden="true"
    />
  );
}

function SuggestionRow({
  row,
  on,
  onAccept,
}: {
  row: Suggestion;
  on: boolean;
  onAccept: () => void;
}) {
  return (
    <button
      type="button"
      className={on ? "suggestion on" : "suggestion"}
      aria-current={on ? "true" : undefined}
      tabIndex={-1}
      // Taking a row leaves the caret in the field, the way a severity chip does.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onAccept}
    >
      <span className={`suggestion-sev ${row.severity}`}>{row.severity.toUpperCase()}</span>
      <span className="suggestion-body">{row.body.split("\n")[0]}</span>
      <span className="suggestion-meta">
        {row.session} · {row.similarity.toFixed(2)}
      </span>
      <span className={on ? "key on" : "key off"}>TAB</span>
    </button>
  );
}
