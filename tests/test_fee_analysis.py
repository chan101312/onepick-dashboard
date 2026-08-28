import fee_analysis as fa


def test_parse_num_variants():
    assert fa._parse_num(None) == 0.0
    assert fa._parse_num("") == 0.0
    assert fa._parse_num("1,234") == 1234.0
    assert fa._parse_num("12.5") == 12.5
    assert fa._parse_num(7) == 7.0
    assert fa._parse_num("abc") == 0.0


def test_norm_name():
    assert fa._norm_name("장터국수 우동국물1.8L X 6개") == "장터국수우동국물18lx6개"
    assert fa._norm_name("  Hello, World! ") == "helloworld"


def test_build_link_index():
    links = {
        "다이아몬드 빵가루새우": {"naver": {"id": "11060989411"}, "coupang": {"id": "s1", "vendor_item_id": "999"}},
        "이름만있음": {"naver": {"id": "222"}},
    }
    idx = fa._build_link_index(links)
    assert idx[("naver", "11060989411")] == "다이아몬드 빵가루새우"
    assert idx[("coupang", "999")] == "다이아몬드 빵가루새우"
    assert idx[("naver", "222")] == "이름만있음"


def test_match_by_id():
    rows = [{"온라인 상품명": "빵가루새우 50g"}, {"온라인 상품명": "다른상품"}]
    m_idx = fa._build_margin_index(rows)
    l_idx = {("naver", "11060989411"): "빵가루새우 50g"}
    row, method, conf = fa._match_product("전혀다른정산이름", "11060989411", "naver", m_idx, l_idx)
    assert row["온라인 상품명"] == "빵가루새우 50g"
    assert method == "id"
    assert conf == 1.0


def test_match_by_name_fuzzy():
    rows = [{"온라인 상품명": "장터국수 우동국물1.8L X 6개"}, {"온라인 상품명": "청어 6.5kg"}]
    m_idx = fa._build_margin_index(rows)
    row, method, conf = fa._match_product(
        "장터국수 우동국물1.8L X 6개 육수 대용량 업소용", None, "naver", m_idx, {}
    )
    assert row["온라인 상품명"] == "장터국수 우동국물1.8L X 6개"
    assert method == "name"
    assert conf >= fa.MATCH_THRESHOLD


def test_match_none_when_below_threshold():
    rows = [{"온라인 상품명": "청어 6.5kg"}]
    m_idx = fa._build_margin_index(rows)
    row, method, conf = fa._match_product("완전히 무관한 상품명 XYZ", None, "coupang", m_idx, {})
    assert row is None
    assert method is None


def _margin_row():
    return {
        "온라인 상품명": "장터국수 우동국물",
        "매입": "50000", "자재비": "1000", "운송비": "500", "기타비용": "0", "날치알": "0",
        "네이버 수수료": "4110", "네이버 판매가": "74500",
        "쿠팡 수수료": "8503", "쿠팡 판매가": "80200",
    }


def test_compute_row_naver_rate_based_fee():
    agg = {"revenue": 149000.0, "actual_fee": 4700.0, "qty": 2.0, "qty_partial": False}
    r = fa._compute_row(agg, _margin_row(), "naver")
    assert r["product_name"] == "장터국수 우동국물"
    assert r["channel"] == "naver"
    assert r["qty"] == 2.0
    assert r["cost"] == 100000.0                      # 50000 * 2
    assert r["fixed_cost"] == 3000.0                  # (1000+500) * 2
    # 예측수수료 = 149000 * (4110/74500) = 8220.0 (round)
    assert r["estimated_fee"] == round(149000 * (4110 / 74500))
    assert r["actual_fee"] == 4700.0
    assert r["estimated_margin"] == 149000.0 - 100000.0 - r["estimated_fee"] - 3000.0
    assert r["actual_margin"] == 149000.0 - 100000.0 - 4700.0 - 3000.0
    assert r["diff_amount"] == r["actual_margin"] - r["estimated_margin"]
    assert r["diff_pct"] == round(r["diff_amount"] / abs(r["estimated_margin"]) * 100, 1)


def test_compute_row_fee_fallback_when_price_zero():
    row = _margin_row()
    row["쿠팡 판매가"] = "0"
    agg = {"revenue": 80000.0, "actual_fee": 9000.0, "qty": 1.0, "qty_partial": False}
    r = fa._compute_row(agg, row, "coupang")
    assert r["estimated_fee"] == round(8503 * 1)      # 판매가 0 → 수수료컬럼 * qty


def test_compute_row_diff_pct_none_on_zero_margin():
    row = {"온라인 상품명": "x", "매입": "0", "네이버 수수료": "0", "네이버 판매가": "100"}
    agg = {"revenue": 0.0, "actual_fee": 0.0, "qty": 0.0, "qty_partial": True}
    r = fa._compute_row(agg, row, "naver")
    assert r["estimated_margin"] == 0.0
    assert r["diff_pct"] is None
    assert r["qty_partial"] is True


def test_aggregate_matches_and_summarizes():
    margin_rows = [
        {"온라인 상품명": "장터국수 우동국물1.8L X 6개", "매입": "50000", "자재비": "1000", "운송비": "0",
         "네이버 수수료": "4110", "네이버 판매가": "74500",
         "쿠팡 수수료": "8503", "쿠팡 판매가": "80200"},
        {"온라인 상품명": "청어 6.5kg", "매입": "13000",
         "쿠팡 수수료": "2783", "쿠팡 판매가": "25300"},
    ]
    links = {}
    naver_lines = [
        {"product_id": "9641317164", "product_name": "장터국수 우동국물1.8L X 6개 육수 대용량 업소용",
         "revenue": 74500.0, "fee": 2237.0, "qty": 1.0, "qty_partial": False},
    ]
    coupang_lines = [
        {"vendor_item_id": "90149646990", "product_id": "1", "product_name": "장터국수 우동국물1.8L X 6개 육수 대용량",
         "revenue": 80200.0, "fee": 8600.0, "qty": 1.0},
        {"vendor_item_id": "777", "product_id": "2", "product_name": "완전무관 상품 ZZZ",
         "revenue": 30000.0, "fee": 3500.0, "qty": 1.0},
    ]
    out = fa._aggregate(naver_lines, coupang_lines, margin_rows, links)

    assert len(out["rows"]) == 2                       # 네이버 1 + 쿠팡 1 (매칭)
    assert len(out["unmatched"]) == 1
    assert out["unmatched"][0]["product_name"] == "완전무관 상품 ZZZ"
    assert out["unmatched"][0]["channel"] == "coupang"

    nv = out["channels"]["naver"]
    assert nv["revenue"] == 74500.0
    assert nv["actual_fee"] == 2237.0
    assert nv["estimated_fee"] > 0

    cp = out["channels"]["coupang"]
    assert cp["revenue"] == 110200.0                   # 80200 + 30000 (미매칭 포함)
    assert cp["unmatched_revenue"] == 30000.0
    assert cp["unmatched_fee"] == 3500.0

    diffs = [abs(r["diff_amount"]) for r in out["rows"]]
    assert diffs == sorted(diffs, reverse=True)        # |diff| 내림차순


def test_aggregate_id_match_beats_name():
    margin_rows = [{"온라인 상품명": "정답상품", "매입": "0", "네이버 수수료": "0", "네이버 판매가": "100"},
                   {"온라인 상품명": "장터국수 우동국물", "매입": "0", "네이버 수수료": "0", "네이버 판매가": "100"}]
    links = {"정답상품": {"naver": {"id": "9641317164"}}}
    naver_lines = [{"product_id": "9641317164", "product_name": "장터국수 우동국물1.8L X 6개",
                    "revenue": 1000.0, "fee": 30.0, "qty": 1.0, "qty_partial": False}]
    out = fa._aggregate(naver_lines, [], margin_rows, links)
    assert out["rows"][0]["product_name"] == "정답상품"
    assert out["rows"][0]["match_method"] == "id"


import datetime as _dt


class _Resp:
    def __init__(self, status, payload):
        self.status_code = status
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


def test_month_window():
    a, b = fa._month_window("2026-07")
    assert a == _dt.date(2026, 7, 1)
    assert b == _dt.date(2026, 8, 20)


def test_fetch_naver_settle_filters_by_paydate(monkeypatch):
    monkeypatch.setattr(fa.time, "sleep", lambda *a, **k: None)   # 테스트 빠르게
    calls = {"n": 0}

    def fake_request(method, url, headers=None, params=None, json=None):
        calls["n"] += 1
        if "settle/case" in url:
            return _Resp(200, {"elements": [
                {"productOrderType": "PROD_ORDER", "productOrderId": "po1", "productId": "p1",
                 "productName": "상품1", "payDate": "2026-07-15", "paySettleAmount": 10000,
                 "totalPayCommissionAmount": -300},
                {"productOrderType": "PROD_ORDER", "productOrderId": "po2", "productId": "p2",
                 "productName": "상품2", "payDate": "2026-06-30", "paySettleAmount": 5000,
                 "totalPayCommissionAmount": -150},
                {"productOrderType": "DELIVERY", "productOrderId": "d1", "productId": None,
                 "productName": "기본배송비", "payDate": "2026-07-15", "paySettleAmount": 3000,
                 "totalPayCommissionAmount": -90},
            ], "pagination": {"page": 1, "totalPages": 1}})
        raise AssertionError(url)

    import apis.naver_api as nav
    monkeypatch.setattr(nav, "_request", fake_request)
    monkeypatch.setattr(nav, "get_access_token", lambda: "tok")

    warnings = []
    out = fa._fetch_naver_settle("2026-07", warnings)
    ids = {r["product_order_id"] for r in out}
    assert ids == {"po1"}                              # po2=6월 결제 제외, d1=DELIVERY 제외
    assert out[0]["commission"] == -300
    assert warnings == []


def test_fetch_naver_quantities_batches(monkeypatch):
    monkeypatch.setattr(fa.time, "sleep", lambda *a, **k: None)

    def fake_request(method, url, headers=None, params=None, json=None):
        assert "product-orders/query" in url
        ids = json["productOrderIds"]
        return _Resp(200, {"data": [
            {"productOrder": {"productOrderId": i, "quantity": 2, "productOrderStatus": "PURCHASE_DECIDED"}}
            for i in ids
        ]})

    import apis.naver_api as nav
    monkeypatch.setattr(nav, "_request", fake_request)
    monkeypatch.setattr(nav, "get_access_token", lambda: "tok")

    warnings = []
    q = fa._fetch_naver_quantities([f"po{i}" for i in range(650)], warnings)
    assert len(q) == 650
    assert q["po1"]["quantity"] == 2


def test_fetch_naver_settle_no_dup_on_pagination_retry(monkeypatch):
    monkeypatch.setattr(fa.time, "sleep", lambda *a, **k: None)
    state = {}

    def el(poid, amt, comm):
        return {"productOrderType": "PROD_ORDER", "productOrderId": poid, "productId": "x",
                "productName": "n", "payDate": "2026-07-05",
                "paySettleAmount": amt, "totalPayCommissionAmount": comm}

    def fake_request(method, url, headers=None, params=None, json=None):
        if params["searchDate"] != "2026-07-01":
            return _Resp(200, {"elements": [], "pagination": {"page": 1, "totalPages": 1}})
        page = params["pageNumber"]
        if page == 1:
            return _Resp(200, {"elements": [el("p1", 100, -3)],
                               "pagination": {"page": 1, "totalPages": 2}})
        if not state.get("p2_ok"):
            state["p2_ok"] = True
            return _Resp(500, {})
        return _Resp(200, {"elements": [el("p2", 200, -6)],
                           "pagination": {"page": 2, "totalPages": 2}})

    import apis.naver_api as nav
    monkeypatch.setattr(nav, "_request", fake_request)
    monkeypatch.setattr(nav, "get_access_token", lambda: "tok")

    out = fa._fetch_naver_settle("2026-07", [])
    ids = [r["product_order_id"] for r in out]
    assert ids.count("p1") == 1
    assert ids.count("p2") == 1


def test_fetch_coupang_revenue_refund_and_filter(monkeypatch):
    monkeypatch.setattr(fa.time, "sleep", lambda *a, **k: None)
    pages = [
        {"code": 200, "data": [
            {"orderId": 1, "saleType": "SALE", "saleDate": "2026-07-03", "items": [
                {"vendorItemId": 111, "productId": 9, "productName": "훈제오리",
                 "saleAmount": 94400, "serviceFee": 10006, "serviceFeeVat": 1001, "quantity": 1}]},
            {"orderId": 2, "saleType": "REFUND", "saleDate": "2026-07-04", "items": [
                {"vendorItemId": 111, "productId": 9, "productName": "훈제오리",
                 "saleAmount": 94400, "serviceFee": 10006, "serviceFeeVat": 1001, "quantity": 1}]},
            {"orderId": 3, "saleType": "SALE", "saleDate": "2026-06-25", "items": [
                {"vendorItemId": 222, "productId": 8, "productName": "제외대상",
                 "saleAmount": 5000, "serviceFee": 500, "serviceFeeVat": 50, "quantity": 1}]},
        ], "hasNext": False, "nextToken": None},
    ]

    def fake_request(method, url, headers=None, **kw):
        if not pages:                                  # 2번째 구간 조회 → 데이터 없음
            return _Resp(500, {"error": "no data"})
        return _Resp(200, pages.pop(0))

    import apis.coupang_api as cpa
    monkeypatch.setattr(cpa, "_request", fake_request)
    monkeypatch.setattr(cpa, "generate_coupang_signature", lambda m, u: "sig")
    monkeypatch.setattr(cpa, "VENDOR_ID", "A0", raising=False)

    warnings = []
    out = fa._fetch_coupang_revenue("2026-07", warnings)
    by_vi = {}
    for r in out:
        by_vi.setdefault(r["vendor_item_id"], []).append(r)
    assert "222" not in by_vi                          # 6월 판매 제외
    sale, refund = sorted(by_vi["111"], key=lambda r: r["revenue"], reverse=True)
    assert sale["revenue"] == 94400 and sale["fee"] == 11007 and sale["qty"] == 1
    assert refund["revenue"] == -94400 and refund["fee"] == -11007 and refund["qty"] == -1


def test_build_naver_lines_joins_qty():
    settle = [
        {"product_order_id": "po1", "product_id": "p1", "product_name": "상품1",
         "pay_settle_amount": 10000.0, "commission": -300.0},
        {"product_order_id": "po2", "product_id": "p2", "product_name": "상품2",
         "pay_settle_amount": 5000.0, "commission": -150.0},
    ]
    qty_map = {"po1": {"quantity": 3.0, "status": "PURCHASE_DECIDED"}}
    lines = fa._build_naver_lines(settle, qty_map)
    l1 = next(l for l in lines if l["product_name"] == "상품1")
    l2 = next(l for l in lines if l["product_name"] == "상품2")
    assert l1["revenue"] == 10000.0 and l1["fee"] == 300.0 and l1["qty"] == 3.0
    assert l1["qty_partial"] is False
    assert l2["qty"] == 0.0 and l2["qty_partial"] is True     # 수량 조회 누락


def test_endpoints_refresh_then_get(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)                                # 캐시파일을 임시 디렉터리에
    monkeypatch.setattr(fa, "_fetch_naver_settle", lambda m, w: [
        {"product_order_id": "po1", "product_id": "p1", "product_name": "장터국수 우동국물 6개",
         "pay_settle_amount": 74500.0, "commission": -2237.0}])
    monkeypatch.setattr(fa, "_fetch_naver_quantities", lambda ids, w: {"po1": {"quantity": 1.0, "status": "OK"}})
    monkeypatch.setattr(fa, "_fetch_coupang_revenue", lambda m, w: [])
    monkeypatch.setattr(fa, "_load_margin_rows", lambda: [
        {"온라인 상품명": "장터국수 우동국물", "매입": "50000", "네이버 수수료": "4110", "네이버 판매가": "74500"}])
    monkeypatch.setattr(fa, "_load_channel_links", lambda: {})

    from fastapi.testclient import TestClient
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(fa.router)
    c = TestClient(app)

    r0 = c.get("/api/fee-analysis?month=2026-07")
    assert r0.json()["status"] == "error"                      # 캐시 없음

    r1 = c.post("/api/fee-analysis/refresh", json={"month": "2026-07"})
    j1 = r1.json()
    assert j1["status"] == "success"
    assert j1["month"] == "2026-07" and j1["basis"] == "sale"
    assert len(j1["rows"]) == 1

    r2 = c.get("/api/fee-analysis?month=2026-07")
    assert r2.json()["rows"][0]["product_name"] == "장터국수 우동국물"
    assert (tmp_path / "fee_cache_2026-07.json").exists()
