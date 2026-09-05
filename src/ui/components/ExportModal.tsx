import { byCodePoint } from "../../core/order.ts";
import { exportAnchor } from "../anchor.ts";
import { formatBase } from "../base.ts";
import type { ExportView } from "../store.ts";
import { useStore } from "../store.ts";
import type { Comment } from "../types.ts";
import { Overlay } from "./Overlay.tsx";

/**
 * The export of handoff section 9. `raw` is the markdown `GET /api/export`
 * answers with, and it is what `Copy .md` writes to the clipboard; `rendered`
 * is that same export laid out, built from the comments of the same route
 * rather than by parsing the markdown back — the page has the comments, and a
 * markdown parser to read its own output would be the long way round.
 */
export function ExportModal() {
  const view = useStore((store) => store.exportView);
  const status = useStore((store) => store.exportStatus);
  const openExport = useStore((store) => store.openExport);
  const setExportView = useStore((store) => store.setExportView);

  return (
    <Overlay width={760} label="export" onClose={() => openExport(false)}>
      <div className="export">
        <div className="export-head">
          <span className="segments">
            {(["rendered", "raw"] as ExportView[]).map((one) => (
              <button
                key={one}
                type="button"
                className={view === one ? "segment on" : "segment"}
                aria-pressed={view === one}
                onClick={() => setExportView(one)}
              >
                {one}
              </button>
            ))}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="ghost"
            onClick={() => void useStore.getState().copyExport()}
          >
            Copy .md
          </button>
        </div>
        <div className="export-body">
          {status === "loading" ? (
            <p className="picker-note">…</p>
          ) : status === "failed" ? (
            <p className="failure">Экспорт не прочитался.</p>
          ) : view === "raw" ? (
            <Raw />
          ) : (
            <Rendered />
          )}
        </div>
      </div>
    </Overlay>
  );
}

function Raw() {
  const raw = useStore((store) => store.exportRaw);
  return <pre className="export-raw">{raw}</pre>;
}

function Rendered() {
  const comments = useStore((store) => store.exportComments);
  const session = useStore((store) => store.session);
  const open = comments.filter((comment) => comment.status === "open").length;

  return (
    <div className="export-rendered">
      <h1>
        Review {session?.name ?? ""}
        {session?.title ? ` — ${session.title}` : ""}
      </h1>
      <p className="export-meta">
        base {session === null ? "—" : formatBase(session.base)} · {plural(open, "open comment")}
      </p>
      {sections(comments).map(({ title, comments: inSection }) => (
        <section key={title}>
          <h2>
            {title}
            <span className="export-count">{plural(inSection.length, "comment")}</span>
          </h2>
          {inSection.map((comment) => (
            <Item key={comment.id} comment={comment} />
          ))}
        </section>
      ))}
    </div>
  );
}

function Item({ comment }: { comment: Comment }) {
  return (
    <div className="export-item">
      <span className={`export-sev ${comment.severity}`}>{comment.severity}</span>
      <div className="export-text">
        <span className="export-anchor">{exportAnchor(comment)}</span>
        <p>{comment.body}</p>
        {comment.replies.map((reply) => (
          <blockquote key={reply.id}>
            <b>{reply.author}</b> ({reply.role}) — {reply.body}
          </blockquote>
        ))}
      </div>
    </div>
  );
}

/**
 * The sections in the order `exportMarkdown` writes them: the whole review
 * first, then the repositories by code point, and inside each one the comments
 * by path and then by line. The two tabs are one export, so `rendered` may not
 * put it in a different order than `raw`
 * ([04-domain.md](../../../docs/reference/04-domain.md)).
 */
function sections(comments: Comment[]): { title: string; comments: Comment[] }[] {
  const out: { title: string; comments: Comment[] }[] = [];
  const wholeReview = comments.filter((comment) => comment.repo === null);
  if (wholeReview.length > 0) out.push({ title: "Review", comments: [...wholeReview].sort(order) });

  const repositories = [
    ...new Set(
      comments.map((comment) => comment.repo).filter((repo): repo is string => repo !== null),
    ),
  ].sort(byCodePoint);
  for (const repo of repositories) {
    out.push({
      title: repo,
      comments: comments.filter((comment) => comment.repo === repo).sort(order),
    });
  }
  return out;
}

/** By code point and never by locale, for the reason the domain's export gives. */
function order(a: Comment, b: Comment): number {
  return byCodePoint(a.path ?? "", b.path ?? "") || (a.line ?? 0) - (b.line ?? 0);
}

/** "1 comment", "3 comments": the export is read by people. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
