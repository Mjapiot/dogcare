/** Paw mark rendered by next/og (Satori): only flexbox + basic CSS. */
export function AppIconMark({ size, padding = 0 }: { size: number; padding?: number }) {
  const inner = size - padding * 2;
  const u = inner / 100;
  const toe = (left: number, top: number, w: number, h: number) => (
    <div
      style={{
        position: "absolute",
        left: padding + left * u,
        top: padding + top * u,
        width: w * u,
        height: h * u,
        borderRadius: "50%",
        background: "#fbfaf7",
      }}
    />
  );
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        position: "relative",
        background: "#1c1b19",
      }}
    >
      {toe(18, 30, 15, 20)}
      {toe(33, 16, 15, 21)}
      {toe(52, 16, 15, 21)}
      {toe(67, 30, 15, 20)}
      <div
        style={{
          position: "absolute",
          left: padding + 28 * u,
          top: padding + 46 * u,
          width: 44 * u,
          height: 36 * u,
          borderRadius: "48% 48% 42% 42%",
          background: "#c9dcc4",
        }}
      />
    </div>
  );
}
