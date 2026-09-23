import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { splitLines } from "../context.ts";
import { revealCard, revealThread } from "../reveal.ts";
import type { PreviewLine, SearchHit } from "../search.ts";
import { PREVIEW_LINES, preview, search, textHits } from "../search.ts";
import { onTask, useStore } from "../store.ts";
import type { FileContent, TextHit, TextSearch } from "../types.ts";
import { Overlay } from "./Overlay.tsx";

/** Global search of handoff section 6: the field, the results on the left, a preview of the
 * target on the right ([08-ui.md](../../../docs/reference/08-ui.md), "Global search"). */
export function GlobalSearch() {
  const open = useStore((store) => store.paletteOpen);
  return open ? <Palette /> : null;
}

function focusField(element: HTMLInputElement | null): void {
  element?.focus();
}

function Palette() {
  const query = useStore((store) => store.paletteQuery);
  const index = useStore((store) => store.palIdx);
  const files = useStore((store) => store.files);
  const comments = useStore((store) => store.comments);
  const repositories = useStore((store) => store.repositories);
  const trees = useStore((store) => store.trees);
  const setQuery = useStore((store) => store.setPaletteQuery);
  const setIndex = useStore((store) => store.setPalIdx);
  const close = useStore((store) => store.setPalette);

  // The unchanged files are the trees', read when the modal opens and kept while the review is.
  useEffect(() => {
    const store = useStore.getState();
    for (const repo of repositories) {
      if (store.trees[repo.path] === undefined) void store.loadTree(repo.path);
    }
  }, [repositories]);
  const unchanged = useMemo(() => {
    const listed = new Set(files.map((entry) => entry.id));
    return repositories.flatMap((repo) =>
      (trees[repo.path]?.tree?.files ?? [])
        .filter((entry) => entry.worktree && !listed.has(`${repo.path}/${entry.path}`))
        .map((entry) => ({ repo: repo.path, path: entry.path })),
    );
  }, [repositories, trees, files]);

  const text = useTextSearch(query);
  const hits = useMemo(
    () => [...search(query, files, comments, unchanged), ...textHits(text.hits)],
    [query, files, comments, unchanged, text.hits],
  );
  const selected = hits[Math.min(index, hits.length - 1)] ?? null;

  const choose = useCallback(
    (hit: SearchHit) => {
      close(false);
      if (hit.kind === "comment") {
        void revealThread(hit.id);
        return;
      }
      const store = useStore.getState();
      if (hit.kind === "plain" || hit.kind === "text") {
        store.openBrowse(hit.repo, hit.path, { line: hit.line });
        return;
      }
      if (store.browse) store.closeBrowse();
      store.select(hit.repo, hit.path);
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
    <Overlay
      width={880}
      className="palette"
      label="global search"
      ladder="palette"
      onClose={() => close(false)}
    >
      <div className="palette-field">
        <span className="palette-glyph">⌕</span>
        <input
          type="text"
          value={query}
          // Where the reader already is: a callback ref rather than `autoFocus`, and a stable
          // one, so results landing later do not take the focus back from a hit.
          ref={focusField}
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
                ? "Файлы, текст и комментарии этого ревью."
                : text.status === "loading"
                  ? `Ищем «${query.trim()}» в рабочих деревьях…`
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
          {text.next === null ? null : (
            <li>
              <button type="button" className="palette-more" onClick={text.more}>
                ещё совпадения · {text.hits.length} из {text.total}
                {text.capped ? "+" : ""}
              </button>
            </li>
          )}
          {text.next === null && text.capped ? (
            <li className="palette-capped">совпадений больше, чем показано, — уточните запрос</li>
          ) : null}
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
        data-repo={hit.repo}
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
  if (hit.kind === "plain") return <PlainPreview hit={hit} />;
  if (hit.around !== undefined) return <TextPreview hit={hit} />;

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

/** How long the field has to be still before the working trees are searched. */
const TEXT_DEBOUNCE_MS = 150;

type TextState = {
  query: string;
  status: "idle" | "loading" | "ready";
  hits: TextHit[];
  next: number | null;
  total: number;
  capped: boolean;
};

const NO_TEXT: TextState = {
  query: "",
  status: "idle",
  hits: [],
  next: null,
  total: 0,
  capped: false,
};

/** The server's text search for the query, a page at a time; an answer for an older query is
 * dropped ([07-server.md](../../../docs/reference/07-server.md), "Text search"). */
function useTextSearch(query: string): TextState & { more: () => void } {
  const [state, setState] = useState<TextState>(NO_TEXT);
  const wanted = query.trim();
  // The page asked for: a second press before it arrives asks for nothing, and an answer for a
  // page the list has already moved past is dropped rather than appended twice.
  const asked = useRef<number | null>(null);

  useEffect(() => {
    asked.current = null;
    if (wanted.length < 2) {
      setState(NO_TEXT);
      return;
    }
    setState({ ...NO_TEXT, query: wanted, status: "loading" });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void readText(wanted, 0, controller.signal).then((result) => {
        if (result === null) return;
        setState({ query: wanted, status: "ready", ...result });
      });
    }, TEXT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [wanted]);

  const more = () => {
    const page = state.next;
    if (page === null || state.query !== wanted || asked.current === page) return;
    asked.current = page;
    void readText(wanted, page).then((result) => {
      if (result === null) {
        // A failed read leaves the row able to ask again.
        if (asked.current === page) asked.current = null;
        return;
      }
      setState((held) =>
        held.query === wanted && held.next === page
          ? { ...held, ...result, hits: [...held.hits, ...result.hits] }
          : held,
      );
    });
  };
  return { ...(state.query === wanted ? state : NO_TEXT), more };
}

async function readText(
  query: string,
  page: number,
  signal?: AbortSignal,
): Promise<Pick<TextSearch, "hits" | "next" | "total" | "capped"> | null> {
  try {
    const url = `/api/search/text?q=${encodeURIComponent(query)}&page=${page}`;
    const response = await fetch(onTask(url), signal === undefined ? {} : { signal });
    if (!response.ok) return null;
    const { hits, next, total, capped } = (await response.json()) as TextSearch;
    return { hits, next, total, capped };
  } catch {
    // An aborted read is an older query; a failed one leaves the ranked rows to speak.
    return null;
  }
}

/** A line the server found, between the lines around it. */
function TextPreview({ hit }: { hit: SearchHit }) {
  const around = hit.around;
  const line = hit.line ?? 1;
  if (around === undefined) return null;
  const first = line - around.before.length;
  const rows = [...around.before, around.text, ...around.after].map((text, at) => ({
    at,
    line: first + at,
    text,
    kind: "context" as const,
  }));
  return (
    <div className="palette-preview">
      <div className="palette-where">
        <span className="palette-path">{hit.path}</span>
        <span className="palette-meta">
          {hit.repo} · L{line}
        </span>
      </div>
      <div className="palette-code">
        {rows.map((row) => (
          <Line key={row.at} line={row} target={line} />
        ))}
      </div>
      <p className="palette-note">рабочее дерево</p>
    </div>
  );
}

/** The first lines of a file the review does not carry, read when the row is selected. */
function PlainPreview({ hit }: { hit: SearchHit }) {
  const [shown, setShown] = useState<{ id: string; lines: PreviewLine[] | null } | null>(null);
  useEffect(() => {
    let live = true;
    const query = `path=${encodeURIComponent(hit.path)}&rev=worktree`;
    void fetch(onTask(`/api/repos/${hit.repo}/file?${query}`))
      .then(async (response) => (response.ok ? ((await response.json()) as FileContent) : null))
      .catch(() => null)
      .then((content) => {
        if (!live) return;
        const text = content?.text ?? null;
        const lines =
          text === null
            ? null
            : splitLines(text)
                .slice(0, PREVIEW_LINES)
                .map((one, at) => ({ at, line: at + 1, text: one, kind: "context" as const }));
        setShown({ id: hit.id, lines });
      });
    return () => {
      live = false;
    };
  }, [hit.id, hit.repo, hit.path]);
  const lines = shown?.id === hit.id ? shown.lines : [];

  return (
    <div className="palette-preview">
      <div className="palette-where">
        <span className="palette-path">{hit.path}</span>
        <span className="palette-meta">{hit.repo}</span>
      </div>
      {lines === null ? (
        <p className="palette-note">Этот файл показан без содержимого.</p>
      ) : (
        <div className="palette-code">
          {lines.map((line) => (
            <Line key={line.at} line={line} target={null} />
          ))}
        </div>
      )}
      <p className="palette-note">рабочее дерево · вне ревью</p>
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
