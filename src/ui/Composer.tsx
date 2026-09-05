import { useEffect, useRef } from "react";
import { composerLabel } from "./anchor.ts";
import { useStore } from "./store.ts";
import { SEVERITIES } from "./types.ts";

/**
 * The comment form of handoff section 2: a strip across the whole width of the
 * diff that stays put while the card is scrolled sideways, the anchor it is
 * being written for, the four severity chips, the field, and the two buttons.
 * `⌘⏎` sends and `esc` closes.
 *
 * The `AUTO` chip and the suggestions from history belong to the same strip and
 * arrive with the model (DA-36); until then the severity is the reviewer's own
 * and `warning` is what the form proposes (`docs/SPEC.md` section 5).
 */
export function Composer() {
  const target = useStore((store) => store.composer);
  const endLine = useStore((store) => store.composerEnd);
  const sev = useStore((store) => store.sev);
  const body = useStore((store) => store.body);
  const sending = useStore((store) => store.sending);
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
          <span className="spacer" />
          <span className="composer-note">severity задан вручную</span>
        </div>

        <textarea
          ref={field}
          className="composer-field"
          value={body}
          placeholder="Что не так с этими строками?"
          aria-label="comment"
          onChange={(event) => setBody(event.target.value)}
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
      </div>
    </form>
  );
}
