# 네이버 옵션 상품 지원 + 채널 가격 자동 반영 — 설계

날짜: 2026-08-27
관련 대화: 채널 연결/가격 자동 반영 기능에 네이버 옵션 상품 지원 추가 요청

## 배경

"채널 연결"은 마진산출장부의 상품(자유 텍스트 상품명)을 실제 네이버/쿠팡/식봄 채널 상품과 1:1로
이어주는 기능이다(`channel_link.json`, `server.py`의 `/api/channel-link*`).

네이버는 하나의 등록 상품 안에 여러 옵션(조합형 옵션)이 묶여 있고 옵션마다 별도 가격을 가질 수
있는데, 지금 구조는 상품 단위로만 연결되어 있어 원가 변경 시 어느 옵션의 가격을 바꿔야 할지
알 수 없다. 조사 결과 쿠팡도 유사한 문제가 있다 — 옵션마다 독립된 `vendorItemId`와 절대가격을
가진다.

또한 조사 과정에서 "원가 변경 → 채널 가격 자동 반영" 기능 자체가 백엔드에 없다는 것을 확인했다.
`frontend/src/components/MarginTab.jsx`는 `/api/margin/update` 응답의 `price_changes`를 읽어
미리보기 모달을 띄우고(`handleSyncPrices`가 `/api/channel-price-sync`를 호출), 두 백엔드 모두
`server.py`에 구현되어 있지 않다. 이번 작업은 옵션 지원과 함께 이 기능 자체를 처음부터 구현한다.

## 검증된 사실 (실제 API 호출로 확인, 2026-08-27)

### 네이버 (조합형 옵션)
`GET /external/v2/products/channel-products/{channelProductNo}` 응답의
`originProduct.optionInfo.optionCombinations[]`에 각 옵션이 온다. 각 항목:
- `id` — 옵션(조합)의 고유 식별자. 이번 작업에서 `optionId`로 저장.
- `optionName1` — 옵션명 (예: "30g", "50g").
- `price` — **대표가격(`originProduct.salePrice`) 대비 추가금액(delta)**. 절대가격이 아님.
- `stockQuantity`, `usable` 등.

옵션 가격 반영 공식: `새 addPrice = 목표가 - salePrice`.

### 쿠팡 (아이템형 옵션)
`GET /v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}` 응답의
`data.items[]`가 옵션 단위이며, 각 item은:
- `vendorItemId` — 옵션의 고유 식별자, 이번 작업에서 저장 대상.
- `salePrice` — **절대금액**. 대표가/추가금액 개념 없음. (`supplyPrice`는 공급가라 별개 필드, 혼동 금지)

가격 반영은 전용 API로 한다: `PUT /v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/{vendorItemId}/prices/{price}` — 바디 없음, `{price}`는 10원 단위여야 함.

옵션이 1개뿐인 쿠팡 상품도 `vendorItemId`는 항상 존재하므로, 쿠팡은 옵션 유무와 무관하게 항상
`vendor_item_id`를 저장해야 가격 반영이 가능하다 (네이버처럼 "옵션 없으면 대표가 갱신" 경로가 없음).

## 데이터 모델 변경

### `channel_link.json`
채널별 엔트리에 옵션 식별자 필드를 선택적으로 추가한다. 필드명은 채널마다 다르게 둬서
"옵션 없음"과 "옵션 있지만 첫 번째"를 혼동하지 않는다.

```json
{
  "다이아몬드 빵가루 새우 튀김 투톤 30g,50g": {
    "naver":   { "id": "11060989411", "name": "...", "option_id": "31838214078", "option_name": "50g", "linked_at": "2026-08-27 ..." },
    "coupang": { "id": "sellerProductId", "name": "...", "vendor_item_id": "12345678", "option_name": "50g", "linked_at": "..." }
  }
}
```

- 네이버: `option_id`/`option_name`이 없으면 옵션 없는 상품 → 기존처럼 대표가(`salePrice`) 갱신.
- 쿠팡: `vendor_item_id`는 옵션 유무와 무관하게 항상 존재. 옵션이 여러 개일 때만 `option_name`을
  같이 저장해 미리보기 표시에 사용.
- 기존에 저장된 링크(옵션 필드 없음)는 그대로 하위호환 동작 — 마이그레이션 불필요.

`ChannelLinkIn` (Pydantic 모델, `server.py`)에 `option_id: str | None`, `option_name: str | None`,
`vendor_item_id: str | None`을 optional로 추가.

## API 변경

### 1. 상품 상세조회 (옵션 목록 확인용)
- 네이버: 기존 `GET /api/naver/products/{channel_no}` 재사용 (이미 `optionInfo` 포함해서 반환함,
  수정 불필요).
- 쿠팡: `GET /api/coupang/products/{seller_product_id}` 신규 추가 — `coupang_api.get_coupang_product_detail()`를
  감싸기만 하면 됨 (이미 옵션별 `items[]` 포함).

### 2. 채널연결 모달 흐름 (프론트, `MarginTab.jsx`)
후보 라디오 선택 시 상세조회 1회 호출 → 옵션이 여러 개면(네이버 `optionCombinations.length > 0`,
쿠팡 `items.length > 1`) "이 상품의 어떤 옵션인가요?" 하위 라디오를 추가로 보여준다. 옵션이
하나뿐인 쿠팡 상품도 `vendor_item_id`(items[0].vendorItemId)는 조용히 같이 저장한다(사용자에게는
선택지를 안 보여줘도 됨).

### 3. `price_changes` 계산 — `/api/margin/update` 확장
현재 이 라우트는 payload를 그대로 CSV에 덮어쓰기만 한다(`server.py:331-341`). 확장:
1. 덮어쓰기 전에 기존 CSV를 읽어 상품명(`온라인 상품명`/`상품명`) 기준 맵으로 만든다.
2. 새 payload(프론트가 이미 재계산해서 보낸 `'네이버 판매가'`/`'쿠팡 판매가'` 등 최종가 포함)와
   비교해서, 값이 달라진 상품×채널 조합만 추려낸다.
3. 그 상품에 대해 `channel_link.json`에 연결된 채널이 있는 조합만 `price_changes`에 담는다.
   각 항목: `{ product_name, channel, channel_id, channel_name, option_id, option_name,
   vendor_item_id, old_price, new_price }` (옵션 없으면 `option_id`/`vendor_item_id`는 `null`).
4. 신뢰 경계는 기존과 동일하게 유지한다 — 백엔드가 원가부터 재계산하지 않고, 프론트가 계산해
   보낸 최종가를 그대로 신뢰한다.

### 4. `/api/channel-price-sync` 신규 구현
요청: `{ changes: [ {product_name, channel, channel_id, channel_name, option_id, option_name,
vendor_item_id, new_price}, ... ] }` (프론트가 이미 이 형태로 보내고 있음, 옵션 필드만 추가).

**채널별 분기, 그리고 네이버는 상품 단위로 배치 처리:**

- **쿠팡**: 각 change마다 독립적으로 `PUT vendor-items/{vendor_item_id}/prices/{round(new_price, -1)}`
  호출 (10원 단위 반올림). 항목별로 성공/실패를 그대로 결과에 남긴다.

- **네이버**: 여러 옵션이 같은 상품(`channel_id` = channelProductNo)에서 동시에 바뀔 수 있으므로,
  **상품(channelProductNo) 단위로 그룹핑해서 GET 1회 → PUT 1회**로 처리한다 (옵션마다 따로
  GET→PUT 하면 뒤의 PUT이 앞의 PUT으로 반영된 가격을 못 보고 순차 덮어써서 유실 위험이 있음).
  1. `channel_id`가 같은 change들을 묶는다.
  2. `GET`으로 해당 상품의 현재 `originProduct` 전체(특히 `optionCombinations` 배열 전체)를 가져온다.
  3. 그룹 안의 각 change에 대해, `optionCombinations` 배열에서 대상 옵션을 찾는다:
     - 먼저 저장된 `option_id`와 `combo['id']`가 일치하는 항목을 찾는다.
     - **못 찾으면**(= id가 안정적이지 않다는 뜻) 저장된 `option_name`과 `combo['optionName1']`이
       일치하는 항목으로 폴백 매칭한다. 폴백으로 찾은 경우, 매칭된 새 `id`로 `channel_link.json`의
       `option_id`를 갱신해서 다음 반영부터는 다시 1차 매칭이 되게 한다.
     - 둘 다 못 찾으면 해당 change는 실패 처리(`실패: 옵션을 찾을 수 없음`)하고 그룹의 나머지는
       계속 진행한다.
     - 찾은 항목의 `price`만 `new_price - origin['salePrice']`로 교체한다. **매칭 안 된 나머지
       옵션들은 배열에서 원본 그대로 유지**해서 같이 PUT에 실어 보낸다(빠뜨리면 그 옵션이
       삭제/초기화될 위험).
     - `option_id`가 없는 change(옵션 없는 상품)는 그룹과 별개로 `salePrice` 자체를 `new_price`로
       교체.
  4. 수정된 `optionCombinations` 배열 전체를 담아 **한 번만 PUT**한다.
  5. `optionCombinationSortType`은 기존 `update_naver_product_advanced`가 쓰던 `"CREATE"`를
     쓰지 않는다 — 재정렬/재생성 없이 기존 배열을 그대로 유지하는 값으로 보낸다. **주의**: 이 값이
     실제로 `id`를 보존하는지는 이번 배포 후 실제 PUT 1건으로 반드시 재검증한다 (문서로 확증 못한
     부분). id가 바뀌는 것으로 확인되면 위 3번의 폴백 매칭이 실질적인 주 경로가 된다 — 그 경우
     `optionCombinationSortType` 선택은 크게 중요하지 않아지고(매 반영마다 이름으로 재매칭하면
     되므로), 대신 "이름이 중복된 옵션"이 있는 상품은 지원 불가 상태가 됨을 결과 메시지에 남긴다.

이 배치 처리 함수는 `apis/naver_api.py`에 새 함수(예: `update_naver_option_prices(channel_product_no, price_updates)` — `price_updates: [{option_id, option_name, new_addprice_or_saleprice}]`)로 추가하고,
`server.py`의 `/api/channel-price-sync`가 change 목록을 `channel_id`로 그룹핑해서 이 함수를 상품당
1번씩 호출한다.

### 5. 미리보기 모달 (`MarginTab.jsx`)
`priceChanges` 각 항목에 `option_name`이 있으면:
`"네이버 - 50g 옵션: 5,000원 → 5,300원"` / `"쿠팡 - 50g 옵션: 5,000원 → 5,300원"`
없으면 기존처럼 `"네이버: 5,000원 → 5,300원"`.

## 에러 처리

- `/api/channel-price-sync`는 항목별 성공/실패를 배열로 반환(기존 프론트가 이미
  `data.results`를 기대하고 있음 — 형식 유지).
- 네이버 그룹 처리 중 일부 옵션만 실패해도(예: 이름 매칭 실패) 나머지 옵션은 계속 반영한다 —
  한 상품 안에서 하나가 막혔다고 그룹 전체를 포기하지 않는다.
- GET 실패(상품이 삭제됐거나 API 오류)는 그룹의 모든 change를 실패 처리.

## 범위 밖 (이번에 안 함)

- 식봄(sikbom) 채널의 옵션 지원 — 식봄은 공식 API 미연동 상태(`NotImplementedError`)라 대상 아님.
- 배민(baemin) 채널 — 애초에 `channel_link.json`의 연결 대상 채널(`CHANNEL_LINK_CHANNELS`)이 아님.
- 원가 자체의 재계산 로직 변경 — 프론트의 `recalcFullDataWithFees`는 그대로 둠.
