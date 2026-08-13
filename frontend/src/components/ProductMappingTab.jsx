import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import { Emoji } from './Icons';

export default function ProductMappingTab() {
  const [mapping, setMapping] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [search, setSearch] = useState('');
  const [newEsangin, setNewEsangin] = useState('');
  const [newAlias, setNewAlias] = useState('');

  const fetchMapping = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/product-mapping`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        setMapping(result.data || []);
        setErrorMsg('');
      } else {
        setErrorMsg(result.message || '매핑 목록을 불러오지 못했습니다.');
      }
    } catch (e) {
      setErrorMsg('서버에 연결할 수 없습니다.');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchMapping();
  }, [fetchMapping]);

  const addMapping = async () => {
    const esangin = newEsangin.trim();
    const alias = newAlias.trim();
    if (!esangin || !alias) {
      alert('E상인 상품명과 온라인 상품명을 둘 다 입력해주세요.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/order-reconcile/confirm-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_product_name: alias, esangin_core_name: esangin }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.status === 'success') {
        setNewEsangin('');
        setNewAlias('');
        fetchMapping();
      } else {
        alert(`등록 실패: ${result.message || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert(`등록 실패: 서버에 연결할 수 없습니다. (${e.message})`);
    }
  };

  const deleteAlias = async (esanginName, alias) => {
    if (!window.confirm(`"${alias}" 별칭을 삭제할까요?`)) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/product-mapping/${encodeURIComponent(esanginName)}?alias=${encodeURIComponent(alias)}`,
        { method: 'DELETE' }
      );
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.status === 'success') {
        fetchMapping();
      } else {
        alert(`삭제 실패: ${result.message || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert(`삭제 실패: 서버에 연결할 수 없습니다. (${e.message})`);
    }
  };

  const deleteEntry = async (esanginName) => {
    if (!window.confirm(`"${esanginName}" 매핑 전체를 삭제할까요? (모든 별칭이 함께 삭제됩니다)`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/product-mapping/${encodeURIComponent(esanginName)}`, {
        method: 'DELETE',
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.status === 'success') {
        fetchMapping();
      } else {
        alert(`삭제 실패: ${result.message || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert(`삭제 실패: 서버에 연결할 수 없습니다. (${e.message})`);
    }
  };

  const filtered = search.trim()
    ? mapping.filter((m) =>
        m.esangin_core_name.includes(search) ||
        (m.aliases || []).some((a) => a.includes(search))
      )
    : mapping;

  return (
    <div className="responsive-container">
      <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'var(--text-3)' }}>
        재고 정합성 대조에서 상품명이 자동으로 안 맞아떨어질 때, 온라인 상품명과 E상인 상품명을
        수동으로 짝지어 등록하는 화면입니다. 한 번 등록하면 이후 계속 자동으로 매칭됩니다.
      </p>

      <div style={{
        background: 'var(--surface)', borderRadius: '14px', border: '1px solid var(--border)',
        padding: '16px', marginBottom: '20px',
      }}>
        <div style={{ fontWeight: 700, marginBottom: '10px', color: 'var(--text)' }}><Emoji>➕</Emoji> 새 매핑 등록</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
          <input
            type="text"
            placeholder="E상인 상품명 (예: [장터]-우동국물)"
            value={newEsangin}
            onChange={(e) => setNewEsangin(e.target.value)}
            style={{
              padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)',
              background: 'rgba(255,255,255,0.04)', color: 'var(--text)', fontSize: '14px', outline: 'none',
            }}
          />
          <input
            type="text"
            placeholder="온라인 상품명 (예: 장터국수 우동국물1.8L X 6개)"
            value={newAlias}
            onChange={(e) => setNewAlias(e.target.value)}
            style={{
              padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)',
              background: 'rgba(255,255,255,0.04)', color: 'var(--text)', fontSize: '14px', outline: 'none',
            }}
          />
          <button onClick={addMapping} className="esangin-btn">등록</button>
        </div>
      </div>

      {errorMsg && (
        <div style={{
          marginBottom: '16px', padding: '12px 16px', borderRadius: '10px',
          background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 35%, transparent)',
          color: 'var(--amber)', fontSize: '13px', fontWeight: 600,
        }}>
          <Emoji>⚠️</Emoji> {errorMsg}
        </div>
      )}

      <input
        type="text"
        placeholder="상품명으로 검색..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: '100%', maxWidth: '400px', padding: '10px 12px', borderRadius: '8px',
          border: '1px solid var(--border)', background: 'rgba(255,255,255,0.04)',
          color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px',
        }}
      />

      {isLoading ? (
        <div style={{ padding: '50px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
          불러오는 중...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '50px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
          {mapping.length === 0 ? '등록된 매핑이 없습니다.' : '검색 결과가 없습니다.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map((m) => (
            <div
              key={m.esangin_core_name}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: '10px', padding: '14px 16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>
                  {m.esangin_core_name}
                </span>
                <button
                  onClick={() => deleteEntry(m.esangin_core_name)}
                  style={{
                    background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5',
                    borderRadius: '6px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer',
                  }}
                >
                  전체 삭제
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {(m.aliases || []).map((alias) => (
                  <div
                    key={alias}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                      background: 'var(--surface-2)', borderRadius: '8px', padding: '8px 12px',
                    }}
                  >
                    <span style={{ fontSize: '13px', color: 'var(--text-2, var(--text-3))' }}>{alias}</span>
                    <button
                      onClick={() => deleteAlias(m.esangin_core_name, alias)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '14px', lineHeight: 1 }}
                      title="이 별칭만 삭제"
                    >
                      <Emoji>✕</Emoji>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
