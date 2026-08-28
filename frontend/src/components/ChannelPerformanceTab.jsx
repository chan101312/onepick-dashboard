import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import { Emoji } from './Icons';

const GRADE_CONFIG = {
  danger: { label: '팔면 안됨', accent: 'var(--danger)' },
  caution: { label: '주의', accent: 'var(--amber)' },
  good: { label: '광고 추천', accent: 'var(--success)' },
};

const FILTER_TABS = [
  { key: 'all', label: '전체' },
  { key: 'danger', label: '팔면 안됨' },
  { key: 'caution', label: '주의' },
  { key: 'good', label: '광고 추천' },
];

export default function ChannelPerformanceTab() {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [filterMode, setFilterMode] = useState('all');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/channel-performance`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        setItems(Array.isArray(result.data) ? result.data : []);
        setErrorMsg('');
      } else {
        setErrorMsg(result.message || '채널 성과 데이터를 불러오지 못했습니다.');
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

  const hasGrade = (product, grade) => (product.channels || []).some((c) => c.grade === grade);

  const counts = {
    danger: items.filter((p) => hasGrade(p, 'danger')).length,
    caution: items.filter((p) => hasGrade(p, 'caution')).length,
    good: items.filter((p) => hasGrade(p, 'good')).length,
  };

  const filtered = filterMode === 'all' ? items : items.filter((p) => hasGrade(p, filterMode));

  return (
    <div className="responsive-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>
          <Emoji>📈</Emoji> 채널 성과 비교
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
          {items.length === 0 ? '채널 성과 데이터가 없습니다.' : '해당 조건의 상품이 없습니다.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map((product) => {
            const worstGrade = hasGrade(product, 'danger') ? 'danger' : hasGrade(product, 'caution') ? 'caution' : 'good';
            const worstCfg = GRADE_CONFIG[worstGrade];
            return (
              <div
                key={product.product_name}
                className="ui-card"
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderLeft: `3px solid ${worstCfg.accent}`, borderRadius: '16px', padding: '14px 16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>
                    {product.product_name}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>
                    원가 {product.cost.toLocaleString()}원
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px' }}>
                  {(product.channels || []).map((c) => {
                    const cfg = GRADE_CONFIG[c.grade] || GRADE_CONFIG.caution;
                    return (
                      <div
                        key={c.channel}
                        style={{
                          background: 'var(--surface-2)', borderRadius: '8px', padding: '8px 10px',
                          border: `1px solid color-mix(in srgb, ${cfg.accent} 40%, var(--border))`,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>{c.channel}</span>
                          <span style={{
                            fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px',
                            background: 'color-mix(in srgb, ' + cfg.accent + ' 15%, transparent)', color: cfg.accent, whiteSpace: 'nowrap',
                          }}>
                            {cfg.label}
                          </span>
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-3)' }}>판매가 {c.price.toLocaleString()}원</div>
                        <div style={{ fontSize: '10px', color: 'var(--text-3)' }}>마진액 {c.profit.toLocaleString()}원</div>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: cfg.accent, marginTop: '2px' }}>
                          마진율 {c.margin_rate}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
