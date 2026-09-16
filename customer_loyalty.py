"""
🤝 단골손님 리스트 — 채널(쿠팡/식봄/네이버) 주문의 수취인명을 기준으로 구매횟수를 집계해서
많이 산 순으로 보여준다. fee_analysis.py와 동일한 "갱신 버튼 + 서버 캐시 파일" 패턴을 쓴다
(라이브 조회는 채널 API 호출이 여러 번 걸려 느려서 탭을 열 때마다 하기엔 부적합 — 아래 참고).

【채널별 상태 — 2026-09-16 조사】
- 쿠팡: get_coupang_orders()에 FINAL_DELIVERY(배송완료) 상태가 빠져 있어서 주문이 배송완료
  후 2일만 지나도 안 잡히던 버그를 이번에 같이 고쳤다(apis/coupang_api.py 참고). 지금은 6개월
  전 데이터도 정상 조회됨.
- 식봄: order-reconcile의 오래된 주석("공식 주문조회 API 없음")은 stale함 — 실제로는
  get_sikbom_orders_by_date가 이미 완전히 구현되어 있고 수취인명도 포함한다. 재고 조회
  (get_sikbom_stock_by_product_name)만 아직 미구현이라 이 둘을 혼동하면 안 된다.
- 네이버: 이번 조사 중 네이버 커머스 API 인증 자체가 깨져있는 걸 발견했다
  ("어플리케이션 상태가 유효하지 않습니다" — 네이버 커머스 API센터에서 앱 상태 확인 필요,
  코드 문제 아님). 고쳐지기 전까지는 자동으로 건너뛰고 warnings에 안내만 남긴다.

【조회 기간과 터널 타임아웃】
Cloudflare Quick Tunnel이 응답 없는 요청을 ~100초 근처에서 끊는 걸 이미 겪은 적 있다
(server.py의 ORDER_RECONCILE_KEYWORD_SEARCH_DAYS 히스토리 참고 — 90일 조회가 524초 걸려서
30일로 낮췄던 사례). 이번에도 같은 제약이 적용된다:
  - 쿠팡(페이지네이션 포함)·식봄(하루 단위 순차 호출, 실측 ~0.7초/일)은 90일이어도 각각
    60~90초 선이라 여유가 있다.
  - 네이버는 get_new_orders()가 날짜를 하루씩 쪼개서 상태 2종(PAYED/DISPATCHED)을 순회
    호출하는 구조라 30일에 약 70초(order-reconcile 키워드검색에서 실측한 것과 동일 구조) —
    90일을 그대로 걸면 타임아웃 위험이 커서 네이버만 조회 기간을 따로 짧게 둔다.
  - 세 채널을 순차로 합치면 타임아웃을 넘길 수 있어 스레드로 동시에 조회한다(전체 소요시간
    = 셋 중 가장 느린 것 하나 기준).

【동일인 식별 — 단순화한 부분】
연락처(safeNumber)는 쿠팡 쪽에서 상당수 비어 있어 안정적인 보조키로 못 쓴다(실측 확인).
이번 버전은 수취인명 완전일치만으로 그룹핑하고, 연락처 뒷자리는 화면에 참고 정보로만 보여준다
(동명이인/배송지 변경으로 인한 오차는 감수 — 이 코드베이스의 다른 근사치 처리와 동일 수준).
"""
import concurrent.futures
import datetime as dt
import json
import os
from collections import Counter
from threading import Lock

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

router = APIRouter()

CACHE_FILE = "customer_loyalty_cache.json"
TOP_N = 50

# 부대비용성 라인은 "주력상품" 집계에서 제외 (다른 탭들과 동일한 기준)
EXCLUDED_NAME_KEYWORDS = ['택배비', '배송비', '아이스팩', '스티로폼', '광고비', '수수료', '정산', '기타']

# 채널별 조회 기간 — 위 docstring의 터널 타임아웃 설명 참고. 네이버는 인증이 복구된 뒤
# 실제 소요시간을 재보고 늘릴 수 있는지 다시 판단한다.
COUPANG_LOOKBACK_DAYS = 90
SIKBOM_LOOKBACK_DAYS = 90
NAVER_LOOKBACK_DAYS = 30

_refresh_lock = Lock()


def _fetch_coupang(warnings):
    from apis import coupang_api
    end = dt.date.today()
    start = end - dt.timedelta(days=COUPANG_LOOKBACK_DAYS)
    try:
        return coupang_api.get_coupang_orders(start.isoformat(), end.isoformat())
    except Exception as e:
        warnings.append(f"쿠팡 주문 조회 실패: {e}")
        return []


def _fetch_sikbom(warnings):
    from apis import sikbom_api
    if not sikbom_api.is_configured():
        warnings.append("식봄 API 키가 설정되지 않아 단골손님 집계에서 건너뜁니다.")
        return []
    end = dt.date.today()
    start = end - dt.timedelta(days=SIKBOM_LOOKBACK_DAYS)
    result = []
    d = start
    while d <= end:
        try:
            day_orders = sikbom_api.get_sikbom_orders_by_date(d.isoformat())
            for o in day_orders:
                o["마켓"] = "식봄"
            result.extend(day_orders)
        except Exception as e:
            warnings.append(f"식봄 주문 조회 실패({d}): {e}")
        d += dt.timedelta(days=1)
    return result


def _fetch_naver(warnings):
    from apis import naver_api
    token = naver_api.get_access_token()
    if not token:
        warnings.append(
            "네이버 API 인증에 실패했습니다 — 네이버 커머스 API센터에서 앱 상태를 확인해주세요. "
            "(단골손님 집계에서 네이버는 이번엔 제외됩니다)"
        )
        return []
    end = dt.date.today()
    start = end - dt.timedelta(days=NAVER_LOOKBACK_DAYS)
    try:
        orders = naver_api.get_new_orders(start.isoformat(), end.isoformat())
    except Exception as e:
        warnings.append(f"네이버 주문 조회 실패: {e}")
        return []
    for o in orders:
        o["마켓"] = "네이버"
    return orders


def _fetch_all_channels(warnings):
    """세 채널을 스레드로 동시에 조회한다 — 순차로 하면 각자의 소요시간이 합쳐져
    Cloudflare 터널의 응답 타임아웃(~100초)을 넘기기 쉽다."""
    fetchers = [_fetch_coupang, _fetch_sikbom, _fetch_naver]
    all_orders = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(fetchers)) as pool:
        futures = [pool.submit(f, warnings) for f in fetchers]
        for fut in futures:
            all_orders.extend(fut.result())
    return all_orders


def _aggregate_customers(orders):
    customers = {}
    for o in orders:
        name = str(o.get("수취인명") or "").strip()
        if not name:
            continue
        entry = customers.setdefault(name, {
            "order_keys": set(), "products": Counter(), "channels": set(),
            "last_order": "", "phone_hint": "",
        })
        channel = str(o.get("마켓") or "")
        order_no = str(o.get("주문번호") or o.get("상품주문번호") or "")
        entry["order_keys"].add((channel, order_no))
        if channel:
            entry["channels"].add(channel)
        order_date = str(o.get("결제일시") or "")[:10]
        if order_date and order_date > entry["last_order"]:
            entry["last_order"] = order_date
        phone = str(o.get("연락처") or "").strip()
        if phone and not entry["phone_hint"]:
            entry["phone_hint"] = phone[-4:]
        product = str(o.get("상품명") or "").strip()
        if product and not any(k in product for k in EXCLUDED_NAME_KEYWORDS):
            entry["products"][product] += 1
    return customers


def _rank_customers(customers):
    ranked = []
    for name, entry in customers.items():
        if not entry["order_keys"]:
            continue
        top_product = entry["products"].most_common(1)
        ranked.append({
            "name": name,
            "count": len(entry["order_keys"]),
            "channels": sorted(entry["channels"]),
            "last_order": entry["last_order"],
            "top_product": top_product[0][0] if top_product else "",
            "phone_hint": entry["phone_hint"],
        })
    ranked.sort(key=lambda x: (x["count"], x["last_order"]), reverse=True)
    return ranked[:TOP_N]


def build_payload():
    warnings = []
    orders = _fetch_all_channels(warnings)
    customers = _aggregate_customers(orders)
    ranked = _rank_customers(customers)

    kst = dt.timezone(dt.timedelta(hours=9))
    return {
        "fetched_at": dt.datetime.now(kst).isoformat(timespec="seconds"),
        "lookback_days": {"coupang": COUPANG_LOOKBACK_DAYS, "sikbom": SIKBOM_LOOKBACK_DAYS, "naver": NAVER_LOOKBACK_DAYS},
        "customers": ranked,
        "warnings": warnings,
    }


@router.get("/api/customer-loyalty")
def get_customer_loyalty():
    if not os.path.exists(CACHE_FILE):
        return {"status": "error", "message": "아직 조회된 데이터가 없습니다. '갱신'을 눌러주세요."}
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return {"status": "success", **json.load(f)}
    except (OSError, ValueError):
        return {"status": "error", "message": "캐시 파일을 읽을 수 없습니다. '갱신'을 다시 눌러주세요."}


@router.post("/api/customer-loyalty/refresh")
async def refresh_customer_loyalty():
    if not _refresh_lock.acquire(blocking=False):
        return {"status": "error", "message": "조회가 이미 진행 중입니다."}
    try:
        # 채널 API 호출이 최대 1~2분 걸릴 수 있어 스레드풀로 밀어내 이벤트 루프가 멈추지 않게 함
        payload = await run_in_threadpool(build_payload)
        try:
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2, allow_nan=False)
        except ValueError:
            return {"status": "error", "message": "데이터에 비정상 수치가 있어 저장에 실패했습니다."}
        return {"status": "success", **payload}
    finally:
        _refresh_lock.release()
