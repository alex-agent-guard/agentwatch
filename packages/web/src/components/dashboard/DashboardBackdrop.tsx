/**
 * 仪表盘背景 — 暮蓝分层渐变（非纯黑）
 */
export default function DashboardBackdrop() {
  const photoUrl = import.meta.env.VITE_DASH_BG_IMAGE as string | undefined;
  const usePhoto = Boolean(photoUrl?.trim());

  return (
    <div className="dash-bg pointer-events-none fixed inset-0 z-0" aria-hidden>
      {usePhoto && (
        <div
          className="dash-bg__photo"
          style={{ backgroundImage: `url(${photoUrl})` }}
        />
      )}
      <div className="dash-bg__base" />
      <div className="dash-bg__depth" />
      <div className="dash-bg__spotlight" />
      <div className="dash-bg__vignette" />
      {usePhoto && <div className="dash-bg__veil" />}
      <div className="dash-bg__noise" />
    </div>
  );
}
