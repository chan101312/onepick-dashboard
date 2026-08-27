# 네이버/쿠팡 옵션 상품 채널 가격 자동 반영 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원가 변경 시 마진산출장부에서 계산된 새 채널 판매가를, 채널연결된 네이버/쿠팡 상품(옵션 단위 포함)에 자동으로 반영하는 미리보기+실행 기능을 처음부터 구현한다.

**Architecture:** `/api/margin/update`가 저장 직전 CSV와 새 데이터를 상품명 기준으로 비교해 `price_changes`를 계산해서 응답에 실어준다. 프론트(`MarginTab.jsx`)는 이를 미리보기 모달에 채널명+옵션명과 함께 보여주고, 사용자가 선택한 항목만 `/api/channel-price-sync`로 보낸다. 이 엔드포인트는 채널별로 분기한다: 쿠팡은 옵션(`vendorItemId`)마다 독립된 절대가 PUT을, 네이버는 상품(`channelProductNo`) 단위로 묶어 GET 1회 후 옵션 여러 개의 추가금액(`price`)을 한 번에 고쳐 PUT 1회로 반영한다. 채널연결 저장 구조(`channel_link.json`)에는 옵션 식별자(`option_id`/`option_name`/`vendor_item_id`)를 선택적으로 추가해 하위호환을 유지한다.

**Tech Stack:** FastAPI(`server.py`), `apis/naver_api.py`/`apis/coupang_api.py` (requests 기반 HTTP 클라이언트), React 19 프론트(`frontend/src/components/MarginTab.jsx`), 저장은 `channel_link.json`/`uploads/online.csv`. 이 저장소엔 테스트 프레임워크가 없다(CLAUDE.md: "No tests, no CI") — 새 의존성을 추가하지 않기 위해 순수 로직 테스트는 Python 표준 라이브러리 `unittest`(+ `unittest.mock`)만 사용한다. 새 테스트 파일은 `tests/`에 둔다(이 저장소에 처음 생기는 디렉터리).

**Spec:** `docs/superpowers/specs/2026-08-27-naver-option-channel-price-sync-design.md`

## Global Constraints

- 네이버 조합형 옵션의 `optionCombinations[].price`는 대표가격(`salePrice`) 대비 **추가금액**이다 (실제 GET 응답으로 검증됨). 절대가로 착각해서 계산하지 말 것.
- 쿠팡은 `items[].salePrice`가 **절대금액**이고 `vendorItemId` 단위로 독립적이다 (실제 GET 응답으로 검증됨). `supplyPrice`(공급가)와 혼동하지 말 것.
- 쿠팡 가격 변경은 `PUT /v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/{vendorItemId}/prices/{price}` — 바디 없음, `{price}`는 **10원 단위**여야 한다.
- 네이버 상품 하나에서 여러 옵션이 동시에 바뀌는 경우, 옵션마다 따로 GET→PUT 하지 말고 **상품(channelProductNo) 단위로 GET 1회 → PUT 1회**로 묶어 처리한다 (순차 PUT은 이전 반영분을 덮어쓸 위험).
- `optionCombinations[].id`가 PUT 이후에도 유지되는지는 문서로 확증되지 않았다 — id 매칭이 실패하면 **`optionName1`(옵션명) 기준 폴백 매칭**을 반드시 넣고, 폴백으로 찾은 새 id를 `channel_link.json`에 갱신한다.
- 기존에 저장된 `channel_link.json` 항목(옵션 필드 없음)은 그대로 동작해야 한다(하위호환) — 마이그레이션 스크립트 없음.
- 이 개발 환경에서는 네이버/쿠팡 API가 IP 화이트리스트로 막혀 있다. 실제 API 호출이 필요한 검증은 GCP 인스턴스(`instance-20260709-123435`, zone `us-central1-a`, project `gen-lang-client-0363132726`, 원격 경로 `~/store/store/onepick-dashboard/`)에 SSH로 접속해서 진행한다. 배포 시 동일 파일명이 이미 있으면 자동 덮어쓰기가 안 되니 업로드 전 `rm -f`로 기존 파일을 지운다.

---

## File Structure

- `server.py` — 수정: `_compute_price_changes`/`_prices_equal`(순수 함수), `/api/margin/update`(확장), `ChannelLinkIn`/`create_channel_link`(옵션 필드), `/api/coupang/products/{seller_product_id}`(신규 라우트), `/api/channel-price-sync`(신규 라우트).
- `apis/coupang_api.py` — 수정: `_round_price_to_10`(순수 함수), `update_coupang_item_price`(신규).
- `apis/naver_api.py` — 수정: `_match_option_combination`(순수 함수), `update_naver_option_prices`(신규, 배치 처리), `update_naver_sale_price`(신규, 옵션 없는 상품용).
- `frontend/src/components/MarginTab.jsx` — 수정: 채널연결 모달에 옵션 선택 UI, `handleConnectSelected`/`handleSyncPrices` payload 확장.
- `tests/test_price_changes.py` — 신규: `_compute_price_changes`/`_prices_equal` 단위테스트.
- `tests/test_coupang_price.py` — 신규: `_round_price_to_10`, `update_coupang_item_price` 단위테스트(HTTP는 monkeypatch).
- `tests/test_naver_option_price.py` — 신규: `_match_option_combination`, `update_naver_option_prices`, `update_naver_sale_price` 단위테스트(HTTP는 monkeypatch).

---

### Task 1: `/api/margin/update` — price_changes 순수 계산 로직

**Files:**
- Modify: `server.py` (기존 `def clean_dataframe(df):` 바로 위, 대략 94번째 줄 근처에 추가)
- Test: `tests/test_price_changes.py`

**Interfaces:**
- Produces: `_prices_equal(a, b) -> bool`, `_compute_price_changes(old_rows: list[dict], new_rows: list[dict], channel_links: dict) -> list[dict]`. 각 결과 dict: `{product_name, channel, channel_id, channel_name, option_id, option_name, vendor_item_id, old_price, new_price}`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_price_changes.py` (신규 파일, 저장소 루트에 `tests/` 디렉터리도 함께 생성):

```python
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import _compute_price_changes, _prices_equal


class TestPricesEqual(unittest.TestCase):
    def test_equal_numeric_and_string(self):
        self.assertTrue(_prices_equal(5000, "5000"))
        self.assertTrue(_prices_equal(5000.0, 5000))

    def test_not_equal(self):
        self.assertFalse(_prices_equal(5000, 5300))

    def test_missing_values_are_not_equal(self):
        self.assertFalse(_prices_equal(None, 5000))
        self.assertFalse(_prices_equal("", 5000))
        self.assertFalse(_prices_equal(5000, ""))


class TestComputePriceChanges(unittest.TestCase):
    def setUp(self):
        self.channel_links = {
            "다이아몬드 빵가루새우(투톤)": {
                "naver": {"id": "11060989411", "name": "다이아몬드...", "option_id": "31838214078", "option_name": "50g"},
                "coupang": {"id": "999", "name": "다이아몬드...", "vendor_item_id": "12345678"},
            }
        }

    def test_no_channel_link_is_skipped(self):
        old_rows = [{"온라인 상품명": "연결 안 된 상품", "네이버 판매가": 1000}]
        new_rows = [{"온라인 상품명": "연결 안 된 상품", "네이버 판매가": 2000}]
        self.assertEqual(_compute_price_changes(old_rows, new_rows, self.channel_links), [])

    def test_unchanged_price_is_skipped(self):
        old_rows = [{"온라인 상품명": "다이아몬드 빵가루새우(투톤)", "네이버 판매가": 5000, "쿠팡 판매가": 7000}]
        new_rows = [{"온라인 상품명": "다이아몬드 빵가루새우(투톤)", "네이버 판매가": 5000, "쿠팡 판매가": 7000}]
        self.assertEqual(_compute_price_changes(old_rows, new_rows, self.channel_links), [])

    def test_changed_price_produces_change_with_option_fields(self):
        old_rows = [{"온라인 상품명": "다이아몬드 빵가루새우(투톤)", "네이버 판매가": 5000, "쿠팡 판매가": 7000}]
        new_rows = [{"온라인 상품명": "다이아몬드 빵가루새우(투톤)", "네이버 판매가": 5300, "쿠팡 판매가": 7000}]
        changes = _compute_price_changes(old_rows, new_rows, self.channel_links)
        self.assertEqual(len(changes), 1)
        c = changes[0]
        self.assertEqual(c["channel"], "naver")
        self.assertEqual(c["old_price"], 5000)
        self.assertEqual(c["new_price"], 5300)
        self.assertEqual(c["option_id"], "31838214078")
        self.assertEqual(c["option_name"], "50g")
        self.assertIsNone(c["vendor_item_id"])

    def test_no_old_row_means_old_price_is_none(self):
        old_rows = []
        new_rows = [{"온라인 상품명": "다이아몬드 빵가루새우(투톤)", "네이버 판매가": 5300, "쿠팡 판매가": 7000}]
        changes = _compute_price_changes(old_rows, new_rows, self.channel_links)
        channels = {c["channel"]: c for c in changes}
        self.assertIsNone(channels["naver"]["old_price"])
        self.assertEqual(channels["coupang"]["vendor_item_id"], "12345678")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `python -m unittest tests.test_price_changes -v`
Expected: `ImportError: cannot import name '_compute_price_changes' from 'server'` (아직 없음)

- [ ] **Step 3: 최소 구현 작성**

`server.py`에 `def clean_dataframe(df):` 정의 바로 위에 추가:

```python
CHANNEL_PRICE_COLUMNS = {"naver": "네이버 판매가", "coupang": "쿠팡 판매가", "sikbom": "식봄 판매가"}


def _prices_equal(a, b):
    if a is None or a == "" or b is None or b == "":
        return False
    try:
        return float(a) == float(b)
    except (TypeError, ValueError):
        return str(a) == str(b)


def _compute_price_changes(old_rows, new_rows, channel_links):
    """이전 저장본과 새 저장본을 상품명 기준으로 비교해서, 채널연결된 상품×채널 중
    최종 판매가가 달라진 것만 골라 price_changes 리스트로 만든다."""
    def product_name_of(row):
        return str(row.get("온라인 상품명") or row.get("상품명") or "").strip()

    old_by_name = {}
    for row in old_rows:
        name = product_name_of(row)
        if name:
            old_by_name[name] = row

    changes = []
    for row in new_rows:
        product_name = product_name_of(row)
        if not product_name:
            continue
        links = channel_links.get(product_name)
        if not links:
            continue
        old_row = old_by_name.get(product_name)
        for channel, price_col in CHANNEL_PRICE_COLUMNS.items():
            link = links.get(channel)
            if not link:
                continue
            new_price = row.get(price_col)
            if new_price is None or new_price == "":
                continue
            old_price = None
            if old_row is not None:
                candidate_old = old_row.get(price_col)
                if _prices_equal(candidate_old, new_price):
                    continue
                if candidate_old not in (None, ""):
                    old_price = candidate_old
            changes.append({
                "product_name": product_name,
                "channel": channel,
                "channel_id": link.get("id"),
                "channel_name": link.get("name", ""),
                "option_id": link.get("option_id"),
                "option_name": link.get("option_name"),
                "vendor_item_id": link.get("vendor_item_id"),
                "old_price": old_price,
                "new_price": new_price,
            })
    return changes
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `python -m unittest tests.test_price_changes -v`
Expected: `OK` (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add server.py tests/test_price_changes.py
git commit -m "feat: price_changes 계산 순수 로직 추가 (옵션 필드 포함)"
```

---

### Task 2: `/api/margin/update`에 price_changes 응답 연결

**Files:**
- Modify: `server.py:331-341` (`@app.post("/api/margin/update")` 라우트)

**Interfaces:**
- Consumes: Task 1의 `_compute_price_changes(old_rows, new_rows, channel_links)`, 기존 `_load_json_file(path, default)` (server.py:1577 근처, 이미 존재), `CHANNEL_LINK_FILE`(server.py:1836 근처, 이미 존재).
- Produces: `/api/margin/update` 응답에 `price_changes: list[dict]` 필드 추가 (기존 `{"status": "success"}` 유지, 필드만 추가라 프론트 하위호환).

- [ ] **Step 1: 기존 동작 확인 (수동)**

지금은 `price_changes`가 없다는 걸 재확인:
Run: `python -c "import server; import inspect; print('price_changes' in inspect.getsource(server.update_margin))"`
Expected: `False`

- [ ] **Step 2: 라우트 구현 교체**

`server.py`의 기존
```python
@app.post("/api/margin/update")
async def update_margin(request: Request):
    global current_margin_data
    try:
        data = await request.json()
        current_margin_data = data.get("data", [])
        df = pd.DataFrame(current_margin_data)
        df = clean_dataframe(df) 
        df.to_csv(MARGIN_FILE_PATH, index=False, encoding='utf-8-sig')
        return {"status": "success"}
    except Exception as e: return {"status": "error", "message": str(e)}
```
를 아래로 교체:
```python
@app.post("/api/margin/update")
async def update_margin(request: Request):
    global current_margin_data
    try:
        data = await request.json()
        new_rows = data.get("data", [])

        old_rows = []
        if os.path.exists(MARGIN_FILE_PATH):
            try:
                old_df = pd.read_csv(MARGIN_FILE_PATH)
                old_df = clean_dataframe(old_df)
                old_rows = old_df.to_dict(orient="records")
            except Exception as e:
                print(f"[가격변경감지] 이전 단가표 읽기 실패(무시하고 계속): {e}")

        channel_links = _load_json_file(CHANNEL_LINK_FILE, {})
        price_changes = _compute_price_changes(old_rows, new_rows, channel_links)

        current_margin_data = new_rows
        df = pd.DataFrame(current_margin_data)
        df = clean_dataframe(df)
        df.to_csv(MARGIN_FILE_PATH, index=False, encoding='utf-8-sig')
        return {"status": "success", "price_changes": price_changes}
    except Exception as e: return {"status": "error", "message": str(e)}
```

`CHANNEL_LINK_FILE`/`_load_json_file`은 이 함수보다 파일 뒤쪽(약 1577/1836번째 줄)에 정의돼 있지만, 함수 본문 안에서 호출 시점에 이름을 찾기 때문에(모듈 레벨 이름은 실행 시점에 존재하면 됨) 문제 없다.

- [ ] **Step 3: 수동 통합 테스트**

Run (저장소 루트에서, 서버 켜지 않고 함수만 직접 호출):
```bash
python -c "
import json, os
os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
import server

# 임시로 channel_link.json에 테스트용 연결 하나 심어두고 실행 (실제 파일은 건드리지 않도록 백업/복원)
import shutil
backup = None
if os.path.exists('channel_link.json'):
    backup = open('channel_link.json', encoding='utf-8').read()
try:
    with open('channel_link.json', 'w', encoding='utf-8') as f:
        json.dump({'테스트상품': {'naver': {'id': '1', 'name': 'n', 'option_id': 'o1', 'option_name': '50g'}}}, f, ensure_ascii=False)

    old_rows = [{'온라인 상품명': '테스트상품', '네이버 판매가': 5000}]
    new_rows = [{'온라인 상품명': '테스트상품', '네이버 판매가': 5300}]
    channel_links = server._load_json_file('channel_link.json', {})
    changes = server._compute_price_changes(old_rows, new_rows, channel_links)
    print(json.dumps(changes, ensure_ascii=False, indent=2))
    assert len(changes) == 1 and changes[0]['new_price'] == 5300
    print('OK')
finally:
    if backup is not None:
        with open('channel_link.json', 'w', encoding='utf-8') as f:
            f.write(backup)
    else:
        os.remove('channel_link.json')
"
```
Expected: 마지막 줄에 `OK` 출력, `channel_link.json`은 실행 전 상태로 복원됨.

- [ ] **Step 4: 커밋**

```bash
git add server.py
git commit -m "feat: /api/margin/update가 price_changes를 계산해서 응답에 포함"
```

---

### Task 3: `channel_link.json`에 옵션 식별자 저장 (하위호환)

**Files:**
- Modify: `server.py:1893-1919` (`ChannelLinkIn` 모델, `create_channel_link`)
- Test: 수동 curl (아래)

**Interfaces:**
- Produces: `POST /api/channel-link`가 `option_id`/`option_name`/`vendor_item_id`(모두 optional)를 받아 저장. 값이 없으면 기존처럼 저장(필드 자체를 안 넣음 — 하위호환).

- [ ] **Step 1: 기존 모델/라우트 확인**

`server.py:1893`부터:
```python
class ChannelLinkIn(BaseModel):
    product_name: str
    channel: str
    channel_id: str
    channel_name: str


@app.post("/api/channel-link")
def create_channel_link(payload: ChannelLinkIn):
    product_name = payload.product_name.strip()
    channel = payload.channel.strip()
    if not product_name or channel not in CHANNEL_LINK_CHANNELS:
        return {"status": "error", "message": f"product_name이 비어있거나 channel이 {CHANNEL_LINK_CHANNELS} 중 하나가 아닙니다."}

    import datetime
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with _channel_link_lock:
        data = _load_json_file(CHANNEL_LINK_FILE, {})
        data.setdefault(product_name, {})[channel] = {
            "id": payload.channel_id,
            "name": payload.channel_name,
            "linked_at": now_str,
        }
        _save_json_file(CHANNEL_LINK_FILE, data)

    return {"status": "success", "data": data[product_name]}
```

- [ ] **Step 2: 교체**

```python
class ChannelLinkIn(BaseModel):
    product_name: str
    channel: str
    channel_id: str
    channel_name: str
    option_id: str | None = None
    option_name: str | None = None
    vendor_item_id: str | None = None


@app.post("/api/channel-link")
def create_channel_link(payload: ChannelLinkIn):
    product_name = payload.product_name.strip()
    channel = payload.channel.strip()
    if not product_name or channel not in CHANNEL_LINK_CHANNELS:
        return {"status": "error", "message": f"product_name이 비어있거나 channel이 {CHANNEL_LINK_CHANNELS} 중 하나가 아닙니다."}

    import datetime
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    entry = {
        "id": payload.channel_id,
        "name": payload.channel_name,
        "linked_at": now_str,
    }
    if payload.option_id:
        entry["option_id"] = payload.option_id
    if payload.option_name:
        entry["option_name"] = payload.option_name
    if payload.vendor_item_id:
        entry["vendor_item_id"] = payload.vendor_item_id

    with _channel_link_lock:
        data = _load_json_file(CHANNEL_LINK_FILE, {})
        data.setdefault(product_name, {})[channel] = entry
        _save_json_file(CHANNEL_LINK_FILE, data)

    return {"status": "success", "data": data[product_name]}
```

- [ ] **Step 3: 서버 띄우고 수동 검증**

```bash
uvicorn server:app --reload &
sleep 2
curl -s -X POST http://127.0.0.1:8000/api/channel-link -H "Content-Type: application/json" -d '{"product_name":"__plan_test__","channel":"naver","channel_id":"111","channel_name":"테스트","option_id":"o1","option_name":"50g"}'
curl -s -X POST http://127.0.0.1:8000/api/channel-link -H "Content-Type: application/json" -d '{"product_name":"__plan_test__","channel":"coupang","channel_id":"222","channel_name":"테스트"}'
curl -s http://127.0.0.1:8000/api/channel-link
curl -s -X DELETE "http://127.0.0.1:8000/api/channel-link/naver?product_name=__plan_test__"
curl -s -X DELETE "http://127.0.0.1:8000/api/channel-link/coupang?product_name=__plan_test__"
kill %1
```
Expected: 첫 GET 응답에 `naver` 항목엔 `option_id`/`option_name`이 있고, `coupang` 항목엔 옵션 필드가 아예 없는 것을 확인. 마지막 두 DELETE로 테스트 데이터 정리.

- [ ] **Step 4: 커밋**

```bash
git add server.py
git commit -m "feat: channel_link.json에 옵션 식별자(option_id/option_name/vendor_item_id) 저장 지원"
```

---

### Task 4: 쿠팡 상품 상세조회 라우트 추가

**Files:**
- Modify: `server.py` (네이버 상세조회 라우트 `@app.get("/api/naver/products/{channel_no}")` 바로 아래에 추가, server.py:356-360 근처)

**Interfaces:**
- Consumes: 기존 `coupang_api.get_coupang_product_detail(seller_product_id)` (apis/coupang_api.py:190, 이미 존재).
- Produces: `GET /api/coupang/products/{seller_product_id}` → `{"status": "success", "data": {...}}` (쿠팡 API 원본 `data` 그대로, `items[]` 포함) 또는 `{"status": "error", "message": "..."}`.

- [ ] **Step 1: 라우트 추가**

`server.py`의
```python
@app.get("/api/naver/products/{channel_no}")
def get_naver_product_detail(channel_no: str):
    data = naver_api.get_naver_product_detail(channel_no)
    if data: return {"status": "success", "data": data}
    return {"status": "error", "message": "상세 정보 불러오기 실패"}
```
바로 아래에 추가:
```python
@app.get("/api/coupang/products/{seller_product_id}")
def get_coupang_product_detail_route(seller_product_id: str):
    data = coupang_api.get_coupang_product_detail(seller_product_id)
    if data: return {"status": "success", "data": data}
    return {"status": "error", "message": "상세 정보 불러오기 실패"}
```

- [ ] **Step 2: 수동 검증 (이 개발 환경은 쿠팡 API가 IP 차단이라 형식만 확인)**

```bash
uvicorn server:app --reload &
sleep 2
curl -s http://127.0.0.1:8000/api/coupang/products/0
kill %1
```
Expected: `{"status":"error","message":"상세 정보 불러오기 실패"}` (실제 IP 차단이든 존재하지 않는 ID든, 라우트 자체가 500 없이 정상적으로 에러 응답을 만드는지만 확인). 실제 데이터 검증은 Task 11(GCP)에서 진행.

- [ ] **Step 3: 커밋**

```bash
git add server.py
git commit -m "feat: 쿠팡 상품 상세조회 라우트(/api/coupang/products/{id}) 추가"
```

---

### Task 5: 쿠팡 옵션 가격 변경 함수

**Files:**
- Modify: `apis/coupang_api.py` (`get_coupang_product_detail` 함수 바로 아래, apis/coupang_api.py:204 근처)
- Test: `tests/test_coupang_price.py`

**Interfaces:**
- Produces: `_round_price_to_10(price: float) -> int`, `update_coupang_item_price(vendor_item_id: str, price: float) -> tuple[bool, str]`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_coupang_price.py`:
```python
import os
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from apis import coupang_api


class TestRoundPriceTo10(unittest.TestCase):
    def test_rounds_to_nearest_10(self):
        self.assertEqual(coupang_api._round_price_to_10(5304), 5300)
        self.assertEqual(coupang_api._round_price_to_10(5305), 5310)
        self.assertEqual(coupang_api._round_price_to_10(5300), 5300)


class TestUpdateCoupangItemPrice(unittest.TestCase):
    @patch.object(coupang_api, "VENDOR_ID", "v1")
    @patch.object(coupang_api, "ACCESS_KEY", "a1")
    @patch.object(coupang_api, "SECRET_KEY", "s1")
    @patch.object(coupang_api, "_request")
    def test_success(self, mock_request):
        mock_res = MagicMock()
        mock_res.status_code = 200
        mock_request.return_value = mock_res

        ok, msg = coupang_api.update_coupang_item_price("12345678", 5304)

        self.assertTrue(ok)
        called_url = mock_request.call_args.args[1]
        self.assertIn("/vendor-items/12345678/prices/5300", called_url)

    @patch.object(coupang_api, "VENDOR_ID", "v1")
    @patch.object(coupang_api, "ACCESS_KEY", "a1")
    @patch.object(coupang_api, "SECRET_KEY", "s1")
    @patch.object(coupang_api, "_request")
    def test_failure_returns_message(self, mock_request):
        mock_res = MagicMock()
        mock_res.status_code = 400
        mock_res.text = "가격 변경 제한 초과"
        mock_request.return_value = mock_res

        ok, msg = coupang_api.update_coupang_item_price("12345678", 5304)

        self.assertFalse(ok)
        self.assertIn("가격 변경 제한 초과", msg)

    def test_missing_credentials(self):
        with patch.object(coupang_api, "VENDOR_ID", None):
            ok, msg = coupang_api.update_coupang_item_price("12345678", 5304)
            self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `python -m unittest tests.test_coupang_price -v`
Expected: `AttributeError: module 'apis.coupang_api' has no attribute '_round_price_to_10'`

- [ ] **Step 3: 최소 구현 작성**

`apis/coupang_api.py`의 `get_coupang_product_detail` 함수(현재 파일 190-204번째 줄) 바로 아래에 추가:

```python
def _round_price_to_10(price):
    """쿠팡 가격변경 API는 10원 단위만 허용한다."""
    return int(round(float(price) / 10.0)) * 10


def update_coupang_item_price(vendor_item_id, price):
    """옵션(vendorItemId) 단위 판매가격 변경. 요청 바디 없음, 가격은 10원 단위로 반올림해서 보낸다."""
    if not all([VENDOR_ID, ACCESS_KEY, SECRET_KEY]):
        return False, "쿠팡 API 키(COUPANG_VENDOR_ID/ACCESS_KEY/SECRET_KEY)가 config.py에 설정되지 않았습니다."
    if not vendor_item_id:
        return False, "vendor_item_id가 없습니다."

    rounded_price = _round_price_to_10(price)
    uri = f"/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/{vendor_item_id}/prices/{rounded_price}"
    url = f"https://api-gateway.coupang.com{uri}"
    auth_header = generate_coupang_signature("PUT", uri)
    headers = {"Authorization": auth_header, "Content-Type": "application/json;charset=UTF-8", "Accept": "application/json"}

    res = _request("PUT", url, headers=headers)
    if res.status_code == 200:
        return True, "성공"
    return False, f"쿠팡 거부: HTTP {res.status_code} — {res.text[:300]}"
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `python -m unittest tests.test_coupang_price -v`
Expected: `OK` (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add apis/coupang_api.py tests/test_coupang_price.py
git commit -m "feat: 쿠팡 vendorItemId 단위 가격 변경 함수 추가"
```

---

### Task 6: 네이버 옵션 매칭 순수 로직 (id → 이름 폴백)

**Files:**
- Modify: `apis/naver_api.py` (`get_naver_product_detail` 함수 바로 아래, apis/naver_api.py:277 근처)
- Test: `tests/test_naver_option_price.py` (이 파일은 Task 7에서 이어서 채운다)

**Interfaces:**
- Produces: `_match_option_combination(combinations: list[dict], option_id: str | None, option_name: str | None) -> dict | None`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_naver_option_price.py` (신규):
```python
import os
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from apis import naver_api


class TestMatchOptionCombination(unittest.TestCase):
    def setUp(self):
        self.combinations = [
            {"id": 111, "optionName1": "30g", "price": 0},
            {"id": 222, "optionName1": "50g", "price": 300},
        ]

    def test_match_by_id(self):
        found = naver_api._match_option_combination(self.combinations, "222", "이름은틀림")
        self.assertEqual(found["id"], 222)

    def test_fallback_to_name_when_id_not_found(self):
        found = naver_api._match_option_combination(self.combinations, "999", "50g")
        self.assertEqual(found["id"], 222)

    def test_no_match_returns_none(self):
        found = naver_api._match_option_combination(self.combinations, "999", "없는옵션")
        self.assertIsNone(found)

    def test_no_option_id_uses_name_directly(self):
        found = naver_api._match_option_combination(self.combinations, None, "30g")
        self.assertEqual(found["id"], 111)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `python -m unittest tests.test_naver_option_price -v`
Expected: `AttributeError: module 'apis.naver_api' has no attribute '_match_option_combination'`

- [ ] **Step 3: 최소 구현 작성**

`apis/naver_api.py`의 `get_naver_product_detail` 함수(현재 파일 268-277번째 줄) 바로 아래에 추가:

```python
def _match_option_combination(combinations, option_id, option_name):
    """optionCombinations 리스트에서 대상 옵션을 찾는다.
    1순위: option_id와 combo['id']가 일치. 2순위(폴백): option_name과 combo['optionName1']이 일치.
    id가 PUT 이후에도 유지되는지 문서로 확증 안 돼서, id가 안 맞을 가능성에 대비한 폴백이다."""
    requested_id = str(option_id) if option_id else None
    if requested_id:
        found = next((c for c in combinations if str(c.get("id")) == requested_id), None)
        if found is not None:
            return found
    if option_name:
        return next((c for c in combinations if str(c.get("optionName1")) == str(option_name)), None)
    return None
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `python -m unittest tests.test_naver_option_price -v`
Expected: `OK` (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add apis/naver_api.py tests/test_naver_option_price.py
git commit -m "feat: 네이버 옵션 id→이름 폴백 매칭 순수 로직 추가"
```

---

### Task 7: 네이버 옵션 배치 가격 갱신 + 대표가 갱신 함수

**Files:**
- Modify: `apis/naver_api.py` (Task 6에서 추가한 `_match_option_combination` 바로 아래)
- Test: `tests/test_naver_option_price.py` (Task 6 파일에 이어서 추가)

**Interfaces:**
- Consumes: `_match_option_combination`(Task 6), 기존 `get_access_token()`, `_request()`.
- Produces:
  - `update_naver_option_prices(channel_product_no: str, option_updates: list[dict]) -> list[dict]` — `option_updates` 항목: `{"option_id": str|None, "option_name": str|None, "new_price": int}`(목표 절대가). 반환 항목: `{"option_id", "option_name", "success": bool, "message": str, "matched_option_id": str|None}`.
  - `update_naver_sale_price(channel_product_no: str, new_price: int) -> tuple[bool, str]`.

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/test_naver_option_price.py`에 이어서 추가 (파일 끝의 `if __name__ ==` 위에 삽입):

```python
class TestUpdateNaverOptionPrices(unittest.TestCase):
    def _detail_response(self):
        res = MagicMock()
        res.status_code = 200
        res.json.return_value = {
            "originProduct": {
                "originProductNo": "9999",
                "name": "테스트상품",
                "salePrice": 5000,
                "stockQuantity": 10,
                "detailContent": "내용",
                "detailAttribute": {},
                "deliveryInfo": {},
                "optionInfo": {
                    "optionCombinations": [
                        {"id": 111, "optionName1": "30g", "price": 0},
                        {"id": 222, "optionName1": "50g", "price": 300},
                    ]
                },
            }
        }
        return res

    @patch.object(naver_api, "get_access_token", return_value="tok")
    @patch.object(naver_api, "_request")
    def test_batches_multiple_options_into_one_get_and_one_put(self, mock_request, mock_token):
        get_res = self._detail_response()
        put_res = MagicMock()
        put_res.status_code = 200
        mock_request.side_effect = [get_res, put_res]

        results = naver_api.update_naver_option_prices("channel1", [
            {"option_id": "111", "option_name": "30g", "new_price": 5100},
            {"option_id": "222", "option_name": "50g", "new_price": 5400},
        ])

        self.assertEqual(mock_request.call_count, 2)  # GET 1회 + PUT 1회
        self.assertTrue(all(r["success"] for r in results))

        put_call = mock_request.call_args_list[1]
        self.assertEqual(put_call.args[0], "PUT")
        sent_payload = put_call.kwargs["json"]
        combos_by_id = {c["id"]: c for c in sent_payload["optionInfo"]["optionCombinations"]}
        self.assertEqual(combos_by_id[111]["price"], 5100 - 5000)
        self.assertEqual(combos_by_id[222]["price"], 5400 - 5000)

    @patch.object(naver_api, "get_access_token", return_value="tok")
    @patch.object(naver_api, "_request")
    def test_fallback_match_reports_matched_option_id(self, mock_request, mock_token):
        get_res = self._detail_response()
        put_res = MagicMock()
        put_res.status_code = 200
        mock_request.side_effect = [get_res, put_res]

        # option_id가 안 맞아서 이름("50g")으로 폴백 매칭돼야 함
        results = naver_api.update_naver_option_prices("channel1", [
            {"option_id": "stale-id", "option_name": "50g", "new_price": 5400},
        ])

        self.assertTrue(results[0]["success"])
        self.assertEqual(results[0]["matched_option_id"], 222)

    @patch.object(naver_api, "get_access_token", return_value="tok")
    @patch.object(naver_api, "_request")
    def test_unmatched_option_fails_without_blocking_others(self, mock_request, mock_token):
        get_res = self._detail_response()
        put_res = MagicMock()
        put_res.status_code = 200
        mock_request.side_effect = [get_res, put_res]

        results = naver_api.update_naver_option_prices("channel1", [
            {"option_id": "111", "option_name": "30g", "new_price": 5100},
            {"option_id": "no-match", "option_name": "없는옵션", "new_price": 9999},
        ])

        self.assertTrue(results[0]["success"])
        self.assertFalse(results[1]["success"])
        self.assertIn("옵션을 찾을 수 없음", results[1]["message"])


class TestUpdateNaverSalePrice(unittest.TestCase):
    @patch.object(naver_api, "get_access_token", return_value="tok")
    @patch.object(naver_api, "_request")
    def test_updates_sale_price_only(self, mock_request, mock_token):
        get_res = MagicMock()
        get_res.status_code = 200
        get_res.json.return_value = {"originProduct": {
            "originProductNo": "9999", "name": "테스트상품", "salePrice": 5000,
            "stockQuantity": 10, "detailContent": "내용", "detailAttribute": {}, "deliveryInfo": {},
        }}
        put_res = MagicMock()
        put_res.status_code = 200
        mock_request.side_effect = [get_res, put_res]

        ok, msg = naver_api.update_naver_sale_price("channel1", 6000)

        self.assertTrue(ok)
        put_call = mock_request.call_args_list[1]
        self.assertEqual(put_call.kwargs["json"]["salePrice"], 6000)
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `python -m unittest tests.test_naver_option_price -v`
Expected: `AttributeError: module 'apis.naver_api' has no attribute 'update_naver_option_prices'`

- [ ] **Step 3: 최소 구현 작성**

`apis/naver_api.py`의 `_match_option_combination` 바로 아래에 추가:

```python
def update_naver_option_prices(channel_product_no, option_updates):
    """같은 상품(channel_product_no)의 여러 옵션 가격을 GET 1회 + PUT 1회로 한번에 갱신한다.
    옵션마다 따로 GET→PUT 하면 뒤의 PUT이 앞의 PUT을 못 보고 덮어써서 유실될 수 있어 반드시 배치로 처리한다.
    option_updates: [{"option_id": str|None, "option_name": str|None, "new_price": int(목표 절대가)}, ...]
    반환: [{"option_id", "option_name", "success", "message", "matched_option_id"}, ...] (요청 순서 유지)
    """
    def fail_all(message):
        return [{"option_id": u.get("option_id"), "option_name": u.get("option_name"),
                  "success": False, "message": message, "matched_option_id": None} for u in option_updates]

    try:
        token = get_access_token()
    except Exception as e:
        return fail_all(f"인증에러: {e}")
    if not token:
        return fail_all("토큰 실패")

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"https://api.commerce.naver.com/external/v2/products/channel-products/{channel_product_no}"
    res = _request("GET", url, headers=headers)
    if res.status_code != 200:
        return fail_all(f"조회실패: {res.text[:200]}")

    data = res.json()
    origin = data.get("originProduct", {}) or {}
    origin_no = origin.get("originProductNo")
    sale_price = origin.get("salePrice")
    option_info = origin.get("optionInfo") or {}
    combinations = option_info.get("optionCombinations") or []

    if not origin_no or sale_price is None or not combinations:
        return fail_all("originProductNo/salePrice/optionCombinations 정보를 찾을 수 없습니다.")

    results = []
    for update in option_updates:
        target = _match_option_combination(combinations, update.get("option_id"), update.get("option_name"))
        if target is None:
            results.append({"option_id": update.get("option_id"), "option_name": update.get("option_name"),
                             "success": False, "message": "옵션을 찾을 수 없음(id/이름 모두 불일치)", "matched_option_id": None})
            continue
        target["price"] = int(update["new_price"]) - int(sale_price)
        results.append({"option_id": update.get("option_id"), "option_name": update.get("option_name"),
                         "success": True, "message": "PUT 대기", "matched_option_id": target.get("id")})

    if not any(r["success"] for r in results):
        return results

    # id 필드를 그대로 유지한 채 price만 바꿔서 되돌려 보낸다.
    # optionCombinationSortType(예: "CREATE")을 쓰면 전체가 새로 생성되며 id가 바뀔 위험이 있어 일부러 안 보낸다 —
    # 이 가정이 맞는지는 문서로 확증 못 했고, 실제 PUT 테스트로 검증해야 한다(계획 마지막 태스크).
    option_info["optionCombinations"] = combinations
    option_info.pop("optionCombinationSortType", None)

    update_payload = {
        "name": origin.get("name"),
        "salePrice": int(sale_price),
        "stockQuantity": origin.get("stockQuantity"),
        "detailContent": origin.get("detailContent", " "),
        "detailAttribute": origin.get("detailAttribute", {}),
        "deliveryInfo": origin.get("deliveryInfo", {}),
        "optionInfo": option_info,
    }
    if origin.get("leafCategoryId"):
        update_payload["leafCategoryId"] = str(origin["leafCategoryId"])
    if origin.get("images"):
        update_payload["images"] = origin["images"]

    put_res = _request("PUT", f"https://api.commerce.naver.com/external/v2/products/origin-products/{origin_no}", headers=headers, json=update_payload)
    put_ok = put_res.status_code == 200
    put_msg = "성공" if put_ok else f"네이버 거부: {put_res.text[:300]}"
    for r in results:
        if r["success"]:
            r["success"] = put_ok
            r["message"] = put_msg
    return results


def update_naver_sale_price(channel_product_no, new_price):
    """옵션 없는 네이버 상품의 대표가격(salePrice)만 갱신한다."""
    try:
        token = get_access_token()
    except Exception as e:
        return False, f"인증에러: {e}"
    if not token:
        return False, "토큰 실패"

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"https://api.commerce.naver.com/external/v2/products/channel-products/{channel_product_no}"
    res = _request("GET", url, headers=headers)
    if res.status_code != 200:
        return False, f"조회실패: {res.text[:200]}"

    data = res.json()
    origin = data.get("originProduct", {}) or {}
    origin_no = origin.get("originProductNo")
    if not origin_no:
        return False, "originProductNo 정보를 찾을 수 없습니다."

    update_payload = {
        "name": origin.get("name"),
        "salePrice": int(new_price),
        "stockQuantity": origin.get("stockQuantity"),
        "detailContent": origin.get("detailContent", " "),
        "detailAttribute": origin.get("detailAttribute", {}),
        "deliveryInfo": origin.get("deliveryInfo", {}),
    }
    if origin.get("leafCategoryId"):
        update_payload["leafCategoryId"] = str(origin["leafCategoryId"])
    if origin.get("images"):
        update_payload["images"] = origin["images"]
    if origin.get("optionInfo"):
        update_payload["optionInfo"] = origin["optionInfo"]

    put_res = _request("PUT", f"https://api.commerce.naver.com/external/v2/products/origin-products/{origin_no}", headers=headers, json=update_payload)
    if put_res.status_code == 200:
        return True, "성공"
    return False, f"네이버 거부: {put_res.text[:300]}"
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `python -m unittest tests.test_naver_option_price -v`
Expected: `OK` (8 tests: Task 6의 4개 + 이번 4개)

- [ ] **Step 5: 커밋**

```bash
git add apis/naver_api.py tests/test_naver_option_price.py
git commit -m "feat: 네이버 옵션 배치 가격 갱신(GET 1회+PUT 1회) 및 대표가 갱신 함수 추가"
```

---

### Task 8: `/api/channel-price-sync` 엔드포인트

**Files:**
- Modify: `server.py` (`/api/channel-link` 관련 라우트들 바로 아래, server.py:1928 이후, `_channel_link_lock` 정의된 뒤)

**Interfaces:**
- Consumes: `naver_api.update_naver_option_prices`, `naver_api.update_naver_sale_price`(Task 7), `coupang_api.update_coupang_item_price`(Task 5), `_load_json_file`/`_save_json_file`/`_channel_link_lock`/`CHANNEL_LINK_FILE`(기존).
- Produces: `POST /api/channel-price-sync` — 요청 `{"changes": [{"product_name","channel","channel_id","channel_name","option_id","option_name","vendor_item_id","new_price"}, ...]}` → 응답 `{"status": "success", "results": [{"product_name","channel","option_name","success","message"}, ...]}` (프론트의 `data.results` 기대 형식과 동일).

- [ ] **Step 1: 모델/라우트 추가**

`server.py`의 `@app.delete("/api/channel-link/{channel}")` 라우트(server.py:1928 근처) 바로 아래에 추가:

```python
class ChannelPriceSyncChange(BaseModel):
    product_name: str
    channel: str
    channel_id: str | None = None
    channel_name: str | None = None
    option_id: str | None = None
    option_name: str | None = None
    vendor_item_id: str | None = None
    new_price: float


class ChannelPriceSyncIn(BaseModel):
    changes: list[ChannelPriceSyncChange]


@app.post("/api/channel-price-sync")
def channel_price_sync(payload: ChannelPriceSyncIn):
    results = []

    coupang_changes = [c for c in payload.changes if c.channel == "coupang"]
    naver_changes = [c for c in payload.changes if c.channel == "naver"]
    unsupported_changes = [c for c in payload.changes if c.channel not in ("coupang", "naver")]

    for c in coupang_changes:
        if not c.vendor_item_id:
            results.append({"product_name": c.product_name, "channel": c.channel, "option_name": c.option_name,
                             "success": False, "message": "vendor_item_id가 연결 정보에 없습니다. 채널연결을 다시 해주세요."})
            continue
        ok, msg = coupang_api.update_coupang_item_price(c.vendor_item_id, c.new_price)
        results.append({"product_name": c.product_name, "channel": c.channel, "option_name": c.option_name, "success": ok, "message": msg})

    # 네이버: channel_id(channelProductNo) 단위로 그룹핑해서 상품당 GET 1회 + PUT 1회로 처리한다.
    naver_groups = {}
    for c in naver_changes:
        naver_groups.setdefault(c.channel_id, []).append(c)

    channel_link_id_fixes = []  # (product_name, old_option_id, new_option_id) — 폴백 매칭으로 id가 갱신된 것들

    for channel_id, group in naver_groups.items():
        with_option = [c for c in group if c.option_id or c.option_name]
        without_option = [c for c in group if not (c.option_id or c.option_name)]

        if with_option:
            option_updates = [{"option_id": c.option_id, "option_name": c.option_name, "new_price": c.new_price} for c in with_option]
            option_results = naver_api.update_naver_option_prices(channel_id, option_updates)
            for c, r in zip(with_option, option_results):
                results.append({"product_name": c.product_name, "channel": "naver", "option_name": c.option_name,
                                 "success": r["success"], "message": r["message"]})
                if r["success"] and r.get("matched_option_id") is not None and str(r["matched_option_id"]) != str(c.option_id):
                    channel_link_id_fixes.append((c.product_name, c.option_id, str(r["matched_option_id"])))

        for c in without_option:
            ok, msg = naver_api.update_naver_sale_price(channel_id, c.new_price)
            results.append({"product_name": c.product_name, "channel": "naver", "option_name": None, "success": ok, "message": msg})

    for c in unsupported_changes:
        results.append({"product_name": c.product_name, "channel": c.channel, "option_name": c.option_name,
                         "success": False, "message": f"'{c.channel}' 채널은 자동 가격 반영을 지원하지 않습니다."})

    if channel_link_id_fixes:
        with _channel_link_lock:
            link_data = _load_json_file(CHANNEL_LINK_FILE, {})
            for product_name, old_option_id, new_option_id in channel_link_id_fixes:
                entry = (link_data.get(product_name) or {}).get("naver")
                if entry and str(entry.get("option_id")) == str(old_option_id):
                    entry["option_id"] = new_option_id
            _save_json_file(CHANNEL_LINK_FILE, link_data)

    return {"status": "success", "results": results}
```

- [ ] **Step 2: 수동 검증 (모킹 없이, 그룹핑/분기 로직만 확인 — 실제 네이버/쿠팡 호출은 이 환경에서 IP 차단이라 에러로 끝나는 것까지만 확인)**

```bash
uvicorn server:app --reload &
sleep 2
curl -s -X POST http://127.0.0.1:8000/api/channel-price-sync -H "Content-Type: application/json" -d '{
  "changes": [
    {"product_name": "테스트", "channel": "sikbom", "new_price": 1000}
  ]
}'
kill %1
```
Expected: `results`에 `sikbom` 항목이 `"success": false`, `"message": "'sikbom' 채널은 자동 가격 반영을 지원하지 않습니다."`로 나오는 것을 확인 (분기 로직이 정확히 동작).

- [ ] **Step 3: 커밋**

```bash
git add server.py
git commit -m "feat: /api/channel-price-sync 구현 (네이버 상품단위 배치, 쿠팡 옵션단위 개별)"
```

---

### Task 9: 채널연결 모달 — 옵션 선택 UI

**Files:**
- Modify: `frontend/src/components/MarginTab.jsx`

**Interfaces:**
- Consumes: `GET /api/naver/products/{channel_no}`(기존), `GET /api/coupang/products/{seller_product_id}`(Task 4).
- Produces: 새 상태 `optionCandidates`, `selectedOptionByChannel`; `handleConnectSelected`가 보내는 POST 바디에 `option_id`/`option_name`/`vendor_item_id` 추가.

- [ ] **Step 1: 상태 추가**

`const [searchKeyword, setSearchKeyword] = useState("");` 바로 아래(현재 50번째 줄 근처)에 추가:
```js
const [optionCandidates, setOptionCandidates] = useState({}); // { naver: {loading, options:[{id,name}]}, coupang: {...} }
const [selectedOptionByChannel, setSelectedOptionByChannel] = useState({}); // { naver: {id,name}|null, coupang: {...} }
```

- [ ] **Step 2: 상세조회 → 옵션 목록 추출 함수 추가**

`closeLinkModal` 함수(현재 106-111번째 줄) 바로 아래에 추가:
```js
const fetchOptionCandidates = (channel, candidateId) => {
  if (channel === 'naver') {
    setOptionCandidates(prev => ({ ...prev, naver: { loading: true, options: [] } }));
    fetch(`${API_BASE}/api/naver/products/${encodeURIComponent(candidateId)}`, { headers: { 'ngrok-skip-browser-warning': '69420' } })
      .then(res => res.json())
      .then(data => {
        const combos = data.status === 'success'
          ? ((data.data?.originProduct?.optionInfo?.optionCombinations) || [])
          : [];
        setOptionCandidates(prev => ({ ...prev, naver: { loading: false, options: combos.map(c => ({ id: String(c.id), name: c.optionName1 })) } }));
      })
      .catch(() => setOptionCandidates(prev => ({ ...prev, naver: { loading: false, options: [] } })));
  } else if (channel === 'coupang') {
    setOptionCandidates(prev => ({ ...prev, coupang: { loading: true, options: [] } }));
    fetch(`${API_BASE}/api/coupang/products/${encodeURIComponent(candidateId)}`, { headers: { 'ngrok-skip-browser-warning': '69420' } })
      .then(res => res.json())
      .then(data => {
        const items = data.status === 'success' ? ((data.data?.items) || []) : [];
        const options = items.map(it => ({ id: String(it.vendorItemId), name: it.itemName || it.externalVendorSku || String(it.vendorItemId) }));
        setOptionCandidates(prev => ({ ...prev, coupang: { loading: false, options } }));
        // 옵션이 1개뿐이면 사용자에게 선택지를 보여줄 필요 없이 바로 그 vendorItemId를 써야 한다(쿠팡은 옵션 없어도 vendorItemId가 필수).
        if (options.length === 1) {
          setSelectedOptionByChannel(prev => ({ ...prev, coupang: options[0] }));
        }
      })
      .catch(() => setOptionCandidates(prev => ({ ...prev, coupang: { loading: false, options: [] } })));
  }
};
```

- [ ] **Step 3: 후보 라디오 선택 시 옵션 조회 트리거**

현재(수정 전) 후보 라디오:
```jsx
                          {candidates.map((c) => (
                            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--surface-2)', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name={`link-${channel}`}
                                checked={!!selected && String(selected.id) === String(c.id)}
                                onChange={() => setSelectedCandidates(prev => ({ ...prev, [channel]: { id: c.id, name: c.name } }))}
                              />
                              <span style={{ fontSize: '13px', color: 'var(--text)' }}>{c.name}</span>
                              {linked && String(linked.id) === String(c.id) && (
                                <span style={{ fontSize: '10px', color: 'var(--success)', fontWeight: 700 }}>✓ 연결됨</span>
                              )}
                            </label>
                          ))}
                        </div>
                      ) : (
```
아래로 교체 (onChange만 확장하고, 옵션 선택 UI를 후보 목록 뒤에 추가):
```jsx
                          {candidates.map((c) => (
                            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--surface-2)', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name={`link-${channel}`}
                                checked={!!selected && String(selected.id) === String(c.id)}
                                onChange={() => {
                                  setSelectedCandidates(prev => ({ ...prev, [channel]: { id: c.id, name: c.name } }));
                                  setSelectedOptionByChannel(prev => ({ ...prev, [channel]: null }));
                                  if (channel === 'naver' || channel === 'coupang') fetchOptionCandidates(channel, c.id);
                                }}
                              />
                              <span style={{ fontSize: '13px', color: 'var(--text)' }}>{c.name}</span>
                              {linked && String(linked.id) === String(c.id) && (
                                <span style={{ fontSize: '10px', color: 'var(--success)', fontWeight: 700 }}>✓ 연결됨</span>
                              )}
                            </label>
                          ))}
                          {(channel === 'naver' || channel === 'coupang') && selected && optionCandidates[channel] && (
                            optionCandidates[channel].loading ? (
                              <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '4px' }}>옵션 조회 중...</div>
                            ) : optionCandidates[channel].options.length > 0 ? (
                              <div style={{ marginTop: '6px', paddingLeft: '12px', borderLeft: '2px solid var(--border)' }}>
                                <div style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '6px' }}>이 상품의 어떤 옵션인가요?</div>
                                {optionCandidates[channel].options.map(opt => (
                                  <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '4px 0', cursor: 'pointer' }}>
                                    <input
                                      type="radio"
                                      name={`option-${channel}`}
                                      checked={!!selectedOptionByChannel[channel] && selectedOptionByChannel[channel].id === opt.id}
                                      onChange={() => setSelectedOptionByChannel(prev => ({ ...prev, [channel]: opt }))}
                                    />
                                    {opt.name}
                                  </label>
                                ))}
                              </div>
                            ) : null
                          )}
                        </div>
                      ) : (
```

- [ ] **Step 4: `handleConnectSelected`가 옵션 필드를 같이 보내도록 수정**

현재:
```js
        const res = await fetch(`${API_BASE}/api/channel-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '69420' },
          body: JSON.stringify({
            product_name: linkModalProduct, channel,
            channel_id: String(candidate.id), channel_name: candidate.name
          })
        });
```
교체:
```js
        const chosenOption = selectedOptionByChannel[channel] || null;
        const res = await fetch(`${API_BASE}/api/channel-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '69420' },
          body: JSON.stringify({
            product_name: linkModalProduct, channel,
            channel_id: String(candidate.id), channel_name: candidate.name,
            option_id: channel === 'naver' ? (chosenOption?.id || null) : null,
            option_name: chosenOption?.name || null,
            vendor_item_id: channel === 'coupang' ? (chosenOption?.id || null) : null,
          })
        });
```

- [ ] **Step 5: `closeLinkModal`이 옵션 상태도 초기화하도록 수정**

현재:
```js
  const closeLinkModal = () => {
    setLinkModalProduct(null);
    setLinkCandidates(null);
    setSelectedCandidates({});
    setSearchKeyword("");
  };
```
교체:
```js
  const closeLinkModal = () => {
    setLinkModalProduct(null);
    setLinkCandidates(null);
    setSelectedCandidates({});
    setSearchKeyword("");
    setOptionCandidates({});
    setSelectedOptionByChannel({});
  };
```

- [ ] **Step 6: 수동 브라우저 확인**

```bash
cd frontend && npm run dev
```
브라우저에서 마진산출장부 → 임의 상품의 "채널 연결" → 검색 버튼 클릭 → 네이버/쿠팡 후보 중 하나를 선택했을 때 "옵션 조회 중..." → 옵션 목록(또는 옵션 없으면 아무것도 안 뜸)이 나오는지 확인. (실제 네이버/쿠팡 응답은 이 환경에서 IP 차단이라 에러 상태로 끝날 수 있음 — UI 흐름 자체만 확인하고, 실데이터 확인은 Task 11에서.)

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/components/MarginTab.jsx
git commit -m "feat: 채널연결 모달에 네이버/쿠팡 옵션 선택 UI 추가"
```

---

### Task 10: `handleSyncPrices` payload에 옵션 필드 포함

**Files:**
- Modify: `frontend/src/components/MarginTab.jsx` (`handleSyncPrices` 함수)

**Interfaces:**
- Consumes: `priceChanges` 배열 항목(Task 1~2에서 백엔드가 이미 `option_id`/`option_name`/`vendor_item_id`를 포함해서 내려줌).
- Produces: `/api/channel-price-sync` 요청 바디에 옵션 필드 포함.

- [ ] **Step 1: 코드 확인 (이미 표시 로직은 이전 작업에서 반영됨, 전송 payload만 비어있음)**

현재:
```js
      const res = await fetch(`${API_BASE}/api/channel-price-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '69420' },
        body: JSON.stringify({
          changes: selectedChanges.map(c => ({
            product_name: c.product_name,
            channel: c.channel,
            channel_id: c.channel_id,
            channel_name: c.channel_name,
            new_price: c.new_price
          }))
        })
      });
```

- [ ] **Step 2: 옵션 필드 추가**

교체:
```js
      const res = await fetch(`${API_BASE}/api/channel-price-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '69420' },
        body: JSON.stringify({
          changes: selectedChanges.map(c => ({
            product_name: c.product_name,
            channel: c.channel,
            channel_id: c.channel_id,
            channel_name: c.channel_name,
            option_id: c.option_id,
            option_name: c.option_name,
            vendor_item_id: c.vendor_item_id,
            new_price: c.new_price
          }))
        })
      });
```

- [ ] **Step 3: 결과 표시 라인에도 옵션명이 나오도록 확인/보강**

현재 결과 렌더링(이미 존재하는 코드):
```jsx
                      <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: 700 }}>{r.product_name} · {CHANNEL_LABELS[r.channel] || r.channel}</span>
```
교체(옵션명이 있으면 같이 표시, 미리보기 목록과 형식 통일):
```jsx
                      <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: 700 }}>
                        {CHANNEL_LABELS[r.channel] || r.channel} - {r.product_name}{r.option_name ? ` ${r.option_name} 옵션` : ''}
                      </span>
```

- [ ] **Step 4: 수동 확인**

Task 8에서 만든 curl 테스트를 다시 실행해서 응답 `results`에 옵션 필드가 그대로 왕복하는지 확인:
```bash
uvicorn server:app --reload &
sleep 2
curl -s -X POST http://127.0.0.1:8000/api/channel-price-sync -H "Content-Type: application/json" -d '{
  "changes": [
    {"product_name": "테스트", "channel": "sikbom", "option_name": "50g", "new_price": 1000}
  ]
}'
kill %1
```
Expected: 응답의 `results[0].option_name`이 `"50g"`로 그대로 나오는 것을 확인.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/MarginTab.jsx
git commit -m "feat: 채널 가격 반영 요청/결과에 옵션 필드 왕복 포함"
```

---

### Task 11: GCP 실제 API 검증 및 배포

**Files:**
- 없음(코드 변경 없음) — 배포 및 실제 API 검증만 수행. 문제 발견 시 Task 7(네이버 배치 함수)로 돌아가 수정.

이 태스크는 Global Constraints에 적어둔 미확증 사항(“`optionCombinationSortType`을 안 보내면 `id`가 유지되는지”)을 실제 상품으로 검증하고, 배포까지 마무리한다. 검증 대상 상품: "다이아몬드 빵가루 새우 튀김 투톤 30g,50g" (channelProductNo=11060989411, 이전 대화에서 이미 확인됨).

- [ ] **Step 1: 로컬에서 전체 단위테스트 재확인**

```bash
python -m unittest discover -s tests -v
```
Expected: 전부 `OK` (Task 1,5,6,7에서 만든 테스트 전부).

- [ ] **Step 2: GCP에 변경 파일 업로드**

```bash
gcloud compute ssh instance-20260709-123435 --zone=us-central1-a --project=gen-lang-client-0363132726 --command="rm -f ~/store/store/onepick-dashboard/server.py ~/store/store/onepick-dashboard/apis/naver_api.py ~/store/store/onepick-dashboard/apis/coupang_api.py"

gcloud compute scp server.py instance-20260709-123435:~/store/store/onepick-dashboard/server.py --zone=us-central1-a --project=gen-lang-client-0363132726
gcloud compute scp apis/naver_api.py instance-20260709-123435:~/store/store/onepick-dashboard/apis/naver_api.py --zone=us-central1-a --project=gen-lang-client-0363132726
gcloud compute scp apis/coupang_api.py instance-20260709-123435:~/store/store/onepick-dashboard/apis/coupang_api.py --zone=us-central1-a --project=gen-lang-client-0363132726
```
(프론트엔드는 별도 배포 파이프라인이 있으면 그걸 따르고, 없으면 `frontend/src/components/MarginTab.jsx`도 같은 방식으로 올린다.)

- [ ] **Step 3: 서비스 재시작 및 헬스체크**

```bash
gcloud compute ssh instance-20260709-123435 --zone=us-central1-a --project=gen-lang-client-0363132726 --command="sudo systemctl restart onepick.service && sleep 8 && curl -s http://127.0.0.1:8000/api/health"
```
Expected: `{"status":"success"}`

- [ ] **Step 4: 실제 네이버 옵션 가격 반영 1건 테스트 (원복 포함)**

GCP에 접속해서 원격 프로젝트 루트에서 실행 — **원래 가격을 먼저 저장해두고, 테스트 후 반드시 원복한다:**
```bash
gcloud compute ssh instance-20260709-123435 --zone=us-central1-a --project=gen-lang-client-0363132726
cd ~/store/store/onepick-dashboard/
python3 -c "
import apis.naver_api as naver_api
import json

channel_no = '11060989411'
before = naver_api.get_naver_product_detail(channel_no)
combos_before = before['originProduct']['optionInfo']['optionCombinations']
print('반영 전 옵션:', json.dumps(combos_before, ensure_ascii=False))

target = combos_before[0]
original_price = target['price']
test_new_price = before['originProduct']['salePrice'] + original_price + 10  # 10원만 살짝 올려서 테스트

results = naver_api.update_naver_option_prices(channel_no, [
    {'option_id': str(target['id']), 'option_name': target['optionName1'], 'new_price': test_new_price}
])
print('반영 결과:', results)

after = naver_api.get_naver_product_detail(channel_no)
combos_after = after['originProduct']['optionInfo']['optionCombinations']
print('반영 후 옵션:', json.dumps(combos_after, ensure_ascii=False))

# id가 유지됐는지, 다른 옵션(들)이 그대로 남아있는지 확인
same_id_kept = any(c['id'] == target['id'] for c in combos_after)
other_untouched = all(
    c['price'] == next(cb['price'] for cb in combos_before if cb['id'] == c['id'])
    for c in combos_after if c['id'] != target['id']
) if same_id_kept else None
print('id 유지 여부:', same_id_kept, '/ 다른 옵션 안 건드림:', other_untouched)

# 원복
naver_api.update_naver_option_prices(channel_no, [
    {'option_id': str(target['id']), 'option_name': target['optionName1'], 'new_price': before['originProduct']['salePrice'] + original_price}
])
print('원복 완료')
"
```
Expected: `id 유지 여부: True`, `다른 옵션 안 건드림: True`. **만약 `id 유지 여부: False`가 나오면** — Task 7의 `_match_option_combination` 폴백(이름 매칭)이 이미 구현돼 있어 다음 반영부터는 자동으로 이름 기준으로 재매칭되니 코드 변경은 필요 없다. 다만 `optionCombinationSortType`을 다른 값(예: 네이버 문서에서 확인되는 재정렬 안 함 값)으로 명시해야 하는지는 이 결과를 보고 판단한다 — 필요하면 Task 7의 `option_info.pop("optionCombinationSortType", None)` 줄을 실제 값으로 바꾸고 이 Step을 재실행해서 재검증한다.

- [ ] **Step 5: 검증 스크립트 정리**

이번 검증은 파일로 안 남기고 인라인 `python3 -c`로 실행했으므로 별도 정리 불필요. (혹시 이전 대화에서 올려둔 `verify_naver_option.py`/`verify_coupang_option.py`가 원격에 남아있다면 이 김에 삭제)
```bash
rm -f ~/store/store/onepick-dashboard/verify_naver_option.py ~/store/store/onepick-dashboard/verify_coupang_option.py
```

- [ ] **Step 6: 최종 커밋 (Step 4에서 코드 변경이 있었다면)**

Step 4 결과에 따라 `apis/naver_api.py`를 수정했다면：
```bash
git add apis/naver_api.py
git commit -m "fix: optionCombinationSortType 실측 결과 반영"
```
변경이 없었다면 이 태스크는 커밋 없이 종료.

---

## Self-Review 메모

- **스펙 커버리지**: 스펙의 A~E 섹션 전부 태스크로 매핑됨 — A(저장구조)=Task 3, B(모달 옵션 UI)=Task 9, C(price_changes)=Task 1~2, D(channel-price-sync 분기+배치)=Task 5~8, E(미리보기 표시)=이전 작업에서 완료(별도 태스크 불필요, Task 10에서 결과 표시만 보강).
- **플레이스홀더 스캔**: 없음 — 모든 스텝에 실제 코드 포함. `optionCombinationSortType` 관련 불확실성은 코드 주석 + Task 11의 명시적 실측 스텝으로 처리(구현을 미룬 게 아니라, 이미 동작하는 코드에 대한 실측 검증).
- **타입/이름 일관성**: `option_id`/`option_name`/`vendor_item_id` 필드명을 백엔드(`ChannelLinkIn`, `_compute_price_changes`, `ChannelPriceSyncChange`)와 프론트(`selectedOptionByChannel`, payload) 전체에서 동일하게 사용.
