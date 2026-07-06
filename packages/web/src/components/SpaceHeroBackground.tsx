import LoopVideo from '@/components/LoopVideo';
import { VIDEO_ASSETS } from '@/data/videoAssets';

/** Hero：15197075 女孩子镜头（单层，无地球叠加） */
export default function SpaceHeroBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <LoopVideo
        src={VIDEO_ASSETS.heroGirl}
        opacity={0.95}
        objectPosition="55% center"
        playbackRate={0.9}
        fallbackVariant="hero"
        className="absolute inset-0"
      />

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            linear-gradient(90deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.72) 100%),
            linear-gradient(180deg, rgba(6,7,10,0.45) 0%, transparent 42%, rgba(9,11,18,0.92) 100%)
          `,
        }}
      />
    </div>
  );
}
