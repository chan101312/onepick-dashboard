"""회귀 테스트: 같은 상품명이 하루에 여러 건 팔리고 E상인에도 그만큼 여러 건
입력된 경우, 전부 정상 매칭되는지 검증한다.

배경: _fetch_esangin_sales_by_date가 날짜+거래처별 전표 이름을 set()으로 담으면
중복 제거돼서 "그 이름이 존재하는지"만 남고 "몇 건 있는지"가 사라진다. 그러면
같은 상품이 하루에 2건 이상 팔려도 그 중 1건만 매칭되고 나머지는 실제로 전표가
있는데도 영원히 미확인으로 잘못 뜬다(2026-08-31 "[미노] 보통맛떡볶이" 사례로
재발 확인 — 2026-08-03에 한 번 Counter로 고쳤던 게 git에 커밋되지 않고 prod에만
있다가 이후 배포로 되돌아간 것으로 추정됨). set이 아니라 Counter를 쓰는 게 원칙."""
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server
from apis import coupang_api, naver_api, sikbom_api

TODAY = datetime.date.today().isoformat()


def _make_esangin(counts_by_vendor):
    """{"거래처": {"상품명": 건수}} 형태를 서버가 기대하는
    {날짜: {거래처: Counter({상품명: 건수})}} 형태로 감싼다."""
    from collections import Counter
    return {TODAY: {vendor: Counter(counts) for vendor, counts in counts_by_vendor.items()}}


def _fake_coupang_order(order_id, product_name):
    return {
        "주문번호": order_id,
        "결제일시": f"{TODAY} 10:00:00",
        "상품명": product_name,
        "수량": 1,
        "주문상태": "DELIVERING",
    }


def _run_reconcile(monkeypatch, esangin_counts, coupang_orders):
    monkeypatch.setattr(server, "_fetch_esangin_sales_by_date", lambda s, e=None: _make_esangin(esangin_counts))
    monkeypatch.setattr(server, "_fetch_esangin_stock_by_name", lambda: [])
    monkeypatch.setattr(coupang_api, "get_coupang_orders", lambda s, e: coupang_orders)
    monkeypatch.setattr(naver_api, "get_new_orders", lambda s, e: [])
    monkeypatch.setattr(sikbom_api, "get_sikbom_orders_by_date", lambda d: [])
    return server.order_reconcile(start_date=TODAY, end_date=TODAY)


# E상인 이름과 채널 상품명을 일부러 완전히 동일한 문자열로 둔다 — 토큰 유사도 매칭 자체의
# 정확도는 이 테스트의 관심사가 아니고(그건 별도 문제), 여기서는 순수하게 "건수 추적"만
# 검증하려는 것이라 매칭 여부의 변수를 없앤다.
DUP_PRODUCT_NAME = "테스트떡볶이 1kg"


def test_same_product_multiple_orders_all_match_when_enough_entries(monkeypatch):
    """같은 상품명으로 주문이 2건, E상인 전표도 2건이면 전부 매칭돼야 한다."""
    orders = [
        _fake_coupang_order("ORDER_1", DUP_PRODUCT_NAME),
        _fake_coupang_order("ORDER_2", DUP_PRODUCT_NAME),
    ]
    result = _run_reconcile(monkeypatch, {"쿠팡": {DUP_PRODUCT_NAME: 2}}, orders)

    assert result["missing_count"] == 0, result["missing"]
    assert result["matched_count"] == 2


def test_same_product_more_orders_than_entries_only_matches_available_count(monkeypatch):
    """주문은 2건인데 E상인 전표가 1건뿐이면, 딱 1건만 매칭되고 나머지 1건은
    (실제로 전표가 부족한 게 맞으므로) 미확인으로 남아야 한다 — 무조건 다 매칭되는
    과잉매칭도 아니고, 예전처럼 1건만 되고 나머지가 억울하게 밀리는 것도 아님을 함께 검증."""
    orders = [
        _fake_coupang_order("ORDER_1", DUP_PRODUCT_NAME),
        _fake_coupang_order("ORDER_2", DUP_PRODUCT_NAME),
    ]
    result = _run_reconcile(monkeypatch, {"쿠팡": {DUP_PRODUCT_NAME: 1}}, orders)

    assert result["matched_count"] == 1
    assert result["missing_count"] == 1
    assert result["missing"][0]["items"][0]["product_name"] == DUP_PRODUCT_NAME


def test_genuine_miss_still_detected_no_regression(monkeypatch):
    """매칭될 전표가 아예 없는 진짜 누락 건은 여전히 미확인으로 남아야 한다(회귀 없음)."""
    orders = [_fake_coupang_order("ORDER_1", "존재하지않는상품_XYZ")]
    result = _run_reconcile(monkeypatch, {"쿠팡": {}}, orders)

    assert result["missing_count"] == 1
    assert result["matched_count"] == 0
