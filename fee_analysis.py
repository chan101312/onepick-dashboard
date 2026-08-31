import re
import math
import time
import json
import os
import threading
import datetime as dt
import requests
import pandas as pd
from datetime import datetime, timezone, timedelta
from difflib import SequenceMatcher
from urllib.parse import urlencode
from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

MATCH_THRESHOLD = 0.55


def _parse_num(v):
    if v is None:
        return 0.0
    try:
        f = float(str(v).replace(",", "").strip() or 0)
    except (ValueError, TypeError):
        return 0.0
    # NaN / inf 방어 — 빈 숫자셀이 float('nan')으로 새어들어와 round()·JSONResponse를 500내는 것 차단
    return 0.0 if not math.isfinite(f) else f


def _norm_name(s):
    return re.sub(r"[^0-9a-z가-힣]", "", str(s or "").lower())


def _margin_name_of(row):
    return row.get("온라인 상품명") or row.get("상품명") or ""


def _build_link_index(links):
    idx = {}
    for name, v in (links or {}).items():
        nv = v.get("naver") or {}
        cp = v.get("coupang") or {}
        if nv.get("id"):
            idx[("naver", str(nv["id"]))] = name
        if cp.get("vendor_item_id"):
            idx[("coupang", str(cp["vendor_item_id"]))] = name
    return idx


def _build_margin_index(rows):
    out = []
    for row in rows or []:
        nm = _margin_name_of(row)
        if nm:
            out.append((nm, _norm_name(nm), row))
    return out


def _match_product(settle_name, settle_id, channel, margin_index, link_index):
    # 1) ID 매칭
    if settle_id is not None:
        target = link_index.get((channel, str(settle_id)))
        if target:
            for nm, _norm, row in margin_index:
                if nm == target:
                    return row, "id", 1.0
    # 2) 이름 fuzzy
    q = _norm_name(settle_name)
    best_row, best_ratio = None, 0.0
    for _nm, norm, row in margin_index:
        r = SequenceMatcher(None, q, norm).ratio()
        if r > best_ratio:
            best_ratio, best_row = r, row
    if best_row is not None and best_ratio >= MATCH_THRESHOLD:
        return best_row, "name", round(best_ratio, 2)
    return None, None, 0.0


def _compute_row(agg, margin_row, channel):
    label = "네이버" if channel == "naver" else "쿠팡"
    qty = agg["qty"]
    revenue = agg["revenue"]
    actual_fee = agg["actual_fee"]

    fee_col = _parse_num(margin_row.get(f"{label} 수수료"))
    price_col = _parse_num(margin_row.get(f"{label} 판매가"))
    if price_col > 0:
        estimated_fee = round(revenue * (fee_col / price_col))
    else:
        estimated_fee = round(fee_col * qty)

    cost = _parse_num(margin_row.get("매입") or margin_row.get("매입가")) * qty
    fixed_cost = (
        _parse_num(margin_row.get("자재비"))
        + _parse_num(margin_row.get("운송비"))
        + _parse_num(margin_row.get("기타비용"))
        + _parse_num(margin_row.get("날치알"))
    ) * qty

    estimated_margin = revenue - cost - estimated_fee - fixed_cost
    actual_margin = revenue - cost - actual_fee - fixed_cost
    diff_amount = actual_margin - estimated_margin
    diff_pct = None if estimated_margin == 0 else round(diff_amount / abs(estimated_margin) * 100, 1)

    return {
        "product_name": _margin_name_of(margin_row),
        "channel": channel,
        "qty": qty,
        "qty_partial": agg.get("qty_partial", False),
        "revenue": revenue,
        "cost": cost,
        "fixed_cost": fixed_cost,
        "estimated_fee": estimated_fee,
        "actual_fee": actual_fee,
        "estimated_margin": estimated_margin,
        "actual_margin": actual_margin,
        "diff_amount": diff_amount,
        "diff_pct": diff_pct,
    }


NAVER_BASE = "https://api.commerce.naver.com"
_SETTLE_CASE = NAVER_BASE + "/external/v1/pay-settle/settle/case"
_PO_QUERY = NAVER_BASE + "/external/v1/pay-order/seller/product-orders/query"


def _month_window(month):
    y, m = int(month[:4]), int(month[5:7])
    start = dt.date(y, m, 1)
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    return start, dt.date(ny, nm, 20)


def _naver_headers(token):
    return {"Authorization": "Bearer %s" % token, "Content-Type": "application/json"}


def _fetch_naver_settle(month, warnings):
    from apis import naver_api
    token = naver_api.get_access_token()
    if not token:
        warnings.append("네이버 커머스 토큰을 발급받지 못했습니다 — 네이버 정산을 건너뜁니다.")
        return []
    headers = _naver_headers(token)
    start, end = _month_window(month)
    out = []
    d = start
    t0 = time.monotonic()   # 전체 조회 벽시계 예산 (아래 루프에서 300초 상한)
    while d <= end:
        if time.monotonic() - t0 > 300:
            warnings.append("네이버 정산 조회 시간 초과 — 일부 날짜 누락")
            break
        ds = d.isoformat()
        ok = False
        for attempt in range(2):
            try:
                rows_for_date = []
                page = 1
                while True:
                    r = naver_api._request("GET", _SETTLE_CASE, headers=headers, params={
                        "periodType": "SETTLE_CASEBYCASE_SETTLE_BASIS_DATE",
                        "searchDate": ds, "pageNumber": page, "pageSize": 1000,
                    })
                    if r.status_code != 200:
                        raise RuntimeError("HTTP %s" % r.status_code)
                    body = r.json()
                    for el in body.get("elements", []):
                        if el.get("productOrderType") != "PROD_ORDER":
                            continue
                        if str(el.get("payDate", ""))[:7] != month:
                            continue
                        rows_for_date.append({
                            "product_order_id": str(el.get("productOrderId")),
                            "product_id": (str(el["productId"]) if el.get("productId") else None),
                            "product_name": el.get("productName", ""),
                            "product_order_type": el.get("productOrderType"),
                            "pay_settle_amount": _parse_num(el.get("paySettleAmount")),
                            "commission": _parse_num(el.get("totalPayCommissionAmount")),
                            "settle_type": el.get("settleType", ""),
                        })
                    pg = body.get("pagination") or {}
                    if page >= (pg.get("totalPages") or 1):
                        break
                    page += 1
                out.extend(rows_for_date)
                ok = True
                break
            except (requests.RequestException, RuntimeError):
                time.sleep(0.5)
        if not ok:
            warnings.append("네이버 정산 조회 실패: %s" % ds)
        time.sleep(0.2)
        d += dt.timedelta(days=1)
    return out


def _fetch_naver_quantities(product_order_ids, warnings):
    from apis import naver_api
    token = naver_api.get_access_token()
    if not token:
        warnings.append("네이버 커머스 토큰을 발급받지 못했습니다 — 네이버 수량 조회를 건너뜁니다.")
        return {}
    headers = _naver_headers(token)
    ids = list(dict.fromkeys(product_order_ids))
    result = {}
    for i in range(0, len(ids), 300):
        chunk = ids[i:i + 300]
        got = None
        for attempt in range(2):
            try:
                r = naver_api._request("POST", _PO_QUERY, headers=headers, json={"productOrderIds": chunk})
                if r.status_code != 200:
                    raise RuntimeError("HTTP %s" % r.status_code)
                got = r.json().get("data", [])
                break
            except (requests.RequestException, RuntimeError):
                time.sleep(0.5)
        if got is None:
            warnings.append("네이버 상품주문 조회 실패: %d건" % len(chunk))
            continue
        for od in got:
            po = od.get("productOrder", {})
            pid = str(po.get("productOrderId"))
            result[pid] = {"quantity": _parse_num(po.get("quantity")),
                           "status": po.get("productOrderStatus", "")}
        time.sleep(0.2)
    return result


_CP_BASE = "https://api-gateway.coupang.com"
_CP_REVENUE_PATH = "/v2/providers/openapi/apis/api/v1/revenue-history"


def _cp_split_ranges(start, end):
    ranges, cur = [], start
    while cur <= end:
        seg_end = min(cur + dt.timedelta(days=30), end)
        ranges.append((cur, seg_end))
        cur = seg_end + dt.timedelta(days=1)
    return ranges


def _fetch_coupang_revenue(month, warnings):
    from apis import coupang_api as cpa
    start, end = _month_window(month)
    out = []
    for seg_from, seg_to in _cp_split_ranges(start, end):
        token = ""
        page_guard = 0
        while True:
            page_guard += 1
            params = {
                "vendorId": cpa.VENDOR_ID,
                "recognitionDateFrom": seg_from.isoformat(),
                "recognitionDateTo": seg_to.isoformat(),
                "maxPerPage": 50, "token": token,
            }
            uri = _CP_REVENUE_PATH + "?" + urlencode(params)
            body = None
            last_err = None
            for attempt in range(2):   # 일시적 실패 1회 재시도 (네이버 정산 조회와 동일 패턴)
                try:
                    auth = cpa.generate_coupang_signature("GET", uri)
                    r = cpa._request("GET", _CP_BASE + uri, headers={
                        "Authorization": auth, "Content-Type": "application/json;charset=UTF-8",
                        "Accept": "application/json",
                    })
                    if r.status_code != 200:
                        raise RuntimeError("HTTP %s %s" % (r.status_code, r.text[:200]))
                    body = r.json()
                    break
                except (requests.RequestException, RuntimeError, ValueError) as e:
                    # 요청/HTTP/JSON파싱 실패만 흡수 (ValueError=JSONDecodeError). 아이템 매핑 오류는
                    # try 밖이라 그대로 전파됨.
                    last_err = e
                    time.sleep(0.5)
            if body is None:
                warnings.append("쿠팡 정산 조회 실패(%s~%s): %s" % (seg_from, seg_to, last_err))
                break
            for od in body.get("data", []):
                if str(od.get("saleDate", ""))[:7] != month:
                    continue
                sign = -1.0 if od.get("saleType") == "REFUND" else 1.0
                for it in od.get("items", []):
                    out.append({
                        "vendor_item_id": str(it.get("vendorItemId")),
                        "product_id": (str(it["productId"]) if it.get("productId") else None),
                        "product_name": it.get("productName", ""),
                        "revenue": sign * _parse_num(it.get("saleAmount")),
                        "fee": sign * (_parse_num(it.get("serviceFee")) + _parse_num(it.get("serviceFeeVat"))),
                        "qty": sign * _parse_num(it.get("quantity")),
                    })
            if not body.get("hasNext") or not body.get("nextToken") or page_guard > 500:
                break
            token = body["nextToken"]
    return out


def _aggregate(naver_lines, coupang_lines, margin_rows, links):
    link_idx = _build_link_index(links)
    margin_idx = _build_margin_index(margin_rows)

    buckets = {}   # (margin_name, channel) -> {"agg":{...}, "row":margin_row, "method":..., "conf":...}
    unmatched = []
    ch_totals = {
        "naver": {"revenue": 0.0, "actual_fee": 0.0, "unmatched_revenue": 0.0, "unmatched_fee": 0.0},
        "coupang": {"revenue": 0.0, "actual_fee": 0.0, "unmatched_revenue": 0.0, "unmatched_fee": 0.0},
    }

    def ingest(channel, settle_id, settle_name, revenue, fee, qty, qty_partial, spid, vid):
        ch_totals[channel]["revenue"] += revenue
        ch_totals[channel]["actual_fee"] += fee
        row, method, conf = _match_product(settle_name, settle_id, channel, margin_idx, link_idx)
        if row is None:
            ch_totals[channel]["unmatched_revenue"] += revenue
            ch_totals[channel]["unmatched_fee"] += fee
            unmatched.append({
                "product_name": settle_name, "channel": channel,
                "settle_product_id": spid, "vendor_item_id": vid,
                "revenue": revenue, "actual_fee": fee, "qty": qty,
            })
            return
        key = (_margin_name_of(row), channel)
        b = buckets.get(key)
        if b is None:
            b = {"agg": {"revenue": 0.0, "actual_fee": 0.0, "qty": 0.0, "qty_partial": False},
                 "row": row, "method": method, "conf": conf}
            buckets[key] = b
        b["agg"]["revenue"] += revenue
        b["agg"]["actual_fee"] += fee
        b["agg"]["qty"] += qty
        b["agg"]["qty_partial"] = b["agg"]["qty_partial"] or qty_partial
        b["conf"] = min(b["conf"], conf)
        if method == "id":
            b["method"] = "id"

    for ln in naver_lines:
        ingest("naver", ln.get("product_id"), ln.get("product_name", ""),
               ln.get("revenue", 0.0), ln.get("fee", 0.0), ln.get("qty", 0.0),
               ln.get("qty_partial", False), ln.get("product_id"), None)
    for ln in coupang_lines:
        ingest("coupang", ln.get("vendor_item_id"), ln.get("product_name", ""),
               ln.get("revenue", 0.0), ln.get("fee", 0.0), ln.get("qty", 0.0),
               False, ln.get("product_id"), ln.get("vendor_item_id"))

    rows = []
    for (_name, channel), b in buckets.items():
        r = _compute_row(b["agg"], b["row"], channel)
        r["match_method"] = b["method"]
        r["match_confidence"] = b["conf"]
        rows.append(r)
    rows.sort(key=lambda r: abs(r["diff_amount"]), reverse=True)

    channels = {}
    for ch in ("naver", "coupang"):
        t = ch_totals[ch]
        # qty_partial 행은 cost/fixed_cost가 0이라 마진이 무의미 → 채널 합계에서 제외 (rows에는 남김)
        est = sum(r["estimated_fee"] for r in rows if r["channel"] == ch and not r.get("qty_partial"))
        am = sum(r["actual_margin"] for r in rows if r["channel"] == ch and not r.get("qty_partial"))
        channels[ch] = {
            "revenue": t["revenue"], "actual_fee": t["actual_fee"],
            "estimated_fee": est, "actual_margin": am,
            "unmatched_revenue": t["unmatched_revenue"], "unmatched_fee": t["unmatched_fee"],
        }
    return {"channels": channels, "rows": rows, "unmatched": unmatched}


router = APIRouter()
_refresh_lock = threading.Lock()
MARGIN_CSV = "uploads/online.csv"
CHANNEL_LINK_FILE = "channel_link.json"


def _load_margin_rows():
    if not os.path.exists(MARGIN_CSV):
        return []
    df = pd.read_csv(MARGIN_CSV, encoding="utf-8-sig")
    df.columns = [str(c).strip() for c in df.columns]   # "네이버 수수료 " 같은 후행 공백 제거
    df = df.fillna("")   # float64 컬럼의 빈 셀도 확실히 비움 (server.py clean_dataframe과 동일)
    return df.to_dict(orient="records")


def _load_channel_links():
    if not os.path.exists(CHANNEL_LINK_FILE):
        return {}
    try:
        with open(CHANNEL_LINK_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


_CANCEL_HINTS = ("CANCEL", "RETURN", "REFUND")


def _build_naver_lines(settle, qty_map):
    lines = []
    for s in settle:
        poid = s["product_order_id"]
        q = qty_map.get(poid)
        partial = q is None
        qty_val = (q["quantity"] if q else 0.0)
        # 부호는 주문 상태(productOrderStatus)가 아니라 정산 라인 자체에서 뽑는다.
        # 판매 후 반품 주문은 같은 productOrderId로 정산 라인이 2개(판매/반품) 생기는데
        # 주문 상태로 부호를 정하면 두 라인 모두 음수가 되어 이익을 조작한다.
        # settle_type(예: QUICK_SETTLE_ORIGINAL vs QUICK_SETTLE_CANCEL)이 있으면 그걸
        # 1순위로 쓴다 — 실데이터 20일치(123건) 확인 결과 CANCEL 라인은 전부 음수,
        # ORIGINAL 라인은 전부 양수였지만, 프로모션/수수료가 커서 판매인데도 정산액이
        # 음수가 되는 이론상 케이스까지 막으려면 금액 부호만으로 판정하면 안 된다.
        # settle_type이 비어있는 경우에만 금액 부호로 폴백한다.
        pay = float(s.get("pay_settle_amount", 0.0))
        settle_type = str(s.get("settle_type", "")).upper()
        if settle_type:
            is_cancel = any(h in settle_type for h in _CANCEL_HINTS)
        else:
            is_cancel = pay < 0
        sign = -1.0 if is_cancel else 1.0
        lines.append({
            "product_id": s.get("product_id"),
            "product_name": s.get("product_name", ""),
            "revenue": pay,                              # 이미 부호 있음 — 그대로
            "fee": -float(s.get("commission", 0.0)),     # 판매 -300 → +300, 반품 +300 → -300 (net 상쇄)
            "qty": 0.0 if partial else sign * qty_val,   # 수량 조회 누락 라인은 부호와 무관하게 0
            "qty_partial": partial,
        })
    return lines


def build_payload(month):
    warnings = []
    settle = _fetch_naver_settle(month, warnings)
    qty_map = _fetch_naver_quantities([s["product_order_id"] for s in settle], warnings)
    naver_lines = _build_naver_lines(settle, qty_map)
    coupang_lines = _fetch_coupang_revenue(month, warnings)
    margin_rows = _load_margin_rows()
    if not margin_rows:
        warnings.append("uploads/online.csv 를 찾을 수 없어 상품 매칭을 건너뜁니다 — 전체가 미매칭 처리됩니다.")
    agg = _aggregate(naver_lines, coupang_lines, margin_rows, _load_channel_links())
    # partial: 실제 조회 실패/누락이 있었는지 (아래 §5 상시 안내문은 제외하고 판정)
    partial = len(warnings) > 0
    warnings.append("이번 달 후반 판매분은 아직 정산 미확정이라 일부 누락될 수 있습니다. 다음 달에 다시 갱신하세요.")
    kst = timezone(timedelta(hours=9))
    return {
        "month": month, "basis": "sale",
        "fetched_at": datetime.now(kst).isoformat(timespec="seconds"),
        "channels": agg["channels"], "rows": agg["rows"],
        "unmatched": agg["unmatched"], "warnings": warnings,
        "partial": partial,
    }


def _cache_path(month):
    return "fee_cache_%s.json" % month


_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")   # month은 GET/POST 양쪽에서 검증 (경로 조작 방지)


def _valid_month(m):
    # 정규식(YYYY-MM) + 월 범위(01~12) 둘 다 통과해야 함. "2026-99" 같은 값이 dt.date()를 500내는 것 차단.
    if not _MONTH_RE.match(m or ""):
        return False
    return 1 <= int(m[5:7]) <= 12


@router.get("/api/fee-analysis")
def get_fee_analysis(month: str):
    if not _valid_month(month):
        return {"status": "error", "message": "month 형식은 YYYY-MM 이어야 합니다."}
    p = _cache_path(month)
    if not os.path.exists(p):
        return {"status": "error", "message": "아직 조회된 정산 데이터가 없습니다. '정산 갱신'을 눌러주세요."}
    try:
        with open(p, "r", encoding="utf-8") as f:
            return {"status": "success", **json.load(f)}
    except (OSError, ValueError):
        return {"status": "error", "message": "캐시 파일을 읽을 수 없습니다. '정산 갱신'을 다시 눌러주세요."}


@router.post("/api/fee-analysis/refresh")
async def refresh_fee_analysis(request: Request):
    body = await request.json()
    month = (body or {}).get("month", "")
    if not _valid_month(month):
        return {"status": "error", "message": "month 형식은 YYYY-MM 이어야 합니다."}
    if not _refresh_lock.acquire(blocking=False):
        return {"status": "error", "message": "조회가 이미 진행 중입니다."}
    try:
        # 30~60초 블로킹 I/O를 스레드풀로 밀어내 이벤트 루프(다른 라우트 전부)가 멈추지 않게 함
        payload = await run_in_threadpool(build_payload, month)
        try:
            with open(_cache_path(month), "w", encoding="utf-8") as f:
                # allow_nan=False: NaN이 캐시 파일에 눌러붙어 그 달이 영구히 깨지는 것 차단(상시
                # 트립와이어) — _parse_num이 대부분 막아주지만 혹시 남은 경로가 있을 수 있어 여기서도
                # ValueError를 잡아서 500 대신 정상적인 에러 응답으로 내려준다.
                json.dump(payload, f, ensure_ascii=False, indent=2, allow_nan=False)
        except ValueError:
            return {"status": "error", "message": "정산 데이터에 비정상 수치(NaN/Infinity)가 있어 저장에 실패했습니다."}
        return {"status": "success", **payload}
    finally:
        _refresh_lock.release()
