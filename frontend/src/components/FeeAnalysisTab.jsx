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
  diff_abs: (a, b) => Math.abs(b.diff_amount) - Math.abs(a.diff_amount),
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

  const rows = data ? [...data.rows].sort(SORTS[sortKey]) : [];

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
                      <tr>{['상품명', '채널', '매출', '실제수수료'].map((h) => <th key={h} style={{ padding: '8px', textAlign: h === '상품명' ? 'left' : 'right' }}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {data.unmatched.map((u, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 8px', textAlign: 'left' }}>{u.product_name}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{u.channel === 'naver' ? '네이버' : '쿠팡'}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{won(u.revenue)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{won(u.actual_fee)}</td>
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
