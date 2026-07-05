export default function TopGlow() {
  return (
    <>
      <div
        className="top-glow-breathe pointer-events-none fixed inset-x-0 top-0 z-[50] h-[520px]"
        aria-hidden
        style={{
          background: `
            radial-gradient(ellipse 100% 80% at 50% -30%, rgba(41, 121, 255, 0.22) 0%, transparent 65%),
            radial-gradient(ellipse 60% 40% at 70% 0%, rgba(123, 97, 255, 0.12) 0%, transparent 55%),
            radial-gradient(ellipse 50% 35% at 20% 5%, rgba(0, 212, 170, 0.06) 0%, transparent 50%)
          `,
        }}
      />
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[49] h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"
        aria-hidden
      />
    </>
  );
}
