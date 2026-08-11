// ReorderAlertBanner와 App.jsx(뱃지 카운트)가 함께 쓰는 공용 헬퍼.
// 컴포넌트 파일에 유틸 함수를 같이 export하면 Vite fast-refresh가 깨지므로 별도 파일로 분리했다.
export const DISMISS_KEY = 'reorderDismissedAlerts';

export function loadDismissed() {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}');
  } catch {
    return {};
  }
}

// 같은 상품이라도 재고/소진일수가 달라지면(=재입고 후 재하락) 다시 알림이 뜨도록 서명값으로 구분
export const signature = (alert) => `${alert.current_stock}-${alert.days_remaining}`;
