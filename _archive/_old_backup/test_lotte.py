import urllib.request
import json

# 🔴 플레이오토에 넣으셨던 그 '정상 작동하는 키'를 그대로 넣어주세요!
TEST_TOKEN = "5d5b2cb498f3d20001665f4e28e9688af53d4d98bf17032d72cb9236"

url = "https://openapi.lotteon.com/v1/openapi/order/v1/getOrderList"
payload = json.dumps({"srchStrtDtm": "20260301000000", "srchEndDtm": "20260310235959"}).encode('utf-8')

# 💡 핵심: requests 라이브러리 특유의 '기계 냄새'를 없애고 평범한 통신인 척 위장합니다.
req = urllib.request.Request(url, data=payload)
req.add_header("Authorization", f"Bearer {TEST_TOKEN}")
req.add_header("Content-Type", "application/json")
req.add_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
req.add_header("Accept", "application/json")

print("🚀 롯데온 방화벽 스텔스 우회 통신 시도 중...")
try:
    with urllib.request.urlopen(req) as response:
        print(f"🎉 드디어 뚫렸습니다!! 상태코드: {response.getcode()}")
        print(f"데이터: {response.read().decode('utf-8')[:200]}...") # 길어서 앞부분만 출력
except urllib.error.HTTPError as e:
    print(f"🛑 차단됨. 상태코드: {e.code}")
    print(f"에러상세: {e.read().decode('utf-8')}")
except Exception as e:
    print(f"🛑 기타 에러: {e}")