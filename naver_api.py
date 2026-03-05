import streamlit as st
import requests
import time
import bcrypt
import base64
import pandas as pd
import hashlib
import hmac
import json
from datetime import datetime, timedelta

# --- ⚙️ 설정값 불러오기 ---
def get_cfg(key):
    try: return st.secrets[key]
    except:
        try:
            import config
            return getattr(config, key)
        except: return None

NAVER_COMMERCE_ID = get_cfg("NAVER_COMMERCE_CLIENT_ID")
NAVER_COMMERCE_SECRET = get_cfg("NAVER_COMMERCE_CLIENT_SECRET")
NAVER_SEARCH_CLIENT_ID = get_cfg("NAVER_SEARCH_CLIENT_ID")
NAVER_SEARCH_CLIENT_SECRET = get_cfg("NAVER_SEARCH_CLIENT_SECRET")
NAVER_AD_LICENSE = get_cfg("NAVER_AD_LICENSE")
NAVER_AD_SECRET = get_cfg("NAVER_AD_SECRET")
NAVER_AD_CUSTOMER_ID = get_cfg("NAVER_AD_CUSTOMER_ID")

# --- 🔑 공통 인증 함수 ---
def get_access_token():
    if not NAVER_COMMERCE_ID: return None
    timestamp = str(int(time.time() * 1000))
    password = f"{NAVER_COMMERCE_ID}_{timestamp}"
    hashed_pw = bcrypt.hashpw(password.encode('utf-8'), NAVER_COMMERCE_SECRET.encode('utf-8'))
    client_secret_sign = base64.standard_b64encode(hashed_pw).decode('utf-8')
    url = "https://api.commerce.naver.com/external/v1/oauth2/token"
    data = {"client_id": NAVER_COMMERCE_ID, "timestamp": timestamp, "client_secret_sign": client_secret_sign, "grant_type": "client_credentials", "type": "SELF"}
    res = requests.post(url, data=data)
    return res.json().get('access_token') if res.status_code == 200 else None

# --- 📦 상품 관리 함수 ---
@st.cache_data(ttl=3600) 
def get_my_products():
    token = get_access_token()
    if not token: return []
    url = "https://api.commerce.naver.com/external/v1/products/search"
    headers = {"Authorization": f"Bearer {token}"}
    res = requests.post(url, headers=headers, json={"page": 1, "size": 100})
    if res.status_code != 200: return []
    items = []
    for item in res.json().get('contents', []):
        try:
            ch = item['channelProducts'][0]
            items.append({
                'name': ch['name'], 
                'price': ch['salePrice'], 
                'originProductNo': item['originProductNo'],
                'channelProductNo': ch['channelProductNo']
            })
        except: continue
    return items

def update_naver_price(channel_product_no, new_price):
    token = get_access_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"https://api.commerce.naver.com/external/v2/products/channel-products/{channel_product_no}"
    res_get = requests.get(url, headers=headers)
    if res_get.status_code != 200: return False, "조회 실패"
    data = res_get.json()
    data['originProduct']['salePrice'] = new_price
    res_put = requests.put(url, headers=headers, json=data)
    return res_put.status_code == 200, res_put.json().get('message', '')

def update_naver_product_name(channel_product_no, new_name):
    token = get_access_token()
    if not token: return False, "API 인증 실패"
        
    url = f"https://api.commerce.naver.com/external/v2/products/channel-products/{channel_product_no}"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    # 1. 현재 상품 정보 통째로 가져오기
    res_get = requests.get(url, headers=headers)
    if res_get.status_code != 200: 
        return False, "상품 조회 실패"
    
    product_data = res_get.json()
    clean_name = new_name.strip()[:50]

    # 🎯 2. [태그 에러 방어] 네이버가 트집 잡는 기존 '태그' 정보를 수정 항목에서 쏙 빼버립니다.
    if 'originProduct' in product_data and 'detailAttribute' in product_data['originProduct']:
        # 문제가 되는 판매자 직접 입력 태그를 제거하여 에러를 우회합니다.
        product_data['originProduct']['detailAttribute'].pop('sellerTags', None)

    # 3. 원상품 이름과 스마트스토어 전용 이름을 모두 교체
    if 'originProduct' in product_data:
        product_data['originProduct']['name'] = clean_name
        
    if 'smartstoreChannelProduct' in product_data and 'channelProductName' in product_data['smartstoreChannelProduct']:
        product_data['smartstoreChannelProduct']['channelProductName'] = clean_name
    
    # 4. 수정한 데이터 그대로 덮어쓰기
    res_put = requests.put(url, headers=headers, json=product_data)
    
    if res_put.status_code == 200: 
        return True, "성공"
    else:
        err_res = res_put.json()
        
        invalid_list = err_res.get('invalidInputs', err_res.get('invalidParameters', []))
        if invalid_list:
            details = [f"[{p.get('name', '알수없음')}] {p.get('message', '형식 오류')}" for p in invalid_list]
            return False, f"상세 에러: {' / '.join(details)}"
            
        return False, f"실패 사유: {err_res.get('message', '알 수 없는 에러')}"
    
    
# --- 📈 쇼핑 인기 키워드 (가장 예민한 녀석) ---
def get_top_shopping_keywords(category_id="50000000"):
    """
    데이터랩 API 대신, 검색량이 훨씬 정확한 '네이버 광고 키워드 도구 API'를 사용하여
    식품 관련 연관 검색어 검색량 TOP 15를 추출합니다.
    """
    if not NAVER_AD_LICENSE: 
        return ["광고 API 설정이 필요합니다."]
    
    timestamp = str(int(time.time() * 1000))
    uri = '/keywordstool'
    msg = f"{timestamp}.GET.{uri}"
    sig = base64.b64encode(hmac.new(NAVER_AD_SECRET.encode('utf-8'), msg.encode('utf-8'), hashlib.sha256).digest()).decode()
    
    headers = {
        "X-Timestamp": timestamp, 
        "X-API-KEY": NAVER_AD_LICENSE, 
        "X-Customer": str(NAVER_AD_CUSTOMER_ID), 
        "X-Signature": sig
    }
    
    # 💡 원픽푸드마켓에 맞는 핵심 시드 키워드들을 넣어 관련 인기 검색어를 싹쓸이합니다.
    seed_keywords = "밀키트,캠핑음식,냉동식품,간편식,반찬"
    res = requests.get(f"https://api.naver.com{uri}", headers=headers, params={"hintKeywords": seed_keywords, "showDetail": "1"})
    
    if res.status_code == 200:
        k_list = res.json().get('keywordList', [])
        if not k_list: 
            return ["집계된 데이터가 없습니다."]
            
        valid_keywords = []
        seeds = seed_keywords.split(",")
        
        for item in k_list:
            keyword = item['relKeyword']
            # 시드 키워드 자체는 제외
            if keyword in seeds: 
                continue
                
            pc = int(str(item.get('monthlyPcQcCnt', 0)).replace('< 10', '10'))
            mo = int(str(item.get('monthlyMobileQcCnt', 0)).replace('< 10', '10'))
            valid_keywords.append({'keyword': keyword, 'total': pc + mo})
            
        # 🎯 검색량(PC+모바일) 기준으로 내림차순 정렬 후 상위 15개만 추출!
        valid_keywords.sort(key=lambda x: x['total'], reverse=True)
        return [x['keyword'] for x in valid_keywords[:15]]
        
    return [f"광고 API 통신 에러({res.status_code})"]
# --- 📊 검색어 트렌드 그래프 ---
def get_datalab_trend(keyword):
    url = "https://openapi.naver.com/v1/datalab/search"
    headers = {"X-Naver-Client-Id": NAVER_SEARCH_CLIENT_ID, "X-Naver-Client-Secret": NAVER_SEARCH_CLIENT_SECRET, "Content-Type": "application/json"}
    end_date = datetime.now() - timedelta(days=3)
    body = {"startDate": (end_date - timedelta(days=365)).strftime("%Y-%m-%d"), "endDate": end_date.strftime("%Y-%m-%d"), "timeUnit": "month", "keywordGroups": [{"groupName": keyword, "keywords": [keyword]}]}
    res = requests.post(url, headers=headers, json=body)
    if res.status_code == 200:
        data = res.json().get("results", [])
        if data and data[0].get("data"):
            df = pd.DataFrame(data[0].get("data", []))
            df.rename(columns={"period": "날짜", "ratio": "검색량 트렌드(%)"}, inplace=True)
            df.set_index("날짜", inplace=True)
            return df
    return pd.DataFrame()

# --- 🔍 기타 분석 도구 ---
def search_competitors(keyword, ignore_price, must_include):
    url = "https://openapi.naver.com/v1/search/shop.json"
    headers = {"X-Naver-Client-Id": NAVER_SEARCH_CLIENT_ID, "X-Naver-Client-Secret": NAVER_SEARCH_CLIENT_SECRET}
    res = requests.get(url, headers=headers, params={"query": keyword, "display": 100, "sort": "sim"})
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
    res = requests.get(f"https://api.naver.com{uri}", headers=headers, params={"hintKeywords": keyword, "showDetail": "1"})
    if res.status_code == 200:
        k_list = res.json().get('keywordList', [])
        if not k_list: return 0, []
        pc = int(str(k_list[0].get('monthlyPcQcCnt', 0)).replace('< 10', '10'))
        mo = int(str(k_list[0].get('monthlyMobileQcCnt', 0)).replace('< 10', '10'))
        tags = [t['relKeyword'] for t in k_list[1:11]]
        return pc + mo, tags
    return 0, []

def get_total_products(keyword):
    headers = {"X-Naver-Client-Id": NAVER_SEARCH_CLIENT_ID, "X-Naver-Client-Secret": NAVER_SEARCH_CLIENT_SECRET}
    res = requests.get("https://openapi.naver.com/v1/search/shop.json", headers=headers, params={"query": keyword, "display": 1})
    return res.json().get('total', 0) if res.status_code == 200 else 0