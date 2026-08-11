import { useState, useEffect } from 'react';
import './App.css';
import { API_BASE } from './apiBase';
import MarginTab from './components/MarginTab';
import TopRankingTab from './components/TopRankingTab';
import EsanginStock from './components/EsanginStock';
import ReorderTabPage from './components/ReorderTabPage'; // 💡 재발주 알림 + 설정 (한 탭으로 통합)
import TodoListTab from './components/TodoListTab';
import StockAvailabilityTab from './components/StockAvailabilityTab';
import ProductMappingTab from './components/ProductMappingTab';
import SalesDeclineTab from './components/SalesDeclineTab'; // 💡 판매 둔화 감지
import SalesSurgeTab from './components/SalesSurgeTab'; // 💡 판매 급증 감지
import NewPopularTab from './components/NewPopularTab'; // 💡 신규 인기상품
import StockReconcileTab from './components/StockReconcileTab'; // 💡 재고 정합성 체크
import StockAuditTab from './components/StockAuditTab'; // 💡 재고 실사 (수동)
import { loadDismissed, signature } from './components/reorderAlertUtils';
import { useTheme } from './ThemeContext.jsx';

// ====================================================
// 🧮 찐 일반 계산기 (사이드바용 + 키보드 완벽 지원)
// ====================================================
function SidebarCalculator() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

      const key = e.key;
      if (/[0-9\+\-\*\/]/.test(key)) {
        e.preventDefault();
        handleClick(key);
      } 
      else if (key === 'Enter' || key === '=') {
        e.preventDefault();
        handleClick('=');
      } 
      else if (key === 'Escape' || key.toLowerCase() === 'c') {
        e.preventDefault();
        handleClick('C');
      } 
      else if (key === 'Backspace') {
        e.preventDefault();
        handleClick('DEL');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleClick = (val) => {
    setInput(prev => {
      if (val === 'C') return '';
      if (val === 'DEL') return prev === 'Error' ? '' : prev.slice(0, -1);
      if (val === '=') {
        try {
          // eslint-disable-next-line
          const result = new Function('return ' + prev)();
          return String(Math.round(result * 100) / 100);
        } catch (e) {
          return 'Error';
        }
      }
      if (prev === 'Error') return val;
      return prev + val;
    });
  };

  const btns = ['7','8','9','/','4','5','6','*','1','2','3','-','C','0','=','+'];

  return (
    <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%', padding: '10px 14px', borderRadius: '10px',
          background: isOpen ? '#1e5eff' : 'var(--local-box, rgba(255,255,255,0.05))', 
          color: isOpen ? '#fff' : 'var(--text)', border: '1px solid var(--border)',
          fontWeight: 'bold', cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', transition: 'all 0.2s'
        }}
      >
        <span>🧮 퀵 계산기</span>
        <span>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div style={{
          marginTop: '10px', padding: '12px', borderRadius: '12px',
          background: 'var(--local-box, rgba(0,0,0,0.2))', border: '1px solid var(--border)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
        }}>
          <input 
            type="text" 
            value={input} 
            readOnly 
            placeholder="0"
            style={{ 
              width: '100%', padding: '10px', fontSize: '18px', textAlign: 'right', 
              marginBottom: '10px', borderRadius: '8px', border: '1px solid var(--border)', 
              background: 'var(--local-input-bg, #fff)', color: '#000', boxSizing: 'border-box',
              fontWeight: 'bold'
            }} 
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
            {btns.map(b => {
              const isOp = ['/','*','-','+','='].includes(b);
              const isClear = b === 'C';
              return (
                <button 
                  key={b} 
                  onClick={() => handleClick(b)} 
                  style={{ 
                    padding: '10px 0', fontSize: '14px', fontWeight: 'bold', borderRadius: '6px', border: 'none', cursor: 'pointer',
                    background: isOp ? '#1e5eff' : isClear ? '#ff4d4f' : '#333',
                    color: '#fff', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', transition: 'transform 0.1s'
                  }}
                  onMouseDown={(e) => e.target.style.transform = 'scale(0.95)'}
                  onMouseUp={(e) => e.target.style.transform = 'scale(1)'}
                >
                  {b}
                </button>
              )
            })}
          </div>
          <p style={{ margin: '8px 0 0 0', fontSize: '11px', color: 'gray', textAlign: 'center' }}>
            ⌨️ 키보드 넘패드 지원!
          </p>
        </div>
      )}
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('margin');
  const [isEsanginOpen, setIsEsanginOpen] = useState(false);
  const [dbStatus, setDbStatus] = useState('loading');
  const { theme, toggleTheme } = useTheme();

  const [reorderUrgentCount, setReorderUrgentCount] = useState(0);

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

  const navItems = [
    { key: 'margin', label: '마진 산출 장부', icon: '📊' },
    { key: 'ranking', label: '플랫폼 TOP 5 랭킹', icon: '🏆' },
    { key: 'reorder_alerts', label: '재발주', icon: '🔔' },
    // { key: 'sales_decline', label: '판매둔화', icon: '📉' },
    // { key: 'sales_surge', label: '판매급증', icon: '📈' },
    // { key: 'new_popular', label: '신규 인기상품', icon: '🆕' },
    { key: 'stock_reconcile', label: '재고 정확성', icon: '🧮' },
    // { key: 'stock_audit', label: '재고 실사', icon: '📋' },
    { key: 'todo_list', label: '오늘 할 일', icon: '✅' },
    { key: 'stock_availability', label: '재고 가용성', icon: '📊' },
    { key: 'product_mapping', label: '상품명 매핑', icon: '🔗' },
  ];

  const getTopbarTitle = () => {
    if (activeTab === 'esangin_stock') return '📦 E상인 - 재고 파악';
    if (activeTab === 'esangin_deadstock') return '🔥 E상인 - 악성 재고';
    return navItems.find((x) => x.key === activeTab)?.label || 'Dashboard';
  };

  return (
    <>
      <div className="appShell">
        <aside className="sidebar">
          <div className="brand">
            <div className="brandTitle">ONEPICK Dashboard</div>
            <div className="brandSub">Margin · Naver · Stock</div>
          </div>

          <div className="mobileTabSelector">
            <select 
              value={activeTab} 
              onChange={(e) => { setActiveTab(e.target.value); setIsEsanginOpen(false); }}
            >
              <optgroup label="메인 메뉴">
                {navItems.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.icon} {item.label}
                    {item.key === 'reorder_alerts' && reorderUrgentCount > 0 ? ` 🔴${reorderUrgentCount}` : ''}
                  </option>
                ))}
              </optgroup>
              <optgroup label="E상인 통합 관리">
                <option value="esangin_stock">📦 재고 파악</option>
                <option value="esangin_deadstock">🔥 악성 재고</option>
              </optgroup>
            </select>
          </div>

          <nav className="nav" style={{ flexGrow: 1, paddingBottom: '30px' }}>
            <div style={{ flexGrow: 1 }}>
              {navItems.map((item) => (
                <button
                  key={item.key}
                  className={`navBtn ${activeTab === item.key ? 'navBtnActive' : ''}`}
                  onClick={() => { setActiveTab(item.key); setIsEsanginOpen(false); }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}
                >
                  <span>{item.icon} {item.label}</span>
                  {item.key === 'reorder_alerts' && reorderUrgentCount > 0 && (
                    <span className="nav-urgent-badge">🔴{reorderUrgentCount}</span>
                  )}
                </button>
              ))}

              <div style={{ marginTop: '10px' }}>
                <button
                  className={`navBtn ${activeTab.startsWith('esangin') ? 'navBtnActive' : ''}`}
                  onClick={() => setIsEsanginOpen(!isEsanginOpen)}
                  style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}
                >
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span>🦅 E상인 통합 관리</span>
                  </div>
                  <span>{isEsanginOpen ? '▲' : '▼'}</span>
                </button>

                {isEsanginOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '28px', marginTop: '6px' }}>
                    <button className={`navBtn ${activeTab === 'esangin_stock' ? 'navBtnActive' : ''}`} onClick={() => setActiveTab('esangin_stock')}>📦 재고 파악</button>
                    <button className={`navBtn ${activeTab === 'esangin_deadstock' ? 'navBtnActive' : ''}`} onClick={() => setActiveTab('esangin_deadstock')}>🔥 악성 재고</button>
                  </div>
                )}
              </div>
            </div>

            <SidebarCalculator />
          </nav>
        </aside>

        <main className="main">
          <header className="topbar">
            <div>
              <div className="topbarTitle">{getTopbarTitle()}</div>
              <div className="topbarMeta">실시간 연동 · 자동 수집 엔진 가동 중</div>
            </div>
            
            <div className="toolbar" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{
                background: dbStatus === 'connected' ? 'rgba(47, 211, 122, 0.15)' : 'rgba(255, 77, 79, 0.15)', 
                color: dbStatus === 'connected' ? '#2fd37a' : '#ff4d4f',
                padding: '6px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold'
              }}>
                {dbStatus === 'connected' ? '🟢 DB 연동됨' : '🔴 연결 끊김'}
              </span>

              <button className="btn" onClick={toggleTheme}>{theme === 'dark' ? '☀️' : '🌙'}</button>
            </div>
          </header>

          <section className="content">
            {activeTab === 'margin' && <MarginTab />}
            {activeTab === 'ranking' && <TopRankingTab />}
            {activeTab === 'reorder_alerts' && <ReorderTabPage onUrgentCountChange={setReorderUrgentCount} />}
            {activeTab === 'todo_list' && <TodoListTab />}
            {activeTab === 'stock_availability' && <StockAvailabilityTab />}
            {activeTab === 'product_mapping' && <ProductMappingTab />}
            {activeTab === 'sales_decline' && <SalesDeclineTab />}
            {activeTab === 'sales_surge' && <SalesSurgeTab />}
            {activeTab === 'new_popular' && <NewPopularTab />}
            {activeTab === 'stock_reconcile' && <StockReconcileTab />}
            {activeTab === 'stock_audit' && <StockAuditTab />}
            {activeTab === 'esangin_stock' && <EsanginStock menuType="stock" />}
            {activeTab === 'esangin_deadstock' && <EsanginStock menuType="deadstock" />}
          </section>
        </main>
      </div>
    </>
  );
}

export default App;