import type { KeyboardEvent } from "react";
import { useCallback, useMemo } from "react";
import { revealCard, revealThread } from "../reveal.ts";
import type { PreviewLine, SearchHit } from "../search.ts";
import { preview, search } from "../search.ts";
import { useStore } from "../store.ts";
import { Overlay } from "./Overlay.tsx";

/**
 * Global search of handoff section 6: 880 px by 60 vh over the scrim, the field
 * with the focus, the results on the left and a preview of the target on the
 * right. It covers what the MVP has — the files of the change set and the
 * comments of the session; symbols and the text of unchanged files are Phase 2
 * (`docs/SPEC.md` section 3, decision 13).
 */
export function GlobalSearch() {
  const open = useStore((store) => store.paletteOpen);
  return open ? <Palette /> : null;
}

function Palette() {
  const query = useStore((store) => store.paletteQuery);
  const index = useStore((store) => store.palIdx);
  const files = useStore((store) => store.files);
  const comments = useStore((store) => store.comments);
  const setQuery = useStore((store) => store.setPaletteQuery);
  const setIndex = useStore((store) => store.setPalIdx);
  const close = useStore((store) => store.setPalette);

  const hits = useMemo(() => search(query, files, comments), [query, files, comments]);
  const selected = hits[Math.min(index, hits.length - 1)] ?? null;

  const choose = useCallback(
    (hit: SearchHit) => {
      close(false);
      if (hit.kind === "comment") {
        void revealThread(hit.id);
        return;
      }
      useStore.getState().select(hit.repo, hit.path);
      void revealCard(`[data-file="${CSS.escape(hit.id)}"]`);
    },
    [close],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (hits.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((index + 1) % hits.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((index - 1 + hits.length) % hits.length);
      return;
    }
    if (event.key === "Enter" && selected !== null) {
      event.preventDefault();
      choose(selected);
    }
  };

  return (
    <Overlay width={880} className="palette" label="global search" onClose={() => close(false)}>
      <div className="palette-field">
        <span className="palette-glyph">⌕</span>
        <input
          type="text"
          value={query}
          // The modal opened because it was asked for, so this is where the
          // reader already is: a callback ref rather than `autoFocus`.
          ref={(element) => element?.focus()}
          aria-label="search"
          placeholder="файлы, символы, комментарии — во всех репозиториях"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <span className="key">↑↓ ⏎</span>
        <span className="key">esc</span>
      </div>
      <div className="palette-body">
        <ol className="palette-hits">
          {hits.length === 0 ? (
            <li className="palette-empty">
              {query.trim() === ""
                ? "Файлы и комментарии этого ревью."
                : `Ничего не найдено по «${query.trim()}».`}
            </li>
          ) : (
            hits.map((hit, at) => (
              <Row
                key={`${hit.kind}:${hit.id}`}
                hit={hit}
                on={hit === selected}
                select={() => setIndex(at)}
                choose={() => choose(hit)}
              />
            ))
          )}
        </ol>
        <Preview hit={selected} />
      </div>
    </Overlay>
  );
}

function Row({
  hit,
  on,
  select,
  choose,
}: {
  hit: SearchHit;
  on: boolean;
  select: () => void;
  choose: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={on ? "palette-hit on" : "palette-hit"}
        aria-current={on ? "true" : undefined}
        // The pointer selects as well as opens, as the handoff has it: what the
        // preview shows follows the pointer without a click.
        onMouseEnter={select}
        onClick={choose}
      >
        <span className="palette-name">{hit.label}</span>
        <span className={`palette-tag ${hit.kind}`}>{hit.tag}</span>
      </button>
    </li>
  );
}

/** The right column: where the hit is, and twelve lines of the diff around it. */
function Preview({ hit }: { hit: SearchHit | null }) {
  const files = useStore((store) => store.files);
  const comments = useStore((store) => store.comments);

  if (hit === null) return <div className="palette-preview" />;

  const entry = files.find((one) => one.id === `${hit.repo}/${hit.path}`);
  const comment = hit.kind === "comment" ? comments.find((one) => one.id === hit.id) : undefined;
  const lines = entry === undefined ? [] : preview(entry.file.patch, hit.line);

  return (
    <div className="palette-preview">
      <div className="palette-where">
        <span className="palette-path">{hit.path}</span>
        <span className="palette-meta">
          {hit.repo}
          {hit.line === null ? "" : ` · L${hit.line}`}
        </span>
      </div>
      {lines.length === 0 ? (
        <p className="palette-note">Этот файл показан без содержимого.</p>
      ) : (
        <div className="palette-code">
          {lines.map((line) => (
            <Line key={line.at} line={line} target={hit.line} />
          ))}
        </div>
      )}
      {comment === undefined ? null : <p className="palette-body-text">{comment.body}</p>}
    </div>
  );
}

function Line({ line, target }: { line: PreviewLine; target: number | null }) {
  const marked = target !== null && line.line === target;
  return (
    <div className={`palette-line ${line.kind}${marked ? " on" : ""}`}>
      <span className="palette-ln">{line.line ?? ""}</span>
      <span className="palette-text">{line.text}</span>
    </div>
  );
}
