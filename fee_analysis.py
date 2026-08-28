import re
from difflib import SequenceMatcher

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
