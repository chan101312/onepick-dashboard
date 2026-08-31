"""
네이버 옵션 상품 API 응답 구조 검증용 1회성 스크립트.
원격(GCP) 서버의 프로젝트 루트에서 실행: python3 verify_naver_option.py [channelProductNo]
channelProductNo를 안 주면 기본값으로 "다이아몬드 빵가루 새우 튀김 투톤 30g,50g" 상품(11060989411)을 조회합니다.

이 스크립트는 확인이 끝나면 삭제해도 됩니다 (repo에 남겨두는 목적 아님).
"""
import sys
import json

import apis.naver_api as naver_api

channel_no = sys.argv[1] if len(sys.argv) > 1 else "11060989411"

print(f"=== channelProductNo={channel_no} 상세 조회 ===")
detail = naver_api.get_naver_product_detail(channel_no)

if not detail:
    print("조회 실패 (None 응답). 토큰 발급/네트워크/channelProductNo 값을 확인하세요.")
    sys.exit(1)

origin = detail.get("originProduct", {}) or {}
detail_attr = origin.get("detailAttribute", {}) or {}

print()
print("최상위 키:", list(detail.keys()))
print("originProduct 키:", list(origin.keys()))
print("originProduct.detailAttribute 키:", list(detail_attr.keys()))
print("originProduct 최상위에 optionInfo 존재:", "optionInfo" in origin)
print("detailAttribute 안에 optionInfo 존재:", "optionInfo" in detail_attr)
print("originProduct.salePrice:", origin.get("salePrice"))
print("originProduct.stockQuantity:", origin.get("stockQuantity"))

print()
print("=== 전체 응답 (JSON) ===")
print(json.dumps(detail, ensure_ascii=False, indent=2))
