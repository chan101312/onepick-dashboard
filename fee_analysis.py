import re
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

MATCH_THRESHOLD = 0.55


def _parse_num(v):
    if v is None:
        return 0.0
    try:
        return float(str(v).replace(",", "").strip() or 0)
    except (ValueError, TypeError):
        return 0.0


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


def _naver_headers():
    from apis import naver_api
    return {"Authorization": "Bearer %s" % naver_api.get_access_token(), "Content-Type": "application/json"}


def _fetch_naver_settle(month, warnings):
    from apis import naver_api
    headers = _naver_headers()
    start, end = _month_window(month)
    out = []
    d = start
    while d <= end:
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
                            "pay_settle_amount": float(el.get("paySettleAmount") or 0),
                            "commission": float(el.get("totalPayCommissionAmount") or 0),
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
    headers = _naver_headers()
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
            result[pid] = {"quantity": float(po.get("quantity") or 0),
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
            try:
                auth = cpa.generate_coupang_signature("GET", uri)
                r = cpa._request("GET", _CP_BASE + uri, headers={
                    "Authorization": auth, "Content-Type": "application/json;charset=UTF-8",
                    "Accept": "application/json",
                })
                if r.status_code != 200:
                    raise RuntimeError("HTTP %s %s" % (r.status_code, r.text[:200]))
                body = r.json()
            except (requests.RequestException, RuntimeError, ValueError) as e:
                # 요청/HTTP/JSON파싱 실패만 흡수 (ValueError=JSONDecodeError). 아이템 매핑 오류는
                # try 밖이라 그대로 전파됨.
                warnings.append("쿠팡 정산 조회 실패(%s~%s): %s" % (seg_from, seg_to, e))
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
                        "revenue": sign * float(it.get("saleAmount") or 0),
                        "fee": sign * (float(it.get("serviceFee") or 0) + float(it.get("serviceFeeVat") or 0)),
                        "qty": sign * float(it.get("quantity") or 0),
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
        est = sum(r["estimated_fee"] for r in rows if r["channel"] == ch)
        am = sum(r["actual_margin"] for r in rows if r["channel"] == ch)
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
_RETURN_HINTS = ("CANCEL", "RETURN", "REFUND")


def _load_margin_rows():
    if not os.path.exists(MARGIN_CSV):
        return []
    df = pd.read_csv(MARGIN_CSV, encoding="utf-8-sig")
    df = df.where(pd.notnull(df), None)
    return df.to_dict(orient="records")


def _load_channel_links():
    if not os.path.exists(CHANNEL_LINK_FILE):
        return {}
    try:
        with open(CHANNEL_LINK_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _build_naver_lines(settle, qty_map):
    lines = []
    for s in settle:
        poid = s["product_order_id"]
        q = qty_map.get(poid)
        qty = (q["quantity"] if q else 0.0)
        partial = q is None
        if q and any(h in str(q.get("status", "")).upper() for h in _RETURN_HINTS):
            qty = -qty
        lines.append({
            "product_id": s.get("product_id"),
            "product_name": s.get("product_name", ""),
            "revenue": s.get("pay_settle_amount", 0.0),
            "fee": abs(s.get("commission", 0.0)),
            "qty": qty,
            "qty_partial": partial,
        })
    return lines


def build_payload(month):
    warnings = []
    settle = _fetch_naver_settle(month, warnings)
    qty_map = _fetch_naver_quantities([s["product_order_id"] for s in settle], warnings)
    naver_lines = _build_naver_lines(settle, qty_map)
    coupang_lines = _fetch_coupang_revenue(month, warnings)
    agg = _aggregate(naver_lines, coupang_lines, _load_margin_rows(), _load_channel_links())
    kst = timezone(timedelta(hours=9))
    return {
        "month": month, "basis": "sale",
        "fetched_at": datetime.now(kst).isoformat(timespec="seconds"),
        "channels": agg["channels"], "rows": agg["rows"],
        "unmatched": agg["unmatched"], "warnings": warnings,
    }


def _cache_path(month):
    return "fee_cache_%s.json" % month


_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")   # month은 GET/POST 양쪽에서 검증 (경로 조작 방지)


@router.get("/api/fee-analysis")
def get_fee_analysis(month: str):
    if not _MONTH_RE.match(month or ""):
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
    if not _MONTH_RE.match(month or ""):
        return {"status": "error", "message": "month 형식은 YYYY-MM 이어야 합니다."}
    if not _refresh_lock.acquire(blocking=False):
        return {"status": "error", "message": "조회가 이미 진행 중입니다."}
    try:
        payload = build_payload(month)
        with open(_cache_path(month), "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        return {"status": "success", **payload}
    finally:
        _refresh_lock.release()
