import streamlit as st
import pandas as pd
import requests

# 분리된 모듈 불러오기
from apis._old_backup.utils import load_settings, load_margin_db, get_blacklist
from apis.naver_api import NAVER_COMMERCE_ID, get_my_products, get_new_orders
from apis.coupang_api import get_coupang_orders

from tabs import tab1_manage
from tabs import tab2_keyword
from tabs import tab3_seo
from tabs import tab4_orders
from tabs import tab5_margin

# --- 앱 기본 설정 ---
st.set_page_config(page_title="원픽푸드마켓 비즈니스 대시보드", layout="wide")

st.markdown("""
    <style>
    .stButton>button { width: 100%; font-weight: bold; font-size: 16px; }
    .stStatus { border-radius: 10px; }
    div[data-testid="stDataFrame"] { font-size: 16px !important; }
    th { font-size: 16px !important; font-weight: 900 !important; color: #000000 !important; }
    </style>
    """, unsafe_allow_html=True)

# --- 전역 상태 초기화 ---
if 'my_products' not in st.session_state: st.session_state['my_products'] = None
if 'naver_key_idx' not in st.session_state: st.session_state['naver_key_idx'] = 0
if 'coupang_key_idx' not in st.session_state: st.session_state['coupang_key_idx'] = 0

if 'fee_naver' not in st.session_state:
    _sets = load_settings()
    st.session_state['fee_naver'] = float(_sets.get('fee_naver', 5.8))
    st.session_state['fee_coupang'] = float(_sets.get('fee_coupang', 9.6))
    st.session_state['fee_baemin'] = float(_sets.get('fee_baemin', 3.0))
    st.session_state['fee_lotteon'] = float(_sets.get('fee_lotteon', 11.2))

if 'base_margin_df' not in st.session_state: 
    st.session_state['base_margin_df'] = load_margin_db()

# --- 사이드바 동기화 로직 ---
with st.sidebar:
    st.header("시스템 관리")
    if NAVER_COMMERCE_ID:
        try:
            server_ip = requests.get('https://api.ipify.org').text
            st.code(f"IP: {server_ip}\n(쿠팡 허용IP 등록용)", language="text")
        except: pass
    
    st.divider()
    if st.button("🔄 전 채널 데이터 통합 동기화", type="primary"):
        with st.status("🌐 전체 데이터를 새로고침 중...", expanded=True) as status:
            _sets = load_settings()
            st.session_state['fee_naver'] = float(_sets.get('fee_naver', 5.8))
            st.session_state['fee_coupang'] = float(_sets.get('fee_coupang', 9.6))
            st.session_state['fee_baemin'] = float(_sets.get('fee_baemin', 3.0))
            st.session_state['fee_lotteon'] = float(_sets.get('fee_lotteon', 11.2))
            
            st.session_state['base_margin_df'] = load_margin_db()
            if 'margin_editor' in st.session_state: del st.session_state['margin_editor']
            st.session_state['my_products'] = get_my_products()
            
            blacklist = get_blacklist() 
            raw_naver = get_new_orders()
            new_naver = [o for o in raw_naver if str(o['상품주문번호']).strip() not in blacklist]
            st.session_state['naver_df'] = pd.DataFrame(new_naver) if new_naver else None
            if st.session_state['naver_df'] is not None: st.session_state['naver_df'].insert(0, '선택', True)
                
            raw_coupang = get_coupang_orders()
            new_coupang = [o for o in raw_coupang if str(o['상품주문번호']).strip() not in blacklist]
            st.session_state['coupang_df'] = pd.DataFrame(new_coupang) if new_coupang else None
            if st.session_state['coupang_df'] is not None: st.session_state['coupang_df'].insert(0, '선택', True)
                
            status.update(label="✅ 동기화 완료!", state="complete", expanded=False)
        st.rerun()

st.title("👨‍💼 원픽푸드마켓 비즈니스 보드")

# --- 탭 구성 및 모듈 연결 ---
t1, t2, t3, t4, t5 = st.tabs([
    "🚀 상품 관리", "💰 황금 키워드", "📝 SEO", "📦 주문", "📊 마진 장부"
])

with t1: tab1_manage.show_tab()
with t2: tab2_keyword.show_tab()
with t3: tab3_seo.show_tab()
with t4: tab4_orders.show_tab()
with t5: tab5_margin.show_tab()