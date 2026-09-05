import { useMemo } from "react";
import { LIVE_WINDOW_MS, useStore } from "../store.ts";
import { elapsed } from "../time.ts";
import type { ActivityEvent } from "../types.ts";

/**
 * The AGENT ACTIVITY panel of handoff section 4, at the foot of the thread
 * rail: a header that says how many agents are live, and — when it is opened,
 * which it is not by default — the lines the server has noticed since the
 * review was opened, newest first, with their times counted in seconds.
 *
 * The lines are the server's own ([05-watcher.md](../../../docs/reference/05-watcher.md));
 * the sentence around each verb is written here.
 */
export function ActivityPanel() {
  const events = useStore((store) => store.events);
  const open = useStore((store) => store.feedOpen);
  const toggleFeed = useStore((store) => store.toggleFeed);
  // The clock, moved every five seconds, so `12s ago` is the time it says it is.
  const now = useStore((store) => store.tick);

  const newest = useMemo(() => [...events].reverse(), [events]);
  const live = useMemo(() => liveAgents(events, now), [events, now]);

  return (
    <section className="feed" aria-label="agent activity">
      <button type="button" className="feed-head" aria-expanded={open} onClick={toggleFeed}>
        <span className={live > 0 ? "dot ok pulse" : "dot"} />
        AGENT ACTIVITY
        <span className="spacer" />
        <span className="feed-live">{live} live</span>
        <span className="caret">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <ol className="feed-list">
          {newest.length === 0 ? (
            <li className="feed-empty">Nothing has happened since this page was opened.</li>
          ) : (
            newest.map((event) => <FeedRow key={event.id} event={event} now={now} />)
          )}
        </ol>
      ) : null}
    </section>
  );
}

/** One line: the dot in the colour of what happened, the sentence, and where and when. */
function FeedRow({ event, now }: { event: ActivityEvent; now: number }) {
  return (
    <li className="feed-row">
      <span className={`dot ${dot(event)}`} />
      <span className="feed-what">{sentence(event)}</span>
      <span className="feed-where">
        {event.path ?? event.repo ?? "review"} · {elapsed(Date.parse(event.at), now)}
      </span>
    </li>
  );
}

/**
 * Green while an agent is working, accent when one answered, `--bd` for a diff
 * that changed with nobody's name on it — the three the handoff draws.
 */
function dot(event: ActivityEvent): string {
  if (event.verb === "editing") return "ok pulse";
  return event.verb === "changed" ? "diff" : "acc";
}

function sentence(event: ActivityEvent): string {
  const who = event.author ?? "someone";
  switch (event.verb) {
    case "editing":
      return `${who} is editing ${event.repo ?? "the review"}`;
    case "replied":
      return `${who} replied in ${event.path ?? event.repo ?? "the review"}`;
    case "commented":
      return `${who} commented on ${event.path ?? event.repo ?? "the review"}`;
    default:
      return `diff changed in ${event.repo ?? "the review"}`;
  }
}

/**
 * How many agents the header calls live: the names that wrote or edited inside
 * the window the watcher attributes changes for. A diff that changed with
 * nobody's name on it is not somebody working.
 */
function liveAgents(events: ActivityEvent[], now: number): number {
  const since = now - LIVE_WINDOW_MS;
  const names = new Set<string>();
  for (const event of events) {
    if (event.author === null || event.verb === "changed") continue;
    if (Date.parse(event.at) >= since) names.add(event.author);
  }
  return names.size;
}
