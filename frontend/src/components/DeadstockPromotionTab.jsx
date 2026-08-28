import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import { Emoji } from './Icons';

const URGENCY_CONFIG = {
  clear_now: { label: '즉시 정리', accent: 'var(--danger)' },
  discount_ok: { label: '할인 가능', accent: 'var(--amber)' },
  unknown_margin: { label: '마진 미상', accent: 'var(--text-3)' },
};

const REASON_LABEL = {
  sold_out_stale: '품절 상태로 오래 방치됨',
  no_sales_record: '판매 기록 자체가 없음',
  slow_moving: '재고는 있는데 60일 넘게 안 팔림',
};

const FILTER_TABS = [
  { key: 'all', label: '전체' },
  { key: 'clear_now', label: '즉시 정리' },
  { key: 'discount_ok', label: '할인 가능' },
  { key: 'unknown_margin', label: '마진 미상' },
];

export default function DeadstockPromotionTab() {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [filterMode, setFilterMode] = useState('all');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/deadstock-promotion`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        setItems(Array.isArray(result.data) ? result.data : []);
        setErrorMsg('');
      } else {
        setErrorMsg(result.message || '재고 처분 추천 데이터를 불러오지 못했습니다.');
        setItems([]);
      }
    } catch (e) {
      setErrorMsg('서버에 연결할 수 없습니다.');
      setItems([]);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const counts = items.reduce((acc, it) => {
    acc[it.urgency] = (acc[it.urgency] || 0) + 1;
    return acc;
  }, {});

  const filtered = filterMode === 'all' ? items : items.filter((it) => it.urgency === filterMode);

  return (
    <div className="responsive-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>
          <Emoji>🏷️</Emoji> 재고 처분 추천
        </div>
        <button onClick={fetchData} className="esangin-btn" disabled={isLoading}>
          {isLoading ? '확인 중...' : '새로고침'}
        </button>
      </div>

      {errorMsg && (
        <div style={{
          marginBottom: '16px', padding: '12px 16px', borderRadius: '16px',
          background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 35%, transparent)',
          color: 'var(--amber)', fontSize: '13px', fontWeight: 600,
        }}>
          <Emoji>⚠️</Emoji> {errorMsg}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {FILTER_TABS.map((t) => {
          const count = t.key === 'all' ? items.length : (counts[t.key] || 0);
          const active = filterMode === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setFilterMode(t.key)}
              style={{
                padding: '8px 16px', borderRadius: '999px', fontSize: '13px', cursor: 'pointer',
                border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: active ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
                color: active ? 'var(--text)' : 'var(--text-3)',
                fontWeight: active ? 700 : 400,
              }}
            >
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div style={{ padding: '50px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
          확인 중...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '50px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
          {items.length === 0 ? '처분이 필요한 재고가 없습니다.' : '해당 조건의 상품이 없습니다.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map((it) => {
            const cfg = URGENCY_CONFIG[it.urgency] || URGENCY_CONFIG.unknown_margin;
            const hasMargin = it.cost != null && it.price != null && it.margin_rate != null;
            return (
              <div
                key={it.id}
                className="ui-card"
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderLeft: `3px solid ${cfg.accent}`, borderRadius: '16px', padding: '14px 16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px',
                      background: 'var(--surface-2)', color: cfg.accent, flexShrink: 0,
                    }}>
                      {cfg.label}
                    </span>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>
                      {it.product_name}
                    </span>
                    {it.spec && (
                      <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>{it.spec}</span>
                    )}
                  </div>
                  {it.suggested_discount_pct != null && (
                    <span style={{ fontSize: '13px', fontWeight: 700, color: cfg.accent, whiteSpace: 'nowrap' }}>
                      추천 할인 {it.suggested_discount_pct}%
                    </span>
                  )}
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '6px' }}>
                  {REASON_LABEL[it.reason] || it.reason} · 재고 {it.current_stock}개 · {it.days_since_last_sale != null ? `${it.days_since_last_sale}일간 미판매` : '판매 기록 없음'}
                  {it.last_sales_date && ` · 마지막 판매 ${it.last_sales_date}`}
                </div>

                {hasMargin && (
                  <div style={{ display: 'flex', gap: '16px', marginTop: '10px', flexWrap: 'wrap' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-3)' }}>원가</div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>{it.cost.toLocaleString()}원</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-3)' }}>판매가</div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>{it.price.toLocaleString()}원</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-3)' }}>마진율</div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: it.margin_rate < 0 ? 'var(--danger)' : 'var(--success)' }}>
                        {it.margin_rate}%
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
