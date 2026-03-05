import streamlit as st
import requests
import time
import bcrypt
import base64
import pandas as pd

# --- ⚙️ 설정값 불러오기 함수 (로컬/배포 자동 감지) ---
def get_cfg(key):
    """스트림릿 Secrets를 먼저 찾고, 없으면 config.py를 찾습니다."""
    if key in st.secrets:
        return st.secrets[key]
    try:
        import config
        return getattr(config, key)
    except (ImportError, AttributeError):
        return None

# 필요한 모든 키값 로드
NAVER_COMMERCE_ID = get_cfg("NAVER_COMMERCE_CLIENT_ID")
NAVER_COMMERCE_SECRET = get_cfg("NAVER_COMMERCE_CLIENT_SECRET")
NAVER_SEARCH_ID = get_cfg("NAVER_SEARCH_CLIENT_ID")
NAVER_SEARCH_SECRET = get_cfg("NAVER_SEARCH_CLIENT_SECRET")

st.set_page_config(page_title="원픽푸드마켓 최저가 비교기", layout="wide")

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
                my_items.append({
                    'name': channel_info['name'], 
                    'price': channel_info['salePrice']
                })
            except:
                continue
    return my_items

def search_competitors(keyword, ignore_price, must_include):
    if not NAVER_SEARCH_ID or not NAVER_SEARCH_SECRET:
        return []

    url = "https://openapi.naver.com/v1/search/shop.json"
    headers = {
        "X-Naver-Client-Id": NAVER_SEARCH_ID,
        "X-Naver-Client-Secret": NAVER_SEARCH_SECRET
    }
    params = {"query": keyword, "display": 100, "sort": "sim"} 
    response = requests.get(url, headers=headers, params=params)
    
    results = []
    if response.status_code == 200:
        items = response.json().get('items', [])
        for item in items:
            mall_name = item.get('mallName', '')
            price = int(item['lprice'])
            title = item['title'].replace('<b>', '').replace('</b>', '')
            link = item.get('link', '')
            
            if "원픽푸드마켓" in mall_name or price < ignore_price:
                continue
                
            if must_include:
                title_clean = title.lower().replace(" ", "")
                must_clean = must_include.lower().replace(" ", "")
                if must_clean not in title_clean:
                    continue 
                    
            results.append({
                "쇼핑몰": mall_name,
                "상품명": title,
                "가격(원)": price,
                "링크": link
            })
                
    return sorted(results, key=lambda x: x["가격(원)"])

# --- 🎨 웹페이지 화면 그리기 ---
st.title("🕵️‍♂️ 원픽푸드마켓 최저가 비교 대시보드 (전체 상품)")

with st.spinner('원픽푸드마켓의 전체 상품을 불러오고 있습니다... ⏳'):
    my_products = get_my_products()

if not my_products:
    st.error("상품을 불러오지 못했습니다. API 키나 인터넷 연결, 혹은 Streamlit Secrets 설정을 확인해 주세요.")
    st.stop()

product_names = [p['name'] for p in my_products]

st.markdown("### 1️⃣ 분석할 내 상품 선택")

# 세션 상태 관리
if 'previous_product' not in st.session_state:
    st.session_state.previous_product = None

selected_my_product_name = st.selectbox("📦 내 스토어 상품 목록 (자동 로드됨)", product_names)

# 상품 변경 시 초기화 로직
if selected_my_product_name != st.session_state.previous_product:
    st.session_state.search_query = selected_my_product_name
    st.session_state.must_include = ""
    st.session_state.ignore_price = 0
    st.session_state.previous_product = selected_my_product_name

target_my_product = next((p for p in my_products if p['name'] == selected_my_product_name), None)

st.divider()
st.markdown("### 2️⃣ 타사 검색 조건 설정")

with st.container():
    col1, col2, col3, col4 = st.columns([2, 1.5, 1.5, 1])
    with col1:
        search_query = st.text_input("🔍 타사 검색 키워드", key="search_query")
    with col2:
        must_include_word = st.text_input("💡 필수 포함 단어", placeholder="예: 3.2kg", key="must_include")
    with col3:
        ignore_price_limit = st.number_input("🚫 미끼상품 제외 (원)", min_value=0, step=1000, key="ignore_price")
    with col4:
        st.markdown("<br>", unsafe_allow_html=True) 
        search_button = st.button("최저가 랭킹 분석 🚀", use_container_width=True)

if search_button and search_query:
    st.divider()
    
    with st.spinner(f"'{search_query}'(으)로 타사 진짜 경쟁자들을 색출하고 있습니다... ⏳"):
        competitors = search_competitors(search_query, ignore_price_limit, must_include_word)
        
        col_left, col_right = st.columns(2)
        
        with col_left:
            st.subheader("🏪 우리 스토어 현황")
            st.info(f"**📦 선택한 상품:** {target_my_product['name']}\n\n**💵 현재 내 가격:** {target_my_product['price']:,} 원")
            
            if must_include_word:
                st.caption(f"🛡️ **필터링 작동 중:** 타사 상품명에 **[{must_include_word}]** 문구가 포함된 것만 찾아냅니다.")
                
        with col_right:
            st.subheader(f"⚔️ 타사 최저가 랭킹")
            if competitors:
                lowest_price = competitors[0]["가격(원)"]
                lowest_mall = competitors[0]["쇼핑몰"]
                
                price_diff = target_my_product['price'] - lowest_price
                if price_diff > 0:
                    st.error(f"🚨 최저가보다 **{price_diff:,} 원 비쌉니다!** (현재 1위: {lowest_price:,} 원 / {lowest_mall})")
                elif price_diff == 0:
                    st.success(f"🤝 현재 최저가 공동 1위입니다! ({lowest_price:,} 원)")
                else:
                    st.success(f"🏆 압도적 최저가 1위 방어 중! (타사보다 {-price_diff:,} 원 쌉니다)")
                
                df = pd.DataFrame(competitors)
                st.dataframe(
                    df,
                    column_config={"링크": st.column_config.LinkColumn("상품 바로가기")},
                    use_container_width=True,
                    hide_index=True
                )
            else:
                st.warning("조건에 맞는 타사 상품이 없거나, 미끼 가격에 모두 걸러졌습니다.")