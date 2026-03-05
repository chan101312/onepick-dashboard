import streamlit as st
import requests
import time
import bcrypt
import base64
import pandas as pd

# --- ⚙️ 설정값 불러오기 함수 (로컬/배포 안전 감지) ---
def get_cfg(key):
    try:
        # 1. 배포 환경(Streamlit Cloud)에서 먼저 확인
        return st.secrets[key]
    except:
        try:
            # 2. 로컬 환경(config.py)에서 확인
            import config
            return getattr(config, key)
        except:
            return None

# 키값 로드
NAVER_COMMERCE_ID = get_cfg("NAVER_COMMERCE_CLIENT_ID")
NAVER_COMMERCE_SECRET = get_cfg("NAVER_COMMERCE_CLIENT_SECRET")
NAVER_SEARCH_ID = get_cfg("NAVER_SEARCH_CLIENT_ID")
NAVER_SEARCH_SECRET = get_cfg("NAVER_SEARCH_CLIENT_SECRET")

st.set_page_config(page_title="원픽푸드마켓 최저가 비교기", layout="wide")

# 🚨 [중요] 배포 사이트에서 서버 IP를 확인하기 위한 코드
if NAVER_COMMERCE_ID:
    try:
        server_ip = requests.get('https://api.ipify.org').text
        st.info(f"🌐 현재 서버 IP: `{server_ip}` (이 주소를 커머스 API 센터에 등록하세요!)")
    except:
        st.warning("서버 IP를 확인하지 못했습니다.")

# --- ⚙️ API 통신 함수들 ---
@st.cache_data(ttl=3600) 
def get_my_products():
    if not NAVER_COMMERCE_ID or not NAVER_COMMERCE_SECRET:
        return []

    timestamp = str(int(time.time() * 1000))
    password = f"{NAVER_COMMERCE_ID}_{timestamp}"
    # bcrypt 해싱 시 secret_key도 안전하게 처리
    hashed_pw = bcrypt.hashpw(password.encode('utf-8'), NAVER_COMMERCE_SECRET.encode('utf-8'))
    client_secret_sign = base64.standard_b64encode(hashed_pw).decode('utf-8')
    
    url = "https://api.commerce.naver.com/external/v1/oauth2/token"
    data = {
        "client_id": NAVER_COMMERCE_ID,
        "timestamp": timestamp,
        "client_secret_sign": client_secret_sign,
        "grant_type": "client_credentials",
        "type": "SELF"
    }
    response = requests.post(url, data=data)
    
    if response.status_code != 200:
        # 에러 원인 파악을 위해 로그 출력
        st.sidebar.error(f"커머스 인증 실패: {response.status_code}")
        return []
    
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
                    'price': channel_info['salePrice']
                })
            except:
                continue
    return my_items

# ... (search_competitors 함수 및 화면 그리기 로직은 이전과 동일) ...
# (코드가 너무 길어 중략하지만, search_competitors 아래 부분은 그대로 사용하세요!)