# config.py (절대 외부에 공개하지 마세요!)

# [1] 텔레그램 봇 정보
TELEGRAM_TOKEN = '8701746901:AAFFikLZucBFiRUf4jMr9yo_anpyMXpW2HA'
CHAT_ID = '7293105766'

# [2] 네이버 쇼핑 검색 API 정보 (총 상품 수 조회용)
# 🚨 401 에러를 해결할 진짜 열쇠 이름표입니다.
NAVER_SEARCH_CLIENT_ID = '8fsdefpJXOBrtYL5L1Qx'
NAVER_SEARCH_CLIENT_SECRET = 'y29PB6broG'

# [3] 네이버 커머스 API 정보 (내 스토어 '원픽푸드마켓' 접근용)
NAVER_COMMERCE_CLIENT_ID = '4b0WMBrWDnUpvAYyKaUvx5'
NAVER_COMMERCE_CLIENT_SECRET = '$2a$04$aun23zkw33gSqZ2Ctber8.'

NAVER_AD_LICENSE = "010000000021efcad67244ae000c7ab50c4760e330334f90bcf07e00b975034d7c1746f8a7"
NAVER_AD_SECRET = "AQAAAAAh78rWckSuAAx6tQxHYOMwltCX1u6Kno2xDLXKyGDo9w=="
NAVER_AD_CUSTOMER_ID = "3153361"


# [4] 마지노선 설정 (원가+최소마진)
MIN_PRICES = {
    "무안 감태 100장 약500g 생감태 100% 자연산 서산": 81000
}

# 🔍 [새로 추가!] 타사 가격을 비교할 때 쓸 '진짜 검색어'
SEARCH_KEYWORDS = {
    "무안 감태 100장 약500g 생감태 100% 자연산 서산": "생감태 100장" # ⬅️ 이 단어로 타사 상품을 긁어옵니다!
}

# 🚫 [새로 추가!] 이 가격 밑으로 파는 건 '옵션 장난'이므로 무시합니다.
IGNORE_PRICES_BELOW = {
    "무안 감태 100장 약500g 생감태 100% 자연산 서산": 70000  # 예: 6만원 밑은 무조건 가짜!
}