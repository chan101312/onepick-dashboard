import requests
import time
import bcrypt
import base64
import pandas as pd
import hashlib
import hmac
from datetime import datetime, timedelta
import config  # 💡 Streamlit 대신 config.py에서 키를 가져옵니다!

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

NAVER_COMMERCE_ID = getattr(config, "NAVER_COMMERCE_CLIENT_ID", None)
NAVER_COMMERCE_SECRET = getattr(config, "NAVER_COMMERCE_CLIENT_SECRET", None)
NAVER_SEARCH_CLIENT_ID = getattr(config, "NAVER_SEARCH_CLIENT_ID", None)
NAVER_SEARCH_CLIENT_SECRET = getattr(config, "NAVER_SEARCH_CLIENT_SECRET", None)
NAVER_AD_LICENSE = getattr(config, "NAVER_AD_LICENSE", None)
NAVER_AD_SECRET = getattr(config, "NAVER_AD_SECRET", None)
NAVER_AD_CUSTOMER_ID = getattr(config, "NAVER_AD_CUSTOMER_ID", None)

def get_access_token():
    if not NAVER_COMMERCE_ID: return None
    timestamp = str(int(time.time() * 1000))
    password = f"{NAVER_COMMERCE_ID}_{timestamp}"
    hashed_pw = bcrypt.hashpw(password.encode('utf-8'), NAVER_COMMERCE_SECRET.encode('utf-8'))
    client_secret_sign = base64.standard_b64encode(hashed_pw).decode('utf-8')
    url = "https://api.commerce.naver.com/external/v1/oauth2/token"
    data = {"client_id": NAVER_COMMERCE_ID, "timestamp": timestamp, "client_secret_sign": client_secret_sign, "grant_type": "client_credentials", "type": "SELF"}
    res = _request("POST", url, data=data)
    return res.json().get('access_token') if res.status_code == 200 else None

# 💡 [핵심] 1페이지만 가져오던 것을, 상품이 더 이상 없을 때까지 무한대로 페이지를 넘기며 수집하도록 개조했습니다!
def get_my_products():
    token = get_access_token()
    if not token:
        print("[네이버] access token 발급 실패 — NAVER_COMMERCE_CLIENT_ID/SECRET 또는 서버 시간(clock skew)을 확인하세요.")
        return []
    url = "https://api.commerce.naver.com/external/v1/products/search"
    headers = {"Authorization": f"Bearer {token}"}
    
    items = []
    page = 1  
    
    while True: 
        res = _request("POST", url, headers=headers, json={"page": page, "size": 100})
        if res.status_code != 200: break 
            
        contents = res.json().get('contents', [])
        if not contents: break 
            
        for item in contents:
            try:
                ch = item['channelProducts'][0]
                prod_name = str(ch['name']).strip()
                
                # 💡 [핵심 해결] 숫자만 있거나, '야야', '테스트' 같은 의미 없는 유령 상품은 완벽하게 걸러냅니다!
                if prod_name.isdigit() or prod_name in ["야야", "테스트", "임시", "test"]:
                    continue
                    
                items.append({
                    'name': prod_name, 
                    'price': ch['salePrice'], 
                    'originProductNo': item['originProductNo'],
                    'channelProductNo': ch['channelProductNo']
                })
            except: continue
            
        page += 1 
        
    return items

def get_new_orders(start_date=None, end_date=None):
    """start_date/end_date(YYYY-MM-DD, KST 기준)를 지정하면 그 기간만, 생략하면 기존처럼
    최근 3일을 조회한다."""
    token = get_access_token()
    if not token: return []
    from datetime import timezone, timedelta
    from datetime import datetime
    KST = timezone(timedelta(hours=9))
    now = datetime.now(KST)

    if start_date and end_date:
        range_start = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=KST)
        range_end = datetime.strptime(end_date, "%Y-%m-%d").replace(tzinfo=KST) + timedelta(days=1)
        day_windows = []
        cursor = range_start
        while cursor < range_end:
            day_windows.append((cursor, min(cursor + timedelta(days=1), range_end)))
            cursor += timedelta(days=1)
    else:
        day_windows = [(now - timedelta(days=i + 1), now - timedelta(days=i)) for i in range(3)]

    url_status = "https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/last-changed-statuses"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    all_order_ids = set()

    # 💡 PAYED(결제/발주) 와 DISPATCHED(배송중) 상태를 모두 수집합니다!
    for status_type in ["PAYED", "DISPATCHED"]:
        for start, end in day_windows:
            params = {
                "lastChangedFrom": start.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "+09:00",
                "lastChangedTo": end.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "+09:00",
                "lastChangedType": status_type 
            }
            res = _request("GET", url_status, headers=headers, params=params)
            if res.status_code == 200:
                for item in res.json().get('data', {}).get('lastChangeStatuses', []):
                    all_order_ids.add(item['productOrderId'])

    if not all_order_ids: return []
    url_query = "https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/query"
    res_q = _request("POST", url_query, headers=headers, json={"productOrderIds": list(all_order_ids)})
    
    result = []
    if res_q.status_code == 200:
        for order in res_q.json().get('data', []):
            prod = order.get('productOrder', {})
            ship = order.get('shippingAddress', {})
            
            order_status = prod.get('productOrderStatus', '')
            place_status = prod.get('placeOrderStatus', '')
            
            # 💡 [핵심 해결] 네이버의 겉 상태(order_status)와 속 상태(place_status)를 모두 검사하여 진짜 상태를 찾아냅니다!
            display_status = ""
            if order_status == 'PAYED':
                if place_status == 'OK':
                    display_status = "📦 발주확인 (상품준비중)"
                else:
                    display_status = "🟢 신규주문 (결제완료)"
            elif order_status in ['DISPATCHED', 'DELIVERING']:
                display_status = "🚚 배송중"
            else:
                continue # 취소, 교환, 반품 건은 대시보드 발주 목록에서 제외
            
            result.append({
                "주문상태": display_status,
                "결제일시": prod.get('paymentDate', '')[:16].replace("T", " "),
                "주문번호": prod.get('orderId', ''),
                "상품주문번호": prod.get('productOrderId', ''),
                "상품명": prod.get('productName', ''),
                "옵션명": prod.get('productOption', ''),
                "수량": prod.get('quantity', 0),
                "수취인명": ship.get('name', ''),
                "연락처": ship.get('tel1', ''),
                "배송지": f"{ship.get('baseAddress', '')} {ship.get('detailedAddress', '')}",
                "배송메시지": prod.get('shippingMemo', ''),
                "결제금액": prod.get('totalPaymentAmount', 0)
            })
    result.sort(key=lambda x: x['결제일시'], reverse=True)
    return result

def confirm_naver_orders(order_ids):
    token = get_access_token()
    if not token: return False, "인증 실패"
    url = "https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/confirm"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    res = _request("POST", url, headers=headers, json={"productOrderIds": order_ids})
    return res.status_code == 200, res.json().get('message', '실패')

def update_naver_product_name(channel_product_no, new_name):
    token = get_access_token()
    if not token: return False, "API 인증 실패"
    url = f"https://api.commerce.naver.com/external/v2/products/channel-products/{channel_product_no}"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    res_get = _request("GET", url, headers=headers)
    if res_get.status_code != 200: return False, "상품 조회 실패"
    product_data = res_get.json()
    clean_name = new_name.strip()[:50]
    if 'originProduct' in product_data: product_data['originProduct']['name'] = clean_name
    res_put = _request("PUT", url, headers=headers, json=product_data)
    
    # 💡 [핵심 해결] 무조건 '성공'이라고 우기지 않고, 실패 시 네이버의 진짜 에러 메시지를 뱉어냅니다!
    if res_put.status_code == 200:
        return True, "성공"
    else:
        err_msg = res_put.text
        try:
            if "invalidInputs" in res_put.json():
                err_msg = res_put.json()['invalidInputs'][0].get('message')
        except: pass
        return False, err_msg

def get_top_shopping_keywords(category_id="50000000"):
    if not NAVER_AD_LICENSE: return ["광고 API 설정 필요"]
    timestamp = str(int(time.time() * 1000))
    uri = '/keywordstool'
    msg = f"{timestamp}.GET.{uri}"
    sig = base64.b64encode(hmac.new(NAVER_AD_SECRET.encode('utf-8'), msg.encode('utf-8'), hashlib.sha256).digest()).decode()
    headers = {"X-Timestamp": timestamp, "X-API-KEY": NAVER_AD_LICENSE, "X-Customer": str(NAVER_AD_CUSTOMER_ID), "X-Signature": sig}
    res = _request("GET", f"https://api.naver.com{uri}", headers=headers, params={"hintKeywords": "밀키트,캠핑음식,간편식", "showDetail": "1"})
    if res.status_code == 200:
        k_list = res.json().get('keywordList', [])
        valid = sorted([{'k': i['relKeyword'], 't': int(str(i.get('monthlyPcQcCnt',0)).replace('< 10','10')) + int(str(i.get('monthlyMobileQcCnt',0)).replace('< 10','10'))} for i in k_list], key=lambda x: x['t'], reverse=True)
        return [x['k'] for x in valid[:15]]
    return ["데이터 로드 에러"]

def get_datalab_trend(keyword):
    url = "https://openapi.naver.com/v1/datalab/search"
    headers = {"X-Naver-Client-Id": NAVER_SEARCH_CLIENT_ID, "X-Naver-Client-Secret": NAVER_SEARCH_CLIENT_SECRET, "Content-Type": "application/json"}
    end_date = datetime.now() - timedelta(days=3)
    body = {"startDate": (end_date - timedelta(days=365)).strftime("%Y-%m-%d"), "endDate": end_date.strftime("%Y-%m-%d"), "timeUnit": "month", "keywordGroups": [{"groupName": keyword, "keywords": [keyword]}]}
    res = _request("POST", url, headers=headers, json=body)
    if res.status_code == 200:
        results = res.json().get("results", [])
        if results and results[0].get("data"):
            df = pd.DataFrame(results[0].get("data"))
            df.rename(columns={"period": "날짜", "ratio": "검색량 트렌드(%)"}, inplace=True)
            df.set_index("날짜", inplace=True)
            return df
    return pd.DataFrame()

def search_competitors(keyword, ignore_price, must_include):
    url = "https://openapi.naver.com/v1/search/shop.json"
    headers = {"X-Naver-Client-Id": NAVER_SEARCH_CLIENT_ID, "X-Naver-Client-Secret": NAVER_SEARCH_CLIENT_SECRET}
    res = _request("GET", url, headers=headers, params={"query": keyword, "display": 100, "sort": "sim"})
    results = []
    if res.status_code == 200:
        for item in res.json().get('items', []):
            mall, price = item.get('mallName', ''), int(item['lprice'])
            title = item['title'].replace('<b>', '').replace('</b>', '')
            if "원픽푸드마켓" in mall or price < ignore_price: continue
            if must_include and must_include.lower().replace(" ", "") not in title.lower().replace(" ", ""): continue 
            results.append({"쇼핑몰": mall, "상품명": title, "가격(원)": price, "링크": item.get('link', '')})
    return sorted(results, key=lambda x: x["가격(원)"])

def get_keyword_data_with_tags(keyword):
    if not NAVER_AD_LICENSE: return 0, []
    timestamp = str(int(time.time() * 1000))
    uri = '/keywordstool'
    msg = f"{timestamp}.GET.{uri}"
    sig = base64.b64encode(hmac.new(NAVER_AD_SECRET.encode('utf-8'), msg.encode('utf-8'), hashlib.sha256).digest()).decode()
    headers = {"X-Timestamp": timestamp, "X-API-KEY": NAVER_AD_LICENSE, "X-Customer": str(NAVER_AD_CUSTOMER_ID), "X-Signature": sig}
    res = _request("GET", f"https://api.naver.com{uri}", headers=headers, params={"hintKeywords": keyword, "showDetail": "1"})
    if res.status_code == 200:
        k_list = res.json().get('keywordList', [])
        if not k_list: return 0, []
        total = int(str(k_list[0].get('monthlyPcQcCnt', 0)).replace('< 10', '10')) + int(str(k_list[0].get('monthlyMobileQcCnt', 0)).replace('< 10', '10'))
        tags = [t['relKeyword'] for t in k_list[1:11]]
        return total, tags
    return 0, []

def get_total_products(keyword):
    headers = {"X-Naver-Client-Id": NAVER_SEARCH_CLIENT_ID, "X-Naver-Client-Secret": NAVER_SEARCH_CLIENT_SECRET}
    res = _request("GET", "https://openapi.naver.com/v1/search/shop.json", headers=headers, params={"query": keyword, "display": 1})
    return res.json().get('total', 0) if res.status_code == 200 else 0

def get_naver_product_detail(channel_product_no):
    try:
        token = get_access_token()
        if not token: return None
        url = f"https://api.commerce.naver.com/external/v2/products/channel-products/{channel_product_no}"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        res = _request("GET", url, headers=headers)
        if res.status_code == 200: return res.json()
    except Exception as e: print(f"조회 에러: {e}")
    return None

def _match_option_combination(combinations, option_id, option_name):
    """optionCombinations 리스트에서 대상 옵션을 찾는다.
    1순위: option_id와 combo['id']가 일치. 2순위(폴백): option_name과 combo['optionName1']이 일치.
    id가 PUT 이후에도 유지되는지 문서로 확증 안 돼서, id가 안 맞을 가능성에 대비한 폴백이다.
    ⚠️ 폴백 매칭 시 이름 중복이 있으면 (2차원 옵션 등) 모호하므로 None 반환 — 틀린 옵션에 가격을 쓰는 위험을 피한다."""
    requested_id = str(option_id) if option_id else None
    if requested_id:
        found = next((c for c in combinations if str(c.get("id")) == requested_id), None)
        if found is not None:
            return found
    if option_name:
        matching = [c for c in combinations if str(c.get("optionName1")) == str(option_name)]
        if len(matching) == 1:
            return matching[0]
        elif len(matching) > 1:
            # 같은 이름의 옵션이 여러 개 있으면 (2차원 옵션 등) 모호하므로 None 반환
            return None
    return None


def _find_origin_product_no(channel_product_no):
    """일부 스마트스토어 상품은 v2 상세조회(GET channel-products/{id}) 응답에
    originProductNo가 아예 빠져 있다(실제 상품으로 확인됨, 2026-08-27 — 네이버 쪽 문서에도
    "일부 상품은 원상품번호가 응답에 포함되지 않을 수 있음"이라고 나옴). 대신 상품 목록
    검색(get_my_products, v1 검색 API)에는 originProductNo가 포함되어 있어서 그걸로 찾는다."""
    for p in get_my_products():
        if str(p.get("channelProductNo")) == str(channel_product_no):
            return p.get("originProductNo")
    return None


def update_naver_option_prices(channel_product_no, option_updates):
    """같은 상품(channel_product_no)의 여러 옵션 가격을 GET 1회 + PUT 1회로 한번에 갱신한다.
    옵션마다 따로 GET→PUT 하면 뒤의 PUT이 앞의 PUT을 못 보고 덮어써서 유실될 수 있어 반드시 배치로 처리한다.
    option_updates: [{"option_id": str|None, "option_name": str|None, "new_price": int(목표 절대가)}, ...]
    반환: [{"option_id", "option_name", "success", "message", "matched_option_id"}, ...] (요청 순서 유지)
    """
    def fail_all(message):
        return [{"option_id": u.get("option_id"), "option_name": u.get("option_name"),
                  "success": False, "message": message, "matched_option_id": None} for u in option_updates]

    try:
        token = get_access_token()
    except Exception as e:
        return fail_all(f"인증에러: {e}")
    if not token:
        return fail_all("토큰 실패")

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"https://api.commerce.naver.com/external/v2/products/channel-products/{channel_product_no}"

    try:
        res = _request("GET", url, headers=headers)
    except Exception as e:
        return fail_all(f"조회에러: {e}")

    if res.status_code != 200:
        return fail_all(f"조회실패: {res.text[:200]}")

    data = res.json()
    origin = data.get("originProduct", {}) or {}
    origin_no = origin.get("originProductNo") or _find_origin_product_no(channel_product_no)
    sale_price = origin.get("salePrice")
    # 실제 GET 응답으로 확인됨(2026-08-27): optionInfo는 originProduct 최상위가 아니라
    # originProduct.detailAttribute.optionInfo에 들어있다. 최상위에서 읽으면 항상 {}가 되어
    # 옵션 상품인데도 "옵션을 찾을 수 없습니다"로 실패한다 — 실 상품 GET으로 발견/수정.
    detail_attr = origin.get("detailAttribute", {}) or {}
    option_info = detail_attr.get("optionInfo") or {}
    combinations = option_info.get("optionCombinations") or []

    if not origin_no or sale_price is None or not combinations:
        return fail_all("originProductNo/salePrice/optionCombinations 정보를 찾을 수 없습니다.")

    results = []
    for update in option_updates:
        target = _match_option_combination(combinations, update.get("option_id"), update.get("option_name"))
        if target is None:
            results.append({"option_id": update.get("option_id"), "option_name": update.get("option_name"),
                             "success": False, "message": "옵션을 찾을 수 없음(id/이름 모두 불일치)", "matched_option_id": None})
            continue
        target["price"] = int(update["new_price"]) - int(sale_price)
        results.append({"option_id": update.get("option_id"), "option_name": update.get("option_name"),
                         "success": True, "message": "PUT 대기", "matched_option_id": target.get("id")})

    if not any(r["success"] for r in results):
        return results

    # id 필드를 그대로 유지한 채 price만 바꿔서 되돌려 보낸다.
    # optionCombinationSortType(예: "CREATE")을 쓰면 전체가 새로 생성되며 id가 바뀔 위험이 있어 일부러 안 보낸다 —
    # 이 가정이 맞는지는 문서로 확증 못 했고, 실제 PUT 테스트로 검증해야 한다(계획 마지막 태스크).
    option_info["optionCombinations"] = combinations
    option_info.pop("optionCombinationSortType", None)
    # optionInfo를 읽어온 그 자리(detailAttribute 안)에 그대로 되돌려 넣는다 — GET/PUT 위치를 맞춰야
    # 네이버가 이 옵션 정보를 실제로 인식한다.
    detail_attr["optionInfo"] = option_info

    update_payload = {
        "name": origin.get("name"),
        "salePrice": int(sale_price),
        "stockQuantity": origin.get("stockQuantity"),
        "detailContent": origin.get("detailContent", " "),
        "detailAttribute": detail_attr,
        "deliveryInfo": origin.get("deliveryInfo", {}),
    }
    if origin.get("leafCategoryId"):
        update_payload["leafCategoryId"] = str(origin["leafCategoryId"])
    if origin.get("images"):
        update_payload["images"] = origin["images"]

    # 실제 PUT으로 확인됨(2026-08-27): 필드를 최상위에 바로 보내면 네이버가
    # "originProduct 항목을 입력해 주세요"로 거부한다 — GET 응답과 대칭으로
    # {"originProduct": {...}} 안에 감싸서 보내야 한다.
    try:
        put_res = _request("PUT", f"https://api.commerce.naver.com/external/v2/products/origin-products/{origin_no}", headers=headers, json={"originProduct": update_payload})
    except Exception as e:
        put_err_msg = f"PUT 에러: {e}"
        for r in results:
            if r["success"]:
                r["success"] = False
                r["message"] = put_err_msg
        return results

    put_ok = put_res.status_code == 200
    put_msg = "성공" if put_ok else f"네이버 거부: {put_res.text[:300]}"
    for r in results:
        if r["success"]:
            r["success"] = put_ok
            r["message"] = put_msg
    return results


def update_naver_sale_price(channel_product_no, new_price):
    """옵션 없는 네이버 상품의 대표가격(salePrice)만 갱신한다."""
    try:
        token = get_access_token()
    except Exception as e:
        return False, f"인증에러: {e}"
    if not token:
        return False, "토큰 실패"

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"https://api.commerce.naver.com/external/v2/products/channel-products/{channel_product_no}"

    try:
        res = _request("GET", url, headers=headers)
    except Exception as e:
        return False, f"조회에러: {e}"

    if res.status_code != 200:
        return False, f"조회실패: {res.text[:200]}"

    data = res.json()
    origin = data.get("originProduct", {}) or {}
    origin_no = origin.get("originProductNo") or _find_origin_product_no(channel_product_no)
    if not origin_no:
        return False, "originProductNo 정보를 찾을 수 없습니다."

    update_payload = {
        "name": origin.get("name"),
        "salePrice": int(new_price),
        "stockQuantity": origin.get("stockQuantity"),
        "detailContent": origin.get("detailContent", " "),
        "detailAttribute": origin.get("detailAttribute", {}),
        "deliveryInfo": origin.get("deliveryInfo", {}),
    }
    if origin.get("leafCategoryId"):
        update_payload["leafCategoryId"] = str(origin["leafCategoryId"])
    if origin.get("images"):
        update_payload["images"] = origin["images"]
    # 옵션 정보는 optionInfo가 originProduct 최상위가 아니라 detailAttribute.optionInfo에 있어서
    # (실제 GET으로 확인, 2026-08-27) 위의 "detailAttribute": origin.get("detailAttribute", {})가
    # 이미 옵션 정보까지 그대로 통째로 실어 보낸다 — 별도로 다시 넣을 필요 없음.

    # 실제 PUT으로 확인됨(2026-08-27): 필드를 최상위에 바로 보내면 네이버가
    # "originProduct 항목을 입력해 주세요"로 거부한다 — GET 응답과 대칭으로
    # {"originProduct": {...}} 안에 감싸서 보내야 한다.
    try:
        put_res = _request("PUT", f"https://api.commerce.naver.com/external/v2/products/origin-products/{origin_no}", headers=headers, json={"originProduct": update_payload})
    except Exception as e:
        return False, f"PUT 에러: {e}"

    if put_res.status_code == 200:
        return True, "성공"
    return False, f"네이버 거부: {put_res.text[:300]}"

# ==========================================
# 📦 재고 정합성 체크용 — 상품명별 재고 조회
# ==========================================
def get_naver_stock_by_product_name():
    """
    등록된 전체 상품의 상품명 -> 재고수량(stockQuantity) 매핑을 만든다.
    ⚠️ 전용 '재고만 조회' API가 없어서, 상품 목록(get_my_products)을 가져온 뒤
    상품 개수만큼 상세조회(get_naver_product_detail)를 호출한다 — 상품이 많으면 느릴 수 있음.
    TODO: 상품 수가 많아지면 캐싱(TTL) 또는 배치/비동기 호출로 개선 필요.
    TODO: 조합형 옵션 상품은 originProduct.stockQuantity가 아니라
          optionInfo.optionCombinations[n].stockQuantity로 옵션별 재고가 관리될 수 있음.
          지금은 이런 상품은 건너뛴다 — 옵션 상품 재고까지 필요하면 별도 처리 추가할 것.
    """
    if not get_access_token():
        raise RuntimeError("네이버 access token 발급 실패 — NAVER_COMMERCE_CLIENT_ID/SECRET 또는 서버 시간(clock skew)을 확인하세요.")

    products = get_my_products()
    if not products:
        # 재고 정합성 체크에서 "빈 결과=이상없음"으로 오인되면 위험하므로 일부러 에러로 처리한다.
        raise RuntimeError("네이버 상품 목록을 가져오지 못했습니다(0건). 등록 상품이 실제로 없거나 조회에 실패했을 수 있습니다.")

    stock_by_name = {}
    for p in products:
        channel_no = p.get("channelProductNo")
        name = str(p.get("name", "")).strip()
        if not channel_no or not name:
            continue
        detail = get_naver_product_detail(channel_no)
        if not detail:
            continue
        origin = (detail or {}).get("originProduct", {}) or {}
        stock = origin.get("stockQuantity")
        if stock is None:
            continue  # TODO: 옵션 조합형 상품 재고 합산 로직 (위 TODO 참고)
        try:
            stock_by_name[name] = stock_by_name.get(name, 0) + int(stock)
        except (TypeError, ValueError):
            continue
    return stock_by_name

def upload_naver_image(image_bytes, file_name):
    try:
        token = get_access_token() 
        if not token: return None
        url = "https://api.commerce.naver.com/external/v1/product-images/upload"
        headers = {"Authorization": f"Bearer {token}"}
        files = {'imageFiles': (file_name, image_bytes, 'image/jpeg')}
        res = _request("POST", url, headers=headers, files=files)
        if res.status_code == 200:
            data = res.json()
            if data.get('images'): return data['images'][0]['url']
    except Exception as e: print(f"이미지 업로드 에러: {e}")
    return None


# 🔥 기존 상품 덮어쓰기
def update_naver_product_advanced(channel_product_no, new_name, new_price, stock_quantity, manufacturer, brand, as_tel, delivery_company, delivery_fee, return_fee, exchange_fee, main_image_url, additional_image_urls, detail_html, tags, ext_data):
    try: token = get_access_token()
    except Exception as e: return False, f"인증에러: {e}"
    if not token: return False, "토큰 실패"

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"https://api.commerce.naver.com/external/v2/products/channel-products/{channel_product_no}"
    res = _request("GET", url, headers=headers)
    if res.status_code != 200: return False, f"조회실패: {res.text}"
    
    data = res.json()
    origin_product = data.get('originProduct', {}) or {}
    origin_no = origin_product.get('originProductNo') or origin_product.get('productNo') or origin_product.get('originProductNo')
    if not origin_no:
        return False, "originProductNo 정보를 찾을 수 없습니다. (채널상품 정보 구조가 변경되었을 수 있음)"

    update_payload = {"name": new_name, "salePrice": int(new_price), "stockQuantity": int(stock_quantity)}
    
    if ext_data.get('cat_id'): update_payload["leafCategoryId"] = str(ext_data['cat_id'])
    
    if main_image_url: update_payload["images"] = {"representativeImage": {"url": main_image_url}}
    else: update_payload["images"] = {"representativeImage": data['originProduct']['images']['representativeImage']}
    if additional_image_urls: update_payload["images"]["optionalImages"] = [{"url": u} for u in additional_image_urls if u]
    elif 'optionalImages' in data['originProduct']['images']: update_payload["images"]["optionalImages"] = data['originProduct']['images']['optionalImages']

    update_payload["detailContent"] = detail_html if detail_html else data['originProduct'].get('detailContent', " ")

    detail_attr = data['originProduct'].get('detailAttribute', {}) or {}
    detail_attr["productName"] = new_name
    detail_attr["editorType"] = "HTML"
    detail_attr["productConditionType"] = ext_data.get("product_cond", "NEW")
    detail_attr["minorPurchasable"] = bool(ext_data.get("minor_purc", True))
    update_payload["detailAttribute"] = detail_attr
    
    if ext_data.get('model_name'): update_payload["detailAttribute"]["modelName"] = ext_data["model_name"]
    if manufacturer: update_payload["detailAttribute"]["manufacturerName"] = manufacturer
    if brand: update_payload["detailAttribute"]["brandName"] = brand
    
    if as_tel:
        update_payload["detailAttribute"].setdefault("afterServiceInfo", {})["afterServiceTelephoneNumber"] = as_tel
        update_payload["detailAttribute"]["afterServiceInfo"]["afterServiceGuideContent"] = ext_data["as_guide"]
        
    if tags: update_payload["detailAttribute"]["seoInfo"] = {"sellerTags": [{"text": str(t)[:10]} for t in tags if t.strip()]}

    # 💡 [핵심] 테이블(표) 데이터를 읽어와서 세밀한 옵션(가격,재고) 생성!
    if ext_data["use_option"] and ext_data.get("opt_list"):
        combinations = []
        for opt in ext_data["opt_list"]:
            combinations.append({
                "optionName1": str(opt["name"]),
                "price": int(opt["price"]),
                "stockQuantity": int(opt["stock"]),
                "usable": bool(opt["usable"])
            })
        update_payload["optionInfo"] = {
            "optionCombinationSortType": "CREATE",
            "optionCombinationGroupNames": {"optionGroupName1": ext_data.get("opt_name", "옵션명")},
            "optionCombinations": combinations
        }

    new_del = data['originProduct'].get('deliveryInfo', {}).copy()
    new_del['deliveryType'] = ext_data["del_type"]
    if delivery_company: new_del['deliveryCompany'] = delivery_company
    
    if delivery_fee is not None:
        new_del.setdefault('deliveryFee', {})
        if delivery_fee == 0:
            new_del['deliveryFee']['deliveryFeeType'] = 'FREE'
            new_del['deliveryFee']['baseFee'] = 0
            new_del['deliveryFee']['payType'] = "FREE"
        else:
            new_del['deliveryFee']['deliveryFeeType'] = 'PAID'
            new_del['deliveryFee']['baseFee'] = delivery_fee
            new_del['deliveryFee']['payType'] = ext_data["pay_type"]
            
    if return_fee is not None or exchange_fee is not None:
        new_del.setdefault('claimDeliveryInfo', {})
        if return_fee is not None: new_del['claimDeliveryInfo']['returnDeliveryFee'] = return_fee
        if exchange_fee is not None: new_del['claimDeliveryInfo']['exchangeDeliveryFee'] = exchange_fee
            
    update_payload["deliveryInfo"] = new_del
    put_res = _request("PUT", f"https://api.commerce.naver.com/external/v2/products/origin-products/{origin_no}", headers=headers, json=update_payload)
    return (True, "업데이트 성공!") if put_res.status_code == 200 else (False, f"네이버 거부: {put_res.text}")


# 🔥 신규 등록
def create_new_naver_product(template_channel_no, new_name, new_price, stock_quantity, manufacturer, brand, as_tel, delivery_company, delivery_fee, return_fee, exchange_fee, main_image_url, additional_image_urls, detail_html, tags, ext_data):
    try: token = get_access_token()
    except Exception as e: return False, f"인증에러: {e}"
    if not token: return False, "토큰 실패"

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"https://api.commerce.naver.com/external/v2/products/channel-products/{template_channel_no}"
    res = _request("GET", url, headers=headers)
    if res.status_code != 200: return False, f"템플릿 정보 조회 실패 (원인: {res.text})"
    
    base = res.json()
    op = base.get('originProduct', {})
    scp = base.get('smartstoreChannelProduct', {})
    for k in ['channelProductNo', 'productNo', 'registrationDate', 'updateDate']: scp.pop(k, None)

    cat_id = ext_data.get('cat_id') or op.get('leafCategoryId') or op.get('categoryId') or scp.get('representativeCategoryId')
    if not cat_id: return False, "카테고리 번호 추출 실패."

    new_op = {"statusType": "SALE", "name": new_name, "leafCategoryId": str(cat_id), "salePrice": int(new_price), "stockQuantity": int(stock_quantity)}
    
    if main_image_url: new_op["images"] = {"representativeImage": {"url": main_image_url}}
    else: new_op["images"] = {"representativeImage": op['images']['representativeImage']}
    if additional_image_urls: new_op['images']['optionalImages'] = [{"url": u} for u in additional_image_urls if u]
    elif 'optionalImages' in op.get('images', {}): new_op['images']['optionalImages'] = op['images']['optionalImages']

    new_op["detailContent"] = detail_html if detail_html else op.get('detailContent', " ")

    new_detail = {k: v for k, v in op.get('detailAttribute', {}).items() if k not in ['productName', 'detailContent', 'editorType', 'seoInfo']}
    new_detail['productName'] = new_name
    new_detail['editorType'] = 'HTML'
    new_detail['productConditionType'] = ext_data["product_cond"]
    new_detail['minorPurchasable'] = ext_data["minor_purc"]
    
    if ext_data.get('model_name'): new_detail['modelName'] = ext_data["model_name"]
    if manufacturer: new_detail['manufacturerName'] = manufacturer
    if brand: new_detail['brandName'] = brand
    if as_tel: 
        new_detail.setdefault("afterServiceInfo", {})["afterServiceTelephoneNumber"] = as_tel
        new_detail["afterServiceInfo"]["afterServiceGuideContent"] = ext_data["as_guide"]
        
    if tags: new_detail["seoInfo"] = {"sellerTags": [{"text": str(t)[:10]} for t in tags if t.strip()]}
    new_op['detailAttribute'] = new_detail

    # 💡 [핵심] 테이블(표) 데이터를 읽어와서 세밀한 옵션(가격,재고) 생성! (신규 등록)
    if ext_data["use_option"] and ext_data.get("opt_list"):
        combinations = []
        for opt in ext_data["opt_list"]:
            combinations.append({
                "optionName1": str(opt["name"]),
                "price": int(opt["price"]),
                "stockQuantity": int(opt["stock"]),
                "usable": bool(opt["usable"])
            })
        new_op["optionInfo"] = {
            "optionCombinationSortType": "CREATE",
            "optionCombinationGroupNames": {"optionGroupName1": ext_data.get("opt_name", "옵션명")},
            "optionCombinations": combinations
        }

    new_del = op.get('deliveryInfo', {}).copy()
    new_del['deliveryType'] = ext_data["del_type"]
    new_del['deliveryAttributeType'] = 'NORMAL'
    
    if delivery_company: new_del['deliveryCompany'] = delivery_company
    if delivery_fee is not None:
        new_del.setdefault('deliveryFee', {})
        if delivery_fee == 0:
            new_del['deliveryFee']['deliveryFeeType'] = 'FREE'
            new_del['deliveryFee']['baseFee'] = 0
            new_del['deliveryFee']['payType'] = "FREE"
        else:
            new_del['deliveryFee']['deliveryFeeType'] = 'PAID'
            new_del['deliveryFee']['baseFee'] = delivery_fee
            new_del['deliveryFee']['payType'] = ext_data["pay_type"]
            
    if return_fee is not None or exchange_fee is not None:
        new_del.setdefault('claimDeliveryInfo', {})
        if return_fee is not None: new_del['claimDeliveryInfo']['returnDeliveryFee'] = return_fee
        if exchange_fee is not None: new_del['claimDeliveryInfo']['exchangeDeliveryFee'] = exchange_fee

    new_op['deliveryInfo'] = new_del

    post_res = _request("POST", "https://api.commerce.naver.com/external/v2/products", headers=headers, json={"originProduct": new_op, "smartstoreChannelProduct": scp})
    if post_res.status_code == 200: return True, "🎉 완벽하게 처리되었습니다!"
    
    err_msg = post_res.text
    try:
        if "invalidInputs" in post_res.json(): err_msg = f"[{post_res.json()['invalidInputs'][0].get('name')}] {post_res.json()['invalidInputs'][0].get('message')}"
    except: pass
    return False, f"등록 실패: {err_msg}"

def create_completely_new_product(new_name, new_price, stock_quantity, 
                                  manufacturer="자체제작", brand="자체브랜드", as_tel="010-0000-0000", 
                                  delivery_company="CJGLS", delivery_fee=3000, 
                                  return_fee=3000, exchange_fee=6000, 
                                  main_image_url=None, additional_image_urls=[], 
                                  detail_html="", tags=[], ext_data=None):
    """
    템플릿 없이 완전 쌩신규로 스마트스토어에 상품을 등록하는 함수
    """
    import json

    if ext_data is None:
        ext_data = {}

    cat_id = ext_data.get("cat_id")
    if not cat_id:
        return False, "카테고리 번호가 없습니다."

    try:
        # 💡 대표님의 get_access_token() 함수를 사용하여 출입증(Header)을 직접 만듭니다!
        token = get_access_token()
        if not token:
            return False, "네이버 API 토큰 발급에 실패했습니다."
            
        headers = {
            "Authorization": f"Bearer {token}",
            "content-type": "application/json"
        }

        url = "https://api.commerce.naver.com/external/v2/products"

        # 네이버가 요구하는 신규 등록 양식 (최소 필수값 세팅)
        payload = {
            "originProduct": {
                "statusType": "SALE",
                "saleType": "NEW",
                "leafCategoryId": str(cat_id),
                "name": new_name,
                "detailContent": detail_html or "<p>상세페이지 참조</p>",
                "images": {
                    # 대표 이미지가 비어있으면 임시 이미지라도 넣어야 네이버가 받아줍니다
                    "representativeImage": {"url": main_image_url or "https://via.placeholder.com/1000"}
                },
                "saleInfo": {
                    "price": int(new_price)
                },
                "stockInfo": {
                    "stockQuantity": int(stock_quantity)
                },
                "deliveryInfo": {
                    "deliveryType": "DELIVERY",
                    "deliveryAttributeType": "NORMAL",
                    "deliveryCompany": delivery_company,
                    "deliveryBundleGroupUsable": False,
                    "deliveryFee": {
                        "feeType": "CHARGE" if int(delivery_fee) > 0 else "FREE",
                        "baseFee": int(delivery_fee)
                    },
                    "claimDeliveryInfo": {
                        "returnDeliveryFee": int(return_fee),
                        "exchangeDeliveryFee": int(exchange_fee),
                        "returnDeliveryCompany": delivery_company
                    }
                },
                "detailInfo": {
                    "naverShoppingSearchInfo": {
                        "manufacturerName": manufacturer,
                        "brandName": brand
                    },
                    "afterServiceInfo": {
                        "afterServiceTelephoneNumber": as_tel,
                        "afterServiceGuideContent": "상세페이지 참조"
                    }
                },
                "detailAttribute": {
                    "productName": new_name,
                    "editorType": "HTML",
                    "productConditionType": ext_data.get("product_cond", "NEW"),
                    "minorPurchasable": bool(ext_data.get("minor_purc", True))
                }
            },
            "smartstoreChannelProduct": {
                "naverShoppingIsTarget": True,
                "channelProductDisplayStatusType": "ON"
            }
        }

        response = _request("POST", url, headers=headers, json=payload)
        res_data = response.json()

        if response.status_code == 200 and "smartstoreChannelProductNo" in res_data:
            new_no = res_data["smartstoreChannelProductNo"]
            return True, f"템플릿 없이 쌩신규 등록 완료! (상품번호: {new_no})"
        else:
            err_msg = res_data.get("message", "알 수 없는 에러")
            # 네이버가 뱉어내는 상세 에러 메시지가 있다면 추가로 보여줌
            if "invalidInputs" in res_data:
                err_msg += f" 세부오류: {res_data['invalidInputs']}"
            return False, f"네이버 API 에러: {err_msg}"

    except Exception as e:
        return False, f"파이썬 API 처리 중 에러: {str(e)}"
    
def upload_image_to_naver(file_bytes, filename):
    """
    내 컴퓨터의 이미지를 네이버 서버에 업로드하고, 네이버용 진짜 URL을 받아오는 함수
    """
    token = get_access_token()
    if not token:
        return None, "네이버 API 토큰 발급에 실패했습니다."
    
    url = "https://api.commerce.naver.com/external/v1/product-images/upload"
    headers = {
        "Authorization": f"Bearer {token}"
        # 💡 주의: 파일을 보낼 때는 'content-type'을 비워둬야 requests가 알아서 세팅합니다.
    }
    
    # 네이버가 요구하는 다중 파일 업로드 규격
    files = [
        ('imageFiles', (filename, file_bytes, 'image/jpeg')) 
    ]
    
    try:
        res = _request("POST", url, headers=headers, files=files)
        if res.status_code == 200:
            data = res.json()
            if "images" in data and len(data["images"]) > 0:
                # 네이버가 변환해준 진짜 이미지 URL 반환
                return data["images"][0]["url"], "성공"
        return None, f"이미지 업로드 실패: {res.text}"
    except Exception as e:
        return None, f"이미지 업로드 중 에러: {str(e)}"