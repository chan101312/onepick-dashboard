# 수수료 분석 탭 — 설계 문서

작성일: 2026-08-28
상태: 검토 대기

## 1. 목적

상품별로 **예측 마진**(마진산출장부의 채널 수수료 추정치 기반)과 **실제 마진**(정산
API로 조회한 실제 차감 수수료 기반)을 비교해, "예측 대비 실제 수수료가 얼마나
차이 나는지"를 보여준다. 광고비는 이번 범위에서 완전히 제외한다.

목표:
1. 월별 / 채널별(네이버·쿠팡) 실제 지출 수수료 총액 파악
2. 상품별 예측 vs 실제 순마진 비교 (차이 = 예측 수수료 − 실제 수수료)

## 2. 데이터 소스 (프로덕션 실호출로 검증 완료)

### 2.1 네이버 — 건별 정산 내역

- `GET https://api.commerce.naver.com/external/v1/pay-settle/settle/case`
- 헤더: `Authorization: Bearer <token>` (`naver_api.get_access_token()`)
- 파라미터:
  - `periodType` = `SETTLE_CASEBYCASE_SETTLE_BASIS_DATE`
  - `searchDate` = `YYYY-MM-DD` (단일 일자). 판매월 M 집계를 위해 **[M-01 … (M+1)-20] 범위를 하루씩 순회**(§5)
  - `pageNumber` / `pageSize` (settle/daily 응답 기준 기본 size 1000, 페이지네이션 존재 가정 → `pagination` 블록 없을 때까지 순회)
  - 집계 시 `payDate` 가 M월인 행만 사용
- 응답 `elements[]` 주요 필드:
  - `settleBasisDate`, `settleExpectDate`, `settleCompleteDate`, `payDate`
  - `orderId`, `productOrderId`, `productOrderType` (`PROD_ORDER` | `DELIVERY`)
  - `settleType` (`QUICK_SETTLE_ORIGINAL`, 반품/취소 시 다른 값 → 음수 금액)
  - **`productId`** = 네이버 `channelProductNo` (검증: `get_my_products()` 482개 중 정산 21건 중 20건 일치, `originProductNo`와는 0건). `DELIVERY` 라인은 `null`
  - `productName`
  - `paySettleAmount` (결제액), **`totalPayCommissionAmount`** (실제 차감 수수료, 음수),
    `sellingInterlockCommissionAmount`, `freeInstallmentCommissionAmount`, `benefitSettleAmount`
  - `settleExpectAmount` (실수령 예상)
- **수량 필드 없음** (전체 키 합집합 확인: `quantity`/`qty`/`cnt`/`수량` 계열 전무)
  → §2.4 상품주문 상세 API로 실제 수량 병행 조회

### 2.4 네이버 — 상품주문 상세 (실제 수량 조회)

- `POST https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/query`
- 헤더: settle/case와 동일 (`Authorization: Bearer <token>`)
- 바디: `{"productOrderIds": [<settle/case 에서 모은 productOrderId 목록>]}` — 배치, 1회 최대 300개 (추정, 초과 시 분할)
- 응답 `data[].productOrder` 주요 필드:
  - **`quantity`** (실제 주문 수량), `initialQuantity`, `remainQuantity` (부분취소 후 잔여)
  - `productOrderId` (settle/case 와 1:1 조인 키), `productId`, `originalProductId`, `sellerProductCode`
  - `unitPrice`, `totalProductAmount`, `totalPaymentAmount`
  - `productDiscountAmount`, `sellerBurdenStoreDiscountAmount`, `deliveryDiscountAmount` (할인/쿠폰 내역 — 참고)
  - `productOrderStatus` (취소/반품 상태), `taxType`, `saleCommission`, `channelCommission` (수수료 교차검증용)
- 검증: 7월 productOrderId 를 8월 말에 조회 성공 → 최소 2개월 lookback 가능. 기존 `naver_api.get_new_orders()` 가 이 엔드포인트를 이미 사용 중
- **쿠폰/할인 주문에서 `매출 ÷ 판매가` 추정은 부정확**(라이브 확인: `productDiscountAmount` 존재 시 반올림 뒤집힘 가능) → 추정 폐기, 이 API의 `quantity` 를 사용

### 2.2 쿠팡 — 매출/정산 내역

- `GET https://api-gateway.coupang.com/v2/providers/openapi/apis/api/v1/revenue-history`
- 인증: `coupang_api.generate_coupang_signature("GET", uri)` — 서명 대상 uri에 쿼리스트링 포함
- 파라미터:
  - `vendorId` = `COUPANG_VENDOR_ID`
  - `recognitionDateFrom` / `recognitionDateTo` = `YYYY-MM-DD`, 한 번에 ≤ 31일.
    판매월 M 집계 위해 **[M-01 … (M+1)-20]** 을 31일 이하로 2회 분할 조회(§5)
  - **`token` = `""` (빈 문자열, 첫 호출 필수)** — 생략/`0`/`1` 이면 400. 이후 `nextToken` 값으로 순회
  - `maxPerPage` = 50
  - 집계 시 `saleDate` 가 M월인 행만 사용
- 응답 `data[]`:
  - `orderId`, `saleType` (`SALE` | `REFUND`), `saleDate`, `recognitionDate`, `settlementDate`, `finalSettlementDate`
  - `deliveryFee { amount, fee, feeVat, feeRatio, settlementAmount, ... }`
  - `items[]`:
    - **`vendorItemId`**, `productId`, `productName`, `vendorItemName`, `externalSellerSkuCode`
    - `salePrice`, `quantity`, `saleAmount`
    - **`serviceFee`**, `serviceFeeVat`, **`serviceFeeRatio`**, `settlementAmount`
    - `coupangDiscountCoupon`, `sellerDiscountCoupon`, `downloadableCoupon`
  - `hasNext`, `nextToken`
- 환불: `saleType == "REFUND"` → 음수 금액, net 합산으로 처리

### 2.3 채널 총액 (요약 카드 교차검증용, 선택)

- 네이버 `GET /external/v1/pay-settle/settle/daily` → `commissionSettleAmount` (일별 수수료 총액)
- 쿠팡 `GET /v2/providers/marketplace_openapi/apis/api/v1/settlement-histories?revenueRecognitionYearMonth=YYYY-MM` → `serviceFee` (주별 수수료 총액)
- v1에서는 건별 집계값을 신뢰하고, 이 총액은 참고 로그로만 남긴다 (구현 선택).

## 3. 상품 매칭 전략

정산 데이터(채널 상품ID 기준) ↔ 마진산출장부(`uploads/online.csv`, 자유 텍스트
`온라인 상품명` 기준)를 잇는다. 브리지인 `channel_link.json`이 사실상 비어있어
(프로드 3건) ID 매칭만으로는 커버리지 ≈ 0%. 따라서 다단계:

1. **ID 매칭 (우선)**
   - 네이버: `channel_link.json`에서 `naver.id == settle.productId` 인 항목 → 그 `상품명` → `online.csv`에서 정확 일치 행
   - 쿠팡: `coupang.vendor_item_id == settle.vendorItemId` 인 항목 → `상품명` → `online.csv` 행
2. **이름 fuzzy 매칭 (폴백)**
   - 정규화: 소문자화 + 한글/영숫자 외 제거
   - `difflib.SequenceMatcher(None, a, b).ratio()` 를 `online.csv` 전 행 이름과 비교, 최고 점수
   - 임계값 `MATCH_THRESHOLD = 0.55` (조정 가능) 이상이면 매칭 + `match_confidence` 기록
   - 검증: 정산 상품명 18개 표본 중 16개 자동 매칭 (다수 0.9~1.0)
3. **미매칭** → `unmatched[]` 에 별도 수집 (표시만, §7)

- 한 `online.csv` 행에 여러 정산 상품이 매핑될 수 있음(옵션 분리, 네이버+쿠팡
  동시) → `(online.csv 행, 채널)` 단위로 합산
- `match_method` = `"id"` | `"name"` | `null`, `match_confidence` = 0.0~1.0 (id 매칭은 1.0)

## 4. 계산 로직

`(매칭된 online.csv 행) × 채널` 단위. 확정 결정: **예측 마진 = 실제 매출 기준, 수수료만
예측치로 교체.** 따라서 예측/실제의 유일한 차이는 수수료 값이다.

정산 집계값:
- `실제매출`
  - 네이버 = Σ `paySettleAmount` (해당 productId의 `PROD_ORDER` 라인)
  - 쿠팡 = Σ `items[].saleAmount`
- `실제수수료`
  - 네이버 = Σ `|totalPayCommissionAmount|`
  - 쿠팡 = Σ (`serviceFee` + `serviceFeeVat`)
- `수량` (양쪽 다 실제값 사용, 추정 없음)
  - 쿠팡 = Σ `items[].quantity` — `saleType == "REFUND"` 라인은 음수로 합산 (net 판매수량)
  - 네이버 = §2.4 `product-orders/query` 의 `productOrder.quantity` 를 `productOrderId` 로 조인해 합산.
    반품/취소 정산 라인(음수 `settleType`)에 해당하는 `productOrderId` 는 그 수량만큼 차감 (net).
    조회 실패한 `productOrderId` 는 `qty_partial=true` 로 표시하고 그 라인은 수량 0 처리 + `warnings[]`

`online.csv` 행에서:
- `채널수수료추정율` = `online.csv["<채널> 수수료"] / online.csv["<채널> 판매가"]` (판매가 0이면 `null`)
- `매입원가` = `parseNumber(online.csv["매입"])` × `수량`
- `고정비` = (`자재비` + `운송비` + `기타비용` + `날치알`, 각각 parseNumber, 없으면 0) × `수량`
  - `운송비` 컬럼은 마진산출장부 개편 배포 후 존재 (미배포 시 0)

파생:
- `예측수수료` = `채널수수료추정율 != null` 이면 `실제매출 × 채널수수료추정율`,
  아니면 `online.csv["<채널> 수수료"] × 수량`
- `예측마진` = `실제매출 − 매입원가 − 예측수수료 − 고정비`
- `실제마진` = `실제매출 − 매입원가 − 실제수수료 − 고정비`
- `차이금액` = `실제마진 − 예측마진` ( = `예측수수료 − 실제수수료`; 음수면 예상보다 더 떼임)
- `차이율` = `예측마진 != 0` 이면 `차이금액 / |예측마진| × 100`, 아니면 `null`

VAT 가정: `paySettleAmount` / `saleAmount` 는 소비자 결제가(VAT 포함), `online.csv`
판매가도 VAT 포함 → 정합. 수수료는 VAT 포함분(`serviceFee+serviceFeeVat`,
`totalPayCommissionAmount`) 사용. 이 가정을 스펙에 명시하고 v1에서 그대로 사용.

채널 요약 카드 (채널별):
- `매출 총액` = Σ `실제매출` (매칭 + 미매칭 전체)
- `실제 수수료 총액` = Σ `실제수수료` (전체)
- `예측 수수료 총액` = Σ `예측수수료` (매칭분만)
- `실제 순마진 총액` = Σ `실제마진` (매칭분만 — 미매칭은 원가 데이터 없음)
- 부가: `미매칭 매출` / `미매칭 수수료`

## 5. 기간 기준 — 판매(결제) 월 기준

다른 탭(마진산출장부, 재고정합성)이 전부 판매/주문 시점 기준이므로 이 탭도 **선택한
월에 결제/판매된 주문** 기준으로 집계한다. 정산일 기준이 아니다.

구현: 정산 API의 조회 축은 정산일뿐이지만 응답에 판매일이 있으므로 —
- 조회 창을 넓게: 네이버 `settle/case` 는 `searchDate` 를 **[M-01 … (M+1)-20]** 순회,
  쿠팡 `revenue-history` 는 `recognitionDateFrom/To` 를 같은 창으로 (31일 초과이므로 2회 분할)
- 응답 행을 **판매일이 M월인 것만** 남긴다: 네이버 `payDate` ∈ M, 쿠팡 `saleDate` ∈ M
- 조회 창 밖(M+1 20일 이후)에서야 정산 확정되는 M월 초지연 건은 그 시점 갱신에서 누락 →
  다음 달 재갱신 시 포함됨. `warnings[]` 에 "정산 미확정 추정 건 N건 제외 가능성" 안내

비용: 네이버 `settle/case` ~50콜(일별) + `product-orders/query` 배치. 소요 ~30–60초.
캐시가 있으므로 조회 자체는 수동 버튼 눌렀을 때만.

## 6. 백엔드 설계

새 모듈 `fee_analysis.py` (루트, `reorder.py` / `memos.py` 와 동일 패턴):

```python
from fastapi import APIRouter
router = APIRouter()
```

`server.py`:
```python
from fee_analysis import router as fee_analysis_router
app.include_router(fee_analysis_router)
```

### 6.1 엔드포인트

- `GET /api/fee-analysis?month=YYYY-MM`
  - `fee_cache_YYYY-MM.json` 읽어 반환
  - 없으면 `{"status": "error", "message": "아직 조회된 정산 데이터가 없습니다. '정산 갱신'을 눌러주세요."}`
- `POST /api/fee-analysis/refresh` body `{"month": "YYYY-MM"}`
  - 네이버 settle/case `[M-01 … (M+1)-20]` 일별 순회(~50콜) → `payDate ∈ M` 필터 → productOrderId 수집 →
    `product-orders/query` 배치(~1–10콜)로 실제 수량 →
    쿠팡 revenue-history 같은 창 2분할 + 페이지 순회 → `saleDate ∈ M` 필터 → 집계 → 매칭 → 계산
  - `fee_cache_YYYY-MM.json` 저장 후 페이로드 반환
  - 동시 실행 방지: 모듈 레벨 `_refresh_lock`(threading.Lock) + `_in_progress` 플래그, 진행 중이면 `{"status":"error","message":"조회가 이미 진행 중입니다."}`
  - 소요 ~30–60초 (동기 처리). 네이버 콜 간 `time.sleep(0.2)`, 실패한 날짜/배치는 최대 1회 재시도 후 `warnings[]` 에 기록하고 계속

### 6.2 내부 함수

- `_fetch_naver_settle(month) -> list[dict]` — 일별 순회, elements 평탄화
- `_fetch_naver_quantities(product_order_ids) -> dict[str, dict]` — `product-orders/query` 300개씩 분할 POST, `{productOrderId: {quantity, productOrderStatus, ...}}`
- `_fetch_coupang_revenue(month) -> list[dict]` — nextToken 순회, items 평탄화
- `_load_margin_rows() -> list[dict]` — `uploads/online.csv` (`pd.read_csv`, `clean_dataframe` 재사용 가능하면 재사용, 아니면 자체 로드)
- `_load_channel_links() -> dict`
- `_match(settle_name, settle_id, channel, margin_index, link_index) -> (row|None, method, confidence)`
- `_aggregate_and_compute(naver_lines, coupang_lines, margin_rows, links) -> payload`

### 6.3 캐시 파일 스키마 `fee_cache_YYYY-MM.json`

```json
{
  "month": "2026-07",
  "fetched_at": "2026-08-28T19:40:00+09:00",
  "basis": "sale",
  "channels": {
    "naver":  { "revenue": 0, "actual_fee": 0, "estimated_fee": 0, "actual_margin": 0,
                "unmatched_revenue": 0, "unmatched_fee": 0 },
    "coupang":{ "revenue": 0, "actual_fee": 0, "estimated_fee": 0, "actual_margin": 0,
                "unmatched_revenue": 0, "unmatched_fee": 0 }
  },
  "rows": [
    { "product_name": "장터국수 우동국물1.8L X 6개", "channel": "naver",
      "qty": 12, "qty_partial": false,
      "revenue": 894000, "cost": 0, "fixed_cost": 0,
      "estimated_fee": 26820, "actual_fee": 26844,
      "estimated_margin": 0, "actual_margin": 0,
      "diff_amount": -24, "diff_pct": -0.1,
      "match_method": "name", "match_confidence": 0.83 }
  ],
  "unmatched": [
    { "product_name": "...", "channel": "coupang", "settle_product_id": "9688088729",
      "vendor_item_id": "90384408397", "revenue": 0, "actual_fee": 0, "qty": 0 }
  ],
  "warnings": ["네이버 2026-07-14 조회 실패(재시도 후에도)"]
}
```

## 7. 프론트엔드 설계

`frontend/src/components/FeeAnalysisTab.jsx` + `Sidebar.jsx` / `App.jsx` 탭 등록
(key `fee_analysis`, 라벨 "수수료 분석", 아이콘 💸).

- 상태: `month` (기본 = 지난달 — 이번 달은 아직 미확정 정산이 많음), `data`, `loading`, `refreshing`
- 마운트 / `month` 변경 시 `GET /api/fee-analysis?month=` 호출
- 헤더에 "결제일 기준" 명시 (마진산출장부·재고정합성과 동일 시간축)
- **정산 갱신** 버튼 → `POST /api/fee-analysis/refresh` — ~30–60초 소요이므로 로딩 상태를 명확히:
  - `refreshing` 동안 버튼 비활성 + 라벨 "정산 조회 중…" + 스피너
  - 버튼 옆(또는 탭 상단)에 진행 안내 문구 "네이버·쿠팡 정산 내역을 불러오는 중입니다. 30초~1분 걸릴 수 있어요." 표시
  - 기존 테이블은 흐리게(opacity) 처리해 조작 불가함을 시각적으로 전달 (마진산출장부 `isCalculating` 패턴 참고)
  - 완료 시 재조회 + `fetched_at` 을 "마지막 갱신: …" 로, `warnings[]` 있으면 경고 배너
  - 실패 시 에러 메시지 노출하고 버튼 원복
- **채널 요약 카드 2개** (네이버 / 쿠팡): 매출 / 실제 수수료 / 예측 수수료 / 실제 순마진,
  하단에 작게 "미매칭 매출·수수료"
- **상품 테이블**: 상품명 | 채널 | 수량(`qty_partial` 이면 `*` 표시) | 매출 | 예측수수료 | 실제수수료 |
  예측마진 | 실제마진 | 차이(₩) | 차이(%)
  - 정렬 가능, 기본 정렬 = `|diff_amount|` 내림차순
  - 색상: `diff_amount < 0` (예상보다 더 뗌) 빨강, `> 0` 초록
  - `match_confidence < 0.7` → 상품명 옆 ⚠️ (이름 매칭 불확실)
  - `match_method === "name"` → 옅은 배지 "이름매칭"
- **미매칭 섹션** (접이식): 상품명 | 채널 | 매출 | 실제수수료 — 참고용, 계산 미포함
- 숫자 `toLocaleString()`, 통화 표기 원

`apiBase.js` 및 `ngrok-skip-browser-warning` 헤더 규칙은 기존 탭과 동일.

## 8. 에러 처리

- 캐시 없음 → 안내 문구 + 갱신 유도
- refresh 중 네이버 일부 날짜 실패 → 그 날짜만 제외하고 진행, `warnings[]` 노출
- `product-orders/query` 배치 일부 실패/누락 → 해당 `productOrderId` 라인 `qty_partial`, 수량 0, `warnings[]`
- refresh 중 쿠팡 인증/서명 실패 → 해당 채널 0 처리 + `warnings[]`
- `online.csv` 없음 → refresh는 정산 데이터만 채우고 전 행 `unmatched` 처리 + warning
- 동시 refresh → 거절 메시지

## 9. 범위 밖 (이번 반복)

- 광고비 전체 (네이버 검색광고 / 쿠팡애즈 모두)
- 상품별 광고비 귀속
- 미매칭 상품 수동 매핑 UI (표시만)
- 정산 데이터 자동/스케줄 갱신 (수동 버튼만)
- 배송비 라인의 수수료 (상품 수수료에서 제외)
- 초지연 정산 건 자동 보정 (다음 달 수동 재갱신으로 대응)

## 10. 리스크 / 가정

- 네이버 실제 수량은 `product-orders/query` 별도 호출로 확보(§2.4). lookback 한계는 최소 2개월 확인, 문서상 통상 1년 — 아주 오래된 월 조회 시 일부 `productOrderId` 누락 가능 → `qty_partial` 표시 + warning
- 반품/부분취소 시 net 수량 산정: 음수 정산 라인의 `productOrderId` 수량 차감. `remainQuantity` 와 불일치할 수 있어 구현 시 실데이터로 한 번 대조 필요
- 이름 fuzzy 매칭 오탐 가능 → `match_confidence` 표시 + 미매칭 우선 노출로 완화
- `channel_link.json` 거의 비어있음 → 초기에는 대부분 이름 매칭에 의존
- 판매월 기준(§5)이라 조회 창 밖에서 정산 확정되는 초지연 건은 해당 시점 갱신에서 누락 → 다음 달 재갱신 시 포함, `warnings[]` 안내. 이번 달·지난달은 재갱신 권장
- 네이버 ~50콜 + 쿠팡 분할 조회 → rate limit 가능 → 콜 간 지연 + 실패분 재시도/경고
- VAT 포함/제외 가정(§4)이 실제 정산 정의와 다르면 절대 마진 값에 편차 — 차이(예측−실제 수수료)에는 영향 적음
- 로컬 개발 환경은 네이버 커머스 토큰 발급이 안 됨(IP 등) → 백엔드 검증은 프로덕션 경유(SSH + venv)로 수행
