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
                    'channelProductNo': channel_info['channelProductNo'] # ⚡ 가격 수정을 위한 필수 고유 번호 추가
                })
            except: continue
    return my_items

# ⚡ [핵심] 실제 네이버 서버에 가격 수정을 요청하는 함수
def update_naver_price(channel_product_no, new_price):
    # 1. 신선한 토큰 재발급 (수정 작업은 보안이 철저해서 방금 발급받은 토큰이 안전합니다)
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
    
    # 2. 내 상품 정보 100% 가져오기 (GET)
    url_product = f"https://api.commerce.naver.com/external/v2/products/channel-products/{channel_product_no}"
    res_get = requests.get(url_product, headers=headers)
    if res_get.status_code != 200: return False, f"상품 정보 로드 실패: {res_get.status_code}"
    
    product_data = res_get.json()
    
    # 3. 가격 데이터만 살짝 바꾸기
    try:
        product_data['salePrice'] = new_price
    except KeyError:
        return False, "가격 정보를 찾을 수 없는 상품 구조입니다."
        
    # 4. 바꾼 정보를 통째로 네이버에 덮어쓰기 (PUT)
    headers["Content-Type"] = "application/json"
    res_put = requests.put(url_product, headers=headers, json=product_data)
    
    if res_put.status_code == 200:
        return True, "가격 수정 완료"
    else:
        # 실패할 경우 원인 파악을 위해 네이버가 주는 에러 메시지를 그대로 반환합니다
        error_msg = res_put.json().get('message', '알 수 없는 오류')
        return False, f"실패 사유: {error_msg}"


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


# ==========================================
# 🎨 웹페이지 화면 그리기
# ==========================================
st.title("👨‍💼 원픽푸드마켓 올인원 비즈니스 보드")
st.caption("최저가 방어부터 트렌드 분석, 자동 가격 인하까지 한 번에!")

tab1, tab2, tab3 = st.tabs(["🕵️ 실시간 최저가 & 마진", "💰 황금 키워드 & 해시태그", "📈 시즌 트렌드 (데이터랩)"])

# --- 탭 1: 최저가 모니터링 & 자동 가격 수정 ---
with tab1:
    my_products = get_my_products()
    if not my_products:
        st.error("상품을 불러오지 못했습니다. 키 설정을 확인하세요.")
    else:
        if 'previous_product' not in st.session_state:
            st.session_state.previous_product = None
        if 'is_searching' not in st.session_state:
            st.session_state.is_searching = False

        product_names = [p['name'] for p in my_products]
        selected_name = st.selectbox("📦 분석할 내 상품 선택", product_names, key="my_prod_box")
        target_prod = next(p for p in my_products if p['name'] == selected_name)

        if selected_name != st.session_state.previous_product:
            st.session_state.is_searching = False
            st.session_state.previous_product = selected_name

        st.divider()
        col1, col2, col3, col4 = st.columns([2, 1.5, 1.5, 1])
        with col1: search_query = st.text_input("🔍 타사 검색 키워드", value=selected_name)
        with col2: must_include = st.text_input("💡 필수 포함 단어", placeholder="예: 3kg")
        with col3: ignore_price = st.number_input("🚫 미끼제외(원)", min_value=0, step=1000)
        with col4: 
            st.markdown("<br>", unsafe_allow_html=True)
            search_btn = st.button("최저가 분석 🚀", use_container_width=True)

        if search_btn:
            st.session_state.is_searching = True

        if st.session_state.is_searching and search_query:
            competitors = search_competitors(search_query, ignore_price, must_include)
            c_left, c_right = st.columns([1, 2])
            
            with c_left:
                st.subheader("🏪 우리 스토어 현황")
                st.info(f"**현재 판매가:** {target_prod['price']:,} 원")
                
                cost_price = st.number_input("사입가/포장비 등 총 원가 입력 (원)", min_value=0, step=500, value=int(target_prod['price']*0.6))
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
                    lowest_price = competitors[0]["가격(원)"]
                    diff = target_prod['price'] - lowest_price
                    
                    if diff > 0: 
                        st.error(f"🚨 1위보다 {diff:,}원 비쌉니다!")
                        target_new_price = lowest_price - 10
                        
                        # ⚡ [핵심] 실제 서버로 가격 수정을 요청하는 콜백 함수
                        def apply_real_price_cut():
                            # 버튼이 눌리면 이 코드가 실행됩니다
                            success, msg = update_naver_price(target_prod['channelProductNo'], target_new_price)
                            st.session_state.update_success = success
                            st.session_state.update_msg = msg
                            st.session_state.show_success_alert = True
                            
                        if st.button(f"⚡ {target_new_price:,}원으로 진짜 10원 내리기", type="primary", on_click=apply_real_price_cut):
                            pass
                            
                        # 결과 알림창 띄우기
                        if st.session_state.get('show_success_alert', False):
                            if st.session_state.get('update_success'):
                                st.toast("✅ 네이버 스마트스토어 반영 완료!", icon="🚀")
                                st.balloons()
                                st.success(f"🎉 성공! 현재 스토어 가격이 **{target_new_price:,}원**으로 변경되었습니다.")
                                get_my_products.clear() # 캐시를 삭제해서 바뀐 새 가격을 바로 불러옵니다
                            else:
                                st.error(f"🚨 수정 실패: {st.session_state.get('update_msg')}")
                            
                            st.session_state.show_success_alert = False # 알림 초기화
                            
                    else: 
                        st.success("🏆 현재 1위 최저가 방어 중입니다. 가격을 내릴 필요가 없습니다!")
                        
                    st.dataframe(pd.DataFrame(competitors), use_container_width=True)
                else:
                    st.warning("조건에 맞는 경쟁사가 없습니다.")

# --- 탭 2: 황금 키워드 & 해시태그 ---
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
                    st.divider()
                    st.markdown("#### 🏷️ 스마트스토어 추천 해시태그 (복사해서 쓰세요!)")
                    if tags: st.info(f"**{', '.join(['#'+t for t in tags])}**")
                else: st.error("검색량 데이터를 가져오지 못했습니다.")

# --- 탭 3: 시즌 트렌드 (데이터랩) ---
with tab3:
    st.markdown("### 📈 최근 1년 계절별 검색 트렌드")
    trend_keyword = st.text_input("트렌드를 확인할 상품명 입력", placeholder="예: 냉동연어")
    if st.button("트렌드 차트 보기 📊"):
        if trend_keyword:
            with st.spinner('네이버 데이터랩을 조회 중입니다...'):
                trend_df = get_datalab_trend(trend_keyword)
                if not trend_df.empty: st.line_chart(trend_df, height=400)
                else: st.warning("트렌드 데이터를 찾을 수 없습니다.")
