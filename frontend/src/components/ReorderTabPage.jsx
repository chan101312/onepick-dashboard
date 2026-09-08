import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import { signature } from './reorderAlertUtils';
import Pagination from './Pagination';
import { Emoji, EmojiText } from './Icons';

// 시급도 배지(URGENT/WARNING/NOTICE)는 지금처럼 진한 빨강/주황/회색 계열을 유지한다 — 이건 문제없었음.
// 카드 배경은 더 이상 시급도 색으로 물들이지 않는다: 카드가 5~60개씩 쌓이면 배경색이 화면 전체를
// 뒤덮어서, 정작 진짜 위험한 카드(마이너스 재고/품절)가 오히려 안 튀어 보이는 문제가 있었다.
// 대신 왼쪽에 얇은 컬러 스트라이프만 남기고, "위험 신호(빨강 계열)"는 배지와 재고 칩에만 집중시킨다.
const URGENCY_CONFIG = {
  urgent: {
    label: '즉시 발주 필요',
    badgeLabel: '긴급',
    accent: 'var(--danger)',
    text: 'var(--text)',
    borderWidth: '4px',
    pillBg: 'var(--danger)',
    pillText: '#fff',
  },
  warning: {
    label: '발주 준비하세요',
    badgeLabel: '주의',
    accent: 'var(--amber)',
    text: 'var(--text)',
    borderWidth: '3px',
    pillBg: 'var(--amber)',
    pillText: '#fff',
  },
  notice: {
    label: '발주 예정 확인',
    badgeLabel: '참고',
    accent: 'var(--text-3)',
    text: 'var(--text)',
    borderWidth: '2px',
    pillBg: 'transparent',
    pillText: 'var(--text-3)',
  },
};
const CARD_BG = 'var(--surface)';
const CARD_BORDER = 'var(--border)';
const CHIP_BG = 'var(--surface-2)';
const MUTED = 'var(--text-3)';

// "위험 신호(빨강 계열)"와 "정보/액션" 색을 명확히 분리하기 위한 팔레트.
// - 재고 마이너스(초과판매): 가장 급한 위험 신호라 빨강 계열 유지
// - 품절(재고 정확히 0개): 마이너스와는 다른 상태이므로 빨강이 아닌 진한 회색/검정 계열로 구분
// - 제안 발주량: 경고가 아니라 "지금 눌러서 조정하면 되는 액션"이라 파랑 계열로 분리
// 품절은 "심각하지만 마이너스(초과판매)보다는 덜 위험한" 상태라서, 마이너스의 빨강보다 톤을 낮춘
// 어두운 남색을 쓴다. 순수 검정/진회색은 오히려 빨강보다 무겁게 보여 위계가 뒤집히므로 피한다.
const SOLD_OUT_BG = '#475569'; // 라이트/다크 테마 공통 고정값(slate) — 빨강 계열과 겹치지 않으면서 차분한 톤

// "제안 발주량"에 var(--accent)를 썼더니 두 번이나 파랑으로 안 보였다 — 원인은 index.css:57에서
// 라이트 테마의 --accent가 #1a1a1a(거의 검정)로 정의돼 있기 때문(다크 테마 값 #3b82f6만 파랑).
// 테마를 타지 않고 항상 같은 파랑으로 보이게, 토큰 대신 리터럴 값을 직접 못박는다.
const ACTION_CHIP_BG = '#E3F2FD';
const ACTION_CHIP_TEXT = '#1565C0';
const ACTION_CHIP_BORDER = 'rgba(21, 101, 192, 0.35)';

const SORT_OPTIONS = [
  { key: 'stock_asc', label: '재고 적은 순' },
  { key: 'sales_desc', label: '최근 30일 판매량 많은 순' },
  { key: 'days_asc', label: '예상 소진일수 적은 순' },
  { key: 'name_asc', label: '상품명 가나다순' },
];
const DEFAULT_SORT = 'stock_asc';

const TIER_TABS = [
  { key: 'all', label: '전체' },
  { key: 'high', label: '🔥 많이 팔림' },
  { key: 'low', label: '🐢 덜 팔림' },
];
const DEFAULT_TIER = 'all';

const PAGE_SIZE = 20;
const STALE_MS = 24 * 60 * 60 * 1000;
const SELECTED_KEY = 'reorder_selected_ids_v1';
const DEFAULT_TARGET_STOCK_DAYS = 14;
const VENDOR_TABS_COLLAPSED_COUNT = 8; // 매입처가 많아지면 한 줄로 쫙 펼쳐져 복잡해지니 상위 N개만 먼저 보여주고 "더보기"로 펼친다

function loadSelected() {
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// 발주 제안 수량 = 일평균 × 목표재고일수 − 현재재고 (음수면 0). 일평균을 모르면(폴백 추정 모드 등) null.
function suggestedQty(alert, targetDays) {
  if (alert.daily_avg_sales == null) return null;
  const raw = alert.daily_avg_sales * targetDays - alert.current_stock;
  return Math.max(0, Math.round(raw));
}

function parseServerDate(str) {
  if (!str) return null;
  const iso = str.replace(' ', 'T');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sortAlerts(list, sortMode) {
  const arr = [...list];
  switch (sortMode) {
    case 'sales_desc':
      arr.sort((a, b) => (b.sales_30d ?? -Infinity) - (a.sales_30d ?? -Infinity));
      break;
    case 'days_asc':
      arr.sort((a, b) => (a.days_remaining ?? Infinity) - (b.days_remaining ?? Infinity));
      break;
    case 'name_asc':
      arr.sort((a, b) => a.product_name.localeCompare(b.product_name, 'ko'));
      break;
    case 'stock_asc':
    default:
      arr.sort((a, b) => a.current_stock - b.current_stock);
      break;
  }
  return arr;
}

export default function ReorderAlertBanner({ onUrgentCountChange } = {}) {
  const [alerts, setAlerts] = useState([]);
  const [deadstocks, setDeadstocks] = useState([]);
  const [recentVendors, setRecentVendors] = useState([]); // 최근 3개월 내 실거래가 있는 매입처 전체 (재발주 대상 상품 여부와 무관)
  const [lastUpdated, setLastUpdated] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [dismissed, setDismissed] = useState({});
  const [deadstockOpen, setDeadstockOpen] = useState(false);
  const [sortMode, setSortMode] = useState(DEFAULT_SORT);
  const [tierMode, setTierMode] = useState(DEFAULT_TIER);
  const [vendorMode, setVendorMode] = useState('all');
  const [vendorTabsExpanded, setVendorTabsExpanded] = useState(false);
  const [alertPage, setAlertPage] = useState(1);
  const [deadstockPage, setDeadstockPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState(loadSelected);
  const [selectedOpen, setSelectedOpen] = useState(true);
  const [copyMsg, setCopyMsg] = useState('');
  const [targetDays, setTargetDays] = useState(DEFAULT_TARGET_STOCK_DAYS);
  const [targetDaysInput, setTargetDaysInput] = useState(String(DEFAULT_TARGET_STOCK_DAYS));
  const [qtyOverrides, setQtyOverrides] = useState({});
  const [orderSheetText, setOrderSheetText] = useState('');
  const [orderSheetOpen, setOrderSheetOpen] = useState(false);
  const [orderSheetCopyMsg, setOrderSheetCopyMsg] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/reorder/settings`, {
          headers: { 'ngrok-skip-browser-warning': '69420' },
        });
        const result = await res.json();
        if (result.status === 'success' && result.data?.target_stock_days) {
          setTargetDays(result.data.target_stock_days);
          setTargetDaysInput(String(result.data.target_stock_days));
        }
      } catch (e) {
        console.error('재발주 설정 조회 실패', e);
      }
    })();
  }, []);

  // "발주 완료" 숨김 상태도 목표재고일수와 같은 이유로 localStorage 대신 서버(reorder_dismissed.json)에 저장.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/reorder/dismissed`, {
          headers: { 'ngrok-skip-browser-warning': '69420' },
        });
        const result = await res.json();
        if (result.status === 'success' && result.data) {
          setDismissed(result.data);
        }
      } catch (e) {
        console.error('발주 완료 상태 조회 실패', e);
      }
    })();
  }, []);

  // 목표재고일수는 기기마다 다르게 보이면 혼란스러우니 localStorage가 아니라 서버(reorder_settings.json)에 저장.
  // 입력 중 매 키 입력마다 요청을 보내지 않도록 살짝 디바운스한다.
  const persistTargetDays = useCallback((days) => {
    fetch(`${API_BASE}/api/reorder/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_stock_days: days }),
    }).catch((e) => console.error('재발주 설정 저장 실패', e));
  }, []);

  useEffect(() => {
    const parsed = Number(targetDaysInput);
    if (!targetDaysInput || Number.isNaN(parsed) || parsed <= 0) return;
    const t = setTimeout(() => {
      setTargetDays(parsed);
      persistTargetDays(parsed);
    }, 600);
    return () => clearTimeout(t);
  }, [targetDaysInput, persistTargetDays]);

  const fetchAlerts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/reorder-alerts`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.error) {
        setErrorMsg(result.error);
        setAlerts([]);
        setDeadstocks([]);
        setRecentVendors([]);
        setLastUpdated('');
        setDataSource('');
      } else {
        setErrorMsg('');
        setAlerts(Array.isArray(result.alerts) ? result.alerts : []);
        setDeadstocks(Array.isArray(result.deadstocks) ? result.deadstocks : []);
        setRecentVendors(Array.isArray(result.vendors) ? result.vendors : []);
        setLastUpdated(result.last_updated || '');
        setDataSource(result.data_source || '');
        setQtyOverrides({});
      }
    } catch (e) {
      console.error('재발주 알림 조회 실패', e);
      setErrorMsg('재발주 알림을 불러오지 못했습니다. 서버 연결을 확인해주세요.');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const persistSelected = (next) => {
    setSelectedIds(next);
    localStorage.setItem(SELECTED_KEY, JSON.stringify(next));
  };

  const toggleSelect = (id) => {
    const next = { ...selectedIds };
    if (next[id]) {
      delete next[id];
    } else {
      next[id] = true;
    }
    persistSelected(next);
  };

  const clearSelection = () => {
    persistSelected({});
  };

  const handleDismiss = (alert) => {
    const sig = signature(alert);
    const next = { ...dismissed, [alert.id]: sig };
    setDismissed(next);
    fetch(`${API_BASE}/api/reorder/dismissed`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: alert.id, signature: sig }),
    }).catch((e) => console.error('발주 완료 상태 저장 실패', e));
    if (selectedIds[alert.id]) {
      const nextSel = { ...selectedIds };
      delete nextSel[alert.id];
      persistSelected(nextSel);
    }
  };

  const handleRefreshClick = () => {
    setDismissed({});
    fetch(`${API_BASE}/api/reorder/dismissed`, { method: 'DELETE' }).catch((e) => console.error('발주 완료 상태 초기화 실패', e));
    setAlertPage(1);
    setDeadstockPage(1);
    fetchAlerts();
  };

  const visibleAlerts = alerts.filter((a) => dismissed[a.id] !== signature(a));
  const urgentCount = visibleAlerts.filter((a) => a.urgency === 'urgent').length;

  useEffect(() => {
    onUrgentCountChange?.(urgentCount);
  }, [urgentCount, onUrgentCountChange]);

  useEffect(() => {
    setAlertPage(1);
  }, [sortMode, tierMode, vendorMode]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(visibleAlerts.length / PAGE_SIZE));
    setAlertPage((p) => Math.min(p, maxPage));
  }, [visibleAlerts.length]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(deadstocks.length / PAGE_SIZE));
    setDeadstockPage((p) => Math.min(p, maxPage));
  }, [deadstocks.length]);

  if (errorMsg) {
    return (
      <div className="reorder-alert-wrap">
        <div className="reorder-status-row reorder-status-empty">
          <span><Emoji>⚠️</Emoji> {errorMsg}</span>
        </div>
      </div>
    );
  }

  const updatedDate = parseServerDate(lastUpdated);
  const isStale = updatedDate ? (Date.now() - updatedDate.getTime()) > STALE_MS : false;

  const statusText = (
    <>
      {isStale
        ? <><Emoji>⚠️</Emoji> 데이터가 오래되었을 수 있어요. 새로고침으로 갱신하세요. (마지막 업데이트: {lastUpdated})</>
        : <><Emoji>✅</Emoji> E상인 연동 중 · 마지막 업데이트: {lastUpdated}</>}
      {dataSource === 'fallback' && <> · <Emoji>⚠️</Emoji> 실시간 DB 연결 실패, 추정치로 표시 중</>}
    </>
  );

  if (visibleAlerts.length === 0 && deadstocks.length === 0) {
    return (
      <div className="reorder-alert-wrap">
        <div className={`reorder-status-row ${isStale ? 'reorder-status-stale' : 'reorder-status-ok'}`}>
          <span>{statusText}</span>
          <button className="reorder-refresh-btn" onClick={handleRefreshClick} disabled={isLoading}>
            {isLoading ? <><Emoji>🔄</Emoji> 확인 중...</> : <><Emoji>🔄</Emoji> 새로고침</>}
          </button>
        </div>
      </div>
    );
  }

  const urgencyCounts = visibleAlerts.reduce((acc, a) => {
    acc[a.urgency] = (acc[a.urgency] || 0) + 1;
    return acc;
  }, {});

  const tierCounts = visibleAlerts.reduce((acc, a) => {
    const tier = a.sales_tier || 'low';
    acc[tier] = (acc[tier] || 0) + 1;
    return acc;
  }, {});

  const tierFilteredAlerts = tierMode === 'all'
    ? visibleAlerts
    : visibleAlerts.filter((a) => (a.sales_tier || 'low') === tierMode);

  const vendorCounts = tierFilteredAlerts.reduce((acc, a) => {
    const v = a.vendor || '미상';
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});
  // 재발주 알림에 지금 등장하는 매입처(vendorCounts)만 보여주면, 최근 실거래는 있어도 지금 재고가
  // 넉넉해 알림 대상이 아닌 상품의 매입처(예: 조은수산)는 필터에 아예 안 뜨는 문제가 있었다.
  // 그래서 최근 3개월 내 실거래 매입처 전체(recentVendors, 백엔드 saleticketlist 직접 조회)를 합쳐서 보여준다.
  const vendorTabs = Array.from(new Set([...Object.keys(vendorCounts), ...recentVendors]))
    .map((v) => [v, vendorCounts[v] || 0])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));

  const vendorFilteredAlerts = vendorMode === 'all'
    ? tierFilteredAlerts
    : tierFilteredAlerts.filter((a) => (a.vendor || '미상') === vendorMode);

  const sortedAlerts = sortAlerts(vendorFilteredAlerts, sortMode);
  const alertTotalPages = Math.max(1, Math.ceil(sortedAlerts.length / PAGE_SIZE));
  const alertStart = (alertPage - 1) * PAGE_SIZE;
  const shown = sortedAlerts.slice(alertStart, alertStart + PAGE_SIZE);

  const deadstockTotalPages = Math.max(1, Math.ceil(deadstocks.length / PAGE_SIZE));
  const deadstockStart = (deadstockPage - 1) * PAGE_SIZE;
  const shownDeadstocks = deadstocks.slice(deadstockStart, deadstockStart + PAGE_SIZE);

  const selectedList = sortAlerts(visibleAlerts, sortMode).filter((a) => selectedIds[a.id]);
  const allShownSelected = shown.length > 0 && shown.every((a) => selectedIds[a.id]);

  const selectAllShown = () => {
    const next = { ...selectedIds };
    shown.forEach((a) => { next[a.id] = true; });
    persistSelected(next);
  };

  const deselectAllShown = () => {
    const next = { ...selectedIds };
    shown.forEach((a) => { delete next[a.id]; });
    persistSelected(next);
  };

  // 입력칸에 표시할 값: 사용자가 직접 고친 값(override)이 있으면 그걸, 없으면 자동 제안 수량, 그마저 없으면 빈칸.
  const getQtyValue = (alert) => {
    if (qtyOverrides[alert.id] !== undefined) return qtyOverrides[alert.id];
    const s = suggestedQty(alert, targetDays);
    return s == null ? '' : s;
  };

  const setQtyOverride = (id, value) => {
    setQtyOverrides((prev) => ({ ...prev, [id]: value }));
  };

  const generateOrderSheet = () => {
    if (selectedList.length === 0) return;
    const byVendor = new Map();
    selectedList.forEach((a) => {
      const vendor = a.vendor || '매입처 미상';
      const qtyRaw = getQtyValue(a);
      const qty = qtyRaw === '' || Number.isNaN(Number(qtyRaw)) ? 0 : Number(qtyRaw);
      if (!byVendor.has(vendor)) byVendor.set(vendor, []);
      byVendor.get(vendor).push({ name: `${a.product_name}${a.spec ? ` ${a.spec}` : ''}`, qty });
    });
    const blocks = Array.from(byVendor.entries()).map(([vendor, items]) => {
      const lines = items.map((it) => `${it.name} x ${it.qty}`);
      return `[${vendor}]\n${lines.join('\n')}`;
    });
    setOrderSheetText(blocks.join('\n\n'));
    setOrderSheetOpen(true);
    setOrderSheetCopyMsg('');
  };

  const copyOrderSheet = () => {
    if (!orderSheetText || !navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(orderSheetText).then(() => {
      setOrderSheetCopyMsg('복사되었어요!');
      setTimeout(() => setOrderSheetCopyMsg(''), 2000);
    });
  };

  const copySelectedList = () => {
    if (selectedList.length === 0) return;
    const lines = selectedList.map((a) => {
      const spec = a.spec ? ` ${a.spec}` : '';
      return `${a.product_name}${spec} - 현재재고 ${a.current_stock}개 · 발주필요(${a.urgency})`;
    });
    const text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopyMsg('복사되었어요!');
        setTimeout(() => setCopyMsg(''), 2000);
      });
    }
  };

  const markSelectedOnDemand = async () => {
    if (selectedList.length === 0) return;
    if (!window.confirm(`선택한 ${selectedList.length}개 상품을 당일매입형(재고를 미리 안 쌓아두는 상품)으로 등록할까요?\n등록하면 재발주 알림에서 완전히 제외됩니다.`)) return;
    let successCount = 0;
    let failCount = 0;
    for (const a of selectedList) {
      try {
        const res = await fetch(`${API_BASE}/api/reorder/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_name: a.product_name, on_demand: true }),
        });
        const result = await res.json().catch(() => ({}));
        if (res.ok && result.status === 'success') {
          successCount += 1;
        } else {
          failCount += 1;
        }
      } catch {
        failCount += 1;
      }
    }
    clearSelection();
    setCopyMsg(failCount > 0 ? `${successCount}개 등록, ${failCount}개 실패` : `${successCount}개 당일매입형으로 등록됨`);
    setTimeout(() => setCopyMsg(''), 3000);
    fetchAlerts();
  };

  return (
    <div className="reorder-alert-wrap">
      <div className={`reorder-status-row ${isStale ? 'reorder-status-stale' : 'reorder-status-ok'}`}>
        <span>{statusText}</span>
        <button className="reorder-refresh-btn" onClick={handleRefreshClick} disabled={isLoading}>
          {isLoading ? <><Emoji>🔄</Emoji> 확인 중...</> : <><Emoji>🔄</Emoji> 새로고침</>}
        </button>
      </div>

      {visibleAlerts.length > 0 && (
        <div className="reorder-summary-row" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', margin: '10px 0' }}>
          <span style={{ fontSize: '13px', color: URGENCY_CONFIG.urgent.accent, fontWeight: 600 }}>
            긴급 {urgencyCounts.urgent || 0}
          </span>
          <span style={{ fontSize: '13px', color: URGENCY_CONFIG.warning.accent, fontWeight: 600 }}>
            주의 {urgencyCounts.warning || 0}
          </span>
          <span style={{ fontSize: '13px', color: URGENCY_CONFIG.notice.accent, fontWeight: 600 }}>
            참고 {urgencyCounts.notice || 0}
          </span>
          <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>· 총 발주 필요 {visibleAlerts.length}개</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-3)', marginLeft: 'auto' }}>
            목표 재고일수
            <input
              type="number"
              min="1"
              value={targetDaysInput}
              onChange={(e) => setTargetDaysInput(e.target.value)}
              style={{ width: '56px', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: '13px' }}
            />
            일치 기준으로 제안 발주량 계산 (모든 기기 공통)
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', margin: '10px 0' }}>
        {TIER_TABS.map((t) => {
          const count = t.key === 'all' ? visibleAlerts.length : (tierCounts[t.key] || 0);
          const active = tierMode === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTierMode(t.key)}
              style={{
                padding: '8px 16px', borderRadius: '999px', fontSize: '13px', cursor: 'pointer',
                border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: active ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-3)',
                fontWeight: active ? 700 : 400,
              }}
            >
              <EmojiText text={t.label} /> ({count})
            </button>
          );
        })}
      </div>
      <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: 'var(--text-3)' }}>
        ※ 최근 30일 판매량 기준 상위 30%를 "많이 팔림"으로 자동 분류합니다. 회전 빠른 상품부터 먼저 확인하세요.
      </p>

      {vendorTabs.length > 0 && (() => {
        const collapsedVendorTabs = vendorTabs.slice(0, VENDOR_TABS_COLLAPSED_COUNT);
        const hiddenVendorCount = Math.max(0, vendorTabs.length - VENDOR_TABS_COLLAPSED_COUNT);
        // 접힌 목록 밖에 있는 매입처가 이미 선택돼 있으면(예: 이전에 펼쳐서 골랐다가 다시 접은 경우)
        // 선택된 필터가 화면에서 사라져 혼란스러우니 그 경우엔 자동으로 펼친다.
        const activeHidden = vendorMode !== 'all' && !collapsedVendorTabs.some(([v]) => v === vendorMode);
        const showAll = vendorTabsExpanded || activeHidden;
        const shownVendorTabs = showAll ? vendorTabs : collapsedVendorTabs;
        return (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px', alignItems: 'center' }}>
            <button
              onClick={() => setVendorMode('all')}
              style={{
                padding: '6px 14px', borderRadius: '999px', fontSize: '12px', cursor: 'pointer',
                border: vendorMode === 'all' ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: vendorMode === 'all' ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
                color: vendorMode === 'all' ? 'var(--text)' : 'var(--text-3)',
                fontWeight: vendorMode === 'all' ? 700 : 400,
              }}
            >
              전체 매입처
            </button>
            {shownVendorTabs.map(([vendor, count]) => {
              const active = vendorMode === vendor;
              return (
                <button
                  key={vendor}
                  onClick={() => setVendorMode(vendor)}
                  style={{
                    padding: '6px 14px', borderRadius: '999px', fontSize: '12px', cursor: 'pointer',
                    border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: active ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text-3)',
                    fontWeight: active ? 700 : 400,
                  }}
                >
                  {vendor} ({count})
                </button>
              );
            })}
            {hiddenVendorCount > 0 && (
              <button
                onClick={() => setVendorTabsExpanded((v) => !v)}
                style={{
                  padding: '6px 14px', borderRadius: '999px', fontSize: '12px', cursor: 'pointer',
                  border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-3)', fontWeight: 600,
                }}
              >
                {showAll ? '접기 ▲' : `더보기 +${hiddenVendorCount} ▼`}
              </button>
            )}
          </div>
        );
      })()}

      {tierFilteredAlerts.length > 1 && (
        <div className="reorder-sort-bar">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className={`reorder-sort-btn ${sortMode === opt.key ? 'reorder-sort-btn-active' : ''}`}
              onClick={() => setSortMode(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
          padding: '10px 14px', margin: '8px 0', background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)', borderRadius: '8px',
        }}
      >
        <button
          onClick={allShownSelected ? deselectAllShown : selectAllShown}
          className="tab-icon-btn"
          style={{
            border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)',
            background: allShownSelected ? 'color-mix(in srgb, var(--accent) 25%, transparent)' : 'transparent', color: 'var(--accent)',
          }}
        >
          {allShownSelected ? '현재 페이지 선택해제' : '현재 페이지 전체선택'}
        </button>
        <span style={{ color: 'var(--accent)', fontSize: '13px' }}>선택된 상품 {selectedList.length}개</span>
        {selectedList.length > 0 && (
          <>
            <button
              onClick={() => setSelectedOpen((v) => !v)}
              className="tab-icon-btn"
              style={{ border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)', color: 'var(--accent)' }}
            >
              선택 목록 {selectedOpen ? '접기' : '펼치기'}
            </button>
            <button
              onClick={copySelectedList}
              className="tab-icon-btn"
              style={{ border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)', color: 'var(--accent)' }}
            >
              목록 복사
            </button>
            <button
              onClick={generateOrderSheet}
              className="tab-icon-btn"
              style={{ border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)', color: 'var(--accent)', fontWeight: 700 }}
              title="선택한 상품을 매입처별로 묶어 발주서 텍스트를 만듭니다"
            >
              <EmojiText text="📋 발주서 생성" />
            </button>
            <button
              onClick={markSelectedOnDemand}
              className="tab-icon-btn"
              style={{ border: '1px solid color-mix(in srgb, var(--amber) 50%, transparent)', color: 'var(--amber)' }}
              title="재고를 미리 안 쌓아두고 주문 시 매입하는 상품 - 등록하면 재발주 알림에서 제외됩니다"
            >
              <Emoji>🍢</Emoji> 당일매입형으로 등록
            </button>
            <button
              onClick={clearSelection}
              className="tab-icon-btn danger"
            >
              전체 해제
            </button>
            {copyMsg && <span style={{ color: 'var(--success)', fontSize: '13px' }}>{copyMsg}</span>}
          </>
        )}
      </div>

      {orderSheetOpen && orderSheetText && (
        <div style={{ marginBottom: '10px', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', background: CARD_BG }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>매입처별 발주서</span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {orderSheetCopyMsg && <span style={{ color: 'var(--success)', fontSize: '12px' }}>{orderSheetCopyMsg}</span>}
              <button onClick={copyOrderSheet} className="tab-icon-btn">복사</button>
              <button onClick={() => setOrderSheetOpen(false)} className="tab-icon-btn">닫기</button>
            </div>
          </div>
          <textarea
            readOnly
            value={orderSheetText}
            rows={Math.min(20, orderSheetText.split('\n').length + 1)}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'monospace',
              fontSize: '13px', padding: '10px', borderRadius: '6px', border: '1px solid var(--border)',
              background: 'var(--surface-2)', color: 'var(--text)',
            }}
          />
        </div>
      )}

      {selectedOpen && selectedList.length > 0 && (
        <div style={{ marginBottom: '10px', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
          {selectedList.map((a) => {
            const cfg = URGENCY_CONFIG[a.urgency] || URGENCY_CONFIG.notice;
            return (
              <div
                key={a.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                  padding: '8px 14px', borderBottom: '1px solid var(--border)', background: CARD_BG,
                }}
              >
                <span style={{ color: cfg.text, fontSize: '13px' }}>
                  [{a.product_name}{a.spec ? ` ${a.spec}` : ''}] 현재재고 {a.current_stock}개
                </span>
                <button
                  onClick={() => toggleSelect(a.id)}
                  style={{ background: 'transparent', border: 'none', color: cfg.text, cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}
                  title="선택 해제"
                >
                  <Emoji>✕</Emoji>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* alignItems:'stretch'는 grid 기본값이라 원래도 같은 행 카드끼리는 높이가 맞춰지고 있었지만
          (실측 확인함), 의도를 코드로 명시해 이후 다른 스타일 변경에 의해 조용히 깨지지 않게 한다. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px', alignItems: 'stretch' }}>
        {shown.map((alert) => {
          const cfg = URGENCY_CONFIG[alert.urgency] || URGENCY_CONFIG.notice;
          const isNegative = alert.current_stock < 0;       // 재고 마이너스(초과판매) — 빨강 계열
          const isZeroStock = alert.current_stock === 0;    // 완전 품절(재고 정확히 0개) — 회색/검정 계열
          const isSoldOut = isNegative || isZeroStock;
          const suggested = suggestedQty(alert, targetDays);
          return (
            <div
              key={alert.id}
              style={{
                position: 'relative', overflow: 'hidden',
                display: 'flex', flexDirection: 'column', gap: '14px',
                background: CARD_BG, border: '1px solid var(--border)', borderRadius: '16px',
                padding: '18px 20px',
              }}
              className="ui-card"
            >
              {/* 왼쪽 색 스트라이프: border-left를 다른 세 변(1px)보다 굵게 주면 border-radius 모서리에서
                  두 굵기가 만나는 지점이 매끈하게 안 이어지고 삐져나오거나 잘린 것처럼 보였다.
                  그래서 실제 테두리 대신, 카드에 overflow:hidden을 걸고 그 안에 절대 위치로 얇은 바를
                  깔아서 카드의 둥근 모서리 곡률에 자연스럽게 클리핑되게 한다. */}
              <div
                style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: cfg.borderWidth, background: cfg.accent,
                }}
              />
              {/* 배지 줄 높이를 고정(2줄 분량 minHeight)해서, 매입처 이름이 길어 태그가 2줄로
                  넘어가는 카드가 있어도 그 아래(상품명부터)는 모든 카드가 항상 같은 위치에서
                  시작한다 — 매입처 태그도 말줄임으로 한 번 더 잘라서 3줄 이상으로는 안 늘어난다. */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', minHeight: '52px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', alignContent: 'flex-start' }}>
                  <span
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                      padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 800,
                      background: cfg.pillBg, color: cfg.pillText, letterSpacing: '0.03em',
                      border: cfg.pillBg === 'transparent' ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    {cfg.badgeLabel}
                  </span>
                  {isNegative && (
                    <span
                      className="reorder-badge-white"
                      style={{
                        display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: '999px',
                        fontSize: '11px', fontWeight: 800, letterSpacing: '0.03em',
                        background: 'var(--danger)', color: '#fff',
                      }}
                    >
                      마이너스
                    </span>
                  )}
                  {isZeroStock && (
                    <span
                      className="reorder-badge-white"
                      style={{
                        display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: '999px',
                        fontSize: '11px', fontWeight: 800, letterSpacing: '0.03em',
                        background: SOLD_OUT_BG, color: '#fff',
                      }}
                    >
                      품절
                    </span>
                  )}
                  {alert.sales_tier === 'high' && (
                    <span style={{ fontSize: '11px', padding: '2px 9px', borderRadius: '999px', background: 'var(--surface-2)', color: 'var(--text-3)', fontWeight: 600 }}>
                      많이 팔림
                    </span>
                  )}
                  {alert.vendor && (
                    <span
                      title={alert.vendor}
                      style={{
                        fontSize: '11px', padding: '2px 9px', borderRadius: '999px', background: 'var(--surface-2)',
                        color: 'var(--text-3)', fontWeight: 600, display: 'inline-block', maxWidth: '120px',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle',
                      }}
                    >
                      {alert.vendor}
                    </span>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={!!selectedIds[alert.id]}
                  onChange={() => toggleSelect(alert.id)}
                  style={{ width: '17px', height: '17px', cursor: 'pointer', flexShrink: 0, marginTop: '2px' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text)', lineHeight: 1.3 }}>
                  {alert.product_name}
                </div>
                {alert.spec && (
                  <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '3px' }}>
                    {alert.spec}
                  </div>
                )}
              </div>

              {/* 가장 먼저 눈에 들어와야 할 두 값(재고 위험도, 제안 발주량)을 상단 큰 칩으로 배치.
                  재고 칩은 "위험 신호"(마이너스=빨강, 품절=회색·검정)만 채우고, 정상 재고는 카드와
                  같은 중립 톤 — 색이 전부 빨강으로 번지지 않게 위험 상태일 때만 확실히 튄다. */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                <div style={{ background: isNegative ? 'var(--danger)' : isZeroStock ? SOLD_OUT_BG : CHIP_BG, borderRadius: '8px', padding: '6px 10px' }}>
                  <div className={isSoldOut ? 'reorder-alert-chip-label' : undefined} style={{ fontSize: '10px', color: isSoldOut ? 'rgba(255,255,255,0.85)' : 'var(--text-3)', marginBottom: '2px' }}>
                    {isNegative
                      ? <EmojiText text="⚠️ 재고 마이너스(초과판매)" size={11} />
                      : isZeroStock
                        ? <EmojiText text="⚠️ 품절" size={11} />
                        : '현재 재고'}
                  </div>
                  <div className={isSoldOut ? 'reorder-alert-chip-value' : undefined} style={{ fontSize: '16px', fontWeight: 800, color: isSoldOut ? '#fff' : 'var(--text)' }}>
                    {alert.current_stock}개
                  </div>
                </div>
                <div style={{ background: ACTION_CHIP_BG, border: `1px solid ${ACTION_CHIP_BORDER}`, borderRadius: '8px', padding: '5px 10px' }}>
                  <div className="reorder-qty-label" style={{ fontSize: '10px', color: ACTION_CHIP_TEXT, marginBottom: '2px', fontWeight: 600 }}>제안 발주량</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                    <input
                      type="number"
                      min="0"
                      className="reorder-qty-input"
                      value={getQtyValue(alert)}
                      onChange={(e) => setQtyOverride(alert.id, e.target.value)}
                      placeholder={suggested == null ? '-' : undefined}
                      style={{
                        width: '100%', fontSize: '16px', fontWeight: 800, color: ACTION_CHIP_TEXT,
                        background: 'transparent', border: 'none', padding: '0 0 2px 0',
                      }}
                    />
                    <span className="reorder-qty-unit" style={{ fontSize: '12px', color: ACTION_CHIP_TEXT }}>개</span>
                  </div>
                </div>
              </div>

              {/* 부가 정보(회전율 참고용)는 눈에 덜 띄게 — 상품명/재고/발주량보다 한 단계 더 작고 흐리게 */}
              {(alert.sales_30d != null || alert.daily_avg_sales != null) && (
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '10px', color: 'var(--text-3)', opacity: 0.75 }}>
                  {alert.sales_30d != null && <span>30일 판매 {alert.sales_30d}개</span>}
                  {alert.daily_avg_sales != null && (
                    <span>일평균{alert.sales_cycle_days ? `(${alert.sales_cycle_days}일)` : ''} {alert.daily_avg_sales}개</span>
                  )}
                </div>
              )}

              <button
                onClick={() => handleDismiss(alert)}
                className="tab-icon-btn"
                style={{ width: '100%', textAlign: 'center', fontWeight: 600 }}
              >
                발주 완료
              </button>
            </div>
          );
        })}
      </div>
      <Pagination currentPage={alertPage} totalPages={alertTotalPages} onPageChange={setAlertPage} />

      {deadstocks.length > 0 && (
        <div className="reorder-deadstock-wrap">
          <button className="reorder-deadstock-toggle" onClick={() => setDeadstockOpen((v) => !v)}>
            <Emoji>📦</Emoji> 데드스톡 주의 ({deadstocks.length}개) {deadstockOpen ? '▲' : '▼'}
          </button>
          {deadstockOpen && (
            <>
              <div className="reorder-deadstock-list">
                {shownDeadstocks.map((d) => (
                  <div key={d.id} className="reorder-deadstock-item">
                    <span className="reorder-deadstock-name">
                      [{d.product_name}{d.spec ? ` ${d.spec}` : ''}]
                    </span>
                    <span className="reorder-deadstock-detail">
                      재고 {d.current_stock}개 ·{' '}
                      {d.days_since_last_sale != null
                        ? `${d.days_since_last_sale}일간 미판매`
                        : '판매 기록 없음'}
                    </span>
                  </div>
                ))}
              </div>
              <Pagination currentPage={deadstockPage} totalPages={deadstockTotalPages} onPageChange={setDeadstockPage} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
