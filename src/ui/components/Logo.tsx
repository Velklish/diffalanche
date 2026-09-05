/** The mark of the handoff: three 9 px squares stepping down the diagonal. */
export function Logo({ size = 19 }: { size?: number }) {
  const square = (size * 9) / 19;
  const step = (size * 5) / 19;
  return (
    <span className="logo-mark" style={{ width: size, height: size }} aria-hidden="true">
      {[
        { offset: 0, color: "var(--acc)" },
        { offset: step, color: "var(--warn)" },
        { offset: step * 2, color: "var(--nit)" },
      ].map((part) => (
        <span
          key={part.offset}
          style={{
            left: part.offset,
            top: part.offset,
            width: square,
            height: square,
            background: part.color,
          }}
        />
      ))}
    </span>
  );
}
