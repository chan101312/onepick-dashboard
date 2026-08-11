import requests

# ==========================================
# ⚙️ 식봄 API 설정
# 공식 개발자 문서를 못 찾아서(2단계 조사 결과 참고) 엔드포인트/인증 방식이 전부 미확정 상태.
# 아래 TODO 상수/함수를 실제 문서 기준으로 채워넣으면 됨.
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

# TODO: 식봄 실제 API base URL로 교체 (판매자 어드민 > API 발급 메뉴에 안내된 주소 확인)
SIKBOM_ENDPOINT_TODO = "https://api.sikbom.example.com"

# TODO: 실제 상품 목록 조회 경로로 교체 (일반적인 REST 패턴으로 임시 지정해둠)
SIKBOM_PRODUCTS_PATH = "/products"
# TODO: 실제 재고 조회 경로로 교체 (예: /inventory/{productId} 형태일 수도 있음)
SIKBOM_INVENTORY_PATH = "/inventory"
# TODO: 실제 주문 목록 조회 경로로 교체 (예: /orders?date=YYYY-MM-DD 형태일 수도 있음)
SIKBOM_ORDERS_PATH = "/orders"


def is_configured():
    """API 키/시크릿이 설정돼 있는지만 확인 (엔드포인트 확정 여부와는 별개)."""
    return bool(SIKBOM_API_KEY and SIKBOM_API_SECRET)


def _sikbom_headers():
    # TODO: 식봄이 Bearer 토큰인지, API-Key 헤더인지, 서명(HMAC) 방식인지 문서로 확인 후 교체.
    # 지금은 가장 흔한 두 방식(Authorization Bearer + 커스텀 시크릿 헤더)을 임시로 넣어둠.
    return {
        "Authorization": f"Bearer {SIKBOM_API_KEY}",
        "X-API-Secret": SIKBOM_API_SECRET or "",
        "Content-Type": "application/json",
    }


def get_sikbom_stock_by_product_name():
    """
    식봄 상품명별 재고 조회. 공식 문서가 없어 실제로는 아직 동작하지 않는다.
    호출하면 NotImplementedError를 던지므로, 호출부(server.py)에서
    이걸 잡아서 '미연동' 상태로 표시하면 된다.

    엔드포인트가 확정되면 이 함수 안의 TODO만 채우면 되도록 구조만 잡아뒀다.
    """
    if not is_configured():
        raise RuntimeError("SIKBOM_API_KEY / SIKBOM_API_SECRET이 설정되지 않았습니다. config.py를 확인하세요.")

    raise NotImplementedError(
        "식봄 공식 API 문서가 없어 엔드포인트/요청 형식이 확정되지 않았습니다. "
        "apis/sikbom_api.py의 SIKBOM_ENDPOINT_TODO, SIKBOM_PRODUCTS_PATH, SIKBOM_INVENTORY_PATH, "
        "_sikbom_headers()를 실제 문서 기준으로 채운 뒤 아래 스켈레톤을 완성하세요."
    )

    # --- 여기부터는 일반적인 REST 패턴으로 짜둔 뼈대 (위 raise를 지우고 사용) ---
    # products_res = requests.get(
    #     f"{SIKBOM_ENDPOINT_TODO}{SIKBOM_PRODUCTS_PATH}", headers=_sikbom_headers(), timeout=15
    # )
    # products_res.raise_for_status()
    # products = products_res.json()  # TODO: 실제 응답 구조에 맞게 파싱 (예: .get('data', []))
    #
    # stock_by_name = {}
    # for p in products:
    #     product_id = p.get("id")      # TODO: 실제 필드명 확인
    #     name = str(p.get("name", "")).strip()  # TODO: 실제 필드명 확인
    #     if not product_id or not name:
    #         continue
    #     inv_res = requests.get(
    #         f"{SIKBOM_ENDPOINT_TODO}{SIKBOM_INVENTORY_PATH}/{product_id}",
    #         headers=_sikbom_headers(), timeout=15
    #     )
    #     inv_res.raise_for_status()
    #     stock_by_name[name] = inv_res.json().get("quantity", 0)  # TODO: 실제 필드명 확인
    # return stock_by_name


def get_sikbom_orders_by_date(target_date):
    """
    식봄 특정 날짜(YYYY-MM-DD) 주문 목록 조회. 공식 문서가 없어 실제로는 아직 동작하지 않는다.
    호출하면 NotImplementedError를 던지므로, 호출부(server.py의 /api/order-reconcile)에서
    이걸 잡아서 '엔드포인트 미확정' 상태로 표시하면 된다.
    """
    if not is_configured():
        raise RuntimeError("SIKBOM_API_KEY / SIKBOM_API_SECRET이 설정되지 않았습니다. config.py를 확인하세요.")

    raise NotImplementedError(
        "식봄 주문 조회 API 문서가 없어 엔드포인트/요청 형식이 확정되지 않았습니다. "
        "apis/sikbom_api.py의 SIKBOM_ORDERS_PATH, _sikbom_headers()를 실제 문서 기준으로 채운 뒤 "
        "아래 스켈레톤을 완성하세요."
    )

    # --- 여기부터는 일반적인 REST 패턴으로 짜둔 뼈대 (위 raise를 지우고 사용) ---
    # res = requests.get(
    #     f"{SIKBOM_ENDPOINT_TODO}{SIKBOM_ORDERS_PATH}", headers=_sikbom_headers(),
    #     params={"date": target_date}, timeout=15  # TODO: 실제 쿼리 파라미터명 확인
    # )
    # res.raise_for_status()
    # orders = res.json()  # TODO: 실제 응답 구조에 맞게 파싱 (예: .get('data', []))
    #
    # result = []
    # for o in orders:
    #     result.append({
    #         "결제일시": o.get("orderedAt", target_date),  # TODO: 실제 필드명 확인
    #         "상품명": o.get("productName", ""),            # TODO: 실제 필드명 확인
    #         "수량": o.get("quantity", 0),                  # TODO: 실제 필드명 확인
    #         "상품주문번호": str(o.get("orderId", "")),      # TODO: 실제 필드명 확인
    #     })
    # return result
