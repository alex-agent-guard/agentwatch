import { Link } from 'react-router-dom';
import BrandLogo from '@/components/BrandLogo';
import { storeAuthRedirect } from '@/lib/authRedirect';

export default function Footer() {
  return (
    <footer className="relative border-t border-white/[0.06] bg-gradient-to-b from-[#070810] to-[#06070a]">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-12 md:grid-cols-4">
        <div className="md:col-span-2">
          <BrandLogo to="/" size="md" className="mb-3 text-text-primary" />
          <p className="type-body-cn max-w-md text-sm text-text-secondary">
            每一次调用实时审计 · 异常行为即时监测 · 审计记录不可篡改
          </p>
        </div>

        <div>
          <h4 className="type-heading mb-3 text-sm text-text-primary">产品</h4>
          <ul className="type-body-cn space-y-2 text-sm text-text-secondary">
            <li>
              <Link
                to="/home"
                className="hover:text-text-primary"
                onClick={() => storeAuthRedirect('/home')}
              >
                首页
              </Link>
            </li>
            <li>
              <Link
                to="/dashboard"
                className="hover:text-text-primary"
                onClick={() => storeAuthRedirect('/dashboard')}
              >
                仪表盘
              </Link>
            </li>
            <li>
              <Link
                to="/reports"
                className="hover:text-text-primary"
                onClick={() => storeAuthRedirect('/reports')}
              >
                报告
              </Link>
            </li>
            <li><Link to="/settings" className="hover:text-text-primary">设置</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="type-heading mb-3 text-sm text-text-primary">联系</h4>
          <p className="type-body-cn text-sm text-text-secondary">alexai66</p>
        </div>
      </div>

      <div className="type-caption-en border-t border-white/5 py-6 text-center text-[10px] text-text-muted">
        © {new Date().getFullYear()} AgentWatch · 联系 alexai66
      </div>
    </footer>
  );
}
