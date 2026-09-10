import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import { Emoji } from './Icons';

// 재발주 탭 > "제외목록" 서브탭.
// on_demand=true(당일매입형)로 지정돼 재발주 알림에서 빠진 상품들을 모아 보여주고,
// "제외 해제"로 다시 알림 대상에 넣는다. 저장/조회는 /api/reorder/on-demand 하나로 처리.
export default function ReorderExclusionList() {
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true); // 마운트 시 바로 조회하므로 true로 시작
  const [errorMsg, setErrorMsg] = useState('');
  const [busyName, setBusyName] = useState('');

  const fetchRows = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/reorder/on-demand`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        setRows(Array.isArray(result.data) ? result.data : []);
        setErrorMsg('');
      } else {
        setRows([]);
        setErrorMsg(result.message || '제외목록을 불러오지 못했습니다.');
      }
    } catch (e) {
      console.error('제외목록 조회 실패', e);
      setErrorMsg('제외목록을 불러오지 못했습니다. 서버 연결을 확인해주세요.');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // 이펙트 본문에서 setState를 동기로 호출하지 않도록 async IIFE로 한 틱 미룬다.
    (async () => { await fetchRows(); })();
  }, [fetchRows]);

  const handleRestore = async (row) => {
    if (busyName) return;
    if (!window.confirm(`[${row.product_name}]을(를) 제외 해제할까요?\n다음 재발주 알림 조회부터 다시 발주 대상에 포함됩니다.`)) return;
    setBusyName(row.product_name);
    setRows((prev) => prev.filter((r) => r.product_name !== row.product_name)); // 낙관적 제거
    try {
      const res = await fetch(`${API_BASE}/api/reorder/on-demand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_name: row.product_name, on_demand: false }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.status !== 'success') {
        setErrorMsg('제외 해제 저장에 실패했습니다. 목록을 새로고침 해주세요.');
        fetchRows();
      }
    } catch (e) {
      console.error('제외 해제 실패', e);
      setErrorMsg('제외 해제 저장에 실패했습니다. 서버 연결을 확인해주세요.');
      fetchRows();
    }
    setBusyName('');
  };

  const th = {
    padding: '12px 14px', textAlign: 'left', color: 'var(--text-3)', fontSize: '13px',
    fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
  };
  const td = { padding: '10px 14px', fontSize: '13px', color: 'var(--text)', verticalAlign: 'middle' };

  return (
    <div>
      {isLoading && (
        <div className="reorder-loading-overlay">
          <div className="reorder-big-spinner" />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)' }}>
          당일매입형으로 지정돼 재발주 알림에서 제외된 상품 목록입니다. "제외 해제"하면 다시 발주 대상에 포함됩니다.
        </p>
        <button
          onClick={fetchRows}
          disabled={isLoading}
          className="tab-icon-btn"
          style={{ marginLeft: 'auto' }}
        >
          <Emoji>🔄</Emoji> {isLoading ? '불러오는 중...' : '새로고침'}
        </button>
      </div>

      {errorMsg && (
        <div style={{
          marginBottom: '12px', padding: '10px 14px', borderRadius: '8px',
          background: 'color-mix(in srgb, var(--amber) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--amber) 35%, transparent)',
          color: 'var(--amber)', fontSize: '12px', fontWeight: 600,
        }}>
          <Emoji>⚠️</Emoji> {errorMsg}
        </div>
      )}

      <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'var(--surface-2)' }}>
              <tr>
                <th style={th}>상품명</th>
                <th style={th}>규격</th>
                <th style={th}>매입처</th>
                <th style={th}>제외 설정일</th>
                <th style={{ ...th, textAlign: 'center' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? (
                rows.map((r) => (
                  <tr key={r.id || r.product_name} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.product_name}</td>
                    <td style={{ ...td, color: 'var(--text-3)' }}>{r.spec || '-'}</td>
                    <td style={{ ...td, color: 'var(--text-3)' }}>{r.vendor || '-'}</td>
                    <td style={{ ...td, color: 'var(--text-3)' }}>{r.on_demand_since || '-'}</td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <button
                        onClick={() => handleRestore(r)}
                        disabled={busyName === r.product_name}
                        className="tab-icon-btn"
                        style={{ padding: '5px 12px', fontSize: '12px' }}
                      >
                        제외 해제
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
                    {isLoading ? '불러오는 중...' : '제외된 상품이 없습니다. 재발주 알림의 요약 보기 > 표 보기에서 "제외" 버튼으로 추가할 수 있어요.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
