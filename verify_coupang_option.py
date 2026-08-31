"""
쿠팡 옵션형 상품 API 응답 구조 검증용 1회성 스크립트.
원격(GCP) 서버의 프로젝트 루트에서 실행: python3 verify_coupang_option.py [검색어]
검색어를 안 주면 등록된 상품을 최대 30개 나열만 하고, 검색어를 주면 매칭되는 첫 상품을 상세 조회합니다.

이 스크립트는 확인이 끝나면 삭제해도 됩니다 (repo에 남겨두는 목적 아님).
"""
import sys
import json

import apis.coupang_api as coupang_api

keyword = sys.argv[1] if len(sys.argv) > 1 else None

print("=== 1. 쿠팡 등록 상품 목록 조회 ===")
products = coupang_api.get_coupang_products()
print(f"전체 상품 수: {len(products)}")

if not keyword:
    print("검색어 없이 실행됨. 상품명 최대 30개만 출력:")
    for p in products[:30]:
        print(" -", p)
    print()
    print("옵션형 상품(이름에 여러 용량/규격이 같이 붙어있는 상품)의 이름 일부를 인자로 다시 실행해줘.")
    sys.exit(0)

matches = [p for p in products if keyword in p.get("sellerProductName", "")]
if not matches:
    print(f"'{keyword}'로 매칭된 상품 없음.")
    sys.exit(0)

for p in matches:
    print(" -", p)

target = matches[0]
seller_product_id = target.get("sellerProductId")

print()
print(f"=== 2. '{target.get('sellerProductName')}' (sellerProductId={seller_product_id}) 상세 조회 ===")
detail = coupang_api.get_coupang_product_detail(seller_product_id)

if not detail:
    print("상세 조회 실패 (None 응답).")
    sys.exit(1)

items = detail.get("items", []) or []
print(f"items 개수: {len(items)}")
for it in items:
    print(" - keys:", list(it.keys()))

print()
print("=== 전체 응답 (JSON) ===")
print(json.dumps(detail, ensure_ascii=False, indent=2))
