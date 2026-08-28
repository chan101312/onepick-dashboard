import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import Pagination from './Pagination';
import { Emoji } from './Icons';

const SEVERITY_CONFIG = {
  caution: { icon: '🟡', label: '주의', bg: 'color-mix(in srgb, var(--amber) 12%, transparent)', border: 'var(--amber)', text: 'var(--amber)' },
  warning: { icon: '🟠', label: '경고', bg: 'color-mix(in srgb, var(--amber) 10%, var(--danger) 10%)', border: 'color-mix(in srgb, var(--amber) 45%, var(--danger) 55%)', text: 'color-mix(in srgb, var(--amber) 45%, var(--danger) 55%)' },
  critical: { icon: '🔴', label: '심각', bg: 'color-mix(in srgb, var(--danger) 12%, transparent)', border: 'var(--danger)', text: 'var(--danger)' },
};

const SORT_OPTIONS = [
  { key: 'decline_desc', label: '감소율순' },
  { key: 'volume_desc', label: '판매량순' },
  { key: 'revenue_desc', label: '매출감소액순' },
];

const PAGE_SIZE = 20;

function sortItems(list, sortMode) {
  const arr = [...list];
  switch (sortMode) {
    case 'volume_desc':
      arr.sort((a, b) => b.last_month - a.last_month);
      break;
    case 'revenue_desc':
      arr.sort((a, b) => (b.last_month_sales - b.this_month_sales) - (a.last_month_sales - a.this_month_sales));
      break;
    case 'decline_desc':
    default:
      arr.sort((a, b) => b.decline_rate - a.decline_rate);
      break;
  }
  return arr;
}

export default function SalesDeclineTab() {
  const [items, setItems] = useState([]);
  const [substituted, setSubstituted] = useState([]);
  const [substitutedOpen, setSubstitutedOpen] = useState(false);
  const [thisMonth, setThisMonth] = useState('');
  const [lastMonth, setLastMonth] = useState('');
  const [compareDays, setCompareDays] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sortMode, setSortMode] = useState('decline_desc');
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/sales-decline`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        setItems(Array.isArray(result.data) ? result.data : []);
        setSubstituted(Array.isArray(result.substituted) ? result.substituted : []);
        setThisMonth(result.this_month || '');
        setLastMonth(result.last_month || '');
        setCompareDays(result.compare_days || null);
        setErrorMsg('');
      } else {
        setErrorMsg(result.message || '판매 둔화 데이터를 불러오지 못했습니다.');
        setItems([]);
        setSubstituted([]);
      }
    } catch (e) {
      console.error('판매 둔화 조회 실패', e);
      setErrorMsg('판매 둔화 데이터를 불러오지 못했습니다. 서버 연결을 확인해주세요.');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 정렬이 바뀌면 1페이지부터
  useEffect(() => {
    setPage(1);
  }, [sortMode]);

  // 데이터가 갱신돼서 목록이 줄어들면 현재 페이지를 유효 범위로 당겨온다
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    setPage((p) => Math.min(p, maxPage));
  }, [items.length]);

  if (errorMsg) {
    return (
      <div className="reorder-alert-wrap">
        <div className="reorder-status-row reorder-status-empty">
          <span><Emoji>📉</Emoji> {errorMsg}</span>
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
          <Emoji>📉</Emoji> {lastMonth} → {thisMonth} 판매 비교
        </span>
        <button className="reorder-refresh-btn" onClick={fetchData} disabled={isLoading}>
          {isLoading ? <><Emoji>🔄</Emoji> 확인 중...</> : <><Emoji>🔄</Emoji> 새로고침</>}
        </button>
      </div>

      <div className="reorder-summary-row">
        <span className="reorder-summary-total">지난달{compareDays ? ` 1~${compareDays}일` : ""} 대비 30% 이상 감소 상품 {items.length}개</span>
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
            const cfg = SEVERITY_CONFIG[item.severity] || SEVERITY_CONFIG.caution;
            const revenueDrop = item.last_month_sales - item.this_month_sales;
            return (
              <div
                key={item.product_name}
                className="reorder-alert-row"
                style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
              >
                <div className="reorder-alert-msg">
                  <span className="reorder-alert-icon"><Emoji>{cfg.icon}</Emoji></span>
                  <div className="reorder-alert-body">
                    <span className="reorder-alert-text" style={{ color: cfg.text }}>
                      [{item.product_name}]
                    </span>
                    <span className="reorder-alert-sub">
                      지난달{compareDays ? ` 1~${compareDays}일` : ""} {item.last_month}개 → 이번달 {item.this_month}개 · 매출 감소액 {revenueDrop.toLocaleString()}원
                    </span>
                  </div>
                  <span className="decline-rate-badge">-{item.decline_rate}%</span>
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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Emoji>✨</Emoji> 지난달 대비 30% 이상 판매가 줄어든 상품이 없습니다.</span>
          </div>
        )
      )}

      {substituted.length > 0 && (
        <div className="reorder-deadstock-wrap">
          <button className="reorder-deadstock-toggle" onClick={() => setSubstitutedOpen((v) => !v)}>
            <Emoji>🔄</Emoji> 대체 공급처 전환 추정 — 확인 필요 ({substituted.length}개) {substitutedOpen ? '▲' : '▼'}
          </button>
          {substitutedOpen && (
            <div className="reorder-deadstock-list">
              <div className="substituted-hint">
                <Emoji>⚠️</Emoji> 상품명 유사도로 자동 추정한 결과입니다. 실제로 같은 상품인지는 사장님이 직접 확인해주세요.
              </div>
              {substituted.map((s, i) => (
                <div key={i} className="reorder-deadstock-item">
                  <span className="reorder-deadstock-name">
                    [{s.old_name}] → [{s.new_name}]
                  </span>
                  <span className="reorder-deadstock-detail">
                    지난달 {s.old_last_month_qty}개 → 이번달(대체 추정품) {s.new_this_month_qty}개
                    <span className={`confidence-badge confidence-${s.confidence}`}>
                      신뢰도 {s.confidence === 'high' ? '높음' : '중간'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
