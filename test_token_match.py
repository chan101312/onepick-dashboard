"""
/api/order-reconcile의 새 토큰 매칭 로직(_tokenize_product_name / _find_best_token_match) 검증용.
서버 재배포 없이 로컬에서 실제 케이스로 확인한다.
"""
import sys
sys.path.insert(0, ".")

import server

COUPANG_KETCHUP = "오뚜기 케찹 3.2kg 3개 스파우트팩"
ESANGIN_KETCHUP = "[오뚜기]-케챂(스파우트팩)"

# 사장님이 확인해주신, 매칭되면 안 되는 다른 오뚜기 상품 7종 (최근 3000건 조회로 뽑은 실제 데이터)
ESANGIN_OTHER_OTTOGI = [
    "[오뚜기] 사과식초-미u",
    "[오뚜기] 2배사과식초-미u",
    "[오뚜기] 2배사과식초(말)-미u",
    "[오뚜기] 사리면-48개입-미u",
    "[오뚜기] 펜더굴소스-(병)-미u",
    "[오뚜기]-카레(약간매운맛)(70)",
    "[오뚜기] 돈까스소스-P/T-미u",
]

print("=" * 70)
print("1) 토큰화 결과")
print("=" * 70)
print("쿠팡  :", COUPANG_KETCHUP, "->", server._tokenize_product_name(COUPANG_KETCHUP))
print("E상인 :", ESANGIN_KETCHUP, "->", server._tokenize_product_name(ESANGIN_KETCHUP))
print()
for n in ESANGIN_OTHER_OTTOGI:
    print("E상인 :", n, "->", server._tokenize_product_name(n))

print()
print("=" * 70)
print("2) 양성 테스트 — 오뚜기 케찹(쿠팡) vs 오뚜기 케챂(E상인) : 반드시 매칭돼야 함")
print("=" * 70)
matched, matched_name, confidence = server._find_best_token_match(
    COUPANG_KETCHUP, [ESANGIN_KETCHUP] + ESANGIN_OTHER_OTTOGI
)
print(f"matched={matched}, matched_name={matched_name!r}, confidence={confidence}")
assert matched is True, "❌ FAIL: 오뚜기 케찹 매칭 실패"
assert matched_name == ESANGIN_KETCHUP, f"❌ FAIL: 엉뚱한 상품({matched_name})에 매칭됨"
print("✅ PASS")

print()
print("=" * 70)
print("3) 음성 테스트 — 오뚜기 케찹(쿠팡)이 다른 오뚜기 상품 7종과는 매칭되면 안 됨")
print("=" * 70)
all_negative_passed = True
for other_name in ESANGIN_OTHER_OTTOGI:
    matched, matched_name, confidence = server._find_best_token_match(COUPANG_KETCHUP, [other_name])
    status = "✅ PASS (안 걸림)" if not matched else f"❌ FAIL (잘못 매칭됨: {matched_name}, {confidence})"
    if matched:
        all_negative_passed = False
    print(f"  {other_name!r:45s} -> matched={matched}  {status}")

print()
print("=" * 70)
print("4) 종합 결과")
print("=" * 70)
if all_negative_passed:
    print("🎉 전체 통과: 양성 케이스 매칭 + 음성 케이스 7종 전부 오탐 없음")
else:
    print("🚨 실패: 음성 케이스 중 일부가 잘못 매칭됨 (오탐 발생)")
    sys.exit(1)
