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
