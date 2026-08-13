import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import Pagination from './Pagination';
import { Emoji } from './Icons';

const PAGE_SIZE = 20;
const CARD_BG = 'rgba(139, 92, 246, 0.12)';
const CARD_BORDER = '#8b5cf6';
const CARD_TEXT = '#7c3aed';

export default function NewPopularTab() {
  const [items, setItems] = useState([]);
  const [thisMonth, setThisMonth] = useState('');
  const [lastMonth, setLastMonth] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/new-popular`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        setItems(Array.isArray(result.data) ? result.data : []);
        setThisMonth(result.this_month || '');
        setLastMonth(result.last_month || '');
        setErrorMsg('');
      } else {
        setErrorMsg(result.message || '신규 인기상품 데이터를 불러오지 못했습니다.');
        setItems([]);
      }
    } catch (e) {
      console.error('신규 인기상품 조회 실패', e);
      setErrorMsg('신규 인기상품 데이터를 불러오지 못했습니다. 서버 연결을 확인해주세요.');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    setPage((p) => Math.min(p, maxPage));
  }, [items.length]);

  if (errorMsg) {
    return (
      <div className="reorder-alert-wrap">
        <div className="reorder-status-row reorder-status-empty">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Emoji>🆕</Emoji> {errorMsg}</span>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const shown = items.slice(start, start + PAGE_SIZE);

  return (
    <div className="reorder-alert-wrap">
      <div className="reorder-status-row reorder-status-ok">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Emoji>🆕</Emoji> {lastMonth}에는 없었는데 {thisMonth}에 새로 팔리기 시작한 상품
        </span>
        <button className="reorder-refresh-btn" onClick={fetchData} disabled={isLoading}>
          <Emoji>🔄</Emoji> {isLoading ? '확인 중...' : '새로고침'}
        </button>
      </div>

      <div className="reorder-summary-row">
        <span className="reorder-summary-total">신규 인기상품 {items.length}개</span>
      </div>

      {shown.length > 0 ? (
        <>
          {shown.map((item) => (
            <div
              key={item.product_name}
              className="reorder-alert-row"
              style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}
            >
              <div className="reorder-alert-msg">
                <span className="reorder-alert-icon"><Emoji>🆕</Emoji></span>
                <div className="reorder-alert-body">
                  <span className="reorder-alert-text" style={{ color: CARD_TEXT }}>
                    [{item.product_name}]
                  </span>
                  <span className="reorder-alert-sub">
                    이번달 {item.this_month}개 판매
                  </span>
                </div>
              </div>
            </div>
          ))}

          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      ) : (
        !isLoading && (
          <div className="reorder-status-row reorder-status-empty">
            <span>이번달 새로 팔리기 시작한 상품이 없습니다.</span>
          </div>
        )
      )}
    </div>
  );
}
