import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../apiBase';
import { Emoji, EmojiText } from './Icons';

// 💡 마진 산출 장부(MarginTab.jsx)와 동일한 계산식을 그대로 복제한 것입니다.
// MarginTab.jsx는 건드리지 않기 위해 일부러 별도 함수로 둡니다 (원본 로직 변경 없음).
const parseMarginNumber = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const num = Number(String(value).replace(/,/g, "").trim());
  return Number.isNaN(num) ? 0 : num;
};

const getMarginCommonCost = (row) => (
  parseMarginNumber(row['매입'] || row['매입가']) +
  parseMarginNumber(row['자재비']) +
  parseMarginNumber(row['마진']) +
  parseMarginNumber(row['기타비용']) +
  parseMarginNumber(row['날치알'])
);

const getMarginDeliveryCost = (row) => parseMarginNumber(row['배민/쿠팡 택배비'] || row['배민,쿠팡 택배비']);

const calcMarginPlatformPrice = (baseCost, feePercent) => {
  if (feePercent >= 100) return 0;
  if (feePercent < 0) return Math.round(baseCost);
  const price = baseCost / (1 - feePercent / 100);
  return Math.ceil(price / 100) * 100;
};

const normalizeProductName = (name) => String(name || '').replace(/\s+/g, '').toLowerCase();

// TOP5 랭킹의 거래처명 → 마진 장부 수수료 키 매핑
// 🚫 롯데온 판매 중단: "🔴 롯데ON" 매핑 제외 (재개 시 두 줄만 복원하면 됨)
const MARKET_TO_FEE_KEY = {
  "🟢 스마트스토어 (네이버)": 'naver',
  "🚀 쿠팡": 'coupang',
  "🛵 우아한형제 (배민)": 'baemin',
  "🥬 식봄": 'sikbom',
};

const NEEDS_DELIVERY_COST = { naver: false, coupang: true, baemin: true, sikbom: false };
const HIDDEN_MARKETS = ["🔴 롯데ON"]; // 🚫 롯데온 판매 중단: TOP5 카드 자체를 숨김 (데이터는 그대로 서버에서 계산됨)

const getMarginRateForMarket = (row, marketKey, fees) => {
  const feeKey = MARKET_TO_FEE_KEY[marketKey];
  if (!feeKey || !row) return null;
  const commonCost = getMarginCommonCost(row);
  const base = NEEDS_DELIVERY_COST[feeKey] ? commonCost + getMarginDeliveryCost(row) : commonCost;
  if (feeKey === 'sikbom' && !base) return null; // MarginTab과 동일: 식봄은 원가 0이면 판매가 0 처리
  const price = calcMarginPlatformPrice(base, parseMarginNumber(fees[feeKey]));
  if (!price) return null;
  const marginAmount = parseMarginNumber(row['마진']);
  return (marginAmount / price) * 100;
};

export default function TopRankingTab() {
  const [rankingData, setRankingData] = useState({});
  const [availableMonths, setAvailableMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [sortMode, setSortMode] = useState('qty'); // 'qty' = 많이 팔린 순, 'profit' = 수익순

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [marginRows, setMarginRows] = useState([]);
  const [marginThreshold] = useState(() => {
    const saved = localStorage.getItem('marginThreshold');
    return saved ? JSON.parse(saved) : 10;
  });
  const [marginFees] = useState(() => {
    const saved = localStorage.getItem('marginFees');
    return saved ? JSON.parse(saved) : { naver: 6.0, coupang: 11.0, baemin: 11.0, lotteon: 13.0, sikbom: 6.0 };
  });

  const [loyaltyData, setLoyaltyData] = useState(null);
  const [loyaltyError, setLoyaltyError] = useState(null);
  const [loyaltyRefreshing, setLoyaltyRefreshing] = useState(false);

  const fetchLoyalty = () => {
    fetch(`${API_BASE}/api/customer-loyalty`, { headers: { 'ngrok-skip-browser-warning': '69420' } })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') { setLoyaltyData(data); setLoyaltyError(null); }
        else setLoyaltyError(data.message);
      })
      .catch(() => setLoyaltyError('서버 통신 에러가 발생했습니다.'));
  };

  useEffect(() => { fetchLoyalty(); }, []);

  const refreshLoyalty = async () => {
    setLoyaltyRefreshing(true);
    setLoyaltyError(null);
    try {
      const res = await fetch(`${API_BASE}/api/customer-loyalty/refresh`, {
        method: 'POST', headers: { 'ngrok-skip-browser-warning': '69420' }
      });
      const data = await res.json();
      if (data.status === 'success') setLoyaltyData(data);
      else setLoyaltyError(data.message || '갱신에 실패했습니다.');
    } catch (e) {
      setLoyaltyError(`갱신 실패: 서버에 연결할 수 없습니다. (${e.message})`);
    } finally {
      setLoyaltyRefreshing(false);
    }
  };

  const marginLookup = useMemo(() => {
    const map = new Map();
    marginRows.forEach(row => {
      const name = row['온라인 상품명'] || row['상품명'];
      if (name) map.set(normalizeProductName(name), row);
    });
    return map;
  }, [marginRows]);

  useEffect(() => {
    fetch(`${API_BASE}/api/margin/data`, { headers: { 'ngrok-skip-browser-warning': '69420' } })
      .then(res => res.json())
      .then(data => { if (data.status === 'success') setMarginRows(data.full_data || []); })
      .catch(() => {});
  }, []);

  const fetchTop5 = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/orders/top5`, { headers: { 'ngrok-skip-browser-warning': '69420' } });
      const result = await res.json();
      if (result.status === 'success') {
        setRankingData(result.data);
        setAvailableMonths(result.months || []);
        setError(null);
      } else {
        setError(result.message);
      }
    } catch (e) {
      setError("서버 통신 에러가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTop5(); }, []);

  if (loading) return <div style={{ padding: '40px', color: 'var(--text)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>E상인 DB에서 실시간 매출 데이터를 긁어와 분석 중입니다... <Emoji>🚀</Emoji></div>;
  if (error) return (
    <div style={{ color: 'var(--danger)', padding: '20px', fontWeight: 'bold' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Emoji>⚠️</Emoji> {error}</span> <br/>
      <button onClick={fetchTop5} className="tab-cta-btn" style={{ marginTop: '15px', background: 'var(--danger)' }}>
        <Emoji>🔄</Emoji> 다시 시도
      </button>
    </div>
  );

  // 현재 선택된 월의 데이터만 꺼냅니다. (없으면 빈 객체)
  const currentData = rankingData[selectedMonth] || {};

  return (
    <div style={{ padding: '20px', color: 'var(--text)' }}>

      {/* 💡 헤더 영역 & 월별 선택기 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Emoji>🏆</Emoji> 플랫폼별 매출 TOP 5 랭킹
          </h2>
          <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: 'var(--text-3)' }}>
            * E상인(ERP)의 실제 거래처 매출 전표 데이터를 기반으로 집계됩니다.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {/* 🔀 정렬 기준 토글 */}
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
            {[{ key: 'qty', label: '많이 팔린 순' }, { key: 'profit', label: '수익순' }].map(opt => (
              <button
                key={opt.key}
                onClick={() => setSortMode(opt.key)}
                style={{
                  padding: '8px 14px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
                  background: sortMode === opt.key ? 'var(--accent)' : 'var(--surface)',
                  color: sortMode === opt.key ? '#fff' : 'var(--text)'
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* 📅 달력 필터 (드롭다운) */}
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            style={{
              padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--border)',
              background: 'var(--surface)', color: 'var(--text)', fontWeight: 'bold', fontSize: '14px',
              cursor: 'pointer', outline: 'none'
            }}
          >
            <option value="all">📊 전체 누적 매출</option>
            {availableMonths.map(m => (
              <option key={m} value={m}>📅 {m.split('-')[0]}년 {m.split('-')[1]}월</option>
            ))}
          </select>
        </div>
      </div>

      {sortMode === 'profit' && (
        <p style={{ margin: '-8px 0 16px 0', fontSize: '12px', color: 'var(--text-3)' }}>
          <Emoji>⚠️</Emoji> 수익순은 E상인에 기록된 실제 판매단가(할인·시세 변동 반영)에서 마진산출장부 원가(매입+자재비+기타비용+날치알)를 뺀 금액입니다.
          원가는 여전히 포장(박스/팩) 단위 금액이라 박스/낱개 단위 차이가 있는 상품은 실제와 다를 수 있고, 마진산출장부에 매칭되지 않는 상품은 제외됩니다.
        </p>
      )}

      {/* 💡 카드 영역 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
        {Object.entries(currentData).filter(([platform]) => !HIDDEN_MARKETS.includes(platform)).map(([platform, lists]) => {
          const items = sortMode === 'profit' ? lists.profit_top5 : lists.qty_top5;
          return (
          <div key={platform} className="ui-card" style={{
            background: 'var(--panel)', border: '1px solid var(--border)',
            borderRadius: '16px', padding: '16px'
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 700, borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
              <EmojiText text={platform} />
            </h3>

            {items && items.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {items.map((item, idx) => {
                  const matchedRow = marginLookup.get(normalizeProductName(item.name));
                  const marginRate = matchedRow ? getMarginRateForMarket(matchedRow, platform, marginFees) : null;
                  const isLowMargin = marginRate !== null && marginRate !== undefined && marginRate < marginThreshold;
                  return (
                  <li key={idx} style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    background: isLowMargin ? 'color-mix(in srgb, var(--danger) 6%, transparent)' : 'var(--surface)', padding: '12px', borderRadius: '16px', border: `1px solid ${isLowMargin ? 'color-mix(in srgb, var(--danger) 25%, transparent)' : 'var(--border)'}`
                  }}>
                    <div style={{
                      fontSize: '16px', fontWeight: '900', color: idx === 0 ? 'var(--danger)' : idx === 1 ? 'var(--amber)' : idx === 2 ? 'var(--success)' : 'var(--text-3)',
                      width: '24px', textAlign: 'center'
                    }}>
                      {idx + 1}
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 'bold', fontSize: '14px' }}>
                      {item.name}
                    </div>
                    {marginRate !== null && marginRate !== undefined && (
                      <div style={{ fontSize: '12px', fontWeight: 'bold', color: isLowMargin ? 'var(--danger)' : 'var(--success)', whiteSpace: 'nowrap' }}>
                        마진 {marginRate.toFixed(1)}%
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      {sortMode === 'profit' && (
                        <div style={{ fontWeight: '900', color: 'var(--success)', fontSize: '14px' }}>
                          {item.profit.toLocaleString()}원
                        </div>
                      )}
                      <div style={{ fontWeight: sortMode === 'profit' ? 'normal' : '900', color: sortMode === 'profit' ? 'var(--text-3)' : 'var(--accent)', fontSize: sortMode === 'profit' ? '11px' : '14px' }}>
                        {item.qty}개
                      </div>
                    </div>
                  </li>
                  );
                })}
              </ul>
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-3)', fontSize: '14px', background: 'var(--surface)', borderRadius: '16px' }}>
                {sortMode === 'profit' && lists.qty_top5 && lists.qty_top5.length > 0
                  ? '마진산출장부에 매칭되는 상품이 없습니다.'
                  : '이 달에는 판매 기록이 없습니다.'}
              </div>
            )}

            {sortMode === 'profit' && lists.unit_mismatch_suspects && lists.unit_mismatch_suspects.length > 0 && (
              <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '12px', background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 30%, transparent)' }}>
                <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--amber)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Emoji>⚠️</Emoji> 단위 불일치 의심 상품 (수익순 제외됨)
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {lists.unit_mismatch_suspects.map((s, i) => (
                    <li key={i} style={{ fontSize: '11px', color: 'var(--text-3)', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                      <span style={{ whiteSpace: 'nowrap' }}>계산된 마진 {s.profit.toLocaleString()}원 (단위 오차 의심)</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          );
        })}

        {/* 선택한 달에 아무 데이터도 없을 경우 */}
        {Object.keys(currentData).length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '40px', textAlign: 'center', color: 'var(--text-3)', background: 'var(--panel)', borderRadius: '16px', border: '1px dashed var(--border)' }}>
            해당 월에 수집된 E상인 매출 데이터가 없습니다.
          </div>
        )}
      </div>

      {/* 🤝 단골손님 TOP 50 — 채널(쿠팡/식봄/네이버) 주문 수취인명 기준 구매횟수 집계 */}
      <div className="ui-card" style={{
        marginTop: '20px', background: 'var(--panel)', border: '1px solid var(--border)',
        borderRadius: '16px', padding: '16px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Emoji>🤝</Emoji> 단골손님 TOP 50
            </h3>
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: 'var(--text-3)' }}>
              * 채널 주문의 수취인명 기준 근사치입니다(동명이인·배송지 변경은 구분 못 함). 쿠팡·식봄은 최근 90일, 네이버는 최근 30일 기준.
            </p>
          </div>
          <button
            onClick={refreshLoyalty}
            disabled={loyaltyRefreshing}
            className="tab-cta-btn"
            style={{ opacity: loyaltyRefreshing ? 0.6 : 1 }}
          >
            {loyaltyRefreshing ? '⏳ 조회 중…' : '🔄 갱신'}
          </button>
        </div>

        {loyaltyData?.fetched_at && !loyaltyRefreshing && (
          <p style={{ margin: '0 0 10px 0', fontSize: '11px', color: 'var(--text-3)' }}>
            마지막 갱신: {String(loyaltyData.fetched_at).replace('T', ' ').slice(0, 16)}
          </p>
        )}

        {loyaltyData?.warnings && loyaltyData.warnings.length > 0 && (
          <div style={{ marginBottom: '10px', padding: '10px 12px', borderRadius: '12px', background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 30%, transparent)' }}>
            {loyaltyData.warnings.map((w, i) => (
              <div key={i} style={{ fontSize: '12px', color: 'var(--amber)' }}><Emoji>⚠️</Emoji> {w}</div>
            ))}
          </div>
        )}

        {loyaltyError && (
          <div style={{ color: 'var(--danger)', fontSize: '13px', padding: '10px 0' }}>
            <Emoji>⚠️</Emoji> {loyaltyError}
          </div>
        )}

        {loyaltyData?.customers && loyaltyData.customers.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px', width: '32px' }}>#</th>
                  <th style={{ padding: '6px 8px' }}>수취인명</th>
                  <th style={{ padding: '6px 8px' }}>구매횟수</th>
                  <th style={{ padding: '6px 8px' }}>최근 주문일</th>
                  <th style={{ padding: '6px 8px' }}>주력상품</th>
                  <th style={{ padding: '6px 8px' }}>이용채널</th>
                </tr>
              </thead>
              <tbody>
                {loyaltyData.customers.map((c, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 8px', color: 'var(--text-3)' }}>{idx + 1}</td>
                    <td style={{ padding: '6px 8px', fontWeight: 'bold' }}>
                      {c.name}{c.phone_hint && <span style={{ color: 'var(--text-3)', fontWeight: 'normal' }}> ({c.phone_hint})</span>}
                    </td>
                    <td style={{ padding: '6px 8px', fontWeight: 'bold', color: 'var(--accent)' }}>{c.count}회</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-3)' }}>{c.last_order}</td>
                    <td style={{ padding: '6px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>{c.top_product}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-3)' }}>{c.channels.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {loyaltyData?.customers && loyaltyData.customers.length === 0 && !loyaltyError && (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-3)', fontSize: '14px' }}>
            집계된 단골손님 데이터가 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}