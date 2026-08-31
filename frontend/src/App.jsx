import { useState, useEffect } from 'react';
import './App.css';
import { API_BASE } from './apiBase';
import MarginTab from './components/MarginTab';
import TopRankingTab from './components/TopRankingTab';
import EsanginStock from './components/EsanginStock';
import ReorderTabPage from './components/ReorderTabPage'; // 💡 재발주 알림 + 설정 (한 탭으로 통합)
import TodoListTab from './components/TodoListTab';
import ProductMappingTab from './components/ProductMappingTab';
import MemoTab from './components/MemoTab';
import SalesDeclineTab from './components/SalesDeclineTab'; // 💡 판매 둔화 감지
import SalesSurgeTab from './components/SalesSurgeTab'; // 💡 판매 급증 감지
import StockReconcileTab from './components/StockReconcileTab'; // 💡 재고 정합성 체크
import StockAuditTab from './components/StockAuditTab'; // 💡 재고 실사 (수동)
import DeadstockPromotionTab from './components/DeadstockPromotionTab'; // 💡 재고 처분 추천
import SurgeChannelExpansionTab from './components/SurgeChannelExpansionTab'; // 💡 채널 확장 추천
import FeeAnalysisTab from './components/FeeAnalysisTab'; // 💡 수수료 분석
import { loadDismissed, signature } from './components/reorderAlertUtils';
import { useTheme } from './ThemeContext.jsx';
import { Emoji, Sun, Moon, Dot } from './components/Icons';
import Sidebar, { NAV_ITEMS } from './components/Sidebar';

function App() {
  const [activeTab, setActiveTab] = useState('margin');
  const [dbStatus, setDbStatus] = useState('loading');
  const { theme, toggleTheme } = useTheme();

  const [reorderUrgentCount, setReorderUrgentCount] = useState(0);
  const [driftStatus, setDriftStatus] = useState(null);

  // 💡 prod-git 코드 드리프트 감시 배너 — prod_drift_check.py가 cron으로 주기 확인한
  // 결과를 그대로 보여준다. 앱 로드 시 한 번만 확인(실시간 폴링까지는 필요 없음 — cron
  // 자체가 몇 시간 단위라 그보다 자주 물어봐야 의미가 없다).
  useEffect(() => {
    const checkDrift = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/prod-drift-status`, { headers: { 'ngrok-skip-browser-warning': '69420' } });
        const result = await res.json();
        if (result.status === 'success') setDriftStatus(result.data);
      } catch {
        // 조용히 무시 — 배너는 부가 정보라 실패해도 앱 동작엔 영향 없음
      }
    };
    checkDrift();
  }, []);

  useEffect(() => {
    const checkDbConnection = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/esangin-stock`, { headers: { 'ngrok-skip-browser-warning': '69420' } });
        const result = await res.json();
        if (result.status === 'success') {
          setDbStatus('connected');
        } else {
          setDbStatus('disconnected');
        }
      } catch (err) {
        setDbStatus('error');
      }
    };
    checkDbConnection();
  }, []);

  // 💡 "재발주" 탭을 아직 안 열어봤어도 뱃지 숫자는 바로 보여야 하므로, 앱 로드 시 한 번 별도로 조회
  useEffect(() => {
    const fetchUrgentBadgeCount = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/reorder-alerts`, { headers: { 'ngrok-skip-browser-warning': '69420' } });
        const result = await res.json();
        if (result.error || !Array.isArray(result.alerts)) return;
        const dismissed = loadDismissed();
        const urgentCount = result.alerts.filter((a) => a.urgency === 'urgent' && dismissed[a.id] !== signature(a)).length;
        setReorderUrgentCount(urgentCount);
      } catch {
        // 조용히 무시 — 뱃지는 부가 정보라 실패해도 앱 동작엔 영향 없음
      }
    };
    fetchUrgentBadgeCount();
  }, []);

  const getTopbarTitle = () => {
    if (activeTab === 'esangin_stock') return { icon: '📦', text: 'E상인 - 재고 파악' };
    if (activeTab === 'esangin_deadstock') return { icon: '🔥', text: 'E상인 - 악성 재고' };
    const found = NAV_ITEMS.find((x) => x.key === activeTab);
    return { icon: found?.icon, text: found?.label || 'Dashboard' };
  };
  const topbarTitle = getTopbarTitle();

  return (
    <>
      <div className="appShell">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} reorderUrgentCount={reorderUrgentCount} />

        <main className="main">
          <header className="topbar">
            <div>
              <div className="topbarTitle" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Emoji>{topbarTitle.icon}</Emoji>{topbarTitle.text}
              </div>
              <div className="topbarMeta">실시간 연동 · 자동 수집 엔진 가동 중</div>
            </div>

            <div className="toolbar" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: dbStatus === 'connected' ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'color-mix(in srgb, var(--danger) 15%, transparent)',
                color: dbStatus === 'connected' ? 'var(--success)' : 'var(--danger)',
                padding: '6px 12px', borderRadius: '999px', fontSize: '13px', fontWeight: 'bold'
              }}>
                <Dot tone={dbStatus === 'connected' ? 'green' : 'red'} size={8} />
                {dbStatus === 'connected' ? 'DB 연동됨' : '연결 끊김'}
              </span>

              <button className="btn" onClick={toggleTheme} aria-label="테마 전환" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          </header>

          {driftStatus && !driftStatus.never_run && !driftStatus.ok && (
            <div style={{
              margin: '0 24px 16px', padding: '12px 16px', borderRadius: '12px',
              background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
              color: 'var(--danger)', fontSize: '13px', fontWeight: 600,
            }}>
              <Emoji>🚨</Emoji> prod 서버 코드가 git과 다릅니다 — 확인 시각: {driftStatus.checked_at || '알 수 없음'}
              {driftStatus.error && <div>오류: {driftStatus.error}</div>}
              {driftStatus.content_mismatch?.length > 0 && (
                <div>내용 다름: {driftStatus.content_mismatch.join(', ')}</div>
              )}
              {driftStatus.missing_on_prod?.length > 0 && (
                <div>prod에 없음: {driftStatus.missing_on_prod.join(', ')}</div>
              )}
              {driftStatus.prod_only_mystery_files?.length > 0 && (
                <div>git에 없는 prod 전용 파일: {driftStatus.prod_only_mystery_files.join(', ')}</div>
              )}
            </div>
          )}

          <section className="content">
            <div key={activeTab} className="tab-fade">
              {activeTab === 'margin' && <MarginTab />}
              {activeTab === 'fee_analysis' && <FeeAnalysisTab />}
              {activeTab === 'ranking' && <TopRankingTab />}
              {activeTab === 'reorder_alerts' && <ReorderTabPage onUrgentCountChange={setReorderUrgentCount} />}
              {activeTab === 'todo_list' && <TodoListTab />}
              {activeTab === 'product_mapping' && <ProductMappingTab />}
              {activeTab === 'memo' && <MemoTab />}
              {activeTab === 'sales_decline' && <SalesDeclineTab />}
              {activeTab === 'sales_surge' && <SalesSurgeTab />}
              {activeTab === 'stock_reconcile' && <StockReconcileTab />}
              {activeTab === 'stock_audit' && <StockAuditTab />}
              {activeTab === 'deadstock_promotion' && <DeadstockPromotionTab />}
              {activeTab === 'surge_channel_expansion' && <SurgeChannelExpansionTab />}
              {activeTab === 'esangin_stock' && <EsanginStock menuType="stock" />}
              {activeTab === 'esangin_deadstock' && <EsanginStock menuType="deadstock" />}
            </div>
          </section>
        </main>
      </div>
    </>
  );
}

export default App;