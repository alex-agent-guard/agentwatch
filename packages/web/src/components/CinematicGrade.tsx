/** Subtle color grading overlay — teal shadows, warm highlights */
export default function CinematicGrade() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[54] opacity-[0.35] mix-blend-color"
      aria-hidden
      style={{
        background: `
          linear-gradient(180deg,
            rgba(12, 18, 32, 0.4) 0%,
            rgba(8, 10, 14, 0.1) 40%,
            rgba(14, 10, 24, 0.25) 100%
          )
        `,
      }}
    />
  );
}
