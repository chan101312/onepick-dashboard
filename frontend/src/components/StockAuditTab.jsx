import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import { Emoji } from './Icons';

export default function StockAuditTab() {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [physicalQty, setPhysicalQty] = useState('');
  const [lastResult, setLastResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/stock-audit/history`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.status === 'success') setHistory(Array.isArray(result.data) ? result.data : []);
    } catch (e) {
      console.error('실사 이력 조회 실패', e);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleSearch = async () => {
    setIsSearching(true);
    try {
      const res = await fetch(`${API_BASE}/api/stock-audit/search?q=${encodeURIComponent(query)}`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      setCandidates(result.status === 'success' ? result.data : []);
    } catch (e) {
      console.error('상품 검색 실패', e);
      setCandidates([]);
    }
    setIsSearching(false);
  };

  const handleSelect = (product) => {
    setSelected(product);
    setCandidates([]);
    setQuery(product.product_name);
  };

  const handleSave = async () => {
    if (!selected) {
      alert('먼저 상품을 검색해서 선택해주세요.');
      return;
    }
    if (physicalQty === '') {
      alert('실물 수량을 입력해주세요.');
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/stock-audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_name: selected.product_name, physical_qty: Number(physicalQty) }),
      });
      const result = await res.json();
      if (result.status === 'success') {
        setLastResult(result.data);
        setPhysicalQty('');
        setSelected(null);
        setQuery('');
        fetchHistory();
      } else {
        alert(result.message || '저장 실패');
      }
    } catch (e) {
      alert('저장 실패: ' + e.message);
    }
    setIsSaving(false);
  };

  return (
    <div className="reorder-alert-wrap">
      <div className="reorder-status-row reorder-status-ok">
        <span><Emoji>📋</Emoji> 재고 실사 — 상품 검색 후 실물 수량 입력 (배민상회 등 API 미제공 채널 대상)</span>
      </div>

      <div className="reorder-settings-panel" style={{ marginTop: 0 }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
          <input
            type="text"
            placeholder="상품명 검색 (E상인 기준)"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={{ flex: 1, minWidth: '200px' }}
          />
          <button className="esangin-btn" onClick={handleSearch} disabled={isSearching}>
            {isSearching ? '검색 중...' : '검색'}
          </button>
        </div>

        {candidates.length > 0 && (
          <div className="audit-candidate-list">
            {candidates.map((c) => (
              <button key={c.product_name} className="audit-candidate-item" onClick={() => handleSelect(c)}>
                <span>{c.product_name}</span>
                <span className="audit-candidate-qty">시스템 재고 {c.system_qty}개</span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="audit-selected-row">
            <span>선택됨: <strong>{selected.product_name}</strong> (시스템 재고 {selected.system_qty}개)</span>
            <input
              type="number"
              placeholder="실물 수량"
              value={physicalQty}
              onChange={(e) => setPhysicalQty(e.target.value)}
              style={{ width: '120px' }}
            />
            <button className="esangin-btn" onClick={handleSave} disabled={isSaving}>
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        )}

        {lastResult && (
          <div className={`audit-result-banner ${lastResult.mismatch ? 'audit-result-mismatch' : 'audit-result-match'}`}>
            {lastResult.mismatch
              ? <><Emoji>⚠️</Emoji> 불일치: [{lastResult.product_name}] 실물 {lastResult.physical_qty}개 vs 시스템 {lastResult.system_qty}개 (차이 {lastResult.diff > 0 ? '+' : ''}{lastResult.diff})</>
              : <><Emoji>✅</Emoji> 일치: [{lastResult.product_name}] {lastResult.physical_qty}개</>}
          </div>
        )}
      </div>

      <div className="reorder-settings-section">
        <div className="reorder-deadstock-toggle" style={{ cursor: 'default' }}>
          <Emoji>🗂️</Emoji> 실사 이력 ({history.length}건)
        </div>
        <div className="reorder-deadstock-list" style={{ marginTop: '10px' }}>
          {history.length > 0 ? (
            history.slice(0, 50).map((h, i) => (
              <div key={i} className="reorder-deadstock-item">
                <span className="reorder-deadstock-name">
                  {h.date} · [{h.product_name}]
                </span>
                <span className="reorder-deadstock-detail">
                  실물 {h.physical_qty}개 · 시스템 {h.system_qty ?? '?'}개
                  {h.diff != null && ` · 차이 ${h.diff > 0 ? '+' : ''}${h.diff}`}{' '}
                  <span className={`confidence-badge ${h.mismatch ? 'confidence-medium' : 'confidence-high'}`}>
                    {h.mismatch ? '불일치' : '일치'}
                  </span>
                </span>
              </div>
            ))
          ) : (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-2)' }}>실사 이력이 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}
