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
