import streamlit as st
import pandas as pd
import requests

# 💡 흩어져 있던 모든 무기를 한 번에 깔끔하게 불러옵니다!
from naver_api import (
    get_my_products, 
    update_naver_price, 
    update_naver_product_name, 
    get_top_shopping_keywords, 
    search_competitors, 
    get_keyword_data_with_tags, 
    get_total_products, 
    get_datalab_trend, 
    NAVER_COMMERCE_ID
)

st.set_page_config(page_title="원픽푸드마켓 비즈니스 대시보드", layout="wide")

# --- 🚀 앱 시작 시 자동으로 상품 리스트 불러오기 ---
if 'my_products' not in st.session_state:
    with st.spinner('📦 네이버에서 상품 목록을 자동으로 불러오는 중...'):
        st.session_state['my_products'] = get_my_products()
        
# 변수 이름 연결 (기존 코드와 호환을 위해)
my_products = st.session_state.get('my_products', [])

# 🚨 배포 사이트에서 서버 IP를 확인하기 위한 코드
if NAVER_COMMERCE_ID:
    try:
        server_ip = requests.get('https://api.ipify.org').text
        st.info(f"🌐 현재 서버 IP: `{server_ip}` (이 주소를 커머스 API 센터에 등록하세요!)")
    except: pass

st.title("👨‍💼 원픽푸드마켓 올인원 비즈니스 보드")
st.caption("최저가 방어부터 트렌드 분석, 자동 가격 인하까지 한 번에!")

# 기존 코드를 찾아서 아래처럼 tab4를 추가해 주세요.
tab1, tab2, tab3, tab4 = st.tabs(["🕵️ 실시간 최저가 & 마진", "💰 황금 키워드 & 해시태그", "📈 시즌 트렌드", "📝 SEO 상품명 최적화"])

# --- 탭 1: 최저가 모니터링 & 자동 가격 수정 ---
with tab1:
    # my_products = get_my_products()
    if not my_products:
        st.error("상품 목록이 없습니다. 첫 로딩을 기다리거나 설정을 확인하세요.")
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
                        
                        def apply_real_price_cut():
                            # ⚡ 다시 channelProductNo를 넘겨주도록 원상복구!
                            success, msg = update_naver_price(target_prod['channelProductNo'], target_new_price)
                            
                            st.session_state.update_success = success
                            st.session_state.update_msg = msg
                            st.session_state.show_success_alert = True
                            
                        if st.button(f"⚡ {target_new_price:,}원으로 진짜 10원 내리기", type="primary", on_click=apply_real_price_cut):
                            pass
                            
                        if st.session_state.get('show_success_alert', False):
                            if st.session_state.get('update_success'):
                                st.toast("✅ 네이버 스마트스토어 반영 완료!", icon="🚀")
                                st.balloons()
                                st.success(f"🎉 성공! 현재 스토어 가격이 **{target_new_price:,}원**으로 변경되었습니다.")
                                get_my_products.clear()
                            else:
                                st.error(f"🚨 수정 실패: {st.session_state.get('update_msg')}")
                            
                            st.session_state.show_success_alert = False
                            
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
    st.markdown("### 📈 실시간 네이버 식품 카테고리 트렌드")
    
    col_t1, col_t2 = st.columns([1, 2])
    
    with col_t1:
        st.markdown("#### 🔥 지금 뜨는 식품 TOP 15")
        with st.spinner('실시간 랭킹을 집계 중입니다...'):
            # API에서 진짜 데이터를 가져옵니다.
            real_trending_kw = get_top_shopping_keywords("50000000") # 식품 카테고리 ID
            
            for i, kw in enumerate(real_trending_kw):
                # 클릭하면 바로 오른쪽 검색창에 입력되게 만드는 꿀팁!
                if st.button(f"{i+1}. {kw}", key=f"kw_{i}"):
                    st.session_state['target_kw'] = kw

        st.caption("💡 키워드를 클릭하면 우측 차트가 즉시 업데이트됩니다.")

    with col_t2:
        st.markdown("#### 📊 키워드 검색량 추세 (최근 1년)")
        # 세션 상태에서 키워드 가져오기 (없으면 기본값 '냉동연어')
        default_kw = st.session_state.get('target_kw', "냉동연어")
        search_kw = st.text_input("분석할 키워드 직접 입력", value=default_kw)
        
        if st.button("트렌드 분석 시작 🚀", key="analyze_btn"):
            with st.spinner(f"'{search_kw}' 데이터 분석 중..."):
                df = get_datalab_trend(search_kw)
                if not df.empty:
                    st.line_chart(df, height=400)
                    st.success(f"✅ '{search_kw}' 키워드는 현재 이런 흐름을 보이고 있습니다.")
                else:
                    st.error("데이터를 불러오지 못했습니다. 키워드를 확인해 주세요.")

with tab4:
    st.markdown("### 📝 내 상품명 실시간 SEO 최적화")
    
    # 이제 my_products가 자동으로 로드되므로 바로 목록을 보여줍니다.
    if my_products:
        prod_map = {p['name']: p for p in my_products}
        selected_prod_name = st.selectbox("📦 수정할 상품 선택", list(prod_map.keys()), key="seo_select")
        selected_prod = prod_map[selected_prod_name]

        st.divider()
        col1, col2 = st.columns([1, 1])

        with col1:
            st.markdown("#### 🧱 키워드 편집")
            new_title = st.text_area("새로운 상품명 입력", value=selected_prod_name, height=100)
            
        with col2:
            st.markdown("#### ✨ SEO 검사 및 미리보기")
            clean_name = " ".join(new_title.split()).strip()
            name_len = len(clean_name)

            if name_len <= 50:
                st.success(f"✅ 글자 수 적당함: {name_len}/50자")
            else:
                st.error(f"🚨 50자 초과! 네이버 검색 누락 위험: {name_len}/50자")

            import re
            if re.search(r'[^a-zA-Z0-9가-힣\s]', clean_name):
                st.warning("⚠️ 특수문자 제거 권장 (괄호, 쉼표 등)")
            
            if st.button("🚀 네이버 스토어에 즉시 반영하기", type="primary", width='stretch'):
                if name_len > 50:
                    st.error("50자가 넘으면 반영할 수 없습니다. 이름을 줄여주세요!")
                else:
                    with st.spinner("네이버 서버에 업데이트 중..."):
                        success, msg = update_naver_product_name(selected_prod['channelProductNo'], clean_name)
                        if success:
                            st.toast("✅ 반영 성공!", icon="🚀")
                            st.balloons()
                        else:
                            # 💡 여기서 "범인: [필드명] -> 메시지"가 출력됩니다!
                            st.error(f"❌ {msg}")
    else:
        st.error("상품 목록을 불러올 수 없습니다. API 설정이나 IP 등록 상태를 확인해주세요.")