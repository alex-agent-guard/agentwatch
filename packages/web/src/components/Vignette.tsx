export default function Vignette() {
  return (
    <>
      <div
        className="pointer-events-none fixed inset-0 z-[55]"
        aria-hidden
        style={{
          background: `
            radial-gradient(ellipse 90% 70% at 50% 45%, transparent 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.82) 100%),
            radial-gradient(ellipse 120% 100% at 50% 100%, rgba(0,0,0,0.5) 0%, transparent 50%)
          `,
        }}
      />
      <div
        className="pointer-events-none fixed inset-0 z-[56] opacity-40 mix-blend-multiply"
        aria-hidden
        style={{
          background: `
            radial-gradient(circle at 0% 0%, rgba(15, 20, 40, 0.8) 0%, transparent 45%),
            radial-gradient(circle at 100% 0%, rgba(20, 15, 35, 0.7) 0%, transparent 45%),
            radial-gradient(circle at 100% 100%, rgba(10, 12, 20, 0.9) 0%, transparent 50%),
            radial-gradient(circle at 0% 100%, rgba(12, 18, 32, 0.85) 0%, transparent 50%)
          `,
        }}
      />
    </>
  );
}
