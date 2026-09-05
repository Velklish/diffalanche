/** The 30 px bar of handoff section 1.6; DA-24 adds the context line on the right. */
export function StatusBar() {
  return (
    <footer className="status-bar">
      {[
        ["⌘K", "search"],
        ["J K", "threads"],
        ["C", "comment"],
        ["R", "resolve"],
        ["B", "browse"],
      ].map(([key, what]) => (
        <span className="hint" key={key}>
          <span className="key">{key}</span>
          {what}
        </span>
      ))}
      <span className="spacer" />
    </footer>
  );
}
