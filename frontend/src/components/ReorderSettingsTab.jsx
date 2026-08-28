import React, { useState, useEffect } from 'react';
import { API_BASE } from '../apiBase';

const emptyForm = { product_name: '', lead_time_days: 3, safety_stock_days: 7, sales_cycle_days: 14, on_demand: false };
const SALES_CYCLE_OPTIONS = [
  { value: 7, label: '7일 (매주 발주)' },
  { value: 14, label: '14일 (격주 발주)' },
  { value: 30, label: '30일 (한 달 1번 발주)' },
];

// 서버가 {status:'error', message} 형태가 아닌 FastAPI 기본 에러({detail:...})로
// 네트워크 실패로 응답이 안돼도 사용자가 원인을 알 수 있게 실제 에러 텍스트를 찾아낸다.
function extractErrorMessage(result, res) {
  if (result?.message) return result.message;
  if (result?.detail) {
    if (typeof result.detail === 'string') return result.detail;
    if (Array.isArray(result.detail)) return result.detail.map((d) => d.msg || JSON.stringify(d)).join(', ');
  }
  return `HTTP ${res.status} ${res.statusText || ''}`.trim();
}

export default function ReorderSettingsTab() {
  const [configs, setConfigs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newConfig, setNewConfig] = useState(emptyForm);
  const [editRows, setEditRows] = useState({}); // id -> 수정 중인 값
  const [esanginProducts, setEsanginProducts] = useState([]);
  const [esanginError, setEsanginError] = useState('');

  const fetchConfigs = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/reorder/products`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.status === 'success') setConfigs(result.data || []);
    } catch (e) {
      console.error('재발주 설정 조회 실패', e);
    }
    setIsLoading(false);
  };

  const fetchEsanginProducts = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/reorder/esangin-products`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        setEsanginProducts(result.data || []);
        setEsanginError('');
      } else {
        setEsanginProducts([]);
        setEsanginError(result.message || 'E상인 상품 목록을 불러오지 못했습니다.');
      }
    } catch (e) {
      console.error('E상인 상품 목록 조회 실패', e);
      setEsanginProducts([]);
      setEsanginError('E상인 상품 목록을 불러오지 못했습니다. 서버 연결을 확인해주세요.');
    }
  };

  useEffect(() => {
    fetchConfigs();
    fetchEsanginProducts();
  }, []);

  // 드롭다운 옵션: E상인 상품 목록 + (기존 설정은 살아있지만 지금은 E상인 목록에 없는 상품명도 실수 없이 표시)
  const buildProductOptions = (currentValue) => {
    const options = esanginProducts.map((p) => ({ value: p.name, label: p.spec ? `${p.name} (${p.spec})` : p.name }));
    if (currentValue && !options.some((o) => o.value === currentValue)) {
      options.unshift({ value: currentValue, label: `${currentValue} (E상인 목록에 없음)` });
    }
    return options;
  };

  const handleAddConfig = async () => {
    if (!newConfig.product_name) {
      alert('E상인 상품 목록에서 상품을 선택해주세요.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/reorder/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: newConfig.product_name,
          lead_time_days: Number(newConfig.lead_time_days) || 0,
          safety_stock_days: Number(newConfig.safety_stock_days) || 0,
          sales_cycle_days: Number(newConfig.sales_cycle_days) || 14,
          on_demand: !!newConfig.on_demand,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.status === 'success') {
        setConfigs((prev) => [...prev, result.data]);
        setNewConfig(emptyForm);
      } else {
        alert(`추가 실패: ${extractErrorMessage(result, res)}`);
      }
    } catch (e) {
      alert(`추가 실패: 서버에 연결할 수 없습니다. (${e.message})`);
    }
  };

  const getDraft = (c) => editRows[c.id] || c;

  const handleFieldChange = (id, field, value) => {
    setEditRows((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || configs.find((c) => c.id === id)), [field]: value },
    }));
  };

  const handleSaveRow = async (id) => {
    const draft = editRows[id];
    if (!draft) return;
    if (!String(draft.product_name).trim()) {
      alert('상품을 선택해주세요.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/reorder/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: draft.product_name,
          lead_time_days: Number(draft.lead_time_days) || 0,
          safety_stock_days: Number(draft.safety_stock_days) || 0,
          sales_cycle_days: Number(draft.sales_cycle_days) || 14,
          on_demand: !!draft.on_demand,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.status === 'success') {
        setConfigs((prev) => prev.map((c) => (c.id === id ? result.data : c)));
        setEditRows((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        alert(`저장 실패: ${extractErrorMessage(result, res)}`);
      }
    } catch (e) {
      alert(`저장 실패: 서버에 연결할 수 없습니다. (${e.message})`);
    }
  };

  const handleDeleteRow = async (id) => {
    if (!window.confirm('이 설정을 삭제할까요? (해당 상품은 기본값 리드타임 3일 · 안전재고 7일로 계산됩니다)')) return;
    try {
      const res = await fetch(`${API_BASE}/api/reorder/products/${id}`, { method: 'DELETE' });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.status === 'success') {
        setConfigs((prev) => prev.filter((c) => c.id !== id));
        setEditRows((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        alert(`삭제 실패: ${extractErrorMessage(result, res)}`);
      }
    } catch (e) {
      alert(`삭제 실패: 서버에 연결할 수 없습니다. (${e.message})`);
    }
  };

  return (
    <div className="responsive-container">
      <div style={{ marginBottom: '20px' }}>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)' }}>
          재고/판매 데이터는 <strong>E상인 재고 탭(재고 파악)</strong>을 열 때마다 자동으로 갱신되는 실 데이터를 그대로 사용합니다.
          여기서는 상품별 <strong>발주 리드타임</strong>·<strong>안전재고 일수</strong>·<strong>판매 주기</strong>만 필요할 때 조정하세요.
          (설정하지 않으면 기본값 리드타임 3일 · 안전재고 7일 · 판매주기 14일 적용)
        </p>
        <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: 'var(--text-3)' }}>
          ※ 판매 주기: 박스/묶음 단위로 몰아서 나가는 상품은 일평균 판매량이 비정상적으로 크게 나올 수 있습니다.
          실제 발주 주기(1~2주 등)에 맞게 짧게 설정하면 그 기간 동안의 판매량을 기준으로 계산합니다.
        </p>
        <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: 'var(--text-3)' }}>
          ※ 당일매입형: 비엔나처럼 재고를 미리 쌓아두지 않고 주문이 오면 그때 매입해서 바로 출고하는 상품입니다.
          체크하면 재고가 적어도 재발주 알림에서 완전히 제외됩니다.
        </p>
      </div>

      {esanginError && (
        <div style={{
          marginBottom: '16px', padding: '12px 16px', borderRadius: '16px',
          background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 35%, transparent)',
          color: 'var(--amber)', fontSize: '12px', fontWeight: 600,
        }}>
          ⚠️ {esanginError} — E상인 재고 탭(재고 파악)을 먼저 열어 데이터를 불러온 뒤 다시 시도해주세요.
        </div>
      )}

      <div style={{ background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', padding: '16px', marginBottom: '20px' }}>
        <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '10px', color: 'var(--text)' }}>➕ 상품별 설정 추가</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', alignItems: 'center' }}>
          <select
            value={newConfig.product_name}
            onChange={(e) => setNewConfig({ ...newConfig, product_name: e.target.value })}
            disabled={esanginProducts.length === 0}
          >
            <option value="">
              {esanginProducts.length === 0 ? 'E상인 상품 목록 없음' : '상품 선택...'}
            </option>
            {buildProductOptions('').map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <input
            type="number"
            placeholder="리드타임(일)"
            value={newConfig.lead_time_days}
            onChange={(e) => setNewConfig({ ...newConfig, lead_time_days: e.target.value })}
            disabled={newConfig.on_demand}
          />
          <input
            type="number"
            placeholder="안전재고 일수"
            value={newConfig.safety_stock_days}
            onChange={(e) => setNewConfig({ ...newConfig, safety_stock_days: e.target.value })}
            disabled={newConfig.on_demand}
          />
          <select
            value={newConfig.sales_cycle_days}
            onChange={(e) => setNewConfig({ ...newConfig, sales_cycle_days: e.target.value })}
            disabled={newConfig.on_demand}
          >
            {SALES_CYCLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!newConfig.on_demand}
              onChange={(e) => setNewConfig({ ...newConfig, on_demand: e.target.checked })}
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            />
            당일매입형
          </label>
          <button onClick={handleAddConfig} className="esangin-btn" disabled={esanginProducts.length === 0}>추가</button>
        </div>
      </div>

      <div style={{ background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', whiteSpace: 'nowrap' }}>
            <thead style={{ background: 'var(--surface-2)' }}>
              <tr>
                <th style={{ padding: '14px', textAlign: 'left', color: 'var(--text-3)', fontSize: '13px' }}>상품명</th>
                <th style={{ padding: '14px', color: 'var(--text-3)', fontSize: '13px' }}>리드타임(일)</th>
                <th style={{ padding: '14px', color: 'var(--text-3)', fontSize: '13px' }}>안전재고 일수</th>
                <th style={{ padding: '14px', color: 'var(--text-3)', fontSize: '13px' }}>판매 주기</th>
                <th style={{ padding: '14px', color: 'var(--text-3)', fontSize: '13px' }}>당일매입형</th>
                <th style={{ padding: '14px', color: 'var(--text-3)', fontSize: '13px' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {configs.length > 0 ? (
                configs.map((c) => {
                  const draft = getDraft(c);
                  const dirty = !!editRows[c.id];
                  return (
                    <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px', textAlign: 'left', minWidth: '220px' }}>
                        <select
                          value={draft.product_name}
                          onChange={(e) => handleFieldChange(c.id, 'product_name', e.target.value)}
                          style={{ width: '100%' }}
                        >
                          {buildProductOptions(draft.product_name).map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '10px' }}>
                        <input
                          type="number"
                          value={draft.lead_time_days}
                          onChange={(e) => handleFieldChange(c.id, 'lead_time_days', e.target.value)}
                          style={{ width: '80px', textAlign: 'center' }}
                          disabled={!!draft.on_demand}
                        />
                      </td>
                      <td style={{ padding: '10px' }}>
                        <input
                          type="number"
                          value={draft.safety_stock_days}
                          onChange={(e) => handleFieldChange(c.id, 'safety_stock_days', e.target.value)}
                          style={{ width: '80px', textAlign: 'center' }}
                          disabled={!!draft.on_demand}
                        />
                      </td>
                      <td style={{ padding: '10px' }}>
                        <select
                          value={draft.sales_cycle_days || 14}
                          onChange={(e) => handleFieldChange(c.id, 'sales_cycle_days', e.target.value)}
                          disabled={!!draft.on_demand}
                        >
                          {SALES_CYCLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.value}일</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '10px' }}>
                        <input
                          type="checkbox"
                          checked={!!draft.on_demand}
                          onChange={(e) => handleFieldChange(c.id, 'on_demand', e.target.checked)}
                          style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '10px' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button
                            onClick={() => handleSaveRow(c.id)}
                            disabled={!dirty}
                            className="esangin-btn"
                            style={{ padding: '6px 10px', fontSize: '12px', opacity: dirty ? 1 : 0.5, cursor: dirty ? 'pointer' : 'not-allowed' }}
                          >
                            저장
                          </button>
                          <button
                            onClick={() => handleDeleteRow(c.id)}
                            className="esangin-btn"
                            style={{ padding: '6px 10px', fontSize: '12px', background: 'var(--danger)' }}
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="6" style={{ padding: '50px', color: 'var(--text-3)', textAlign: 'center' }}>
                    {isLoading
                      ? '불러오는 중...'
                      : '등록된 상품별 설정이 없습니다. 모든 상품은 기본값(리드타임 3일 · 안전재고 7일 · 판매주기 14일)으로 계산됩니다.'}
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