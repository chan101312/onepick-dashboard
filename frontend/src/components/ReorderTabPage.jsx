import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import { DISMISS_KEY, loadDismissed, signature } from './reorderAlertUtils';
import Pagination from './Pagination';
import { Emoji, EmojiText } from './Icons';

const URGENCY_CONFIG = {
  urgent: { icon: '●', label: '즉시 발주 필요', accent: 'var(--danger)', text: 'var(--text)' },
  warning: { icon: '●', label: '발주 준비하세요', accent: 'color-mix(in srgb, var(--amber) 45%, var(--danger) 55%)', text: 'var(--text)' },
  notice: { icon: '●', label: '발주 예정 확인', accent: 'var(--amber)', text: 'var(--text)' },
};
const CARD_BG = 'var(--surface)';
const CARD_BORDER = 'var(--border)';
const CHIP_BG = 'var(--surface-2)';
const MUTED = 'var(--text-3)';

const SORT_OPTIONS = [
  { key: 'stock_asc', label: '재고 적은 순' },
  { key: 'sales_desc', label: '최근 30일 판매량 많은 순' },
  { key: 'days_asc', label: '예상 소진일수 적은 순' },
  { key: 'name_asc', label: '상품명 가나다순' },
];
const DEFAULT_SORT = 'stock_asc';

const TIER_TABS = [
  { key: 'all', label: '전체' },
  { key: 'high', label: '🔥 많이 팔림' },
  { key: 'low', label: '🐢 덜 팔림' },
];
const DEFAULT_TIER = 'all';

const PAGE_SIZE = 20;
const STALE_MS = 24 * 60 * 60 * 1000;
const SELECTED_KEY = 'reorder_selected_ids_v1';

function loadSelected() {
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function parseServerDate(str) {
  if (!str) return null;
  const iso = str.replace(' ', 'T');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sortAlerts(list, sortMode) {
  const arr = [...list];
  switch (sortMode) {
    case 'sales_desc':
      arr.sort((a, b) => (b.sales_30d ?? -Infinity) - (a.sales_30d ?? -Infinity));
      break;
    case 'days_asc':
      arr.sort((a, b) => (a.days_remaining ?? Infinity) - (b.days_remaining ?? Infinity));
      break;
    case 'name_asc':
      arr.sort((a, b) => a.product_name.localeCompare(b.product_name, 'ko'));
      break;
    case 'stock_asc':
    default:
      arr.sort((a, b) => a.current_stock - b.current_stock);
      break;
  }
  return arr;
}

export default function ReorderAlertBanner({ onUrgentCountChange } = {}) {
  const [alerts, setAlerts] = useState([]);
  const [deadstocks, setDeadstocks] = useState([]);
  const [lastUpdated, setLastUpdated] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [dismissed, setDismissed] = useState(loadDismissed);
  const [deadstockOpen, setDeadstockOpen] = useState(false);
  const [sortMode, setSortMode] = useState(DEFAULT_SORT);
  const [tierMode, setTierMode] = useState(DEFAULT_TIER);
  const [vendorMode, setVendorMode] = useState('all');
  const [alertPage, setAlertPage] = useState(1);
  const [deadstockPage, setDeadstockPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState(loadSelected);
  const [selectedOpen, setSelectedOpen] = useState(true);
  const [copyMsg, setCopyMsg] = useState('');

  const fetchAlerts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/reorder-alerts`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.error) {
        setErrorMsg(result.error);
        setAlerts([]);
        setDeadstocks([]);
        setLastUpdated('');
        setDataSource('');
      } else {
        setErrorMsg('');
        setAlerts(Array.isArray(result.alerts) ? result.alerts : []);
        setDeadstocks(Array.isArray(result.deadstocks) ? result.deadstocks : []);
        setLastUpdated(result.last_updated || '');
        setDataSource(result.data_source || '');
      }
    } catch (e) {
      console.error('재발주 알림 조회 실패', e);
      setErrorMsg('재발주 알림을 불러오지 못했습니다. 서버 연결을 확인해주세요.');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const persistSelected = (next) => {
    setSelectedIds(next);
    localStorage.setItem(SELECTED_KEY, JSON.stringify(next));
  };

  const toggleSelect = (id) => {
    const next = { ...selectedIds };
    if (next[id]) {
      delete next[id];
    } else {
      next[id] = true;
    }
    persistSelected(next);
  };

  const clearSelection = () => {
    persistSelected({});
  };

  const handleDismiss = (alert) => {
    const next = { ...dismissed, [alert.id]: signature(alert) };
    setDismissed(next);
    localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    if (selectedIds[alert.id]) {
      const nextSel = { ...selectedIds };
      delete nextSel[alert.id];
      persistSelected(nextSel);
    }
  };

  const handleRefreshClick = () => {
    setDismissed({});
    localStorage.removeItem(DISMISS_KEY);
    setAlertPage(1);
    setDeadstockPage(1);
    fetchAlerts();
  };

  const visibleAlerts = alerts.filter((a) => dismissed[a.id] !== signature(a));
  const urgentCount = visibleAlerts.filter((a) => a.urgency === 'urgent').length;

  useEffect(() => {
    onUrgentCountChange?.(urgentCount);
  }, [urgentCount, onUrgentCountChange]);

  useEffect(() => {
    setAlertPage(1);
  }, [sortMode, tierMode, vendorMode]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(visibleAlerts.length / PAGE_SIZE));
    setAlertPage((p) => Math.min(p, maxPage));
  }, [visibleAlerts.length]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(deadstocks.length / PAGE_SIZE));
    setDeadstockPage((p) => Math.min(p, maxPage));
  }, [deadstocks.length]);

  if (errorMsg) {
    return (
      <div className="reorder-alert-wrap">
        <div className="reorder-status-row reorder-status-empty">
          <span><Emoji>⚠️</Emoji> {errorMsg}</span>
        </div>
      </div>
    );
  }

  const updatedDate = parseServerDate(lastUpdated);
  const isStale = updatedDate ? (Date.now() - updatedDate.getTime()) > STALE_MS : false;

  const statusText = (
    <>
      {isStale
        ? <><Emoji>⚠️</Emoji> 데이터가 오래되었을 수 있어요. 새로고침으로 갱신하세요. (마지막 업데이트: {lastUpdated})</>
        : <><Emoji>✅</Emoji> E상인 연동 중 · 마지막 업데이트: {lastUpdated}</>}
      {dataSource === 'fallback' && <> · <Emoji>⚠️</Emoji> 실시간 DB 연결 실패, 추정치로 표시 중</>}
    </>
  );

  if (visibleAlerts.length === 0 && deadstocks.length === 0) {
    return (
      <div className="reorder-alert-wrap">
        <div className={`reorder-status-row ${isStale ? 'reorder-status-stale' : 'reorder-status-ok'}`}>
          <span>{statusText}</span>
          <button className="reorder-refresh-btn" onClick={handleRefreshClick} disabled={isLoading}>
            {isLoading ? <><Emoji>🔄</Emoji> 확인 중...</> : <><Emoji>🔄</Emoji> 새로고침</>}
          </button>
        </div>
      </div>
    );
  }

  const urgencyCounts = visibleAlerts.reduce((acc, a) => {
    acc[a.urgency] = (acc[a.urgency] || 0) + 1;
    return acc;
  }, {});

  const tierCounts = visibleAlerts.reduce((acc, a) => {
    const tier = a.sales_tier || 'low';
    acc[tier] = (acc[tier] || 0) + 1;
    return acc;
  }, {});

  const tierFilteredAlerts = tierMode === 'all'
    ? visibleAlerts
    : visibleAlerts.filter((a) => (a.sales_tier || 'low') === tierMode);

  const vendorCounts = tierFilteredAlerts.reduce((acc, a) => {
    const v = a.vendor || '미상';
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});
  const vendorTabs = Object.entries(vendorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10); // 알림에 등장하는 매입처 중 개수 많은 상위 10곳만 탭으로 노출 (너무 많으면 스크롤만 늘어남)

  const vendorFilteredAlerts = vendorMode === 'all'
    ? tierFilteredAlerts
    : tierFilteredAlerts.filter((a) => (a.vendor || '미상') === vendorMode);

  const sortedAlerts = sortAlerts(vendorFilteredAlerts, sortMode);
  const alertTotalPages = Math.max(1, Math.ceil(sortedAlerts.length / PAGE_SIZE));
  const alertStart = (alertPage - 1) * PAGE_SIZE;
  const shown = sortedAlerts.slice(alertStart, alertStart + PAGE_SIZE);

  const deadstockTotalPages = Math.max(1, Math.ceil(deadstocks.length / PAGE_SIZE));
  const deadstockStart = (deadstockPage - 1) * PAGE_SIZE;
  const shownDeadstocks = deadstocks.slice(deadstockStart, deadstockStart + PAGE_SIZE);

  const selectedList = sortAlerts(visibleAlerts, sortMode).filter((a) => selectedIds[a.id]);
  const allShownSelected = shown.length > 0 && shown.every((a) => selectedIds[a.id]);

  const selectAllShown = () => {
    const next = { ...selectedIds };
    shown.forEach((a) => { next[a.id] = true; });
    persistSelected(next);
  };

  const deselectAllShown = () => {
    const next = { ...selectedIds };
    shown.forEach((a) => { delete next[a.id]; });
    persistSelected(next);
  };

  const copySelectedList = () => {
    if (selectedList.length === 0) return;
    const lines = selectedList.map((a) => {
      const spec = a.spec ? ` ${a.spec}` : '';
      return `${a.product_name}${spec} - 현재재고 ${a.current_stock}개 · 발주필요(${a.urgency})`;
    });
    const text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopyMsg('복사되었어요!');
        setTimeout(() => setCopyMsg(''), 2000);
      });
    }
  };

  const markSelectedOnDemand = async () => {
    if (selectedList.length === 0) return;
    if (!window.confirm(`선택한 ${selectedList.length}개 상품을 당일매입형(재고를 미리 안 쌓아두는 상품)으로 등록할까요?\n등록하면 재발주 알림에서 완전히 제외됩니다.`)) return;
    let successCount = 0;
    let failCount = 0;
    for (const a of selectedList) {
      try {
        const res = await fetch(`${API_BASE}/api/reorder/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_name: a.product_name, on_demand: true }),
        });
        const result = await res.json().catch(() => ({}));
        if (res.ok && result.status === 'success') {
          successCount += 1;
        } else {
          failCount += 1;
        }
      } catch {
        failCount += 1;
      }
    }
    clearSelection();
    setCopyMsg(failCount > 0 ? `${successCount}개 등록, ${failCount}개 실패` : `${successCount}개 당일매입형으로 등록됨`);
    setTimeout(() => setCopyMsg(''), 3000);
    fetchAlerts();
  };

  return (
    <div className="reorder-alert-wrap">
      <div className={`reorder-status-row ${isStale ? 'reorder-status-stale' : 'reorder-status-ok'}`}>
        <span>{statusText}</span>
        <button className="reorder-refresh-btn" onClick={handleRefreshClick} disabled={isLoading}>
          {isLoading ? <><Emoji>🔄</Emoji> 확인 중...</> : <><Emoji>🔄</Emoji> 새로고침</>}
        </button>
      </div>

      {visibleAlerts.length > 0 && (
        <div className="reorder-summary-row" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', margin: '10px 0' }}>
          <span style={{ fontSize: '13px', color: URGENCY_CONFIG.urgent.accent, fontWeight: 600 }}>
            URGENT {urgencyCounts.urgent || 0}
          </span>
          <span style={{ fontSize: '13px', color: URGENCY_CONFIG.warning.accent, fontWeight: 600 }}>
            WARNING {urgencyCounts.warning || 0}
          </span>
          <span style={{ fontSize: '13px', color: URGENCY_CONFIG.notice.accent, fontWeight: 600 }}>
            NOTICE {urgencyCounts.notice || 0}
          </span>
          <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>· 총 발주 필요 {visibleAlerts.length}개</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', margin: '10px 0' }}>
        {TIER_TABS.map((t) => {
          const count = t.key === 'all' ? visibleAlerts.length : (tierCounts[t.key] || 0);
          const active = tierMode === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTierMode(t.key)}
              style={{
                padding: '8px 16px', borderRadius: '999px', fontSize: '13px', cursor: 'pointer',
                border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: active ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-3)',
                fontWeight: active ? 700 : 400,
              }}
            >
              <EmojiText text={t.label} /> ({count})
            </button>
          );
        })}
      </div>
      <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: 'var(--text-3)' }}>
        ※ 최근 30일 판매량 기준 상위 30%를 "많이 팔림"으로 자동 분류합니다. 회전 빠른 상품부터 먼저 확인하세요.
      </p>

      {vendorTabs.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <button
            onClick={() => setVendorMode('all')}
            style={{
              padding: '6px 14px', borderRadius: '999px', fontSize: '12px', cursor: 'pointer',
              border: vendorMode === 'all' ? '1px solid var(--accent)' : '1px solid var(--border)',
              background: vendorMode === 'all' ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
              color: vendorMode === 'all' ? 'var(--text)' : 'var(--text-3)',
              fontWeight: vendorMode === 'all' ? 700 : 400,
            }}
          >
            전체 매입처
          </button>
          {vendorTabs.map(([vendor, count]) => {
            const active = vendorMode === vendor;
            return (
              <button
                key={vendor}
                onClick={() => setVendorMode(vendor)}
                style={{
                  padding: '6px 14px', borderRadius: '999px', fontSize: '12px', cursor: 'pointer',
                  border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: active ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-3)',
                  fontWeight: active ? 700 : 400,
                }}
              >
                {vendor} ({count})
              </button>
            );
          })}
        </div>
      )}

      {tierFilteredAlerts.length > 1 && (
        <div className="reorder-sort-bar">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className={`reorder-sort-btn ${sortMode === opt.key ? 'reorder-sort-btn-active' : ''}`}
              onClick={() => setSortMode(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
          padding: '10px 14px', margin: '8px 0', background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)', borderRadius: '8px',
        }}
      >
        <button
          onClick={allShownSelected ? deselectAllShown : selectAllShown}
          className="tab-icon-btn"
          style={{
            border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)',
            background: allShownSelected ? 'color-mix(in srgb, var(--accent) 25%, transparent)' : 'transparent', color: 'var(--accent)',
          }}
        >
          {allShownSelected ? '현재 페이지 선택해제' : '현재 페이지 전체선택'}
        </button>
        <span style={{ color: 'var(--accent)', fontSize: '13px' }}>선택된 상품 {selectedList.length}개</span>
        {selectedList.length > 0 && (
          <>
            <button
              onClick={() => setSelectedOpen((v) => !v)}
              className="tab-icon-btn"
              style={{ border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)', color: 'var(--accent)' }}
            >
              선택 목록 {selectedOpen ? '접기' : '펼치기'}
            </button>
            <button
              onClick={copySelectedList}
              className="tab-icon-btn"
              style={{ border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)', color: 'var(--accent)' }}
            >
              목록 복사
            </button>
            <button
              onClick={markSelectedOnDemand}
              className="tab-icon-btn"
              style={{ border: '1px solid color-mix(in srgb, var(--amber) 50%, transparent)', color: 'var(--amber)' }}
              title="재고를 미리 안 쌓아두고 주문 시 매입하는 상품 - 등록하면 재발주 알림에서 제외됩니다"
            >
              <Emoji>🍢</Emoji> 당일매입형으로 등록
            </button>
            <button
              onClick={clearSelection}
              className="tab-icon-btn danger"
            >
              전체 해제
            </button>
            {copyMsg && <span style={{ color: 'var(--success)', fontSize: '13px' }}>{copyMsg}</span>}
          </>
        )}
      </div>

      {selectedOpen && selectedList.length > 0 && (
        <div style={{ marginBottom: '10px', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
          {selectedList.map((a) => {
            const cfg = URGENCY_CONFIG[a.urgency] || URGENCY_CONFIG.notice;
            return (
              <div
                key={a.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                  padding: '8px 14px', borderBottom: '1px solid var(--border)', background: CARD_BG,
                }}
              >
                <span style={{ color: cfg.text, fontSize: '13px' }}>
                  [{a.product_name}{a.spec ? ` ${a.spec}` : ''}] 현재재고 {a.current_stock}개
                </span>
                <button
                  onClick={() => toggleSelect(a.id)}
                  style={{ background: 'transparent', border: 'none', color: cfg.text, cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}
                  title="선택 해제"
                >
                  <Emoji>✕</Emoji>
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
        {shown.map((alert) => {
          const cfg = URGENCY_CONFIG[alert.urgency] || URGENCY_CONFIG.notice;
          return (
            <div
              key={alert.id}
              style={{
                display: 'flex', flexDirection: 'column', gap: '10px',
                background: CARD_BG, border: '1px solid var(--border)',
                borderTop: `3px solid ${cfg.accent}`, borderRadius: '16px',
                padding: '14px 16px',
              }}
              className="ui-card"
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                      padding: '2px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: 700,
                      background: 'var(--surface-2)', color: cfg.accent, letterSpacing: '0.03em',
                    }}
                  >
                    {alert.urgency.toUpperCase()}
                  </span>
                  {alert.sales_tier === 'high' && (
                    <span style={{ fontSize: '11px', padding: '2px 9px', borderRadius: '999px', background: 'var(--surface-2)', color: 'var(--text-3)', fontWeight: 600 }}>
                      많이 팔림
                    </span>
                  )}
                  {alert.vendor && (
                    <span style={{ fontSize: '11px', padding: '2px 9px', borderRadius: '999px', background: 'var(--surface-2)', color: 'var(--text-3)', fontWeight: 600 }}>
                      {alert.vendor}
                    </span>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={!!selectedIds[alert.id]}
                  onChange={() => toggleSelect(alert.id)}
                  style={{ width: '17px', height: '17px', cursor: 'pointer', flexShrink: 0, marginTop: '2px' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', lineHeight: 1.35 }}>
                  {alert.product_name}
                </div>
                {alert.spec && (
                  <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '2px' }}>
                    {alert.spec}
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                <div style={{ background: CHIP_BG, borderRadius: '8px', padding: '6px 10px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-3)', marginBottom: '2px' }}>현재 재고</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--danger)' }}>{alert.current_stock}개</div>
                </div>
                {alert.sales_30d != null && (
                  <div style={{ background: CHIP_BG, borderRadius: '8px', padding: '6px 10px' }}>
                    <div style={{ fontSize: '10px', color: 'var(--text-3)', marginBottom: '2px' }}>30일 판매</div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>{alert.sales_30d}개</div>
                  </div>
                )}
                {alert.daily_avg_sales != null && (
                  <div style={{ background: CHIP_BG, borderRadius: '8px', padding: '6px 10px' }}>
                    <div style={{ fontSize: '10px', color: 'var(--text-3)', marginBottom: '2px' }}>
                      일평균{alert.sales_cycle_days ? ` (${alert.sales_cycle_days}일)` : ''}
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>{alert.daily_avg_sales}개</div>
                  </div>
                )}
              </div>

              <button
                onClick={() => handleDismiss(alert)}
                className="tab-icon-btn"
                style={{ width: '100%', textAlign: 'center', fontWeight: 600 }}
              >
                발주 완료
              </button>
            </div>
          );
        })}
      </div>
      <Pagination currentPage={alertPage} totalPages={alertTotalPages} onPageChange={setAlertPage} />

      {deadstocks.length > 0 && (
        <div className="reorder-deadstock-wrap">
          <button className="reorder-deadstock-toggle" onClick={() => setDeadstockOpen((v) => !v)}>
            <Emoji>📦</Emoji> 데드스톡 주의 ({deadstocks.length}개) {deadstockOpen ? '▲' : '▼'}
          </button>
          {deadstockOpen && (
            <>
              <div className="reorder-deadstock-list">
                {shownDeadstocks.map((d) => (
                  <div key={d.id} className="reorder-deadstock-item">
                    <span className="reorder-deadstock-name">
                      [{d.product_name}{d.spec ? ` ${d.spec}` : ''}]
                    </span>
                    <span className="reorder-deadstock-detail">
                      재고 {d.current_stock}개 ·{' '}
                      {d.days_since_last_sale != null
                        ? `${d.days_since_last_sale}일간 미판매`
                        : '판매 기록 없음'}
                    </span>
                  </div>
                ))}
              </div>
              <Pagination currentPage={deadstockPage} totalPages={deadstockTotalPages} onPageChange={setDeadstockPage} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
