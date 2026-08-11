import requests
from datetime import datetime, timedelta
import time

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

# --- ⚙️ 롯데온 API 설정 불러오기 ---
def get_cfg(key):
    try:
        import config
        val = getattr(config, key)
        return val.strip() if isinstance(val, str) else val
    except:
        return None

LOTTEON_TOKEN = get_cfg("LOTTEON_OPENAPI_KEY")

def get_lotteon_orders():
    """롯데온 신규 주문 수집기"""
    
    # 롯데온 키가 없으면 패스
    if not LOTTEON_TOKEN or "여기에" in LOTTEON_TOKEN:
        return []
        
    # 검색 기간 설정 (최근 3일치)
    now = datetime.now()
    start_date = (now - timedelta(days=3)).strftime("%Y%m%d000000") # 롯데온 날짜 포맷: YYYYMMDDHHMMSS
    end_date = now.strftime("%Y%m%d235959")
    
    # 롯데온 주문 조회 엔드포인트
    url = "https://openapi.lotteon.com/v1/openapi/order/v1/getOrderList"
    
    # 💡 롯데온은 복잡한 암호화 없이 Bearer 토큰만 꽂아주면 됩니다!
    headers = {
        "Authorization": f"Bearer {LOTTEON_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    
    payload = {
        "srchStrtDtm": start_date,
        "srchEndDtm": end_date
    }
    
    try:
        res = _request("POST", url, headers=headers, json=payload)
        
        if res.status_code != 200:
            return []
            
        data = res.json()
        
        # 결과 코드가 정상이 아니면 에러 반환
        if data.get('returnCode') != "0000":
            return []
            
        orders = data.get('data', [])
        if not isinstance(orders, list):
            orders = [orders] if orders else []
            
        result = []
        # 💡 가져온 데이터를 우리 대시보드 규격에 맞게 변환
        for order in orders:
            # 롯데온의 시간 포맷(YYYYMMDDHHMMSS)을 예쁘게 변환
            raw_time = str(order.get('odDtm', ''))
            clean_time = f"{raw_time[:4]}-{raw_time[4:6]}-{raw_time[6:8]} {raw_time[8:10]}:{raw_time[10:12]}" if len(raw_time) >= 12 else raw_time
            
            result.append({
                "마켓": "🔴 롯데온",
                "결제일시": clean_time,
                "주문번호": str(order.get('odNo', '')),
                "상품주문번호": str(order.get('odSeq', order.get('odNo', ''))),
                "상품명": order.get('pdNm', '상품명 없음'),
                "옵션명": order.get('optNm', ''),
                "수량": int(order.get('odQty', 1)),
                "수취인명": order.get('rcvrNm', '알수없음'),
                "연락처": order.get('rcvrTelNo', ''),
                "배송지": f"{order.get('rcvrBaseAddr', '')} {order.get('rcvrDtlAddr', '')}".strip(),
                "배송메시지": order.get('dlvMsg', ''),
                "결제금액": int(order.get('slPrc', 0))
            })
            
        return result
        
    except Exception as e:
        return []