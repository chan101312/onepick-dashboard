import streamlit as st
import requests
import time
import bcrypt
import base64
import pandas as pd
import config

st.set_page_config(page_title="원픽푸드마켓 최저가 비교기", layout="wide")

# --- ⚙️ API 통신 함수들 ---
@st.cache_data(ttl=3600) 
def get_my_products():
    timestamp = str(int(time.time() * 1000))
    password = f"{config.NAVER_COMMERCE_CLIENT_ID}_{timestamp}"
    hashed_pw = bcrypt.hashpw(password.encode('utf-8'), config.NAVER_COMMERCE_CLIENT_SECRET.encode('utf-8'))
    client_secret_sign = base64.standard_b64encode(hashed_pw).decode('utf-8')
    
    url = "https://api.commerce.naver.com/external/v1/oauth2/token"
    data = {
        "client_id": config.NAVER_COMMERCE_CLIENT_ID,
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
    url = "https://openapi.naver.com/v1/search/shop.json"
    headers = {
        "X-Naver-Client-Id": config.NAVER_SEARCH_CLIENT_ID,
        "X-Naver-Client-Secret": config.NAVER_SEARCH_CLIENT_SECRET
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
    st.error("상품을 불러오지 못했습니다. API 키나 인터넷 연결을 확인해 주세요.")
    st.stop()

product_names = [p['name'] for p in my_products]

st.markdown("### 1️⃣ 분석할 내 상품 선택")

# 🧠 [핵심] 스트림릿의 기억(Session State)을 관리하는 부분입니다.
if 'previous_product' not in st.session_state:
    st.session_state.previous_product = None
if 'search_query' not in st.session_state:
    st.session_state.search_query = ""
if 'must_include' not in st.session_state:
    st.session_state.must_include = ""
if 'ignore_price' not in st.session_state:
    st.session_state.ignore_price = 0

# 드롭다운 선택창
selected_my_product_name = st.selectbox("📦 내 스토어 상품 목록 (자동 로드됨)", product_names)

# 🎯 만약 드롭다운에서 선택한 상품이 방금 전이랑 달라졌다면? -> 전부 강제 초기화!
if selected_my_product_name != st.session_state.previous_product:
    st.session_state.search_query = selected_my_product_name # 검색어는 내 상품명으로 리셋
    st.session_state.must_include = ""                       # 필수 단어 텅 비우기
    st.session_state.ignore_price = 0                        # 미끼 가격 0원으로 리셋
    st.session_state.previous_product = selected_my_product_name # 현재 상품을 기억해둠

target_my_product = next((p for p in my_products if p['name'] == selected_my_product_name), None)

st.divider()
st.markdown("### 2️⃣ 타사 검색 조건 설정")

with st.container():
    col1, col2, col3, col4 = st.columns([2, 1.5, 1.5, 1])
    with col1:
        # key 파라미터를 써서 아까 만든 기억(Session State)과 연결해줍니다.
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