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

// ──────────────────────────────────────────────────────────────
// 규격(spec)에서 "박스당 수량"을 뽑아낸다. 실패하면 null (호출부는 개수만 표시).
//
// 실제 E상인 규격 데이터(792개)를 훑어 검증한 규칙:
//  1) "내경..." 또는 단위 없는 순수 치수(예: 695*400*200)는 박스 치수(mm)이므로 '*'로 배수를
//     뽑으면 안 된다. 대신 뒤에 붙는 "(20개입)" / "(20개)" 를 박스 입수로 쓴다. 없으면 null.
//  2) 괄호 안이 순수 "숫자*숫자"인 그룹(예: "(420*365)")은 시트 치수이므로 제거한다.
//  3) 남은 문자열에서 "*<숫자>" 의 *마지막* 매치를 박스당 수량으로 쓴다.
//     - "(500g*10)*4봉" → 첫 숫자 10은 속포장, 마지막 4가 진짜 박스 배수
//     - "300g*10" 처럼 '*'가 하나면 첫=마지막이라 영향 없음
//  4) 매치가 없거나 0 이하면 null.
const DIM_TRIPLE = /(?<![0-9A-Za-z])[0-9]{2,4}\s*\*\s*[0-9]{2,4}\s*\*\s*[0-9]{2,4}/;
const PAREN_DIM = /\(\s*[0-9]+\s*\*\s*[0-9]+\s*\)/g;
const GAEIP = /\(\s*([0-9]+)\s*(?:개입|개\)|개$|입|매입|봉입)/;
const LAST_STAR_NUM = /\*\s*([0-9]+)/g;

export function parseBoxUnit(spec) {
  const s = typeof spec === 'string' ? spec.trim() : '';
  if (!s) return null;

  // 1) 박스 치수 규격 → '*' 파싱 금지, "(N개입)"만 신뢰
  if (s.includes('내경') || DIM_TRIPLE.test(s)) {
    const m = s.match(GAEIP);
    if (m) {
      const n = parseInt(m[1], 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    return null;
  }

  // 2) 괄호 안 순수 치수 제거
  const cleaned = s.replace(PAREN_DIM, '');

  // 3) "*<숫자>" 의 마지막 매치
  let last = null;
  let mm;
  LAST_STAR_NUM.lastIndex = 0;
  while ((mm = LAST_STAR_NUM.exec(cleaned)) !== null) {
    last = mm[1];
  }
  if (last == null) return null;
  const n = parseInt(last, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// "254개" 또는 "254개 (26박스)" 형태로 포맷. qty가 빈값/숫자아님이면 개수 자리 그대로.
export function formatQtyWithBox(qty, spec) {
  const hasQty = qty !== '' && qty != null && !Number.isNaN(Number(qty));
  const base = `${qty}개`;
  if (!hasQty) return base;
  const boxUnit = parseBoxUnit(spec);
  if (!boxUnit) return base;
  const boxes = Math.ceil(Number(qty) / boxUnit);
  return `${base} (${boxes}박스)`;
}
