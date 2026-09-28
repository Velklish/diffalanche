import { useStore } from "../store.ts";

/** The "no changes" screen of handoff section 10: an empty change set, and the two ways out that
 * would change the answer — the base and the session (08-ui.md, "Empty states"). */
export function NoChanges() {
  const session = useStore((store) => store.session);
  const openBase = useStore((store) => store.openBase);
  const setSessionMenu = useStore((store) => store.setSessionMenu);

  return (
    <div className="no-changes">
      <h2 className="no-changes-title">Изменений нет</h2>
      <p className="no-changes-note">
        Ни один репозиторий под этой папкой не отличается от базы сессии
        {session === null ? "" : ` ${session.name}`}. Смените базу или откройте другую сессию.
      </p>
      <div className="no-changes-actions">
        <button type="button" className="ghost accent" onClick={() => openBase(true)}>
          Change base
        </button>
        <button type="button" className="ghost" onClick={() => setSessionMenu(true)}>
          Other session
        </button>
      </div>
    </div>
  );
}
