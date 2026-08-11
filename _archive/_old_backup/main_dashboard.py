import streamlit as st
import pandas as pd
from datetime import datetime

# ----------------------------------------------------
# ⚙️ 웹페이지 기본 설정
# ----------------------------------------------------
st.set_page_config(page_title="통합 주문 대시보드", page_icon="📦", layout="wide")

st.title("📦 원픽 통합 주문 관리 대시보드")
st.markdown("네이버, 쿠팡, 롯데온, 식봄의 주문을 한 곳에서 한눈에 확인하세요!")

# ----------------------------------------------------
# 1. 데이터 가져오기 (기존 함수 그대로 사용)
# ----------------------------------------------------
def get_naver_orders():
    return [
        {"플랫폼": "네이버", "주문일시": "2026-03-11 09:30", "상품명": "테스트 상품 A", "수량": 1, "결제금액": 15000, "주문상태": "결제완료"},
        {"플랫폼": "네이버", "주문일시": "2026-03-11 10:15", "상품명": "테스트 상품 B", "수량": 2, "결제금액": 30000, "주문상태": "배송준비"}
    ]

def get_coupang_orders():
    return [{"플랫폼": "쿠팡", "주문일시": "2026-03-11 08:20", "상품명": "로켓 테스트 상품 C", "수량": 1, "결제금액": 12500, "주문상태": "상품준비중"}]

def get_lotteon_orders_mock():
    return [{"플랫폼": "롯데온", "주문일시": "2026-03-11 10:45", "상품명": "[롯데온] 테스트 상품 D", "수량": 3, "결제금액": 45000, "주문상태": "결제완료"}]

def get_sikbom_orders_mock():
    return [{"플랫폼": "식봄", "주문일시": "2026-03-11 07:10", "상품명": "[식자재] 대용량 양파 5kg", "수량": 5, "결제금액": 55000, "주문상태": "입금대기"}]

# 데이터 취합
all_orders = []
all_orders.extend(get_naver_orders())
all_orders.extend(get_coupang_orders())
all_orders.extend(get_lotteon_orders_mock())
all_orders.extend(get_sikbom_orders_mock())

df = pd.DataFrame(all_orders)
df.index = df.index + 1

# ----------------------------------------------------
# 2. 대시보드 화면 그리기 (상단 요약)
# ----------------------------------------------------
total_orders = len(df)
total_revenue = df['결제금액'].sum()

# 화면을 3칸으로 나누어서 예쁜 위젯 달기
col1, col2, col3 = st.columns(3)
col1.metric(label="🛒 오늘 총 주문 건수", value=f"{total_orders} 건")
col2.metric(label="💰 오늘 총 결제 금액", value=f"{total_revenue:,} 원")
col3.metric(label="🔄 마지막 업데이트", value=datetime.now().strftime('%H:%M:%S'))

st.divider() # 구분선 긋기

# ----------------------------------------------------
# 3. 데이터 표 출력
# ----------------------------------------------------
st.subheader("📋 전체 주문 상세 내역")
# use_container_width=True 로 설정하면 표가 화면 꽉 차게 예쁘게 늘어납니다!
st.dataframe(df, use_container_width=True)