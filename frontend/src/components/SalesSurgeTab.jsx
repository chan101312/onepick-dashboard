import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import Pagination from './Pagination';

const SEVERITY_CONFIG = {
  notable: { icon: '🟢', label: '주목', bg: 'rgba(74, 222, 128, 0.14)', border: '#4ade80', text: '#16a34a' },
  high: { icon: '📈', label: '급증', bg: 'rgba(34, 197, 94, 0.14)', border: '#22c55e', text: '#15803d' },
  explosive: { icon: '🚀', label: '폭발적', bg: 'rgba(22, 163, 74, 0.16)', border: '#16a34a', text: '#166534' },
};

const SORT_OPTIONS = [
  { key: 'growth_desc', label: '급증률순' },
  { key: 'increase_desc', label: '증가수량순' },
  { key: 'volume_desc', label: '이번달 판매량순' },
];

const PAGE_SIZE = 20;

function sortItems(list, sortMode) {
  const arr = [...list];
  switch (sortMode) {
    case 'increase_desc':
      arr.sort((a, b) => (b.this_month - b.last_month) - (a.this_month - a.last_month));
      break;
    case 'volume_desc':
      arr.sort((a, b) => b.this_month - a.this_month);
      break;
    case 'growth_desc':
    default:
      arr.sort((a, b) => b.growth_rate - a.growth_rate);
      break;
  }
  return arr;
}

export default function SalesSurgeTab() {
  const [items, setItems] = useState([]);
  const [thisMonth, setThisMonth] = useState('');
  const [lastMonth, setLastMonth] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sortMode, setSortMode] = useState('growth_desc');
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/sales-surge`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        setItems(Array.isArray(result.data) ? result.data : []);
        setThisMonth(result.this_month || '');
        setLastMonth(result.last_month || '');
        setErrorMsg('');
      } else {
        setErrorMsg(result.message || '판매 급증 데이터를 불러오지 못했습니다.');
        setItems([]);
      }
    } catch (e) {
      console.error('판매 급증 조회 실패', e);
      setErrorMsg('판매 급증 데이터를 불러오지 못했습니다. 서버 연결을 확인해주세요.');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [sortMode]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    setPage((p) => Math.min(p, maxPage));
  }, [items.length]);

  if (errorMsg) {
    return (
      <div className="reorder-alert-wrap">
        <div className="reorder-status-row reorder-status-empty">
          <span>📈 {errorMsg}</span>
        </div>
      </div>
    );
  }

  const sorted = sortItems(items, sortMode);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const shown = sorted.slice(start, start + PAGE_SIZE);

  return (
    <div className="reorder-alert-wrap">
      <div className="reorder-status-row reorder-status-ok">
        <span>
          📈 {lastMonth} → {thisMonth} 판매 비교
        </span>
        <button className="reorder-refresh-btn" onClick={fetchData} disabled={isLoading}>
          {isLoading ? '🔄 확인 중...' : '🔄 새로고침'}
        </button>
      </div>

      <div className="reorder-summary-row">
        <span className="reorder-summary-total">지난달 대비 30% 이상 급증 상품 {items.length}개</span>
      </div>

      {items.length > 0 ? (
        <>
          {items.length > 1 && (
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

          {shown.map((item) => {
            const cfg = SEVERITY_CONFIG[item.severity] || SEVERITY_CONFIG.notable;
            const qtyIncrease = item.this_month - item.last_month;
            return (
              <div
                key={item.product_name}
                className="reorder-alert-row"
                style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
              >
                <div className="reorder-alert-msg">
                  <span className="reorder-alert-icon">{cfg.icon}</span>
                  <div className="reorder-alert-body">
                    <span className="reorder-alert-text" style={{ color: cfg.text }}>
                      [{item.product_name}]
                    </span>
                    <span className="reorder-alert-sub">
                      지난달 {item.last_month}개 → 이번달 {item.this_month}개 · 증가 수량 {qtyIncrease}개
                    </span>
                  </div>
                  <span className="surge-rate-badge">+{item.growth_rate}%</span>
                  <span className="reorder-alert-badge" style={{ background: cfg.border }}>{cfg.label}</span>
                </div>
              </div>
            );
          })}

          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      ) : (
        !isLoading && (
          <div className="reorder-status-row reorder-status-empty">
            <span>지난달 대비 30% 이상 급증한 상품이 없습니다.</span>
          </div>
        )
      )}
    </div>
  );
}
