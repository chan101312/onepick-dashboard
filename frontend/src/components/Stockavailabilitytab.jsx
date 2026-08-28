import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import { Emoji } from './Icons';

const AVAILABILITY_CONFIG = {
  out: { label: '품절', accent: 'var(--danger)' },
  not_found: { label: 'E상인 미등록', accent: 'var(--amber)' },
  low: { label: '재고 부족', accent: 'color-mix(in srgb, var(--amber) 45%, var(--danger) 55%)' },
  sufficient: { label: '충분', accent: 'var(--success)' },
};

function todayStr() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

export default function StockAvailabilityTab() {
  const [results, setResults] = useState([]);
  const [channelNotes, setChannelNotes] = useState({});
  const [date, setDate] = useState(todayStr());
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [filterMode, setFilterMode] = useState('all');

  const fetchCheck = useCallback(async (targetDate) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/stock-availability-check?date=${encodeURIComponent(targetDate)}`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        setResults(result.results || []);
        setChannelNotes(result.channel_notes || {});
        setErrorMsg('');
      } else {
        setErrorMsg(result.message || '재고 대조에 실패했습니다.');
        setResults([]);
      }
    } catch (e) {
      setErrorMsg('서버에 연결할 수 없습니다.');
      setResults([]);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchCheck(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => fetchCheck(date);

  const counts = results.reduce((acc, r) => {
    acc[r.availability] = (acc[r.availability] || 0) + 1;
    return acc;
  }, {});

  const filtered = filterMode === 'all' ? results : results.filter((r) => r.availability === filterMode);

  return (
    <div className="responsive-container">
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)',
            background: 'var(--surface-2)', color: 'var(--text)', fontSize: '14px',
          }}
        />
        <button onClick={handleSearch} className="esangin-btn" disabled={isLoading}>
          {isLoading ? '확인 중...' : '조회'}
        </button>
        {Object.entries(channelNotes).map(([ch, note]) => (
          <span
            key={ch}
            style={{
              fontSize: '12px', padding: '4px 10px', borderRadius: '999px',
              background: note.status === 'ok' ? 'color-mix(in srgb, var(--success) 12%, transparent)' : 'color-mix(in srgb, var(--danger) 12%, transparent)',
              color: note.status === 'ok' ? 'var(--success)' : 'var(--danger)', fontWeight: 600,
            }}
          >
            {ch}: {note.status === 'ok' ? `주문 ${note.order_count}건` : (note.message || '오류')}
          </span>
        ))}
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
        {[
          { key: 'all', label: '전체', count: results.length },
          { key: 'out', label: '품절', count: counts.out || 0 },
          { key: 'not_found', label: 'E상인 미등록', count: counts.not_found || 0 },
          { key: 'low', label: '재고 부족', count: counts.low || 0 },
          { key: 'sufficient', label: '충분', count: counts.sufficient || 0 },
        ].map((t) => {
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
              {t.label} ({t.count})
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
          {results.length === 0 ? '해당 날짜에 온라인 주문이 없습니다.' : '해당 조건의 상품이 없습니다.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map((r, idx) => {
            const cfg = AVAILABILITY_CONFIG[r.availability] || AVAILABILITY_CONFIG.sufficient;
            return (
              <div
                key={idx}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderLeft: `3px solid ${cfg.accent}`, borderRadius: '16px', padding: '12px 16px',
                }}
                className="ui-card"
              >
                <span style={{
                  fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px',
                  background: 'var(--surface-2)', color: cfg.accent, flexShrink: 0,
                }}>
                  {cfg.label}
                </span>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <div style={{ fontSize: '14px', color: 'var(--text)', fontWeight: 600 }}>
                    {r.product_name}
                  </div>
                  {r.matched_name && (
                    <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '2px' }}>
                      E상인: {r.matched_name}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '16px', flexShrink: 0 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: 'var(--text-3)' }}>주문 수량</div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>{r.ordered_qty}개</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: 'var(--text-3)' }}>E상인 재고</div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: cfg.accent }}>
                      {r.esangin_stock == null ? '—' : `${r.esangin_stock}개`}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}