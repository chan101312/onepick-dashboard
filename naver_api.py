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
NAVER_SEARCH_ID = get_cfg("NAVER_SEARCH_CLIENT_ID")
NAVER_SEARCH_SECRET = get_cfg("NAVER_SEARCH_CLIENT_SECRET")
NAVER_AD_LICENSE = get_cfg("NAVER_AD_LICENSE")
NAVER_AD_SECRET = get_cfg("NAVER_AD_SECRET")
NAVER_AD_CUSTOMER_ID = get_cfg("NAVER_AD_CUSTOMER_ID")

# ==========================================
# 🛠️ API 통신 함수 모음
# ==========================================

@st.cache_data(ttl=3600) 
def get_my_products():
    if not NAVER_COMMERCE_ID or not NAVER_COMMERCE_SECRET: return []
    timestamp = str(int(time.time() * 1000))
    password = f"{NAVER_COMMERCE_ID}_{timestamp}"
    hashed_pw = bcrypt.hashpw(password.encode('utf-8'), NAVER_COMMERCE_SECRET.encode('utf-8'))
    client_secret_sign = base64.standard_b64encode(hashed_pw).decode('utf-8')
    
    url = "https://api.commerce.naver.com/external/v1/oauth2/token"
    data = {"client_id": NAVER_COMMERCE_ID, "timestamp": timestamp, "client_secret_sign": client_secret_sign, "grant_type": "client_credentials", "type": "SELF"}
    response = requests.post(url, data=data)
    if response.status_code != 200: return []
    
    token = response.json().get('access_token')
    url_search = "https://api.commerce.naver.com/external/v1/products/search"
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"page": 1, "size": 100} 
    
    res_search = requests.post(url_search, headers=headers, json=payload)
    my_items = []
    if res_search.status_code == 200:
        products = res_search.json().get('contents', [])
        for item in products:
            try:
                channel_info = item['channelProducts'][0]
                my_items.append({
                    'name': channel_info['name'], 
                    'price': channel_info['salePrice'],
                    'originProductNo': item['originProductNo'],
                    'channelProductNo': channel_info['channelProductNo'] 
                })
            except: continue
    return my_items

# ⚡ [수정 완료] 채널 상품이 아니라 '원상품(origin-products)' 창구로 정확히 찾아갑니다!
def update_naver_price(origin_product_no, new_price):
    timestamp = str(int(time.time() * 1000))
    password = f"{NAVER_COMMERCE_ID}_{timestamp}"
    hashed_pw = bcrypt.hashpw(password.encode('utf-8'), NAVER_COMMERCE_SECRET.encode('utf-8'))
    client_secret_sign = base64.standard_b64encode(hashed_pw).decode('utf-8')
    
    url_token = "https://api.commerce.naver.com/external/v1/oauth2/token"
    data = {"client_id": NAVER_COMMERCE_ID, "timestamp": timestamp, "client_secret_sign": client_secret_sign, "grant_type": "client_credentials", "type": "SELF"}
    res_token = requests.post(url_token, data=data)
    if res_token.status_code != 200: return False, "API 인증 실패"
    token = res_token.json().get('access_token')
    
    headers = {"Authorization": f"Bearer {token}"}
    
    # 🎯 핵심 변경 포인트: /origin-products/ 주소로 호출!
    url_product = f"https://api.commerce.naver.com/external/v2/products/origin-products/{origin_product_no}"
    res_get = requests.get(url_product, headers=headers)
    if res_get.status_code != 200: return False, f"상품 정보 로드 실패: {res_get.status_code}"
    
    product_data = res_get.json()
    
    try:
        if 'originProduct' in product_data:
            product_data['originProduct']['salePrice'] = new_price
        else:
            product_data['salePrice'] = new_price
    except KeyError:
        return False, "가격 정보를 찾을 수 없는 상품 구조입니다."
        
    headers["Content-Type"] = "application/json"
    res_put = requests.put(url_product, headers=headers, json=product_data)
    
    if res_put.status_code == 200: 
        return True, "가격 수정 완료"
    else: 
        return False, f"실패 사유: {res_put.json().get('message', '알 수 없는 오류')}"
def search_competitors(keyword, ignore_price, must_include):
    if not NAVER_SEARCH_ID: return []
    url = "https://openapi.naver.com/v1/search/shop.json"
    headers = {"X-Naver-Client-Id": NAVER_SEARCH_ID, "X-Naver-Client-Secret": NAVER_SEARCH_SECRET}
    res = requests.get(url, headers=headers, params={"query": keyword, "display": 100, "sort": "sim"})
    results = []
    if res.status_code == 200:
        for item in res.json().get('items', []):
            mall_name, price = item.get('mallName', ''), int(item['lprice'])
            title = item['title'].replace('<b>', '').replace('</b>', '')
            if "원픽푸드마켓" in mall_name or price < ignore_price: continue
            if must_include and must_include.lower().replace(" ", "") not in title.lower().replace(" ", ""): continue 
            results.append({"쇼핑몰": mall_name, "상품명": title, "가격(원)": price, "링크": item.get('link', '')})
    return sorted(results, key=lambda x: x["가격(원)"])

def generate_ad_signature(timestamp, method, uri, secret_key):
    message = f"{timestamp}.{method}.{uri}"
    hash = hmac.new(secret_key.encode('utf-8'), message.encode('utf-8'), hashlib.sha256)
    return base64.b64encode(hash.digest()).decode()

def get_keyword_data_with_tags(keyword):
    if not NAVER_AD_LICENSE: return 0, []
    timestamp = str(int(time.time() * 1000))
    uri = '/keywordstool'
    signature = generate_ad_signature(timestamp, 'GET', uri, NAVER_AD_SECRET)
    headers = {"X-Timestamp": timestamp, "X-API-KEY": NAVER_AD_LICENSE, "X-Customer": str(NAVER_AD_CUSTOMER_ID), "X-Signature": signature}
    res = requests.get(f"https://api.naver.com{uri}", headers=headers, params={"hintKeywords": keyword, "showDetail": "1"})
    
    if res.status_code == 200:
        k_list = res.json().get('keywordList', [])
        if not k_list: return 0, []
        target_data = k_list[0]
        pc = int(str(target_data.get('monthlyPcQcCnt', 0)).replace('< 10', '10'))
        mo = int(str(target_data.get('monthlyMobileQcCnt', 0)).replace('< 10', '10'))
        total_search = pc + mo
        
        tags = []
        for tag_data in k_list[1:20]:
            tpc = int(str(tag_data.get('monthlyPcQcCnt', 0)).replace('< 10', '10'))
            tmo = int(str(tag_data.get('monthlyMobileQcCnt', 0)).replace('< 10', '10'))
            if (tpc+tmo) > 100: tags.append({"태그명": tag_data['relKeyword'], "조회수": tpc+tmo})
        tags = sorted(tags, key=lambda x: x['조회수'], reverse=True)[:10]
        return total_search, [t['태그명'] for t in tags]
    return 0, []

def get_total_products(keyword):
    if not NAVER_SEARCH_ID: return 0
    headers = {"X-Naver-Client-Id": NAVER_SEARCH_ID, "X-Naver-Client-Secret": NAVER_SEARCH_SECRET}
    res = requests.get("https://openapi.naver.com/v1/search/shop.json", headers=headers, params={"query": keyword, "display": 1})
    if res.status_code == 200: return res.json().get('total', 0)
    return 0

def get_datalab_trend(keyword):
    url = "https://openapi.naver.com/v1/datalab/search"
    headers = {"X-Naver-Client-Id": NAVER_SEARCH_ID, "X-Naver-Client-Secret": NAVER_SEARCH_SECRET, "Content-Type": "application/json"}
    end_date = datetime.now()
    start_date = end_date - timedelta(days=365)
    
    body = {"startDate": start_date.strftime("%Y-%m-%d"), "endDate": end_date.strftime("%Y-%m-%d"), "timeUnit": "month", "keywordGroups": [{"groupName": keyword, "keywords": [keyword]}]}
    res = requests.post(url, headers=headers, data=json.dumps(body))
    if res.status_code == 200:
        data = res.json().get("results", [])
        if data:
            df = pd.DataFrame(data[0].get("data", []))
            if not df.empty:
                df.rename(columns={"period": "날짜", "ratio": "검색량 트렌드(%)"}, inplace=True)
                df.set_index("날짜", inplace=True)
                return df
    return pd.DataFrame()