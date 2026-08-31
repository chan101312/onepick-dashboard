import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { API_BASE } from '../apiBase';
import { Emoji } from './Icons';

const NEUTRAL_BADGE = { bg: 'var(--surface-2)', border: 'var(--border)', text: 'var(--text-3)' };
const CHANNEL_BADGE = {
  쿠팡: { bg: 'color-mix(in srgb, var(--danger) 12%, transparent)', border: 'var(--danger)', text: 'var(--danger)' },
  네이버: { bg: 'color-mix(in srgb, var(--success) 12%, transparent)', border: 'var(--success)', text: 'var(--success)' },
  식봄: NEUTRAL_BADGE,
  배민상회: NEUTRAL_BADGE,
};
const DEFAULT_BADGE = NEUTRAL_BADGE;

// 카드 배경/테두리는 채널색이 아니라 심각도(confidence)로 — 대부분 쿠팡이라 전부 빨갛게 보이던 걸 완화
const CONFIDENCE_CARD = {
  high: { bg: 'color-mix(in srgb, var(--danger) 8%, transparent)', border: 'color-mix(in srgb, var(--danger) 30%, transparent)' },
  medium: { bg: 'color-mix(in srgb, var(--text-3) 8%, transparent)', border: 'color-mix(in srgb, var(--text-3) 28%, transparent)' },
};

function orderCardConfidence(items) {
  return items.some((it) => it.confidence === 'high') ? 'high' : 'medium';
}

function shortDateLabel(dateKey) {
  if (!dateKey) return '날짜 미상';
  const [, m, d] = dateKey.split('-');
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

const CHANNEL_NOTE_LABEL = {
  ok: '정상 조회',
  error: '조회 실패',
  not_implemented: '엔드포인트 미확정',
  not_configured: '키 미설정',
  manual_only: '수동 확인 전용',
};

const CHECKED_KEY = 'stockReconcileCheckedEntries';

function loadChecked() {
  try {
    return JSON.parse(localStorage.getItem(CHECKED_KEY) || '{}');
  } catch {
    return {};
  }
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function StockReconcileTab() {
  // --- 기능 A: 누락 의심 주문 (기간 지정, 기본값 오늘 하루) ---
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [missing, setMissing] = useState([]);
  const [channelNotes, setChannelNotes] = useState({});
  const [matchedCount, setMatchedCount] = useState(0);
  const [orderErrorMsg, setOrderErrorMsg] = useState('');
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [checked, setChecked] = useState(loadChecked);
  const [expandedDates, setExpandedDates] = useState({});

  // --- 기능 B: 채널 동기화 미리보기 ---
  const [syncLog, setSyncLog] = useState([]);
  const [isLoadingSync, setIsLoadingSync] = useState(false);
  const [syncErrorMsg, setSyncErrorMsg] = useState('');

  const applyQuickRange = (days) => {
    setStartDate(daysAgoStr(days - 1));
    setEndDate(todayStr());
  };

  const fetchOrderReconcile = useCallback(async (start, end) => {
    setIsLoadingOrders(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/order-reconcile?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`,
        { headers: { 'ngrok-skip-browser-warning': '69420' } }
      );
      const result = await res.json();
      if (result.status === 'success') {
        setMissing(Array.isArray(result.missing) ? result.missing : []);
        setChannelNotes(result.channel_notes || {});
        setMatchedCount(result.matched_count || 0);
        setOrderErrorMsg('');
      } else {
        setOrderErrorMsg(result.message || '주문 대조 데이터를 불러오지 못했습니다.');
      }
    } catch (e) {
      console.error('주문 대조 조회 실패', e);
      setOrderErrorMsg('주문 대조 데이터를 불러오지 못했습니다. 서버 연결을 확인해주세요.');
    }
    setIsLoadingOrders(false);
  }, []);

  const fetchSyncPreview = useCallback(async () => {
    setIsLoadingSync(true);
    try {
      const res = await fetch(`${API_BASE}/api/sync-preview`, { headers: { 'ngrok-skip-browser-warning': '69420' } });
      const result = await res.json();
      if (result.status === 'success') {
        setSyncLog(Array.isArray(result.data) ? result.data : []);
        setSyncErrorMsg('');
      } else {
        setSyncErrorMsg(result.message || '동기화 미리보기를 불러오지 못했습니다.');
      }
    } catch (e) {
      console.error('동기화 미리보기 조회 실패', e);
      setSyncErrorMsg('동기화 미리보기를 불러오지 못했습니다. 서버 연결을 확인해주세요.');
    }
    setIsLoadingSync(false);
  }, []);

  useEffect(() => {
    fetchSyncPreview();
  }, [fetchSyncPreview]);

  // 체크할 때만(체크 해제는 해당 없음) "어떤 E상인 상품이었나요?"를 물어서 수동 매핑 사전에 저장.
  // 정교한 검색 UI는 필요 없다고 하셔서 가장 단순한 입력창(window.prompt)으로 처리.
  const promptAndSaveMapping = async (channelProductName) => {
    const esanginName = window.prompt(
      `"${channelProductName}"\n\n이 상품은 E상인에서 어떤 상품이었나요? (정확한 E상인 상품명을 입력하면, 다음부터는 어느 채널에서든 이 이름으로 주문이 오면 자동으로 인식됩니다)`
    );
    if (!esanginName || !esanginName.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/order-reconcile/confirm-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '69420' },
        body: JSON.stringify({ channel_product_name: channelProductName, esangin_core_name: esanginName.trim() }),
      });
      const result = await res.json();
      if (result.status === 'success') {
        window.alert('저장되었습니다. 다음부터는 어느 채널에서든 이 이름으로 주문이 오면 자동으로 인식됩니다.');
      } else {
        window.alert(result.message || '매핑 저장에 실패했습니다.');
      }
    } catch (e) {
      console.error('매핑 저장 실패', e);
      window.alert('매핑 저장에 실패했습니다. 서버 연결을 확인해주세요.');
    }
  };

  const toggleChecked = (entryKey, items) => {
    const willCheck = !checked[entryKey];
    const next = { ...checked, [entryKey]: willCheck };
    setChecked(next);
    localStorage.setItem(CHECKED_KEY, JSON.stringify(next));
    if (willCheck && Array.isArray(items)) {
      items.forEach((it) => promptAndSaveMapping(it.product_name));
    }
  };

  // 주문일시(ordered_at) 기준으로 날짜별 그룹 묶기 — 최신 날짜가 위로
  const groupedByDate = useMemo(() => {
    const groups = {};
    missing.forEach((order) => {
      const key = order.ordered_at ? String(order.ordered_at).slice(0, 10) : '';
      if (!groups[key]) groups[key] = [];
      groups[key].push(order);
    });
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [missing]);

  // 새로 조회할 때마다 오늘 날짜만 펼치고 나머지는 접힌 상태로 초기화
  useEffect(() => {
    const today = todayStr();
    const next = {};
    groupedByDate.forEach(([dateKey]) => {
      next[dateKey] = dateKey === today;
    });
    setExpandedDates(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);

  const toggleDateExpanded = (dateKey) => {
    setExpandedDates((prev) => ({ ...prev, [dateKey]: !prev[dateKey] }));
  };

  return (
    <div className="reorder-alert-wrap">
      {/* ===== 기능 A: 누락 의심 주문 ===== */}
      <div className="reorder-status-row reorder-status-ok">
        <span><Emoji>🧾</Emoji> 온라인 주문 vs E상인 판매전표 대조</span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ padding: '6px 8px', borderRadius: '8px' }}
          />
          <span>~</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ padding: '6px 8px', borderRadius: '8px' }}
          />
          <button className="reorder-refresh-btn" onClick={() => applyQuickRange(1)}>오늘</button>
          <button className="reorder-refresh-btn" onClick={() => applyQuickRange(3)}>최근 3일</button>
          <button className="reorder-refresh-btn" onClick={() => applyQuickRange(7)}>최근 7일</button>
          <button
            className="reorder-refresh-btn"
            onClick={() => fetchOrderReconcile(startDate, endDate)}
            disabled={isLoadingOrders}
          >
            {isLoadingOrders ? <><Emoji>🔄</Emoji> 확인 중...</> : <><Emoji>🔄</Emoji> 조회</>}
          </button>
        </div>
      </div>

      {orderErrorMsg && (
        <div className="reorder-status-row reorder-status-empty"><span><Emoji>⚠️</Emoji> {orderErrorMsg}</span></div>
      )}

      {Object.keys(channelNotes).length > 0 && (
        <div className="reorder-sort-bar">
          {Object.entries(channelNotes).map(([channel, note]) => {
            const cfg = CHANNEL_BADGE[channel] || DEFAULT_BADGE;
            return (
              <span
                key={channel}
                className="channel-status-pill"
                style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}
                title={note.message || ''}
              >
                {channel}: {CHANNEL_NOTE_LABEL[note.status] || note.status}
                {note.status === 'ok' && ` (주문 ${note.order_count}건${note.accept_excluded ? ` · ACCEPT 제외 ${note.accept_excluded}건` : ''}` }
              </span>
            );
          })}
        </div>
      )}

      <div className="reorder-summary-row">
        <span className="reorder-summary-total">
          {startDate === endDate ? startDate : `${startDate} ~ ${endDate}`} 기준 · 대조 확인됨 {matchedCount}건 · 미입력 의심 {missing.length}건
        </span>
      </div>

      {missing.length > 0 ? (
        groupedByDate.map(([dateKey, orders]) => {
          const isExpanded = !!expandedDates[dateKey];
          return (
            <div key={dateKey || 'unknown'} style={{ marginBottom: '8px' }}>
              <button
                className="reorder-sort-btn"
                style={{ width: '100%', textAlign: 'left', padding: '8px 14px', fontSize: '13px' }}
                onClick={() => toggleDateExpanded(dateKey)}
              >
                {isExpanded ? '▾' : '▸'} {shortDateLabel(dateKey)} ({orders.length}건)
              </button>

              {isExpanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '6px' }}>
                  {orders.map((order, i) => {
                    const channelCfg = CHANNEL_BADGE[order.channel] || DEFAULT_BADGE;
                    const confCfg = CONFIDENCE_CARD[orderCardConfidence(order.items || [])];
                    const entryKey = `${order.channel}-${order.order_id}-${order.ordered_at || ''}`;
                    const isChecked = !!checked[entryKey];
                    const items = Array.isArray(order.items) ? order.items : [];
                    return (
                      <div
                        key={entryKey || i}
                        className="reorder-alert-row"
                        style={{
                          background: confCfg.bg,
                          border: `1px solid ${confCfg.border}`,
                          padding: '7px 12px',
                          opacity: isChecked ? 0.5 : 1,
                        }}
                      >
                        <div className="reorder-alert-msg" style={{ gap: '8px' }}>
                          <span className="channel-badge" style={{ background: channelCfg.border }}>{order.channel}</span>
                          <div className="reorder-alert-body" style={{ gap: 0, textDecoration: isChecked ? 'line-through' : 'none' }}>
                            {items.map((it, j) => (
                              <span key={j} style={{ display: 'block' }}>
                                <span className="reorder-alert-text" style={{ fontSize: '13px' }}>[{it.product_name}]</span>
                                <span className="reorder-alert-sub"> ×{it.qty}</span>
                                {it.receiver_name && <span className="reorder-alert-sub"> - {it.receiver_name}</span>}
                                <span className={`confidence-badge confidence-${it.confidence === 'high' ? 'high' : 'medium'}`} style={{ marginLeft: '6px' }}>
                                  {it.confidence === 'high' ? '높음' : '중간'}
                                </span>
                              </span>
                            ))}
                            <span className="reorder-alert-sub">
                              {shortDateLabel(dateKey)} · 주문번호 {order.order_id || '-'}
                            </span>
                          </div>
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                          <input type="checkbox" checked={isChecked} onChange={() => toggleChecked(entryKey, items)} />
                          E상인에 입력함
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      ) : (
        !isLoadingOrders && !orderErrorMsg && (
          <div className="reorder-status-row reorder-status-empty">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Emoji>✨</Emoji> 미입력 의심 주문이 없습니다.</span>
          </div>
        )
      )}

      {/* ===== 기능 B: 채널 동기화 미리보기 ===== */}
      <div className="reorder-settings-section">
        <div className="reorder-status-row reorder-status-ok" style={{ marginBottom: '8px' }}>
          <span><Emoji>🔄</Emoji> 채널 동기화 미리보기 (dry-run — 실제 채널엔 반영되지 않음)</span>
          <button className="reorder-refresh-btn" onClick={fetchSyncPreview} disabled={isLoadingSync}>
            {isLoadingSync ? <><Emoji>🔄</Emoji> 확인 중...</> : <><Emoji>🔄</Emoji> 새로고침</>}
          </button>
        </div>

        <div className="sync-activate-row">
          <button className="sync-activate-btn" disabled>실제 반영 시작</button>
          <span className="sync-activate-note">며칠 확인 후 활성화 예정 — 지금은 기록만 남기고 채널엔 아무것도 보내지 않습니다.</span>
        </div>

        {syncErrorMsg && (
          <div className="reorder-status-row reorder-status-empty"><span><Emoji>⚠️</Emoji> {syncErrorMsg}</span></div>
        )}

        <div className="reorder-deadstock-list" style={{ marginTop: '10px' }}>
          {syncLog.length > 0 ? (
            syncLog.slice(0, 100).map((s, i) => {
              const cfg = CHANNEL_BADGE[s.channel] || DEFAULT_BADGE;
              return (
                <div key={i} className="reorder-deadstock-item">
                  <span className="reorder-deadstock-name">
                    {s.timestamp} · <span className="channel-badge" style={{ background: cfg.border }}>{s.channel}</span>{' '}
                    [{s.product_name}]
                  </span>
                  <span className="reorder-deadstock-detail">
                    {s.old_qty}개 → {s.new_qty}개 (dry-run)
                  </span>
                </div>
              );
            })
          ) : (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-2)' }}>
              {isLoadingSync ? '불러오는 중...' : '아직 감지된 재고 변경이 없습니다.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
