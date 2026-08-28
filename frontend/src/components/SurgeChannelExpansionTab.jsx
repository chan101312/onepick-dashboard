import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import { Emoji } from './Icons';

const SEVERITY_CONFIG = {
  explosive: { label: '급폭증', accent: 'var(--danger)' },
  high: { label: '급증', accent: 'var(--amber)' },
  notable: { label: '주목', accent: 'var(--highlight)' },
};

export default function SurgeChannelExpansionTab() {
  const [items, setItems] = useState([]);
  const [thisMonth, setThisMonth] = useState('');
  const [lastMonth, setLastMonth] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/sales-surge-channel-expansion`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        setItems(Array.isArray(result.data) ? result.data : []);
        setThisMonth(result.this_month || '');
        setLastMonth(result.last_month || '');
        setErrorMsg('');
      } else {
        setErrorMsg(result.message || '채널 확장 추천 데이터를 불러오지 못했습니다.');
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

  return (
    <div className="responsive-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>
          <Emoji>🚀</Emoji> 채널 확장 추천
          {(thisMonth || lastMonth) && (
            <span style={{ marginLeft: '10px', fontSize: '12px', fontWeight: 400, color: 'var(--text-3)' }}>
              {lastMonth} → {thisMonth}
            </span>
          )}
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

      {isLoading ? (
        <div style={{ padding: '50px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
          확인 중...
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: '50px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
          {errorMsg ? '' : '급증 상품이 없습니다.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {items.map((it) => {
            const cfg = SEVERITY_CONFIG[it.severity] || SEVERITY_CONFIG.notable;
            const sellingChannels = it.selling_channels || [];
            const missingChannels = it.missing_channels || [];
            return (
              <div
                key={it.product_name}
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
                  </div>
                  <span style={{ fontSize: '20px', fontWeight: 900, color: cfg.accent, whiteSpace: 'nowrap' }}>
                    +{it.growth_rate}%
                  </span>
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '6px' }}>
                  지난달 {it.last_month}개 → 이번달 {it.this_month}개
                  {it.has_margin_data === false && (
                    <span style={{ marginLeft: '8px', color: 'var(--text-3)', fontStyle: 'italic' }}>
                      · 마진 데이터 미등록
                    </span>
                  )}
                </div>

                {sellingChannels.length > 0 && (
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ fontSize: '10px', color: 'var(--text-3)', marginBottom: '4px' }}>이미 판매 중</div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {sellingChannels.map((ch) => (
                        <span key={ch} style={{
                          fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '999px',
                          background: 'var(--surface-2)', color: 'var(--text-3)',
                        }}>
                          {ch}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {missingChannels.length > 0 && (
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ fontSize: '10px', color: 'color-mix(in srgb, var(--highlight) 65%, var(--text) 35%)', fontWeight: 700, marginBottom: '4px' }}>
                      <Emoji>✨</Emoji> 이 채널에 등록하면 매출 기회!
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {missingChannels.map((ch) => (
                        <span key={ch} style={{
                          fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px',
                          background: 'var(--highlight)', color: '#1a1a1a',
                        }}>
                          {ch}
                        </span>
                      ))}
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
