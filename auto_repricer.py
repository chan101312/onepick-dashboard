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

# 🚨 배포 사이트에서 서버 IP를 확인하기 위한 코드
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
                my_items.append({'name': channel_info['name'], 'price': channel_info['salePrice']})
            except:
                continue
    return my_items

def search_competitors(keyword, ignore_price, must_include):
    if not NAVER_SEARCH_ID or not NAVER_SEARCH_SECRET:
        return []

    url = "https://openapi.naver.com/v1/search/shop.json"
    headers = {"X-Naver-Client-Id": NAVER_SEARCH_ID, "X-Naver-Client-Secret": NAVER_SEARCH_SECRET}
    params = {"query": keyword, "display": 100, "sort": "sim"} 
    response = requests.get(url, headers=headers, params=params)
    
    results = []
    if response.status_code == 200:
        items = response.json().get('items', [])
        for item in items:
            mall_name = item.get('mallName', '')
            price = int(item['lprice'])
            title = item['title'].replace('<b>', '').replace('</b>', '')
            if "원픽푸드마켓" in mall_name or price < ignore_price:
                continue
            if must_include:
                if must_include.lower().replace(" ", "") not in title.lower().replace(" ", ""):
                    continue 
            results.append({"쇼핑몰": mall_name, "상품명": title, "가격(원)": price, "링크": item.get('link', '')})
    return sorted(results, key=lambda x: x["가격(원)"])

# --- 🎨 웹페이지 화면 그리기 ---
st.title("🕵️‍♂️ 원픽푸드마켓 최저가 비교 대시보드")
my_products = get_my_products()

if not my_products:
    st.error("상품을 불러오지 못했습니다. IP 등록 여부와 Secrets 설정을 확인하세요.")
    st.stop()

# 세션 상태 관리
if 'previous_product' not in st.session_state:
    st.session_state.previous_product = None

product_names = [p['name'] for p in my_products]
selected_name = st.selectbox("📦 분석할 내 상품 선택", product_names)

# 상품 변경 시 초기화
if selected_name != st.session_state.previous_product:
    st.session_state.search_query = selected_name
    st.session_state.must_include = ""
    st.session_state.ignore_price = 0
    st.session_state.previous_product = selected_name

target_prod = next(p for p in my_products if p['name'] == selected_name)

st.divider()
col1, col2, col3, col4 = st.columns([2, 1.5, 1.5, 1])
with col1: search_query = st.text_input("🔍 타사 검색 키워드", key="search_query")
with col2: must_include = st.text_input("💡 필수 포함 단어", key="must_include")
with col3: ignore_price = st.number_input("🚫 미끼제외(원)", min_value=0, step=1000, key="ignore_price")
with col4: 
    st.markdown("<br>", unsafe_allow_html=True)
    search_btn = st.button("분석 시작 🚀", use_container_width=True)

if search_btn and search_query:
    competitors = search_competitors(search_query, ignore_price, must_include)
    c_left, c_right = st.columns(2)
    with c_left:
        st.info(f"**현재 내 가격:** {target_prod['price']:,} 원")
    with c_right:
        if competitors:
            diff = target_prod['price'] - competitors[0]["가격(원)"]
            if diff > 0: st.error(f"🚨 최저가보다 {diff:,}원 비쌈!")
            else: st.success("🏆 최저가 사수 중!")
            st.dataframe(pd.DataFrame(competitors), use_container_width=True)
        else:
            st.warning("조건에 맞는 경쟁사가 없습니다.")