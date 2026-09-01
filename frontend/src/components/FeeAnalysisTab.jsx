import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import { Emoji } from './Icons';

const H = { 'ngrok-skip-browser-warning': '69420' };
const won = (n) => (typeof n === 'number' ? Math.round(n).toLocaleString() + '원' : '-');

function lastMonthStr() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const SORTS = {
  diff_abs: (a, b) => {
    // 부분수량(*) 행은 cost/fixed_cost가 0이라 마진이 무의미 → 항상 맨 아래로
    if (a.qty_partial !== b.qty_partial) return a.qty_partial ? 1 : -1;
    return Math.abs(b.diff_amount) - Math.abs(a.diff_amount);
  },
  diff_asc: (a, b) => a.diff_amount - b.diff_amount,
  revenue: (a, b) => b.revenue - a.revenue,
  name: (a, b) => String(a.product_name).localeCompare(String(b.product_name)),
};

export default function FeeAnalysisTab() {
  const [month, setMonth] = useState(lastMonthStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [sortKey, setSortKey] = useState('diff_abs');

  // 미매칭 상품 수동 지정("이 상품 지정하기") 관련 상태
  const [marginNames, setMarginNames] = useState(null);   // 마진산출장부 상품명 목록 (지연 로드, 1회만)
  const [mappingTarget, setMappingTarget] = useState(null); // 지정 중인 미매칭 항목 (모달용)
  const [mappingSearch, setMappingSearch] = useState('');
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingDoneMsg, setMappingDoneMsg] = useState('');

  const load = useCallback(async (m) => {
    setLoading(true);
    setErrMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/fee-analysis?month=${m}`, { headers: H });
      const j = await res.json();
      if (j.status === 'success') setData(j);
      else { setData(null); setErrMsg(j.message || '데이터가 없습니다.'); }
    } catch {
      setData(null);
      setErrMsg('서버에 연결할 수 없습니다.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  const refresh = async () => {
    setRefreshing(true);
    setErrMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/fee-analysis/refresh`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      });
      const j = await res.json();
      if (j.status === 'success') setData(j);
      else setErrMsg(j.message || '갱신에 실패했습니다.');
    } catch (e) {
      setErrMsg(`갱신 실패: 서버에 연결할 수 없습니다. (${e.message})`);
    }
    setRefreshing(false);
  };

  const openMappingModal = async (u) => {
    setMappingTarget(u);
    setMappingSearch('');
    setMappingDoneMsg('');
    if (marginNames === null) {
      try {
        const res = await fetch(`${API_BASE}/api/margin/data`, { headers: H });
        const j = await res.json();
        const names = (j.summary_data || []).map((r) => r['온라인 상품명']).filter(Boolean);
        setMarginNames([...new Set(names)]);
      } catch {
        setMarginNames([]);
      }
    }
  };

  const saveMapping = async (marginProductName) => {
    if (!mappingTarget) return;
    setMappingSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/fee-analysis/mapping`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: mappingTarget.channel,
          settle_id: mappingTarget.channel === 'coupang' ? mappingTarget.vendor_item_id : mappingTarget.settle_product_id,
          settle_name: mappingTarget.product_name,
          margin_product_name: marginProductName,
        }),
      });
      const j = await res.json();
      if (j.status === 'success') {
        setMappingDoneMsg(`"${mappingTarget.product_name}" → "${marginProductName}" 지정 완료. 다음 "정산 갱신"부터 반영됩니다.`);
        setMappingTarget(null);
      } else {
        alert(`지정 실패: ${j.message || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert(`지정 실패: 서버에 연결할 수 없습니다. (${e.message})`);
    }
    setMappingSaving(false);
  };

  const filteredMarginNames = (marginNames || []).filter(
    (n) => !mappingSearch.trim() || n.includes(mappingSearch.trim())
  );

  const rows = data ? [...(data.rows ?? [])].sort(SORTS[sortKey]) : [];

  return (
    <div className="responsive-container" translate="no" style={{ color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Emoji>💸</Emoji> 수수료 분석
        </h2>
        <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>결제일 기준</span>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          disabled={refreshing}
          style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}
        />
        <button
          onClick={refresh}
          disabled={refreshing}
          className="esangin-btn"
          style={{ opacity: refreshing ? 0.6 : 1 }}
        >
          {refreshing ? '⏳ 정산 조회 중…' : '🔄 정산 갱신'}
        </button>
        {data?.fetched_at && !refreshing && (
          <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>
            마지막 갱신: {String(data.fetched_at).replace('T', ' ').slice(0, 16)}
          </span>
        )}
      </div>

      {refreshing && (
        <div style={{ marginBottom: '14px', padding: '12px 16px', borderRadius: '12px', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', fontSize: '13px' }}>
          네이버·쿠팡 정산 내역을 불러오는 중입니다. 30초~1분 걸릴 수 있어요.
        </div>
      )}

      {errMsg && !refreshing && (
        <div style={{ marginBottom: '14px', padding: '12px 16px', borderRadius: '12px', background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 35%, transparent)', color: 'var(--amber)', fontSize: '13px', fontWeight: 600 }}>
          <Emoji>⚠️</Emoji> {errMsg}
        </div>
      )}

      {mappingDoneMsg && (
        <div style={{ marginBottom: '14px', padding: '12px 16px', borderRadius: '12px', background: 'color-mix(in srgb, var(--success) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)', color: 'var(--success)', fontSize: '13px', fontWeight: 600 }}>
          <Emoji>✅</Emoji> {mappingDoneMsg}
        </div>
      )}

      {data?.warnings?.length > 0 && (
        <div style={{ marginBottom: '14px', padding: '12px 16px', borderRadius: '12px', background: 'color-mix(in srgb, var(--amber) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 25%, transparent)', fontSize: '12px', color: 'var(--text-3)' }}>
          {data.warnings.map((w, i) => <div key={i}>· {w}</div>)}
        </div>
      )}

      <div style={{ opacity: refreshing ? 0.4 : 1, transition: 'opacity .2s' }}>
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', marginBottom: '20px' }}>
              {['naver', 'coupang'].map((ch) => {
                const c = data.channels[ch];
                const label = ch === 'naver' ? '🟢 네이버' : '🚀 쿠팡';
                return (
                  <div key={ch} className="ui-card" style={{ padding: '16px', borderRadius: '16px', background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700, marginBottom: '10px' }}>{label}</div>
                    <Row k="매출" v={won(c.revenue)} />
                    <Row k="실제 수수료" v={won(c.actual_fee)} />
                    <Row k="예측 수수료" v={won(c.estimated_fee)} />
                    <Row k="실제 순마진" v={won(c.actual_margin)} strong />
                    <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-3)' }}>
                      미매칭 매출 {won(c.unmatched_revenue)} · 수수료 {won(c.unmatched_fee)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>상품별 예측 vs 실제 마진</h3>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}>
                <option value="diff_abs">차이 큰 순</option>
                <option value="diff_asc">차이 작은 순(손해 큰 순)</option>
                <option value="revenue">매출 높은 순</option>
                <option value="name">이름순</option>
              </select>
            </div>

            <div className="responsive-overflow" style={{ overflowX: 'auto', background: 'var(--surface)', borderRadius: '16px' }}>
              <table style={{ width: '100%', minWidth: '860px', borderCollapse: 'collapse', fontSize: '13px', whiteSpace: 'nowrap' }}>
                <thead style={{ background: 'var(--surface-2)' }}>
                  <tr>
                    {['상품명', '채널', '수량', '매출', '예측수수료', '실제수수료', '예측마진', '실제마진', '차이(₩)', '차이(%)'].map((h) => (
                      <th key={h} style={{ padding: '10px', textAlign: h === '상품명' ? 'left' : 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 10px', textAlign: 'left' }}>
                        {r.match_confidence < 0.7 && <span title="이름 매칭 불확실">⚠️ </span>}
                        {r.product_name}
                        {r.match_method === 'name' && (
                          <span style={{ marginLeft: '6px', fontSize: '10px', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: '999px', padding: '1px 5px' }}>이름매칭</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.channel === 'naver' ? '네이버' : '쿠팡'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.qty_partial ? '*' : ''}{Math.round(r.qty)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{won(r.revenue)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{won(r.estimated_fee)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{won(r.actual_fee)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{won(r.estimated_margin)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{won(r.actual_margin)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: r.diff_amount < 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>
                        {r.diff_amount > 0 ? '+' : ''}{won(r.diff_amount)}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: r.diff_amount < 0 ? 'var(--danger)' : 'var(--success)' }}>
                        {r.diff_pct === null || r.diff_pct === undefined ? '-' : `${r.diff_pct > 0 ? '+' : ''}${r.diff_pct}%`}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={10} style={{ padding: '30px', textAlign: 'center', color: 'var(--text-3)' }}>매칭된 상품이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {data.unmatched?.length > 0 && (
              <details style={{ marginTop: '18px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '14px' }}>
                  미매칭 {data.unmatched.length}건 (마진산출장부에서 못 찾음 — 계산 미포함)
                </summary>
                <div className="responsive-overflow" style={{ overflowX: 'auto', marginTop: '8px', background: 'var(--surface)', borderRadius: '12px' }}>
                  <table style={{ width: '100%', minWidth: '520px', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead style={{ background: 'var(--surface-2)' }}>
                      <tr>{['상품명', '채널', '매출', '실제수수료', ''].map((h, i) => <th key={i} style={{ padding: '8px', textAlign: h === '상품명' ? 'left' : 'right' }}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {data.unmatched.map((u, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 8px', textAlign: 'left' }}>{u.product_name}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{u.channel === 'naver' ? '네이버' : '쿠팡'}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{won(u.revenue)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{won(u.actual_fee)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                            <button onClick={() => openMappingModal(u)} className="tab-icon-btn" style={{ fontSize: '11px', padding: '3px 8px' }}>
                              이 상품 지정하기
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}
        {!data && !loading && !errMsg && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-3)' }}>월을 선택하고 "정산 갱신"을 눌러주세요.</div>
        )}
      </div>

      {mappingTarget && (
        <div
          onClick={() => !mappingSaving && setMappingTarget(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="ui-card"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '20px', width: '420px', maxWidth: '92vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '4px' }}>이 상품 지정하기</div>
            <div style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '12px' }}>
              "{mappingTarget.product_name}" ({mappingTarget.channel === 'naver' ? '네이버' : '쿠팡'})을 마진산출장부의 어느 상품으로 볼지 선택하세요.
            </div>
            <input
              type="text"
              autoFocus
              placeholder="마진산출장부 상품명으로 검색..."
              value={mappingSearch}
              onChange={(e) => setMappingSearch(e.target.value)}
              style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: '13px', marginBottom: '10px' }}
            />
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {marginNames === null && <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-3)', fontSize: '12px' }}>상품 목록 불러오는 중...</div>}
              {marginNames !== null && filteredMarginNames.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-3)', fontSize: '12px' }}>검색 결과가 없습니다.</div>
              )}
              {filteredMarginNames.slice(0, 200).map((name) => (
                <button
                  key={name}
                  disabled={mappingSaving}
                  onClick={() => saveMapping(name)}
                  style={{ textAlign: 'left', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: '13px', cursor: mappingSaving ? 'default' : 'pointer', opacity: mappingSaving ? 0.6 : 1 }}
                >
                  {name}
                </button>
              ))}
            </div>
            <button
              onClick={() => setMappingTarget(null)}
              disabled={mappingSaving}
              style={{ marginTop: '12px', padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-3)', fontSize: '12px' }}
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '13px' }}>
      <span style={{ color: 'var(--text-3)' }}>{k}</span>
      <span style={{ fontWeight: strong ? 700 : 400 }}>{v}</span>
    </div>
  );
}
