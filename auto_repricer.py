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

# --- ⚙️ 기본 페이지 설정 ---
st.set_page_config(page_title="원픽푸드마켓 비즈니스 대시보드", layout="wide")

# --- ⚙️ 설정값 불러오기 함수 ---
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
                my_items.append({'name': channel_info['name'], 'price': channel_info['salePrice']})
            except: continue
    return my_items

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
    """검색량과 연관 황금 해시태그를 같이 뽑아옵니다."""
    if not NAVER_AD_LICENSE: return 0, []
    timestamp = str(int(time.time() * 1000))
    uri = '/keywordstool'
    signature = generate_ad_signature(timestamp, 'GET', uri, NAVER_AD_SECRET)
    headers = {"X-Timestamp": timestamp, "X-API-KEY": NAVER_AD_LICENSE, "X-Customer": str(NAVER_AD_CUSTOMER_ID), "X-Signature": signature}
    res = requests.get(f"https://api.naver.com{uri}", headers=headers, params={"hintKeywords": keyword, "showDetail": "1"})
    
    if res.status_code == 200:
        k_list = res.json().get('keywordList', [])
        if not k_list: return 0, []
        
        # 첫 번째 항목이 내 키워드 검색량
        target_data = k_list[0]
        pc = int(str(target_data.get('monthlyPcQcCnt', 0)).replace('< 10', '10'))
        mo = int(str(target_data.get('monthlyMobileQcCnt', 0)).replace('< 10', '10'))
        total_search = pc + mo
        
        # 연관 해시태그 추출 (조회수 높은 순으로 10개)
        tags = []
        for tag_data in k_list[1:20]: # 연관 키워드들 탐색
            tpc = int(str(tag_data.get('monthlyPcQcCnt', 0)).replace('< 10', '10'))
            tmo = int(str(tag_data.get('monthlyMobileQcCnt', 0)).replace('< 10', '10'))
            if (tpc+tmo) > 100: # 조회수 100 이상인 유의미한 태그만
                tags.append({"태그명": tag_data['relKeyword'], "조회수": tpc+tmo})
        tags = sorted(tags, key=lambda x: x['조회수'], reverse=True)[:10]
        return total_search, [t['태그명'] for t in tags]
    return 0, []

def get_total_products(keyword):
    headers = {"X-Naver-Client-Id": NAVER_SEARCH_ID, "X-Naver-Client-Secret": NAVER_SEARCH_SECRET}
    res = requests.get("https://openapi.naver.com/v1/search/shop.json", headers=headers, params={"query": keyword, "display": 1})
    if res.status_code == 200: return res.json().get('total', 0)
    return 0

def get_datalab_trend(keyword):
    """최근 1년치 네이버 검색 트렌드 데이터를 가져옵니다."""
    url = "https://openapi.naver.com/v1/datalab/search"
    headers = {"X-Naver-Client-Id": NAVER_SEARCH_ID, "X-Naver-Client-Secret": NAVER_SEARCH_SECRET, "Content-Type": "application/json"}
    end_date = datetime.now()
    start_date = end_date - timedelta(days=365)
    
    body = {
        "startDate": start_date.strftime("%Y-%m-%d"),
        "endDate": end_date.strftime("%Y-%m-%d"),
        "timeUnit": "month",
        "keywordGroups": [{"groupName": keyword, "keywords": [keyword]}]
    }
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

# ==========================================
# 🎨 웹페이지 화면 그리기
# ==========================================
st.title("👨‍💼 원픽푸드마켓 올인원 비즈니스 보드")
st.caption("최저가 방어부터 트렌드 분석, 해시태그 추출까지 한 번에!")

tab1, tab2, tab3 = st.tabs(["🕵️ 실시간 최저가 & 마진", "💰 황금 키워드 & 해시태그", "📈 시즌 트렌드 (데이터랩)"])

# --- 탭 1: 최저가 모니터링 & 마진 계산기 ---
with tab1:
    my_products = get_my_products()
    if not my_products:
        st.error("상품을 불러오지 못했습니다. 키 설정을 확인하세요.")
    else:
        product_names = [p['name'] for p in my_products]
        selected_name = st.selectbox("📦 분석할 내 상품 선택", product_names, key="my_prod_box")
        target_prod = next(p for p in my_products if p['name'] == selected_name)

        st.divider()
        col1, col2, col3, col4 = st.columns([2, 1.5, 1.5, 1])
        with col1: search_query = st.text_input("🔍 타사 검색 키워드", value=selected_name)
        with col2: must_include = st.text_input("💡 필수 포함 단어", placeholder="예: 3kg")
        with col3: ignore_price = st.number_input("🚫 미끼제외(원)", min_value=0, step=1000)
        with col4: 
            st.markdown("<br>", unsafe_allow_html=True)
            search_btn = st.button("최저가 분석 🚀", use_container_width=True)

        if search_btn and search_query:
            competitors = search_competitors(search_query, ignore_price, must_include)
            c_left, c_right = st.columns([1, 2])
            
            with c_left:
                st.subheader("🏪 우리 스토어 현황")
                st.info(f"**현재 판매가:** {target_prod['price']:,} 원")
                
                # 🩸 마진 계산기 (새 기능)
                st.markdown("##### 💵 진짜 마진 계산기")
                cost_price = st.number_input("사입가/포장비 등 총 원가 입력 (원)", min_value=0, step=500, value=int(target_prod['price']*0.6))
                
                # 네이버 수수료 약 5%로 넉넉히 잡음
                naver_fee = int(target_prod['price'] * 0.05)
                pure_margin = target_prod['price'] - cost_price - naver_fee
                margin_rate = (pure_margin / target_prod['price']) * 100 if target_prod['price'] > 0 else 0
                
                st.write(f"- 예상 수수료(5%): {naver_fee:,}원")
                if pure_margin > 0:
                    st.success(f"**순수익: {pure_margin:,}원** (마진율 {margin_rate:.1f}%)")
                else:
                    st.error(f"🚨 **적자 경고! 손해: {pure_margin:,}원**")

            with c_right:
                st.subheader(f"⚔️ 타사 최저가 랭킹")
                if competitors:
                    diff = target_prod['price'] - competitors[0]["가격(원)"]
                    if diff > 0: st.error(f"🚨 최저가보다 {diff:,}원 비쌉니다!")
                    else: st.success("🏆 현재 1위 최저가 방어 중!")
                    st.dataframe(pd.DataFrame(competitors), use_container_width=True)
                else:
                    st.warning("조건에 맞는 경쟁사가 없습니다.")

# --- 탭 2: 황금 키워드 채굴 & 해시태그 ---
with tab2:
    st.markdown("### 🔍 빈집 키워드 분석 & 황금 태그 추천")
    keyword_input = st.text_input("분석할 키워드 입력", placeholder="예: 노바시새우")
    
    if st.button("시장성 분석 🔎"):
        if keyword_input:
            with st.spinner('네이버 데이터를 분석 중입니다...'):
                search_vol, tags = get_keyword_data_with_tags(keyword_input)
                prod_count = get_total_products(keyword_input)
                
                if search_vol > 0:
                    ratio = prod_count / search_vol
                    mc1, mc2, mc3 = st.columns(3)
                    mc1.metric("월간 검색량", f"{search_vol:,}")
                    mc2.metric("전체 상품 수", f"{prod_count:,}")
                    mc3.metric("경쟁률 (상품수/검색량)", f"{ratio:.2f}")
                    
                    if ratio < 1: st.success(f"🔥 **초대박 빈집 발견!** 무조건 진입하세요!")
                    elif ratio < 5: st.info(f"✅ **해볼 만한 시장입니다.**")
                    else: st.error(f"💀 **레드오션입니다.** 차별화 전략이 필수입니다.")
                    
                    # 💡 황금 해시태그 추천 (새 기능)
                    st.divider()
                    st.markdown("#### 🏷️ 스마트스토어 추천 해시태그 (복사해서 쓰세요!)")
                    if tags:
                        tags_str = ", ".join([f"#{t}" for t in tags])
                        st.info(f"**{tags_str}**")
                    else:
                        st.write("연관 태그를 찾지 못했습니다.")
                else:
                    st.error("검색량 데이터를 가져오지 못했습니다.")

# --- 탭 3: 시즌 트렌드 (데이터랩) ---
with tab3:
    st.markdown("### 📈 최근 1년 계절별 검색 트렌드")
    st.caption("이 상품이 몇 월에 가장 잘 팔리는지 파악하고 미리 사입을 준비하세요.")
    
    trend_keyword = st.text_input("트렌드를 확인할 상품명 입력", placeholder="예: 냉동연어")
    if st.button("트렌드 차트 보기 📊"):
        if trend_keyword:
            with st.spinner('네이버 데이터랩을 조회 중입니다...'):
                trend_df = get_datalab_trend(trend_keyword)
                if not trend_df.empty:
                    st.line_chart(trend_df, height=400)
                    st.success(f"위 차트에서 꼭대기(피크)를 찍는 달이 **'{trend_keyword}'의 성수기**입니다!")
                else:
                    st.warning("트렌드 데이터가 부족하거나 키워드 설정에 문제가 있습니다.")
