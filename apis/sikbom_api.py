import hmac
import hashlib
import base64
import time
import requests

# ==========================================
# ⚙️ 식봄(foodspring) Open API 설정
# 공식 문서(openapi.foodspring.co.kr/docs) 확보 및 실제 요청으로 검증 완료.
# 서명 방식: HMAC-SHA256(API_SECRET, METHOD + PATH_ONLY(쿼리스트링 제외) + TIMESTAMP) → Base64.
#   ※ 문서 예제(uri = "/v1/goods/100")는 쿼리 없는 케이스만 보여줘서 헷갈렸는데,
#   실제 검증 결과 쿼리스트링은 서명 대상에서 제외해야 한다(경로만 서명).
# 인증 헤더: X-API-Key, X-Timestamp(ms), X-Signature.
# WAF가 python-requests 기본 User-Agent를 차단하므로 curl처럼 위장해서 보낸다.
# ==========================================
def get_cfg(key):
    try:
        import config
        val = getattr(config, key, None)
        return val.strip() if isinstance(val, str) else val
    except Exception:
        return None

SIKBOM_API_KEY = get_cfg("SIKBOM_API_KEY")
SIKBOM_API_SECRET = get_cfg("SIKBOM_API_SECRET")

SIKBOM_ENDPOINT = "https://openapi.foodspring.co.kr"
SIKBOM_ORDERS_PATH = "/v1/order-goods"

# claimInfo.claimStatusCode 중 "취소/반품/교환 요청 없음(기본 상태)"을 뜻하는 코드.
# 실데이터로 확인된 값은 OCS001("요청 대기")/OCS005("취소 승인") 두 가지뿐이라 공식 문서로
# 전체 코드 목록을 확정하지 못했다 — 그래서 "OCS001이 아니면 클레임이 걸린 것으로 보고 제외"
# 하는 화이트리스트 방식으로 보수적으로 처리한다(모르는 코드를 잘못 통과시키는 것보다,
# 모르는 코드를 일단 제외해서 미확인 목록에서 빠지는 쪽이 안전하다).
SIKBOM_NO_CLAIM_CODE = "OCS001"

# orderStatus 중 "배송중 이상"으로 볼 수 있는 값. 실데이터(2026-08-18~08-31, 41건) 기준
# PENDING_CONFIRMATION(신규주문/발송전) → SHIPPED(배송중) → DELIVERED(배송완료) 3단계만
# 관측됨 — 문서상 이 외 상태가 더 있을 수 있어 화이트리스트 방식으로 다룬다.
SIKBOM_SHIPPED_OR_LATER = {"SHIPPED", "DELIVERED"}


def is_configured():
    return bool(SIKBOM_API_KEY and SIKBOM_API_SECRET)


def _sikbom_headers(method, path_only):
    """path_only는 쿼리스트링을 제외한 순수 경로(예: '/v1/order-goods')여야 한다.
    서명은 경로만 쓰지만, 실제 요청은 쿼리스트링을 포함해서 보낸다."""
    ts = str(int(time.time() * 1000))
    data_to_sign = f"{method}{path_only}{ts}"
    sig = base64.b64encode(
        hmac.new(SIKBOM_API_SECRET.encode(), data_to_sign.encode(), hashlib.sha256).digest()
    ).decode()
    return {
        "X-API-Key": SIKBOM_API_KEY,
        "X-Timestamp": ts,
        "X-Signature": sig,
        "User-Agent": "curl/8.14.1",  # WAF가 python-requests UA를 차단함 — 반드시 필요
    }


def get_sikbom_orders_by_date(target_date):
    """식봄 특정 날짜(YYYY-MM-DD) 주문 목록 조회.
    반환 형식은 server.py의 다른 채널(coupang_api.get_coupang_orders 등)과 동일하게 맞춘다:
    [{"결제일시": ..., "상품명": ..., "수량": ..., "상품주문번호": ..., "주문상태": ..., "수취인명": ...}, ...]

    취소/반품 주문(claimInfo.claimStatusCode != OCS001)은 애초에 결과에서 제외한다 —
    네이버(get_new_orders)가 취소/교환/반품 건을 continue로 걸러내는 것과 동일한 패턴."""
    if not is_configured():
        raise RuntimeError("SIKBOM_API_KEY / SIKBOM_API_SECRET이 설정되지 않았습니다. config.py를 확인하세요.")

    path_only = SIKBOM_ORDERS_PATH
    headers = _sikbom_headers("GET", path_only)
    params = {
        "fromDate": f"{target_date}T00:00",
        "toDate": f"{target_date}T23:59",
    }

    result = []
    page = 1
    while True:
        params["page"] = page
        params["size"] = 100
        res = requests.get(f"{SIKBOM_ENDPOINT}{path_only}", headers=headers, params=params, timeout=15)
        res.raise_for_status()
        data = res.json()
        content = data.get("content", [])
        for o in content:
            claim_code = o.get("claimInfo", {}).get("claimStatusCode")
            if claim_code and claim_code != SIKBOM_NO_CLAIM_CODE:
                continue  # 취소/반품/교환 등 클레임이 걸린 주문 — 대조 대상에서 제외

            goods = o.get("orderGoods", {})
            recipient = o.get("deliveryInfo", {}).get("deliveryAddress", {}).get("recipientName", "")
            result.append({
                "결제일시": o.get("orderedAt", target_date),
                "상품명": goods.get("goodsName", ""),
                "수량": o.get("initQuantity", 0),
                "상품주문번호": str(o.get("orderGoodsNo", "")),
                "주문번호": str(o.get("orderMasterNo", "")),
                "주문상태": o.get("orderStatus", ""),
                "수취인명": recipient,
            })
        total_pages = data.get("totalPages", 1)
        if page >= total_pages:
            break
        page += 1
        # 새 요청마다 timestamp/signature를 다시 만들어야 한다 (서명이 시간에 종속적)
        headers = _sikbom_headers("GET", path_only)

    return result


def get_sikbom_stock_by_product_name():
    """식봄 상품별 재고 조회 — 별도 문서 확인 전이라 아직 미구현.
    호출부(server.py)에서 이 예외를 잡아서 '미연동' 상태로 표시한다."""
    raise NotImplementedError(
        "식봄 재고 조회 API는 아직 문서 확인 전입니다. 주문 조회(get_sikbom_orders_by_date)는 구현 완료됨."
    )


def get_sikbom_products():
    """식봄 등록 상품 목록(goodsId, goodsName) 조회. 채널 연결(가격 자동반영) 기능에서
    상품명 검색용으로 쓴다. 문서상 /v1/goods가 목록 조회 엔드포인트로 확인됨."""
    if not is_configured():
        raise RuntimeError("SIKBOM_API_KEY / SIKBOM_API_SECRET이 설정되지 않았습니다.")

    path_only = "/v1/goods"
    products = []
    page = 1
    while True:
        headers = _sikbom_headers("GET", path_only)  # 매 요청마다 서명 새로 생성(타임스탬프 종속)
        res = requests.get(
            f"{SIKBOM_ENDPOINT}{path_only}",
            headers=headers,
            params={"page": page, "size": 100},
            timeout=15,
        )
        if res.status_code != 200:
            print(f"[식봄 상품조회] 목록 조회 실패 (page={page}): HTTP {res.status_code} — {res.text[:300]}")
            break
        data = res.json()
        content = data.get("content", [])
        if not content:
            break
        for item in content:
            products.append({
                "goodsId": item.get("goodsId"),
                "goodsName": str(item.get("goodsName", "")).strip(),
            })
        total_pages = data.get("totalPages", 1)
        if page >= total_pages:
            break
        page += 1
    return products


def search_sikbom_products_by_name(keyword, months_back=3):
    """상품 목록 조회 API가 없어서, 최근 N개월 주문 내역(goodsName 포함검색 지원)에서
    goodsId를 역으로 찾아내는 우회 방식. 채널 연결(가격 자동반영) 시 후보 검색용으로만 쓴다
    — 이 기간 안에 한 번도 안 팔린 신상품은 이 방법으로 못 찾는 한계가 있다.
    식봄 API는 조회 기간을 한 번에 최대 31일까지만 허용해서(OI_REQ_2001 에러),
    원하는 기간을 31일짜리 구간으로 쪼개서 여러 번 요청한다."""
    if not is_configured():
        raise RuntimeError("SIKBOM_API_KEY / SIKBOM_API_SECRET이 설정되지 않았습니다.")
    import datetime
    MAX_WINDOW_DAYS = 31
    end = datetime.date.today()
    overall_start = end - datetime.timedelta(days=months_back * 30)
    path_only = "/v1/order-goods"
    found = {}  # goodsId -> goodsName (중복 제거용)

    window_end = end
    while window_end > overall_start:
        window_start = max(overall_start, window_end - datetime.timedelta(days=MAX_WINDOW_DAYS - 1))
        page = 1
        while True:
            headers = _sikbom_headers("GET", path_only)
            params = {
                "fromDate": f"{window_start.isoformat()}T00:00",
                "toDate": f"{window_end.isoformat()}T23:59",
                "goodsName": keyword,
                "page": page,
                "size": 100,
            }
            res = requests.get(f"{SIKBOM_ENDPOINT}{path_only}", headers=headers, params=params, timeout=15)
            if res.status_code != 200:
                print(f"[식봄 상품검색] 조회 실패 ({window_start}~{window_end}, page={page}): HTTP {res.status_code} — {res.text[:300]}")
                break
            data = res.json()
            content_list = data.get("content", [])
            if not content_list:
                break
            for o in content_list:
                goods = o.get("orderGoods", {})
                gid = goods.get("goodsId")
                gname = goods.get("goodsName", "")
                if gid and gid not in found:
                    found[gid] = gname
            total_pages = data.get("totalPages", 1)
            if page >= total_pages:
                break
            page += 1
        window_end = window_start - datetime.timedelta(days=1)

    return [{"goodsId": gid, "goodsName": name} for gid, name in found.items()]


def get_sikbom_product_detail(goods_id):
    """단일 상품 상세 조회. 가격 수정 시 기존 정보(카테고리/배송 등)를 유지한 채
    priceInfo만 바꿔서 다시 PUT해야 하므로 먼저 이걸로 전체 정보를 가져온다."""
    if not is_configured():
        raise RuntimeError("SIKBOM_API_KEY / SIKBOM_API_SECRET이 설정되지 않았습니다.")
    path_only = f"/v1/goods/{goods_id}"
    headers = _sikbom_headers("GET", path_only)
    res = requests.get(f"{SIKBOM_ENDPOINT}{path_only}", headers=headers, timeout=15)
    if res.status_code != 200:
        print(f"[식봄 상품상세] 조회 실패 (goodsId={goods_id}): HTTP {res.status_code} — {res.text[:300]}")
        return None
    return res.json()


def update_sikbom_price(goods_id, new_sale_price):
    """가격만 안전하게 수정한다. 상품을 먼저 조회해서 기존 정보를 그대로 유지한 채
    priceInfo만 바꿔서 다시 PUT한다.
    실데이터로 검증한 함정들:
    1) barcode가 빈 문자열이면 "13~14자여야 함"으로 거부됨 → 비어있으면 필드 자체를 뺀다.
    2) orderLimits의 maxOrderQtyPerTime/maxOrderQtyPerDay는 제한이 꺼져있어도 0이면
       "1 이상이어야 함"으로 거부됨 → 0이면 1로 보정한다.
    3) notices.noticeType="IMAGE"인 상품이어도, PUT은 여전히 noticeTemplate의 GN001 템플릿
       11개 항목을 전부 요구한다(상세조회에 없는 값은 "상품상세참조"로 대체 채움).
    4) 【진짜 근본 원인】 새 판매가(singlePrice)가 기존 정가(listPrice)를 넘으면 500 에러
       ("상품을 생성할 수 없습니다"라는 애매한 메시지로만 나와서 원인 파악이 오래 걸렸다).
       원가 인상으로 판매가를 올릴 땐 정가도 함께 올려야 하므로, 새 정가를
       max(기존 정가, 새 판매가 * 1.1, 10원 단위 반올림)으로 자동 계산해서 같이 보낸다."""
    if not is_configured():
        return False, "SIKBOM_API_KEY / SIKBOM_API_SECRET이 설정되지 않았습니다."
    detail = get_sikbom_product_detail(goods_id)
    if not detail:
        return False, "상품 상세 조회 실패"

    new_sale_price = int(new_sale_price)
    price_info = detail.get("priceInfo", {}) or {}
    price_type = price_info.get("priceType", "SINGLE_PRICE")

    existing_list_price = price_info.get("listPrice") or 0
    # 정가는 새 판매가보다 낮으면 안 되므로, 여유있게 10% 높여서 계산(10원 단위로 반올림)
    calculated_list_price = int(round(new_sale_price * 1.1 / 10) * 10)
    new_list_price = max(existing_list_price, calculated_list_price, new_sale_price)

    order_limits_raw = detail.get("orderLimits") or {}
    order_limits = {
        "isMinorPurchasable": order_limits_raw.get("isMinorPurchasable"),
        "isMinOrderQtyLimit": order_limits_raw.get("isMinOrderQtyLimit"),
        "minOrderQty": order_limits_raw.get("minOrderQty") or 1,
        "isMaxOrderQtyPerTimeLimit": order_limits_raw.get("isMaxOrderQtyPerTimeLimit"),
        "maxOrderQtyPerTime": order_limits_raw.get("maxOrderQtyPerTime") or 1,
        "isMaxOrderQtyPerDayLimit": order_limits_raw.get("isMaxOrderQtyPerDayLimit"),
        "maxOrderQtyPerDay": order_limits_raw.get("maxOrderQtyPerDay") or 1,
        "purchaseUnitQty": order_limits_raw.get("purchaseUnitQty") or 1,
    }

    notices_raw = detail.get("notices") or {}
    notice_template_raw = notices_raw.get("noticeTemplate")
    if notice_template_raw and notice_template_raw.get("noticeItems"):
        # 원래 TEMPLATE 방식이던 상품 — 실제 등록된 값 그대로 사용
        notice_template_payload = {
            "noticeTemplateCode": notice_template_raw["templateCode"],
            "noticeTemplateItems": [
                {"itemId": str(i["itemId"]), "value": i["value"]}
                for i in notice_template_raw.get("noticeItems", [])
            ],
        }
    else:
        # IMAGE 방식 상품 — 실제 GN001 항목 값이 없으므로, 상세 정보에서 뽑을 수 있는 것만
        # 채우고 나머지는 "상품상세참조"로 채운다(PUT이 IMAGE 타입이어도 이 구조를 요구함).
        salesSpec = detail.get("salesSpec", "") or "상품상세참조"
        salesUnit = detail.get("salesUnit", "") or "상품상세참조"
        origin = detail.get("origin", "") or "상품상세참조"
        notice_template_payload = {
            "noticeTemplateCode": "GN001",
            "noticeTemplateItems": [
                {"itemId": "32", "value": salesSpec},
                {"itemId": "33", "value": salesUnit},
                {"itemId": "34", "value": "상품상세참조"},
                {"itemId": "35", "value": "상품상세참조"},
                {"itemId": "36", "value": "상품상세참조"},
                {"itemId": "37", "value": "상품상세참조"},
                {"itemId": "38", "value": origin},
                {"itemId": "39", "value": "상품상세참조"},
                {"itemId": "40", "value": "상품상세참조"},
                {"itemId": "41", "value": "상품상세참조"},
                {"itemId": "42", "value": "상품상세참조"},
            ],
        }
    notices_payload = {
        "noticeType": "IMAGE" if notices_raw.get("noticeImageId") and not notice_template_raw else "TEMPLATE",
        "noticeImageId": notices_raw.get("noticeImageId"),
        "noticeTemplate": notice_template_payload,
    }

    category_info = detail.get("category") or {}
    delivery_info_raw = detail.get("deliveryInfo") or {}
    delivery_info_payload = {
        "deliveryPriceId": delivery_info_raw.get("deliveryPriceId"),
        "isBundleShipping": delivery_info_raw.get("isBundleShipping"),
        "shippingWeight": delivery_info_raw.get("shippingWeight") or 1,
        "shippingVolume": delivery_info_raw.get("shippingVolume") or 1,
    }

    raw_goods_name = (detail.get("goodsName") or "").strip()
    safe_goods_name = raw_goods_name if len(raw_goods_name) <= 30 else raw_goods_name[:30]

    update_payload = {
        "erpCode": detail.get("erpCode") or None,
        "goodsName": safe_goods_name,
        "leafCategoryId": category_info.get("leafCategoryId"),
        "manufacturer": detail.get("manufacturer") or None,
        "origin": detail.get("origin"),
        "salesSpec": detail.get("salesSpec"),
        "salesUnit": detail.get("salesUnit"),
        "stockQty": detail.get("stockQty"),
        "detailContents": detail.get("detailContents"),
        "keyword": detail.get("keyword"),
        "priceInfo": {
            "listPrice": new_list_price,
            "priceType": "SINGLE" if price_type == "SINGLE_PRICE" else price_type,
            "singlePrice": new_sale_price,
            "quantityPrice": price_info.get("quantityPrice"),
            "weightPrice": price_info.get("weightPrice"),
            "buyPrice": price_info.get("buyPrice"),
        },
        "notices": notices_payload,
        "deliveryInfo": delivery_info_payload,
        "orderLimits": order_limits,
    }

    barcode = detail.get("barcode") or ""
    if len(barcode) in (13, 14):
        update_payload["barcode"] = barcode

    path_only = f"/v1/goods/{goods_id}"
    headers = _sikbom_headers("PUT", path_only)
    headers["Content-Type"] = "application/json"
    res = requests.put(f"{SIKBOM_ENDPOINT}{path_only}", headers=headers, json=update_payload, timeout=15)
    if res.status_code != 200:
        return False, f"수정실패: HTTP {res.status_code} — {res.text[:300]}"
    return True, "success"
