import time
import hmac
import hashlib
import requests
from datetime import datetime, timedelta, timezone

# ==========================================
# 🌐 HTTP helper (timeout + retry)
# ==========================================
def _request(method: str, url: str, *, timeout: int = 15, retries: int = 2, backoff: float = 0.6, **kwargs):
    last_err = None
    for attempt in range(retries + 1):
        try:
            res = requests.request(method, url, timeout=timeout, **kwargs)
            if res.status_code >= 500 and attempt < retries:
                time.sleep(backoff * (2 ** attempt))
                continue
            return res
        except requests.RequestException as e:
            last_err = e
            if attempt < retries:
                time.sleep(backoff * (2 ** attempt))
                continue
            raise
    if last_err:
        raise last_err
    raise RuntimeError("request failed")

# --- ⚙️ 설정값 불러오기 ---
def get_cfg(key):
    try:
        import config
        val = getattr(config, key)
        # 💡 [핵심 안전장치] 키 값 앞뒤에 묻어있는 '보이지 않는 띄어쓰기'를 완벽하게 제거합니다!
        return val.strip() if isinstance(val, str) else val
    except:
        return None

VENDOR_ID = get_cfg("COUPANG_VENDOR_ID")
ACCESS_KEY = get_cfg("COUPANG_ACCESS_KEY")
SECRET_KEY = get_cfg("COUPANG_SECRET_KEY")

def generate_coupang_signature(method, uri):
    if not all([VENDOR_ID, ACCESS_KEY, SECRET_KEY]):
        return None
    datetime_gmt = time.strftime('%y%m%dT%H%M%SZ', time.gmtime())
    
    # 💡 [핵심 해결] 쿠팡 암호화 규칙: URL에서 '?' 기호는 반드시 빼고 조립해야 합니다!
    if "?" in uri:
        path, query = uri.split("?")
    else:
        path, query = uri, ""
        
    message = datetime_gmt + method + path + query
    signature = hmac.new(bytes(SECRET_KEY, 'utf-8'), msg=bytes(message, 'utf-8'), digestmod=hashlib.sha256).hexdigest()
    return f"CEA algorithm=HmacSHA256, access-key={ACCESS_KEY}, signed-date={datetime_gmt}, signature={signature}"

def get_coupang_orders(start_date=None, end_date=None):
    """
    쿠팡 신규 주문 수집. start_date/end_date(YYYY-MM-DD, KST 기준)를 지정하면 그 기간만,
    생략하면 기존처럼 최근 3일~오늘을 조회한다.

    ⚠️ 2026-07-31 디버깅으로 발견한 두 가지 버그를 고쳤음 (원인: order_count가 실제 주문이
    있는데도 0으로 나옴):
      1) createdAtFrom/createdAtTo에 시간대(timezone) 정보 없이 맨 날짜만 보내고 있었음.
         공식 문서(paging by day 모드) 형식은 `yyyy-mm-dd+09:00`(URL에는 %2B로 인코딩,
         예: 2025-07-21%2B09:00)인데 기존 코드는 `2026-07-31`처럼 그냥 날짜만 보냈음.
      2) status=ACCEPT 하나만 조회했음. 쿠팡은 status가 필수 파라미터고 한 번에 값 하나만
         지정 가능해서(ACCEPT/INSTRUCT/DEPARTURE/DELIVERING/FINAL_DELIVERY/NONE_TRACKING 중 하나),
         주문이 결제완료(ACCEPT) 이후 상품준비중(INSTRUCT) 등으로 이미 넘어갔으면 전혀 안 잡혔음.
         (naver_api.get_new_orders()가 PAYED/DISPATCHED 두 상태를 순회 조회하는 것과 동일한 이유로
         여기서도 상태별로 반복 조회함.)
    또한 최신 공식 문서가 v5 엔드포인트를 기준으로 안내하고 있어 v4→v5로 갱신함
    (v4가 실제로 막힌 건지는 이 샌드박스에서 확인 못 했음 — 아래 DEBUG 로그로 실서버에서 확인 필요).

    TODO: maxPerPage(최대 50)/nextToken 페이지네이션 처리가 없음 — 하루 주문이 50건을
    넘으면 일부가 누락될 수 있음. 지금 버그(0건)를 먼저 해결하는 데 집중하느라 남겨둠.
    """
    if not all([VENDOR_ID, ACCESS_KEY, SECRET_KEY]):
        return []

    KST = timezone(timedelta(hours=9))
    now = datetime.now(KST)
    if not start_date:
        start_date = (now - timedelta(days=3)).strftime("%Y-%m-%d")
    if not end_date:
        end_date = now.strftime("%Y-%m-%d")
    # 공식 문서(paging by day) 형식: yyyy-mm-dd+09:00 → URL에는 %2B로 인코딩해서 보냄
    created_from = f"{start_date}%2B09:00"
    created_to = f"{end_date}%2B09:00"

    result = []
    seen_keys = set()

    # status는 필수 파라미터라 상태별로 각각 조회해야 함
    for status in ["ACCEPT", "INSTRUCT", "DEPARTURE", "DELIVERING"]:
        query = f"createdAtFrom={created_from}&createdAtTo={created_to}&status={status}"
        uri = f"/v2/providers/openapi/apis/api/v5/vendors/{VENDOR_ID}/ordersheets?{query}"
        url = f"https://api-gateway.coupang.com{uri}"

        auth_header = generate_coupang_signature("GET", uri)
        headers = {"Authorization": auth_header, "Content-Type": "application/json;charset=UTF-8", "Accept": "application/json"}

        res = _request("GET", url, headers=headers)

        # 🐛 DEBUG (임시): 실제 쿠팡 API 원본 응답을 그대로 찍어서 어디서 걸러지는지 확인용.
        # 원인 파악 끝나면 이 블록은 지울 것.
        print(f"[DEBUG coupang] status={status} uri={uri}")
        print(f"[DEBUG coupang] status_code={res.status_code} body={res.text[:800]}")

        if res.status_code != 200:
            print(f"[쿠팡 주문조회] status={status} 조회 실패: HTTP {res.status_code} — {res.text[:300]}")
            continue

        data = res.json()
        for order in data.get('data', []):
            ordered_at = order.get('orderedAt', '')[:16].replace("T", " ")
            # v4→v5 갱신 과정에서 receiver 관련 필드가 order 바로 아래 평평한 키
            # (receiverName 등)가 아니라 order['receiver'] 안에 중첩된 구조로 바뀌었는데
            # 여기가 안 따라가서 지금까지 전부 빈 문자열만 나오고 있었다.
            receiver_info = order.get('receiver', {}) or {}
            receiver = receiver_info.get('name', '')
            tel = receiver_info.get('safeNumber', '') or order.get('orderer', {}).get('safeNumber', '')
            addr = f"{receiver_info.get('addr1', '')} {receiver_info.get('addr2', '')}"
            memo = order.get('shippingMemo', '')

            for item in order.get('orderItems', []):
                key = (str(order.get('orderId', '')), str(item.get('vendorItemId', '')))
                if key in seen_keys:
                    continue  # 같은 주문이 여러 status 조회에 중복으로 안 걸리게
                seen_keys.add(key)
                shipping_count = item.get('shippingCount', 0)
                if shipping_count <= 0:
                    continue  # 전량 취소된 품목(cancelCount로 전부 상쇄) — 대조 대상에서 제외
                result.append({
                    "마켓": "쿠팡",
                    "결제일시": ordered_at,
                    "주문상태": status,  # ACCEPT(결제완료)/INSTRUCT(상품준비중)/DEPARTURE/DELIVERING — 조회에 쓰인 상태 버킷 = 현재 상태
                    "주문번호": str(order.get('orderId', '')),
                    "상품주문번호": str(item.get('vendorItemId', '')),
                    "상품명": item.get('vendorItemName', ''),
                    "옵션명": item.get('vendorItemPackageName', ''),
                    "수량": item.get('shippingCount', 0),
                    "수취인명": receiver,
                    "연락처": tel,
                    "배송지": addr,
                    "배송메시지": memo,
                    "결제금액": item.get('orderPrice', 0)
                })

    result.sort(key=lambda x: x['결제일시'], reverse=True)
    return result

# ==========================================
# 📦 재고 정합성 체크용 — 상품 목록/상세/재고 조회
# 공식 문서(developers.coupang.com) 기준:
#   1) GET .../marketplace/seller-products?vendorId=...        → sellerProductId, sellerProductName 목록
#   2) GET .../marketplace/seller-products/{sellerProductId}   → data.items[]에 vendorItemId, maximumBuyCount("판매 가능 수량")
# ==========================================
def get_coupang_products():
    """등록된 판매상품 목록(sellerProductId, sellerProductName)을 페이징으로 전부 수집한다.
    응답의 nextToken(opaque 커서 값)을 그대로 다음 요청에 실어 보내야 다음 페이지가 나온다 —
    이전에는 페이지 번호(1,2,3...)를 nextToken 자리에 넣어 보내서 2페이지부터 항상 빈 응답을
    받았고, 그 결과 seller-products 목록이 첫 100개에서 조용히 잘려나갔다.
    무한루프 방지용으로 최대 50페이지(≈최대 5,000개)에서 강제 종료한다."""
    if not all([VENDOR_ID, ACCESS_KEY, SECRET_KEY]):
        return []

    products = []
    next_token = ""
    MAX_PAGES = 50
    for page in range(1, MAX_PAGES + 1):
        query = f"vendorId={VENDOR_ID}&nextToken={next_token}&maxPerPage=100"
        uri = f"/v2/providers/seller_api/apis/api/v1/marketplace/seller-products?{query}"
        url = f"https://api-gateway.coupang.com{uri}"
        auth_header = generate_coupang_signature("GET", uri)
        headers = {"Authorization": auth_header, "Content-Type": "application/json;charset=UTF-8", "Accept": "application/json"}

        res = _request("GET", url, headers=headers)
        if res.status_code != 200:
            print(f"[쿠팡 재고조회] 상품 목록 조회 실패 (page={page}): HTTP {res.status_code} — {res.text[:300]}")
            break

        body = res.json() or {}
        items = body.get('data', [])
        if not items:
            break

        for item in items:
            products.append({
                "sellerProductId": item.get("sellerProductId"),
                "sellerProductName": str(item.get("sellerProductName", "")).strip(),
            })

        next_token = str(body.get('nextToken') or "")
        if not next_token:
            break

    return products


def get_coupang_product_detail(seller_product_id):
    """단일 판매상품 상세 조회 (옵션별 vendorItemId, maximumBuyCount 등 포함)."""
    if not all([VENDOR_ID, ACCESS_KEY, SECRET_KEY]) or not seller_product_id:
        return None

    uri = f"/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{seller_product_id}"
    url = f"https://api-gateway.coupang.com{uri}"
    auth_header = generate_coupang_signature("GET", uri)
    headers = {"Authorization": auth_header, "Content-Type": "application/json;charset=UTF-8", "Accept": "application/json"}

    res = _request("GET", url, headers=headers)
    if res.status_code != 200:
        print(f"[쿠팡 재고조회] 상품 상세 조회 실패 (sellerProductId={seller_product_id}): HTTP {res.status_code} — {res.text[:300]}")
        return None
    return (res.json() or {}).get('data')


def _round_price_to_10(price):
    """쿠팡 가격변경 API는 10원 단위만 허용한다."""
    price = float(price)
    return int((price + 5) // 10) * 10


def update_coupang_item_price(vendor_item_id, price):
    """옵션(vendorItemId) 단위 판매가격 변경. 요청 바디 없음, 가격은 10원 단위로 반올림해서 보낸다."""
    if not all([VENDOR_ID, ACCESS_KEY, SECRET_KEY]):
        return False, "쿠팡 API 키(COUPANG_VENDOR_ID/ACCESS_KEY/SECRET_KEY)가 config.py에 설정되지 않았습니다."
    if not vendor_item_id:
        return False, "vendor_item_id가 없습니다."

    rounded_price = _round_price_to_10(price)
    uri = f"/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/{vendor_item_id}/prices/{rounded_price}"
    url = f"https://api-gateway.coupang.com{uri}"
    auth_header = generate_coupang_signature("PUT", uri)
    headers = {"Authorization": auth_header, "Content-Type": "application/json;charset=UTF-8", "Accept": "application/json"}

    res = _request("PUT", url, headers=headers)
    if res.status_code == 200:
        return True, "성공"
    return False, f"쿠팡 거부: HTTP {res.status_code} — {res.text[:300]}"


def get_coupang_stock_by_product_name():
    """
    상품명별 쿠팡 '판매가능수량'(maximumBuyCount)을 조회한다. 옵션이 여러 개인 상품은 옵션별 수량을 합산한다.
    ⚠️ 상품 개수만큼 상세조회 API를 호출한다 — 상품이 많으면 느릴 수 있음.
    TODO: maximumBuyCount가 실제로 "남은 재고"와 정확히 같은 개념인지 실데이터로 검증 필요.
          다르다면 대안으로 GET /v2/.../vendor-items/{vendorItemId}/inventories 의 amountInStock을
          vendorItemId별로 추가 조회해서 합산하는 방식으로 교체할 것.
    """
    if not all([VENDOR_ID, ACCESS_KEY, SECRET_KEY]):
        raise RuntimeError("쿠팡 API 키(COUPANG_VENDOR_ID/ACCESS_KEY/SECRET_KEY)가 config.py에 설정되지 않았습니다.")

    products = get_coupang_products()
    if not products:
        # 진짜로 등록 상품이 0개일 수도 있지만, 재고 정합성 체크에서는 "빈 결과=이상없음"으로
        # 오인되면 위험하므로 일부러 에러로 처리한다. 원인은 위 [쿠팡 재고조회] 로그에서 확인.
        raise RuntimeError(
            "쿠팡 상품 목록을 가져오지 못했습니다(0건). 인증 실패(서명/시간 오차) 또는 상품이 "
            "실제로 없는 경우일 수 있습니다 — 서버 로그의 [쿠팡 재고조회] 라인을 확인하세요."
        )

    stock_by_name = {}
    for p in products:
        seller_product_id = p.get("sellerProductId")
        name = p.get("sellerProductName", "")
        if not seller_product_id or not name:
            continue

        detail = get_coupang_product_detail(seller_product_id)
        if not detail:
            continue

        total_qty = 0
        for item in (detail.get("items") or []):
            qty = item.get("maximumBuyCount")
            if isinstance(qty, (int, float)):
                total_qty += qty

        stock_by_name[name] = stock_by_name.get(name, 0) + total_qty

    return stock_by_name
