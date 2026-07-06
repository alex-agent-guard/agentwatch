import { Link } from 'react-router-dom';
import Footer from '@/components/Footer';
import LiveTicker from '@/components/LiveTicker';
import FeatureCard from '@/components/FeatureCard';
import Navbar from '@/components/Navbar';
import SpaceHeroBackground from '@/components/SpaceHeroBackground';
import HeroCopy from '@/components/HeroCopy';
import FilmGrain from '@/components/FilmGrain';
import SectionAmbient from '@/components/SectionAmbient';
import ScrollRevealHeading from '@/components/ScrollRevealHeading';
import CutReveal from '@/components/CutReveal';
import { VIDEO_ASSETS } from '@/data/videoAssets';
import { storeAuthRedirect } from '@/lib/authRedirect';

/** 流程顺序：发现 → 拦截 → 审计 */
const featureCards = [
  {
    step: '01',
    title: '发现',
    description: '持续感知 Agent 行为，偏离基线的异常调用早发现',
    videoSrc: VIDEO_ASSETS.cardDiscover,
    videoPosition: 'center center',
    terminal: [
      '> l1.processEvent',
      '  markov    0.63  anomaly',
      '  frequency z=3.2',
      '  fusion    WARN',
      '  l0_rules  CHAIN_ABUSE_001',
    ],
  },
  {
    step: '02',
    title: '拦截',
    description: '工具调用落地前实时评估，危险操作毫秒级拦截',
    videoSrc: VIDEO_ASSETS.cardRobotTouch,
    videoPosition: 'center 40%',
    terminal: [
      '> tools/call',
      '  tool      transfer',
      '  decision  BLOCK',
      '  l1_score  0.91',
      '  dur_ms    12',
    ],
  },
  {
    step: '03',
    title: '审计',
    description: '全程脱敏留痕，链式签名保障审计记录可信可验',
    videoSrc: VIDEO_ASSETS.cardEarthNetwork,
    videoPosition: 'center center',
    terminal: [
      '> audit verify',
      '  file      ~/.agentwatch/log.jsonl',
      '  entries   847',
      '  hmac      chain intact',
      '  exit      0',
    ],
  },
];

export default function Home() {
  return (
    <div className="page-canvas min-h-screen text-white">
      <FilmGrain />
      <Navbar />

      <section className="relative min-h-screen overflow-hidden">
        <SpaceHeroBackground />
        <HeroCopy />

        <div className="absolute inset-x-0 bottom-0 z-10">
          <LiveTicker />
        </div>
      </section>

      <section id="features" className="relative py-16 md:py-20">
        <SectionAmbient variant="features" />
        <div className="relative z-10 mx-auto max-w-[1400px] px-6 md:px-10">
          <ScrollRevealHeading
            text="您为什么需要我们？"
            className="mb-12 md:mb-16"
          />

          <div className="grid gap-6 lg:grid-cols-3">
            {featureCards.map((card, i) => (
              <CutReveal
                key={card.title}
                direction={card.title === '拦截' ? 'right' : 'left'}
                delay={0.42 + i * 0.1}
              >
                <FeatureCard {...card} />
              </CutReveal>
            ))}
          </div>
        </div>
      </section>

      <section className="relative py-20">
        <SectionAmbient variant="cta" />
        <div className="relative mx-auto max-w-[1400px] px-6 text-center md:px-10">
          <p className="type-label-en text-[10px] text-white/32 md:text-[11px]">
            npm install -g @agentwatch-web3/cli
          </p>
          <p className="type-body-cn mt-5 text-lg text-white/58 md:text-xl">
            本地部署 · 链式验真 · 云端洞察
          </p>
          <Link
            to="/auth"
            className="okx-btn-white type-heading mt-8 inline-block text-sm"
            onClick={() => storeAuthRedirect('/home')}
          >
            开始使用
          </Link>
          <p className="type-body-cn mt-5">
            <Link
              to="/preview/home"
              className="text-[#8fd4a8]/90 underline underline-offset-4 transition hover:text-[#8fd4a8]"
            >
              Demo
            </Link>
            <span className="text-white/38"> · 无需登录</span>
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
