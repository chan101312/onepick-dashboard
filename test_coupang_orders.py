"""
쿠팡 주문 조회 디버깅용 로컬 테스트 스크립트.
서버 재배포 없이 get_coupang_orders()만 직접 호출해서 원본 응답/결과를 확인한다.
"""
import sys
sys.path.insert(0, ".")

from apis import coupang_api

print("=" * 60)
print("현재 get_coupang_orders() 호출")
print("=" * 60)
orders = coupang_api.get_coupang_orders()
print(f"\n결과: {len(orders)}건")
for o in orders[:5]:
    print(o)
