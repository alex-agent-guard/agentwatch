import CinematicGrade from '@/components/CinematicGrade';
import FilmGrain from '@/components/FilmGrain';
import TopGlow from '@/components/TopGlow';
import Vignette from '@/components/Vignette';

export default function GlobalEffects() {
  return (
    <>
      <TopGlow />
      <CinematicGrade />
      <Vignette />
      <FilmGrain />
    </>
  );
}
