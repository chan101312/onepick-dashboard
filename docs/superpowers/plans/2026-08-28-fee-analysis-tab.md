# 수수료 분석 탭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상품별 "예측 마진(마진산출장부 수수료 추정치)" vs "실제 마진(정산 API 실수수료)"을 결제월 기준으로 비교하는 새 탭을 추가한다.

**Architecture:** 백엔드는 `fee_analysis.py` 단일 라우터 모듈(`reorder.py`/`memos.py` 패턴) — 네이버 `settle/case`+`product-orders/query`, 쿠팡 `revenue-history`를 조회해 상품별로 집계·매칭·계산하고 `fee_cache_YYYY-MM.json`에 캐시한다. 프론트는 `FeeAnalysisTab.jsx` 단일 컴포넌트 — 월 선택, "정산 갱신" 버튼(30~60초 로딩 UX), 채널 요약 카드 2개, 정렬 가능한 상품 테이블, 미매칭 섹션.

**Tech Stack:** FastAPI(APIRouter), pandas, requests(기존 `naver_api._request`/`coupang_api` 재사용), pytest(신규), React 19 + Vite(플레인 JSX).

**Spec:** `docs/superpowers/specs/2026-08-28-fee-analysis-tab-design.md` (플랜은 스펙에서 논거를 가져오므로 함께 읽을 것)

## Global Constraints

- 코드/주석/커밋/UI 카피는 한국어 (기존 리포 관례).
- 백엔드 하드코딩 자격증명 추가 금지. 자격증명은 `config.py`(gitignored)에서만.
- 프론트는 TypeScript 없음. 플레인 `.jsx`. ESLint 규칙 1개: `no-unused-vars`가 `^[A-Z_]` 이름은 무시.
- 프론트 API 호출은 `import { API_BASE } from '../apiBase'` + 헤더 `'ngrok-skip-browser-warning': '69420'` (기존 탭과 동일).
- 백엔드 실행: `uvicorn server:app --reload`. 엔트리포인트 없음.
- 정산 API는 로컬에서 네이버 토큰 발급 불가 → 실 API 검증은 프로덕션 경유(GCP SSH + venv). 순수 로직/모의(mock) 테스트는 로컬.
- 배포 절차: `docs/superpowers` 메모리 `gcp-deployment` 참조 (scp → `sudo cp` + `chown ys101312` → `systemctl restart onepick.service`).
- 캐시/런타임 데이터 파일은 커밋하지 않는다.
- 기간 기준 = **결제/판매 월** (`payDate`/`saleDate`), 정산 확정월 아님 (스펙 §5).
- 예측/실제 마진의 유일한 차이는 수수료 값 (스펙 §4): 둘 다 실제매출·실제수량 기준, 예측은 수수료만 추정치로 교체.

---

## File Structure

| 파일 | 역할 |
|---|---|
| `fee_analysis.py` (신규, 루트) | APIRouter + 순수 헬퍼(정규화·매칭·계산·집계) + 조회 함수(네이버/쿠팡) + 엔드포인트 2개 |
| `server.py` (수정, ~L31/L34) | `from fee_analysis import router as fee_analysis_router` + `app.include_router(...)` |
| `requirements.txt` (수정) | `pytest` 추가 |
| `.gitignore` (수정) | `fee_cache_*.json` 추가 |
| `tests/__init__.py` (신규) | 빈 파일 |
| `tests/test_fee_analysis.py` (신규) | 순수 로직 + 모의 조회 + 엔드포인트(TestClient) 테스트 |
| `frontend/src/components/FeeAnalysisTab.jsx` (신규) | 탭 UI 전체 |
| `frontend/src/components/Sidebar.jsx` (수정, `NAV_ITEMS`) | 메뉴 항목 1개 추가 |
| `frontend/src/App.jsx` (수정, L16 부근 + L115 부근) | import + 렌더 라인 추가 |

`fee_analysis.py` 구성 순서: ① 상수 ② 순수 헬퍼 ③ 조회 함수(`from apis import ...`는 함수 내부에서 lazy import — 순수 로직 테스트가 `config.py` 없이도 import 되도록) ④ 라우터.

---

## Task 1: 순수 헬퍼 — 숫자 파싱 · 이름 정규화 · 상품 매칭

**Files:**
- Create: `fee_analysis.py`
- Create: `tests/__init__.py` (빈 파일)
- Create: `tests/test_fee_analysis.py`
- Modify: `requirements.txt` (마지막에 `pytest` 한 줄 추가)

**Interfaces:**
- Consumes: (없음)
- Produces:
  - `_parse_num(v) -> float` — `None`/`""`/`"1,234"`/`12`/`"12.5"` → float, 실패 시 `0.0`
  - `_norm_name(s) -> str` — 소문자화 후 `[^0-9a-z가-힣]` 제거
  - `_build_link_index(links: dict) -> dict` — `{("naver", "<channelProductNo>"): 상품명, ("coupang", "<vendorItemId>"): 상품명}`
  - `_build_margin_index(rows: list[dict]) -> list[tuple[str, str, dict]]` — `[(원본이름, 정규화이름, row), ...]`
  - `MATCH_THRESHOLD = 0.55`
  - `_match_product(settle_name: str, settle_id, channel: str, margin_index, link_index) -> tuple[dict|None, str|None, float]` — `(margin_row, method, confidence)`; method ∈ `"id"|"name"|None`, id매칭 confidence `1.0`

- [ ] **Step 1: `pytest` 의존성 추가**

`requirements.txt` 끝에 추가:
```
pytest
```
설치: `pip install pytest`

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/test_fee_analysis.py`:
```python
import fee_analysis as fa


def test_parse_num_variants():
    assert fa._parse_num(None) == 0.0
    assert fa._parse_num("") == 0.0
    assert fa._parse_num("1,234") == 1234.0
    assert fa._parse_num("12.5") == 12.5
    assert fa._parse_num(7) == 7.0
    assert fa._parse_num("abc") == 0.0


def test_norm_name():
    assert fa._norm_name("장터국수 우동국물1.8L X 6개") == "장터국수우동국물18lx6개"
    assert fa._norm_name("  Hello, World! ") == "helloworld"


def test_build_link_index():
    links = {
        "다이아몬드 빵가루새우": {"naver": {"id": "11060989411"}, "coupang": {"id": "s1", "vendor_item_id": "999"}},
        "이름만있음": {"naver": {"id": "222"}},
    }
    idx = fa._build_link_index(links)
    assert idx[("naver", "11060989411")] == "다이아몬드 빵가루새우"
    assert idx[("coupang", "999")] == "다이아몬드 빵가루새우"
    assert idx[("naver", "222")] == "이름만있음"


def test_match_by_id():
    rows = [{"온라인 상품명": "빵가루새우 50g"}, {"온라인 상품명": "다른상품"}]
    m_idx = fa._build_margin_index(rows)
    l_idx = {("naver", "11060989411"): "빵가루새우 50g"}
    row, method, conf = fa._match_product("전혀다른정산이름", "11060989411", "naver", m_idx, l_idx)
    assert row["온라인 상품명"] == "빵가루새우 50g"
    assert method == "id"
    assert conf == 1.0


def test_match_by_name_fuzzy():
    # 마진산출장부 상품명은 실제로 서술적이다(짧게 자르지 말 것). 임계값 0.55는
    # 실 데이터 검증(18표본 중 16 매칭)에서 확정된 값.
    rows = [{"온라인 상품명": "장터국수 우동국물1.8L X 6개"}, {"온라인 상품명": "청어 6.5kg"}]
    m_idx = fa._build_margin_index(rows)
    row, method, conf = fa._match_product(
        "장터국수 우동국물1.8L X 6개 육수 대용량 업소용", None, "naver", m_idx, {}
    )
    assert row["온라인 상품명"] == "장터국수 우동국물1.8L X 6개"
    assert method == "name"
    assert conf >= fa.MATCH_THRESHOLD


def test_match_none_when_below_threshold():
    rows = [{"온라인 상품명": "청어 6.5kg"}]
    m_idx = fa._build_margin_index(rows)
    row, method, conf = fa._match_product("완전히 무관한 상품명 XYZ", None, "coupang", m_idx, {})
    assert row is None
    assert method is None
```

- [ ] **Step 3: 실패 확인**

Run: `python -m pytest tests/test_fee_analysis.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'fee_analysis'`

- [ ] **Step 4: 최소 구현**

`fee_analysis.py`:
```python
import re
from difflib import SequenceMatcher

MATCH_THRESHOLD = 0.55


def _parse_num(v):
    if v is None:
        return 0.0
    try:
        return float(str(v).replace(",", "").strip() or 0)
    except (ValueError, TypeError):
        return 0.0


def _norm_name(s):
    return re.sub(r"[^0-9a-z가-힣]", "", str(s or "").lower())


def _margin_name_of(row):
    return row.get("온라인 상품명") or row.get("상품명") or ""


def _build_link_index(links):
    idx = {}
    for name, v in (links or {}).items():
        nv = v.get("naver") or {}
        cp = v.get("coupang") or {}
        if nv.get("id"):
            idx[("naver", str(nv["id"]))] = name
        if cp.get("vendor_item_id"):
            idx[("coupang", str(cp["vendor_item_id"]))] = name
    return idx


def _build_margin_index(rows):
    out = []
    for row in rows or []:
        nm = _margin_name_of(row)
        if nm:
            out.append((nm, _norm_name(nm), row))
    return out


def _match_product(settle_name, settle_id, channel, margin_index, link_index):
    # 1) ID 매칭
    if settle_id is not None:
        target = link_index.get((channel, str(settle_id)))
        if target:
            for nm, _norm, row in margin_index:
                if nm == target:
                    return row, "id", 1.0
    # 2) 이름 fuzzy
    q = _norm_name(settle_name)
    best_row, best_ratio = None, 0.0
    for _nm, norm, row in margin_index:
        r = SequenceMatcher(None, q, norm).ratio()
        if r > best_ratio:
            best_ratio, best_row = r, row
    if best_row is not None and best_ratio >= MATCH_THRESHOLD:
        return best_row, "name", round(best_ratio, 2)
    return None, None, 0.0
```

- [ ] **Step 5: 통과 확인**

Run: `python -m pytest tests/test_fee_analysis.py -v`
Expected: PASS (6 tests)

- [ ] **Step 6: 커밋**

```bash
git add fee_analysis.py tests/__init__.py tests/test_fee_analysis.py requirements.txt
git commit -m "feat: 수수료분석 순수 헬퍼(파싱/정규화/상품매칭) + pytest 도입"
```

---

## Task 2: 순수 헬퍼 — 상품×채널 1행 계산

**Files:**
- Modify: `fee_analysis.py`
- Modify: `tests/test_fee_analysis.py`

**Interfaces:**
- Consumes: `_parse_num` (Task 1)
- Produces:
  - `_compute_row(agg: dict, margin_row: dict, channel: str) -> dict`
    - `agg` = `{"revenue": float, "actual_fee": float, "qty": float, "qty_partial": bool}`
    - `channel` ∈ `"naver"|"coupang"`
    - 반환 키: `product_name, channel, qty, qty_partial, revenue, cost, fixed_cost, estimated_fee, actual_fee, estimated_margin, actual_margin, diff_amount, diff_pct`
    - `diff_pct` = `estimated_margin == 0` 이면 `None`, 아니면 `round(diff_amount/abs(estimated_margin)*100, 1)`
    - `diff_amount` = `actual_margin - estimated_margin`
    - 채널 컬럼명: `f"{'네이버' if channel=='naver' else '쿠팡'} 수수료"`, `f"... 판매가"`
    - `estimated_fee`: `판매가>0` 이면 `round(revenue * (수수료컬럼/판매가컬럼))`, 아니면 `round(수수료컬럼 * qty)`
    - `cost` = `_parse_num(margin_row.get("매입") or margin_row.get("매입가")) * qty`
    - `fixed_cost` = `(자재비 + 운송비 + 기타비용 + 날치알) * qty` (각 `_parse_num`, 없으면 0)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_fee_analysis.py` 에 추가:
```python
def _margin_row():
    return {
        "온라인 상품명": "장터국수 우동국물",
        "매입": "50000", "자재비": "1000", "운송비": "500", "기타비용": "0", "날치알": "0",
        "네이버 수수료": "4110", "네이버 판매가": "74500",
        "쿠팡 수수료": "8503", "쿠팡 판매가": "80200",
    }


def test_compute_row_naver_rate_based_fee():
    agg = {"revenue": 149000.0, "actual_fee": 4700.0, "qty": 2.0, "qty_partial": False}
    r = fa._compute_row(agg, _margin_row(), "naver")
    assert r["product_name"] == "장터국수 우동국물"
    assert r["channel"] == "naver"
    assert r["qty"] == 2.0
    assert r["cost"] == 100000.0                      # 50000 * 2
    assert r["fixed_cost"] == 3000.0                  # (1000+500) * 2
    # 예측수수료 = 149000 * (4110/74500) = 8220.0 (round)
    assert r["estimated_fee"] == round(149000 * (4110 / 74500))
    assert r["actual_fee"] == 4700.0
    assert r["estimated_margin"] == 149000.0 - 100000.0 - r["estimated_fee"] - 3000.0
    assert r["actual_margin"] == 149000.0 - 100000.0 - 4700.0 - 3000.0
    assert r["diff_amount"] == r["actual_margin"] - r["estimated_margin"]
    assert r["diff_pct"] == round(r["diff_amount"] / abs(r["estimated_margin"]) * 100, 1)


def test_compute_row_fee_fallback_when_price_zero():
    row = _margin_row()
    row["쿠팡 판매가"] = "0"
    agg = {"revenue": 80000.0, "actual_fee": 9000.0, "qty": 1.0, "qty_partial": False}
    r = fa._compute_row(agg, row, "coupang")
    assert r["estimated_fee"] == round(8503 * 1)      # 판매가 0 → 수수료컬럼 * qty


def test_compute_row_diff_pct_none_on_zero_margin():
    row = {"온라인 상품명": "x", "매입": "0", "네이버 수수료": "0", "네이버 판매가": "100"}
    agg = {"revenue": 0.0, "actual_fee": 0.0, "qty": 0.0, "qty_partial": True}
    r = fa._compute_row(agg, row, "naver")
    assert r["estimated_margin"] == 0.0
    assert r["diff_pct"] is None
    assert r["qty_partial"] is True
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_fee_analysis.py -k compute_row -v`
Expected: FAIL — `AttributeError: module 'fee_analysis' has no attribute '_compute_row'`

- [ ] **Step 3: 최소 구현**

`fee_analysis.py` 에 추가:
```python
def _compute_row(agg, margin_row, channel):
    label = "네이버" if channel == "naver" else "쿠팡"
    qty = agg["qty"]
    revenue = agg["revenue"]
    actual_fee = agg["actual_fee"]

    fee_col = _parse_num(margin_row.get(f"{label} 수수료"))
    price_col = _parse_num(margin_row.get(f"{label} 판매가"))
    if price_col > 0:
        estimated_fee = round(revenue * (fee_col / price_col))
    else:
        estimated_fee = round(fee_col * qty)

    cost = _parse_num(margin_row.get("매입") or margin_row.get("매입가")) * qty
    fixed_cost = (
        _parse_num(margin_row.get("자재비"))
        + _parse_num(margin_row.get("운송비"))
        + _parse_num(margin_row.get("기타비용"))
        + _parse_num(margin_row.get("날치알"))
    ) * qty

    estimated_margin = revenue - cost - estimated_fee - fixed_cost
    actual_margin = revenue - cost - actual_fee - fixed_cost
    diff_amount = actual_margin - estimated_margin
    diff_pct = None if estimated_margin == 0 else round(diff_amount / abs(estimated_margin) * 100, 1)

    return {
        "product_name": _margin_name_of(margin_row),
        "channel": channel,
        "qty": qty,
        "qty_partial": agg.get("qty_partial", False),
        "revenue": revenue,
        "cost": cost,
        "fixed_cost": fixed_cost,
        "estimated_fee": estimated_fee,
        "actual_fee": actual_fee,
        "estimated_margin": estimated_margin,
        "actual_margin": actual_margin,
        "diff_amount": diff_amount,
        "diff_pct": diff_pct,
    }
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_fee_analysis.py -v`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add fee_analysis.py tests/test_fee_analysis.py
git commit -m "feat: 수수료분석 상품×채널 1행 계산(_compute_row)"
```

---

## Task 3: 순수 헬퍼 — 전체 집계 (`_aggregate`)

**Files:**
- Modify: `fee_analysis.py`
- Modify: `tests/test_fee_analysis.py`

**Interfaces:**
- Consumes: `_build_link_index`, `_build_margin_index`, `_match_product`, `_compute_row` (Task 1–2)
- Produces:
  - `_aggregate(naver_lines, coupang_lines, margin_rows, links) -> dict`
    - `naver_lines`: `[{"product_id": str|None, "product_name": str, "revenue": float, "fee": float, "qty": float, "qty_partial": bool}, ...]` (부호 반영된 net 라인; DELIVERY 라인 제외됨 — 호출자 책임)
    - `coupang_lines`: `[{"vendor_item_id": str|None, "product_id": str|None, "product_name": str, "revenue": float, "fee": float, "qty": float}, ...]`
    - 반환:
      ```
      {
        "channels": {
          "naver":  {"revenue","actual_fee","estimated_fee","actual_margin","unmatched_revenue","unmatched_fee"},
          "coupang": {...동일...}
        },
        "rows": [ _compute_row 결과 + {"match_method","match_confidence"} , ... ],   # 채널별로 분리, |diff_amount| 내림차순 정렬
        "unmatched": [ {"product_name","channel","settle_product_id","vendor_item_id","revenue","actual_fee","qty"}, ... ]
      }
      ```
    - 집계 키: 매칭된 `margin_row` 의 이름 + 채널. 여러 정산 상품이 같은 (이름,채널)로 매핑되면 revenue/fee/qty 합산, `qty_partial`는 OR, confidence는 min, method는 하나라도 "id"면 "id".
    - 채널 요약: `revenue`/`actual_fee`는 매칭+미매칭 전체 합, `estimated_fee`/`actual_margin`은 매칭분만.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_fee_analysis.py` 에 추가:
```python
def test_aggregate_matches_and_summarizes():
    margin_rows = [
        {"온라인 상품명": "장터국수 우동국물1.8L X 6개", "매입": "50000", "자재비": "1000", "운송비": "0",
         "네이버 수수료": "4110", "네이버 판매가": "74500",
         "쿠팡 수수료": "8503", "쿠팡 판매가": "80200"},
        {"온라인 상품명": "청어 6.5kg", "매입": "13000",
         "쿠팡 수수료": "2783", "쿠팡 판매가": "25300"},
    ]
    links = {}
    naver_lines = [
        {"product_id": "9641317164", "product_name": "장터국수 우동국물1.8L X 6개 육수 대용량 업소용",
         "revenue": 74500.0, "fee": 2237.0, "qty": 1.0, "qty_partial": False},
    ]
    coupang_lines = [
        {"vendor_item_id": "90149646990", "product_id": "1", "product_name": "장터국수 우동국물1.8L X 6개 육수 대용량",
         "revenue": 80200.0, "fee": 8600.0, "qty": 1.0},
        {"vendor_item_id": "777", "product_id": "2", "product_name": "완전무관 상품 ZZZ",
         "revenue": 30000.0, "fee": 3500.0, "qty": 1.0},
    ]
    out = fa._aggregate(naver_lines, coupang_lines, margin_rows, links)

    assert len(out["rows"]) == 2                       # 네이버 1 + 쿠팡 1 (매칭)
    assert len(out["unmatched"]) == 1
    assert out["unmatched"][0]["product_name"] == "완전무관 상품 ZZZ"
    assert out["unmatched"][0]["channel"] == "coupang"

    nv = out["channels"]["naver"]
    assert nv["revenue"] == 74500.0
    assert nv["actual_fee"] == 2237.0
    assert nv["estimated_fee"] > 0

    cp = out["channels"]["coupang"]
    assert cp["revenue"] == 110200.0                   # 80200 + 30000 (미매칭 포함)
    assert cp["unmatched_revenue"] == 30000.0
    assert cp["unmatched_fee"] == 3500.0

    diffs = [abs(r["diff_amount"]) for r in out["rows"]]
    assert diffs == sorted(diffs, reverse=True)        # |diff| 내림차순


def test_aggregate_id_match_beats_name():
    margin_rows = [{"온라인 상품명": "정답상품", "매입": "0", "네이버 수수료": "0", "네이버 판매가": "100"},
                   {"온라인 상품명": "장터국수 우동국물", "매입": "0", "네이버 수수료": "0", "네이버 판매가": "100"}]
    links = {"정답상품": {"naver": {"id": "9641317164"}}}
    naver_lines = [{"product_id": "9641317164", "product_name": "장터국수 우동국물1.8L X 6개",
                    "revenue": 1000.0, "fee": 30.0, "qty": 1.0, "qty_partial": False}]
    out = fa._aggregate(naver_lines, [], margin_rows, links)
    assert out["rows"][0]["product_name"] == "정답상품"
    assert out["rows"][0]["match_method"] == "id"
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_fee_analysis.py -k aggregate -v`
Expected: FAIL — `_aggregate` 없음

- [ ] **Step 3: 최소 구현**

`fee_analysis.py` 에 추가:
```python
def _aggregate(naver_lines, coupang_lines, margin_rows, links):
    link_idx = _build_link_index(links)
    margin_idx = _build_margin_index(margin_rows)

    buckets = {}   # (margin_name, channel) -> {"agg":{...}, "row":margin_row, "method":..., "conf":...}
    unmatched = []
    ch_totals = {
        "naver": {"revenue": 0.0, "actual_fee": 0.0, "unmatched_revenue": 0.0, "unmatched_fee": 0.0},
        "coupang": {"revenue": 0.0, "actual_fee": 0.0, "unmatched_revenue": 0.0, "unmatched_fee": 0.0},
    }

    def ingest(channel, settle_id, settle_name, revenue, fee, qty, qty_partial, spid, vid):
        ch_totals[channel]["revenue"] += revenue
        ch_totals[channel]["actual_fee"] += fee
        row, method, conf = _match_product(settle_name, settle_id, channel, margin_idx, link_idx)
        if row is None:
            ch_totals[channel]["unmatched_revenue"] += revenue
            ch_totals[channel]["unmatched_fee"] += fee
            unmatched.append({
                "product_name": settle_name, "channel": channel,
                "settle_product_id": spid, "vendor_item_id": vid,
                "revenue": revenue, "actual_fee": fee, "qty": qty,
            })
            return
        key = (_margin_name_of(row), channel)
        b = buckets.get(key)
        if b is None:
            b = {"agg": {"revenue": 0.0, "actual_fee": 0.0, "qty": 0.0, "qty_partial": False},
                 "row": row, "method": method, "conf": conf}
            buckets[key] = b
        b["agg"]["revenue"] += revenue
        b["agg"]["actual_fee"] += fee
        b["agg"]["qty"] += qty
        b["agg"]["qty_partial"] = b["agg"]["qty_partial"] or qty_partial
        b["conf"] = min(b["conf"], conf)
        if method == "id":
            b["method"] = "id"

    for ln in naver_lines:
        ingest("naver", ln.get("product_id"), ln.get("product_name", ""),
               ln.get("revenue", 0.0), ln.get("fee", 0.0), ln.get("qty", 0.0),
               ln.get("qty_partial", False), ln.get("product_id"), None)
    for ln in coupang_lines:
        ingest("coupang", ln.get("vendor_item_id"), ln.get("product_name", ""),
               ln.get("revenue", 0.0), ln.get("fee", 0.0), ln.get("qty", 0.0),
               False, ln.get("product_id"), ln.get("vendor_item_id"))

    rows = []
    for (_name, channel), b in buckets.items():
        r = _compute_row(b["agg"], b["row"], channel)
        r["match_method"] = b["method"]
        r["match_confidence"] = b["conf"]
        rows.append(r)
    rows.sort(key=lambda r: abs(r["diff_amount"]), reverse=True)

    channels = {}
    for ch in ("naver", "coupang"):
        t = ch_totals[ch]
        est = sum(r["estimated_fee"] for r in rows if r["channel"] == ch)
        am = sum(r["actual_margin"] for r in rows if r["channel"] == ch)
        channels[ch] = {
            "revenue": t["revenue"], "actual_fee": t["actual_fee"],
            "estimated_fee": est, "actual_margin": am,
            "unmatched_revenue": t["unmatched_revenue"], "unmatched_fee": t["unmatched_fee"],
        }
    return {"channels": channels, "rows": rows, "unmatched": unmatched}
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_fee_analysis.py -v`
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add fee_analysis.py tests/test_fee_analysis.py
git commit -m "feat: 수수료분석 전체 집계(_aggregate) — 매칭/버킷/채널요약"
```

---

## Task 4: 조회 함수 — 네이버 settle/case + product-orders/query

**Files:**
- Modify: `fee_analysis.py`
- Modify: `tests/test_fee_analysis.py`

**Interfaces:**
- Consumes: `naver_api._request`, `naver_api.get_access_token` (함수 내부 lazy import)
- Produces:
  - `_month_window(month: str) -> tuple[date, date]` — `"2026-07"` → `(date(2026,7,1), date(2026,8,20))`
  - `_fetch_naver_settle(month: str, warnings: list) -> list[dict]`
    - `[date(M,1) .. date(M+1,20)]` 각 날짜에 `GET .../pay-settle/settle/case` (`periodType=SETTLE_CASEBYCASE_SETTLE_BASIS_DATE`, `searchDate=YYYY-MM-DD`, `pageNumber` 순회)
    - `elements` 중 `payDate[:7] == month` 인 것만
    - 각 원소 → `{"product_order_id": str, "product_id": str|None, "product_name": str, "product_order_type": str, "pay_settle_amount": float, "commission": float(음수 그대로)}`
    - 날짜별 실패 시 1회 재시도, 그래도 실패면 `warnings.append(f"네이버 정산 조회 실패: {d}")`
    - 호출 간 `time.sleep(0.2)`
  - `_fetch_naver_quantities(product_order_ids: list[str], warnings: list) -> dict[str, dict]`
    - 300개씩 `POST .../pay-order/seller/product-orders/query` `{"productOrderIds": [...]}`
    - `{productOrderId: {"quantity": float, "status": str}}` (`data[].productOrder.quantity`, `.productOrderStatus`)
    - 배치 실패 시 재시도 1회 후 `warnings.append(...)`; 누락된 id는 결과에 없음

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_fee_analysis.py` 에 추가:
```python
import datetime as _dt


class _Resp:
    def __init__(self, status, payload):
        self.status_code = status
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


def test_month_window():
    a, b = fa._month_window("2026-07")
    assert a == _dt.date(2026, 7, 1)
    assert b == _dt.date(2026, 8, 20)


def test_fetch_naver_settle_filters_by_paydate(monkeypatch):
    monkeypatch.setattr(fa.time, "sleep", lambda *a, **k: None)   # 테스트 빠르게
    calls = {"n": 0}

    def fake_request(method, url, headers=None, params=None, json=None):
        calls["n"] += 1
        if "settle/case" in url:
            return _Resp(200, {"elements": [
                {"productOrderType": "PROD_ORDER", "productOrderId": "po1", "productId": "p1",
                 "productName": "상품1", "payDate": "2026-07-15", "paySettleAmount": 10000,
                 "totalPayCommissionAmount": -300},
                {"productOrderType": "PROD_ORDER", "productOrderId": "po2", "productId": "p2",
                 "productName": "상품2", "payDate": "2026-06-30", "paySettleAmount": 5000,
                 "totalPayCommissionAmount": -150},
                {"productOrderType": "DELIVERY", "productOrderId": "d1", "productId": None,
                 "productName": "기본배송비", "payDate": "2026-07-15", "paySettleAmount": 3000,
                 "totalPayCommissionAmount": -90},
            ], "pagination": {"page": 1, "totalPages": 1}})
        raise AssertionError(url)

    import apis.naver_api as nav
    monkeypatch.setattr(nav, "_request", fake_request)
    monkeypatch.setattr(nav, "get_access_token", lambda: "tok")

    warnings = []
    out = fa._fetch_naver_settle("2026-07", warnings)
    ids = {r["product_order_id"] for r in out}
    assert ids == {"po1"}                              # po2=6월 결제 제외, d1=DELIVERY 제외
    assert out[0]["commission"] == -300
    assert warnings == []


def test_fetch_naver_quantities_batches(monkeypatch):
    monkeypatch.setattr(fa.time, "sleep", lambda *a, **k: None)

    def fake_request(method, url, headers=None, params=None, json=None):
        assert "product-orders/query" in url
        ids = json["productOrderIds"]
        return _Resp(200, {"data": [
            {"productOrder": {"productOrderId": i, "quantity": 2, "productOrderStatus": "PURCHASE_DECIDED"}}
            for i in ids
        ]})

    import apis.naver_api as nav
    monkeypatch.setattr(nav, "_request", fake_request)
    monkeypatch.setattr(nav, "get_access_token", lambda: "tok")

    warnings = []
    q = fa._fetch_naver_quantities([f"po{i}" for i in range(650)], warnings)
    assert len(q) == 650
    assert q["po1"]["quantity"] == 2


def test_fetch_naver_settle_no_dup_on_pagination_retry(monkeypatch):
    monkeypatch.setattr(fa.time, "sleep", lambda *a, **k: None)
    state = {}

    def el(poid, amt, comm):
        return {"productOrderType": "PROD_ORDER", "productOrderId": poid, "productId": "x",
                "productName": "n", "payDate": "2026-07-05",
                "paySettleAmount": amt, "totalPayCommissionAmount": comm}

    def fake_request(method, url, headers=None, params=None, json=None):
        # 첫 순회 날짜(2026-07-01)만 2페이지, 나머지 날짜는 빈 결과
        if params["searchDate"] != "2026-07-01":
            return _Resp(200, {"elements": [], "pagination": {"page": 1, "totalPages": 1}})
        page = params["pageNumber"]
        if page == 1:
            return _Resp(200, {"elements": [el("p1", 100, -3)],
                               "pagination": {"page": 1, "totalPages": 2}})
        # page 2: 최초 1회만 실패 → 재시도 시 page 1부터 다시 → p1 재적재 위험
        if not state.get("p2_ok"):
            state["p2_ok"] = True
            return _Resp(500, {})
        return _Resp(200, {"elements": [el("p2", 200, -6)],
                           "pagination": {"page": 2, "totalPages": 2}})

    import apis.naver_api as nav
    monkeypatch.setattr(nav, "_request", fake_request)
    monkeypatch.setattr(nav, "get_access_token", lambda: "tok")

    out = fa._fetch_naver_settle("2026-07", [])
    ids = [r["product_order_id"] for r in out]
    assert ids.count("p1") == 1        # 재시도가 page-1 행을 중복 적재하면 안 됨
    assert ids.count("p2") == 1
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_fee_analysis.py -k "month_window or naver_settle or naver_quantities" -v`
Expected: `month_window`/`naver_settle`/`naver_quantities` 관련 함수 미정의로 FAIL (모듈은 `import time`/`import datetime as dt` 덕에 정상 수집됨)

- [ ] **Step 3: 최소 구현**

`fee_analysis.py` 상단에 `import time`, `import datetime as dt`, `import requests` 추가
(`requests`는 리포 하드 의존성이고 import 시 config/네트워크를 건드리지 않음 — 순수성 유지).
재시도 `except`는 요청/HTTP 실패만 잡고 파싱 오류(`KeyError`/`ValueError` 등)는 전파시킨다
(파싱 버그가 "조회 실패" 경고로 조용히 묻히면 프로덕션에서 실데이터가 소리 없이 누락됨).
`_fetch_naver_settle`는 날짜별 행을 **로컬 리스트에 모았다가 그 날짜의 전 페이지가
성공한 뒤에만** `out`에 반영한다 (중간 페이지 실패 → 재시도 시 앞 페이지 행 중복 적재 방지).
이후:
```python
NAVER_BASE = "https://api.commerce.naver.com"
_SETTLE_CASE = NAVER_BASE + "/external/v1/pay-settle/settle/case"
_PO_QUERY = NAVER_BASE + "/external/v1/pay-order/seller/product-orders/query"


def _month_window(month):
    y, m = int(month[:4]), int(month[5:7])
    start = dt.date(y, m, 1)
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    return start, dt.date(ny, nm, 20)


def _naver_headers():
    from apis import naver_api
    return {"Authorization": "Bearer %s" % naver_api.get_access_token(), "Content-Type": "application/json"}


def _fetch_naver_settle(month, warnings):
    from apis import naver_api
    headers = _naver_headers()
    start, end = _month_window(month)
    out = []
    d = start
    while d <= end:
        ds = d.isoformat()
        ok = False
        for attempt in range(2):
            rows_for_date = []
            try:
                page = 1
                while True:
                    r = naver_api._request("GET", _SETTLE_CASE, headers=headers, params={
                        "periodType": "SETTLE_CASEBYCASE_SETTLE_BASIS_DATE",
                        "searchDate": ds, "pageNumber": page, "pageSize": 1000,
                    })
                    if r.status_code != 200:
                        raise RuntimeError("HTTP %s" % r.status_code)
                    body = r.json()
                    for el in body.get("elements", []):
                        if el.get("productOrderType") != "PROD_ORDER":
                            continue
                        if str(el.get("payDate", ""))[:7] != month:
                            continue
                        rows_for_date.append({
                            "product_order_id": str(el.get("productOrderId")),
                            "product_id": (str(el["productId"]) if el.get("productId") else None),
                            "product_name": el.get("productName", ""),
                            "product_order_type": el.get("productOrderType"),
                            "pay_settle_amount": float(el.get("paySettleAmount") or 0),
                            "commission": float(el.get("totalPayCommissionAmount") or 0),
                        })
                    pg = body.get("pagination") or {}
                    if page >= (pg.get("totalPages") or 1):
                        break
                    page += 1
                out.extend(rows_for_date)   # 전 페이지 성공 후에만 반영 → 재시도 중복 방지
                ok = True
                break
            except (requests.RequestException, RuntimeError):
                time.sleep(0.5)
        if not ok:
            warnings.append("네이버 정산 조회 실패: %s" % ds)
        time.sleep(0.2)
        d += dt.timedelta(days=1)
    return out


def _fetch_naver_quantities(product_order_ids, warnings):
    from apis import naver_api
    headers = _naver_headers()
    ids = list(dict.fromkeys(product_order_ids))
    result = {}
    for i in range(0, len(ids), 300):
        chunk = ids[i:i + 300]
        got = None
        for attempt in range(2):
            try:
                r = naver_api._request("POST", _PO_QUERY, headers=headers, json={"productOrderIds": chunk})
                if r.status_code != 200:
                    raise RuntimeError("HTTP %s" % r.status_code)
                got = r.json().get("data", [])
                break
            except (requests.RequestException, RuntimeError):
                time.sleep(0.5)
        if got is None:
            warnings.append("네이버 상품주문 조회 실패: %d건" % len(chunk))
            continue
        for od in got:
            po = od.get("productOrder", {})
            pid = str(po.get("productOrderId"))
            result[pid] = {"quantity": float(po.get("quantity") or 0),
                           "status": po.get("productOrderStatus", "")}
        time.sleep(0.2)
    return result
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_fee_analysis.py -v`
Expected: PASS (15 tests)

- [ ] **Step 5: 커밋**

```bash
git add fee_analysis.py tests/test_fee_analysis.py
git commit -m "feat: 수수료분석 네이버 조회(settle/case 결제월 필터 + product-orders 수량)"
```

---

## Task 5: 조회 함수 — 쿠팡 revenue-history

**Files:**
- Modify: `fee_analysis.py`
- Modify: `tests/test_fee_analysis.py`

**Interfaces:**
- Consumes: `coupang_api.generate_coupang_signature`, `coupang_api._request`, `coupang_api.VENDOR_ID` (lazy import)
- Produces:
  - `_fetch_coupang_revenue(month: str, warnings: list) -> list[dict]`
    - `_month_window(month)` 범위를 ≤31일 2구간으로 나눠 `GET .../v1/revenue-history` (`vendorId`, `recognitionDateFrom/To=YYYY-MM-DD`, `token=""` 첫콜, `maxPerPage=50`, 이후 `nextToken`)
    - 서명은 쿼리스트링 포함한 uri로 생성 (`urllib.parse.urlencode`)
    - `data[]` 순회, `saleDate[:7] == month` 인 주문만. 각 `items[]` →
      `{"vendor_item_id": str, "product_id": str|None, "product_name": str, "revenue": float, "fee": float, "qty": float}`
      - `saleType == "REFUND"` 이면 `revenue`/`fee`/`qty` 부호를 음수로
      - `revenue` = `saleAmount`, `fee` = `serviceFee + serviceFeeVat`, `qty` = `quantity`
    - 구간/페이지 실패 시 재시도 1회 후 `warnings.append(...)`

- [ ] **Step 1: 실패하는 테스트 작성**

```python
def test_fetch_coupang_revenue_refund_and_filter(monkeypatch):
    monkeypatch.setattr(fa.time, "sleep", lambda *a, **k: None)
    pages = [
        {"code": 200, "data": [
            {"orderId": 1, "saleType": "SALE", "saleDate": "2026-07-03", "items": [
                {"vendorItemId": 111, "productId": 9, "productName": "훈제오리",
                 "saleAmount": 94400, "serviceFee": 10006, "serviceFeeVat": 1001, "quantity": 1}]},
            {"orderId": 2, "saleType": "REFUND", "saleDate": "2026-07-04", "items": [
                {"vendorItemId": 111, "productId": 9, "productName": "훈제오리",
                 "saleAmount": 94400, "serviceFee": 10006, "serviceFeeVat": 1001, "quantity": 1}]},
            {"orderId": 3, "saleType": "SALE", "saleDate": "2026-06-25", "items": [
                {"vendorItemId": 222, "productId": 8, "productName": "제외대상",
                 "saleAmount": 5000, "serviceFee": 500, "serviceFeeVat": 50, "quantity": 1}]},
        ], "hasNext": False, "nextToken": None},
    ]

    def fake_request(method, url, headers=None, **kw):
        return _Resp(200, pages.pop(0))

    import apis.coupang_api as cpa
    monkeypatch.setattr(cpa, "_request", fake_request)
    monkeypatch.setattr(cpa, "generate_coupang_signature", lambda m, u: "sig")
    monkeypatch.setattr(cpa, "VENDOR_ID", "A0", raising=False)

    warnings = []
    out = fa._fetch_coupang_revenue("2026-07", warnings)
    by_vi = {}
    for r in out:
        by_vi.setdefault(r["vendor_item_id"], []).append(r)
    assert "222" not in by_vi                          # 6월 판매 제외
    sale, refund = sorted(by_vi["111"], key=lambda r: r["revenue"], reverse=True)
    assert sale["revenue"] == 94400 and sale["fee"] == 11007 and sale["qty"] == 1
    assert refund["revenue"] == -94400 and refund["fee"] == -11007 and refund["qty"] == -1
```

(참고: 위 테스트는 첫 구간 1콜만 소비하고 두 번째 구간에서 `pages.pop`이 IndexError를 내지 않도록, 구현에서 각 구간 첫 호출 실패를 warnings로 흡수한다. 구현 Step 3의 `try/except`가 이를 처리 — 두 번째 구간은 `warnings`에 실패 기록 후 빈 결과.)

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_fee_analysis.py -k coupang_revenue -v`
Expected: FAIL — `_fetch_coupang_revenue` 없음

- [ ] **Step 3: 최소 구현**

`fee_analysis.py` 상단에 `from urllib.parse import urlencode` 추가. 이후:
```python
_CP_BASE = "https://api-gateway.coupang.com"
_CP_REVENUE_PATH = "/v2/providers/openapi/apis/api/v1/revenue-history"


def _cp_split_ranges(start, end):
    ranges, cur = [], start
    while cur <= end:
        seg_end = min(cur + dt.timedelta(days=30), end)
        ranges.append((cur, seg_end))
        cur = seg_end + dt.timedelta(days=1)
    return ranges


def _fetch_coupang_revenue(month, warnings):
    from apis import coupang_api as cpa
    start, end = _month_window(month)
    out = []
    for seg_from, seg_to in _cp_split_ranges(start, end):
        token = ""
        page_guard = 0
        while True:
            page_guard += 1
            params = {
                "vendorId": cpa.VENDOR_ID,
                "recognitionDateFrom": seg_from.isoformat(),
                "recognitionDateTo": seg_to.isoformat(),
                "maxPerPage": 50, "token": token,
            }
            uri = _CP_REVENUE_PATH + "?" + urlencode(params)
            try:
                auth = cpa.generate_coupang_signature("GET", uri)
                r = cpa._request("GET", _CP_BASE + uri, headers={
                    "Authorization": auth, "Content-Type": "application/json;charset=UTF-8",
                    "Accept": "application/json",
                })
                if r.status_code != 200:
                    raise RuntimeError("HTTP %s %s" % (r.status_code, r.text[:200]))
                body = r.json()
            except (requests.RequestException, RuntimeError, ValueError) as e:
                # 요청/HTTP/JSON파싱 실패만 흡수 (ValueError=JSONDecodeError). 아이템 매핑 오류는
                # try 밖이라 그대로 전파됨.
                warnings.append("쿠팡 정산 조회 실패(%s~%s): %s" % (seg_from, seg_to, e))
                break
            for od in body.get("data", []):
                if str(od.get("saleDate", ""))[:7] != month:
                    continue
                sign = -1.0 if od.get("saleType") == "REFUND" else 1.0
                for it in od.get("items", []):
                    out.append({
                        "vendor_item_id": str(it.get("vendorItemId")),
                        "product_id": (str(it["productId"]) if it.get("productId") else None),
                        "product_name": it.get("productName", ""),
                        "revenue": sign * float(it.get("saleAmount") or 0),
                        "fee": sign * (float(it.get("serviceFee") or 0) + float(it.get("serviceFeeVat") or 0)),
                        "qty": sign * float(it.get("quantity") or 0),
                    })
            if not body.get("hasNext") or not body.get("nextToken") or page_guard > 500:
                break
            token = body["nextToken"]
    return out
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_fee_analysis.py -v`
Expected: PASS (15 tests)

- [ ] **Step 5: 커밋**

```bash
git add fee_analysis.py tests/test_fee_analysis.py
git commit -m "feat: 수수료분석 쿠팡 조회(revenue-history 2분할 + 환불 부호 + 판매월 필터)"
```

---

## Task 6: 라우터 + 캐시 + server.py 등록

**Files:**
- Modify: `fee_analysis.py` (라우터 + `build_payload` 오케스트레이션)
- Modify: `server.py` (`from fee_analysis import router as fee_analysis_router` / `app.include_router(fee_analysis_router)`)
- Modify: `.gitignore` (`fee_cache_*.json`)
- Modify: `tests/test_fee_analysis.py`

**Interfaces:**
- Consumes: `_fetch_naver_settle`, `_fetch_naver_quantities`, `_fetch_coupang_revenue`, `_aggregate`, `_load_margin_rows`, `_load_channel_links`
- Produces:
  - `_load_margin_rows() -> list[dict]` — `uploads/online.csv` (`pd.read_csv(..., encoding="utf-8-sig")`, `.where(pd.notnull(df), None)`, `to_dict("records")`), 파일 없으면 `[]`
  - `_load_channel_links() -> dict` — `channel_link.json` (없으면 `{}`)
  - `_build_naver_lines(settle, qty_map) -> list[dict]` — settle 라인에 수량 조인. `qty_map`에 없는 `product_order_id`는 `qty=0, qty_partial=True`. 반품/취소 status(`CANCEL`, `RETURN` 포함 문자열)면 `qty` 음수
  - `build_payload(month) -> dict` — 위 조회들 실행 → `_aggregate` → `{"month","fetched_at","basis":"sale","channels","rows","unmatched","warnings"}`
  - `GET /api/fee-analysis?month=YYYY-MM` → 캐시 파일 반환 or `{"status":"error","message":"아직 조회된 정산 데이터가 없습니다. '정산 갱신'을 눌러주세요."}`
  - `POST /api/fee-analysis/refresh` body `{"month":"YYYY-MM"}` → `_refresh_lock` 획득 시도(non-blocking), 이미 진행 중이면 `{"status":"error","message":"조회가 이미 진행 중입니다."}`; 아니면 `build_payload` → `fee_cache_{month}.json` 저장 → `{"status":"success", **payload}`

- [ ] **Step 1: 실패하는 테스트 작성**

```python
def test_build_naver_lines_joins_qty():
    settle = [
        {"product_order_id": "po1", "product_id": "p1", "product_name": "상품1",
         "pay_settle_amount": 10000.0, "commission": -300.0},
        {"product_order_id": "po2", "product_id": "p2", "product_name": "상품2",
         "pay_settle_amount": 5000.0, "commission": -150.0},
    ]
    qty_map = {"po1": {"quantity": 3.0, "status": "PURCHASE_DECIDED"}}
    lines = fa._build_naver_lines(settle, qty_map)
    l1 = next(l for l in lines if l["product_name"] == "상품1")
    l2 = next(l for l in lines if l["product_name"] == "상품2")
    assert l1["revenue"] == 10000.0 and l1["fee"] == 300.0 and l1["qty"] == 3.0
    assert l1["qty_partial"] is False
    assert l2["qty"] == 0.0 and l2["qty_partial"] is True     # 수량 조회 누락


def test_endpoints_refresh_then_get(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)                                # 캐시파일을 임시 디렉터리에
    monkeypatch.setattr(fa, "_fetch_naver_settle", lambda m, w: [
        {"product_order_id": "po1", "product_id": "p1", "product_name": "장터국수 우동국물 6개",
         "pay_settle_amount": 74500.0, "commission": -2237.0}])
    monkeypatch.setattr(fa, "_fetch_naver_quantities", lambda ids, w: {"po1": {"quantity": 1.0, "status": "OK"}})
    monkeypatch.setattr(fa, "_fetch_coupang_revenue", lambda m, w: [])
    monkeypatch.setattr(fa, "_load_margin_rows", lambda: [
        {"온라인 상품명": "장터국수 우동국물", "매입": "50000", "네이버 수수료": "4110", "네이버 판매가": "74500"}])
    monkeypatch.setattr(fa, "_load_channel_links", lambda: {})

    from fastapi.testclient import TestClient
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(fa.router)
    c = TestClient(app)

    r0 = c.get("/api/fee-analysis?month=2026-07")
    assert r0.json()["status"] == "error"                      # 캐시 없음

    r1 = c.post("/api/fee-analysis/refresh", json={"month": "2026-07"})
    j1 = r1.json()
    assert j1["status"] == "success"
    assert j1["month"] == "2026-07" and j1["basis"] == "sale"
    assert len(j1["rows"]) == 1

    r2 = c.get("/api/fee-analysis?month=2026-07")
    assert r2.json()["rows"][0]["product_name"] == "장터국수 우동국물"
    assert (tmp_path / "fee_cache_2026-07.json").exists()


def test_get_fee_analysis_rejects_bad_month(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    from fastapi.testclient import TestClient
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(fa.router)
    c = TestClient(app)
    r = c.get("/api/fee-analysis?month=../../etc/passwd")
    assert r.json()["status"] == "error"
    assert "YYYY-MM" in r.json()["message"]
```

- [ ] **Step 2: 실패 확인**

Run: `PYTHONUTF8=1 python -m pytest tests/test_fee_analysis.py -k "naver_lines or endpoints" -v`
Expected: FAIL — `_build_naver_lines` / `router` 없음

- [ ] **Step 3: 최소 구현**

`fee_analysis.py` 상단: `import json`, `import os`, `import threading`, `from datetime import datetime, timezone, timedelta`, `import pandas as pd`, `from fastapi import APIRouter`. 이후:
```python
router = APIRouter()
_refresh_lock = threading.Lock()
MARGIN_CSV = "uploads/online.csv"
CHANNEL_LINK_FILE = "channel_link.json"
_RETURN_HINTS = ("CANCEL", "RETURN", "REFUND")


def _load_margin_rows():
    if not os.path.exists(MARGIN_CSV):
        return []
    df = pd.read_csv(MARGIN_CSV, encoding="utf-8-sig")
    df = df.where(pd.notnull(df), None)
    return df.to_dict(orient="records")


def _load_channel_links():
    if not os.path.exists(CHANNEL_LINK_FILE):
        return {}
    try:
        with open(CHANNEL_LINK_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _build_naver_lines(settle, qty_map):
    lines = []
    for s in settle:
        poid = s["product_order_id"]
        q = qty_map.get(poid)
        qty = (q["quantity"] if q else 0.0)
        partial = q is None
        if q and any(h in str(q.get("status", "")).upper() for h in _RETURN_HINTS):
            qty = -qty
        lines.append({
            "product_id": s.get("product_id"),
            "product_name": s.get("product_name", ""),
            "revenue": s.get("pay_settle_amount", 0.0),
            "fee": abs(s.get("commission", 0.0)),
            "qty": qty,
            "qty_partial": partial,
        })
    return lines


def build_payload(month):
    warnings = []
    settle = _fetch_naver_settle(month, warnings)
    qty_map = _fetch_naver_quantities([s["product_order_id"] for s in settle], warnings)
    naver_lines = _build_naver_lines(settle, qty_map)
    coupang_lines = _fetch_coupang_revenue(month, warnings)
    agg = _aggregate(naver_lines, coupang_lines, _load_margin_rows(), _load_channel_links())
    kst = timezone(timedelta(hours=9))
    return {
        "month": month, "basis": "sale",
        "fetched_at": datetime.now(kst).isoformat(timespec="seconds"),
        "channels": agg["channels"], "rows": agg["rows"],
        "unmatched": agg["unmatched"], "warnings": warnings,
    }


_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")   # month 파라미터는 GET/POST 양쪽에서 검증 (경로 조작 방지)


def _cache_path(month):
    return "fee_cache_%s.json" % month


@router.get("/api/fee-analysis")
def get_fee_analysis(month: str):
    if not _MONTH_RE.match(month or ""):
        return {"status": "error", "message": "month 형식은 YYYY-MM 이어야 합니다."}
    p = _cache_path(month)
    if not os.path.exists(p):
        return {"status": "error", "message": "아직 조회된 정산 데이터가 없습니다. '정산 갱신'을 눌러주세요."}
    try:
        with open(p, "r", encoding="utf-8") as f:
            return {"status": "success", **json.load(f)}
    except (OSError, ValueError):
        return {"status": "error", "message": "캐시 파일을 읽을 수 없습니다. '정산 갱신'을 다시 눌러주세요."}


@router.post("/api/fee-analysis/refresh")
async def refresh_fee_analysis(request: Request):
    body = await request.json()
    month = (body or {}).get("month", "")
    if not _MONTH_RE.match(month or ""):
        return {"status": "error", "message": "month 형식은 YYYY-MM 이어야 합니다."}
    if not _refresh_lock.acquire(blocking=False):
        return {"status": "error", "message": "조회가 이미 진행 중입니다."}
    try:
        payload = build_payload(month)
        with open(_cache_path(month), "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        return {"status": "success", **payload}
    finally:
        _refresh_lock.release()
```
`from fastapi import APIRouter, Request` 로 import 수정 (Request 추가).

`server.py` L31–34 부근:
```python
from reorder import router as reorder_router
from memos import router as memos_router
from fee_analysis import router as fee_analysis_router

app = FastAPI()
app.include_router(reorder_router)
app.include_router(memos_router)
app.include_router(fee_analysis_router)
```

`.gitignore` — "Local data artifacts" 섹션에 추가:
```
fee_cache_*.json
```

- [ ] **Step 4: 통과 확인**

Run: `PYTHONUTF8=1 python -m pytest tests/test_fee_analysis.py -v`
Expected: PASS (17 tests)

- [ ] **Step 5: server.py import 확인**

Run: `PYTHONUTF8=1 python -c "import server; print([r.path for r in server.app.routes if 'fee-analysis' in r.path])"`
Expected: `['/api/fee-analysis', '/api/fee-analysis/refresh']`

- [ ] **Step 6: 커밋**

```bash
git add fee_analysis.py server.py .gitignore tests/test_fee_analysis.py
git commit -m "feat: 수수료분석 라우터/캐시 + server.py 등록"
```

---

## Task 7: 프론트 — FeeAnalysisTab.jsx

**Files:**
- Create: `frontend/src/components/FeeAnalysisTab.jsx`

**Interfaces:**
- Consumes: `GET/POST /api/fee-analysis*` (Task 6). `API_BASE` from `../apiBase`. `Emoji` from `./Icons`.
- Produces: `export default function FeeAnalysisTab()` — App.jsx 가 `activeTab === 'fee_analysis'` 에 렌더

- [ ] **Step 1: 컴포넌트 작성**

`frontend/src/components/FeeAnalysisTab.jsx`:
```jsx
import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import { Emoji } from './Icons';

const H = { 'ngrok-skip-browser-warning': '69420' };
const won = (n) => (typeof n === 'number' ? Math.round(n).toLocaleString() + '원' : '-');

function lastMonthStr() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const SORTS = {
  diff_abs: (a, b) => Math.abs(b.diff_amount) - Math.abs(a.diff_amount),
  diff_asc: (a, b) => a.diff_amount - b.diff_amount,
  revenue: (a, b) => b.revenue - a.revenue,
  name: (a, b) => String(a.product_name).localeCompare(String(b.product_name)),
};

export default function FeeAnalysisTab() {
  const [month, setMonth] = useState(lastMonthStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [sortKey, setSortKey] = useState('diff_abs');

  const load = useCallback(async (m) => {
    setLoading(true);
    setErrMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/fee-analysis?month=${m}`, { headers: H });
      const j = await res.json();
      if (j.status === 'success') setData(j);
      else { setData(null); setErrMsg(j.message || '데이터가 없습니다.'); }
    } catch (e) {
      setData(null);
      setErrMsg('서버에 연결할 수 없습니다.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  const refresh = async () => {
    setRefreshing(true);
    setErrMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/fee-analysis/refresh`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      });
      const j = await res.json();
      if (j.status === 'success') setData(j);
      else setErrMsg(j.message || '갱신에 실패했습니다.');
    } catch (e) {
      setErrMsg(`갱신 실패: 서버에 연결할 수 없습니다. (${e.message})`);
    }
    setRefreshing(false);
  };

  const rows = data ? [...data.rows].sort(SORTS[sortKey]) : [];

  return (
    <div className="responsive-container" translate="no" style={{ color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Emoji>💸</Emoji> 수수료 분석
        </h2>
        <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>결제일 기준</span>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          disabled={refreshing}
          style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}
        />
        <button
          onClick={refresh}
          disabled={refreshing}
          className="esangin-btn"
          style={{ opacity: refreshing ? 0.6 : 1 }}
        >
          {refreshing ? '⏳ 정산 조회 중…' : '🔄 정산 갱신'}
        </button>
        {data?.fetched_at && !refreshing && (
          <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>
            마지막 갱신: {String(data.fetched_at).replace('T', ' ').slice(0, 16)}
          </span>
        )}
      </div>

      {refreshing && (
        <div style={{ marginBottom: '14px', padding: '12px 16px', borderRadius: '12px', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', fontSize: '13px' }}>
          네이버·쿠팡 정산 내역을 불러오는 중입니다. 30초~1분 걸릴 수 있어요.
        </div>
      )}

      {errMsg && !refreshing && (
        <div style={{ marginBottom: '14px', padding: '12px 16px', borderRadius: '12px', background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 35%, transparent)', color: 'var(--amber)', fontSize: '13px', fontWeight: 600 }}>
          <Emoji>⚠️</Emoji> {errMsg}
        </div>
      )}

      {data?.warnings?.length > 0 && (
        <div style={{ marginBottom: '14px', padding: '12px 16px', borderRadius: '12px', background: 'color-mix(in srgb, var(--amber) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 25%, transparent)', fontSize: '12px', color: 'var(--text-3)' }}>
          {data.warnings.map((w, i) => <div key={i}>· {w}</div>)}
        </div>
      )}

      <div style={{ opacity: refreshing ? 0.4 : 1, transition: 'opacity .2s' }}>
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', marginBottom: '20px' }}>
              {['naver', 'coupang'].map((ch) => {
                const c = data.channels[ch];
                const label = ch === 'naver' ? '🟢 네이버' : '🚀 쿠팡';
                return (
                  <div key={ch} className="ui-card" style={{ padding: '16px', borderRadius: '16px', background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700, marginBottom: '10px' }}>{label}</div>
                    <Row k="매출" v={won(c.revenue)} />
                    <Row k="실제 수수료" v={won(c.actual_fee)} />
                    <Row k="예측 수수료" v={won(c.estimated_fee)} />
                    <Row k="실제 순마진" v={won(c.actual_margin)} strong />
                    <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-3)' }}>
                      미매칭 매출 {won(c.unmatched_revenue)} · 수수료 {won(c.unmatched_fee)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>상품별 예측 vs 실제 마진</h3>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}>
                <option value="diff_abs">차이 큰 순</option>
                <option value="diff_asc">차이 작은 순(손해 큰 순)</option>
                <option value="revenue">매출 높은 순</option>
                <option value="name">이름순</option>
              </select>
            </div>

            <div className="responsive-overflow" style={{ overflowX: 'auto', background: 'var(--surface)', borderRadius: '16px' }}>
              <table style={{ width: '100%', minWidth: '860px', borderCollapse: 'collapse', fontSize: '13px', whiteSpace: 'nowrap' }}>
                <thead style={{ background: 'var(--surface-2)' }}>
                  <tr>
                    {['상품명', '채널', '수량', '매출', '예측수수료', '실제수수료', '예측마진', '실제마진', '차이(₩)', '차이(%)'].map((h) => (
                      <th key={h} style={{ padding: '10px', textAlign: h === '상품명' ? 'left' : 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 10px', textAlign: 'left' }}>
                        {r.match_confidence < 0.7 && <span title="이름 매칭 불확실">⚠️ </span>}
                        {r.product_name}
                        {r.match_method === 'name' && (
                          <span style={{ marginLeft: '6px', fontSize: '10px', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: '999px', padding: '1px 5px' }}>이름매칭</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.channel === 'naver' ? '네이버' : '쿠팡'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.qty_partial ? '*' : ''}{Math.round(r.qty)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{won(r.revenue)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{won(r.estimated_fee)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{won(r.actual_fee)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{won(r.estimated_margin)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{won(r.actual_margin)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: r.diff_amount < 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>
                        {r.diff_amount > 0 ? '+' : ''}{won(r.diff_amount)}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: r.diff_amount < 0 ? 'var(--danger)' : 'var(--success)' }}>
                        {r.diff_pct === null || r.diff_pct === undefined ? '-' : `${r.diff_pct > 0 ? '+' : ''}${r.diff_pct}%`}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={10} style={{ padding: '30px', textAlign: 'center', color: 'var(--text-3)' }}>매칭된 상품이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {data.unmatched?.length > 0 && (
              <details style={{ marginTop: '18px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '14px' }}>
                  미매칭 {data.unmatched.length}건 (마진산출장부에서 못 찾음 — 계산 미포함)
                </summary>
                <div className="responsive-overflow" style={{ overflowX: 'auto', marginTop: '8px', background: 'var(--surface)', borderRadius: '12px' }}>
                  <table style={{ width: '100%', minWidth: '520px', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead style={{ background: 'var(--surface-2)' }}>
                      <tr>{['상품명', '채널', '매출', '실제수수료'].map((h) => <th key={h} style={{ padding: '8px', textAlign: h === '상품명' ? 'left' : 'right' }}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {data.unmatched.map((u, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 8px', textAlign: 'left' }}>{u.product_name}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{u.channel === 'naver' ? '네이버' : '쿠팡'}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{won(u.revenue)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{won(u.actual_fee)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}
        {!data && !loading && !errMsg && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-3)' }}>월을 선택하고 "정산 갱신"을 눌러주세요.</div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '13px' }}>
      <span style={{ color: 'var(--text-3)' }}>{k}</span>
      <span style={{ fontWeight: strong ? 700 : 400 }}>{v}</span>
    </div>
  );
}
```

- [ ] **Step 2: 린트**

Run: `cd frontend && npm run lint`
Expected: `FeeAnalysisTab.jsx` 관련 신규 에러 없음 (기존 파일의 기존 경고는 무관)

- [ ] **Step 3: 빌드**

Run: `cd frontend && npm run build`
Expected: 빌드 성공

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/FeeAnalysisTab.jsx
git commit -m "feat: 수수료 분석 탭 UI (요약 카드 + 정렬 테이블 + 미매칭 + 로딩 UX)"
```

---

## Task 8: 프론트 — 탭 등록 (Sidebar + App)

**Files:**
- Modify: `frontend/src/components/Sidebar.jsx` (`NAV_ITEMS` 배열)
- Modify: `frontend/src/App.jsx` (import 목록 + 렌더 스위치)

**Interfaces:**
- Consumes: `FeeAnalysisTab` (Task 7)
- Produces: `activeTab === 'fee_analysis'` 라우팅

- [ ] **Step 1: Sidebar 메뉴 항목 추가**

`frontend/src/components/Sidebar.jsx` — `NAV_ITEMS` 에서 `{ key: 'margin', ... }` 바로 다음 줄에 추가:
```js
  { key: 'fee_analysis', label: '수수료 분석', icon: '💸', group: 'sales' },
```

- [ ] **Step 2: App.jsx import 추가**

`frontend/src/App.jsx` L16 부근(`SurgeChannelExpansionTab` import 다음 줄)에 추가:
```jsx
import FeeAnalysisTab from './components/FeeAnalysisTab'; // 💡 수수료 분석
```

- [ ] **Step 3: App.jsx 렌더 스위치 추가**

`frontend/src/App.jsx` L104 부근, `{activeTab === 'margin' && <MarginTab />}` 다음 줄에 추가:
```jsx
              {activeTab === 'fee_analysis' && <FeeAnalysisTab />}
```

- [ ] **Step 4: 린트 + 빌드**

Run: `cd frontend && npm run lint && npm run build`
Expected: 신규 에러 없음, 빌드 성공

- [ ] **Step 5: 수동 확인**

`cd frontend && npm run dev` → 브라우저에서 사이드바 "수수료 분석"(💸) 클릭 → 탭 전환되고 "월을 선택하고 정산 갱신을 눌러주세요" 안내가 보이는지 (백엔드 미배포 상태면 갱신은 에러 배너로 끝나도 정상)

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/Sidebar.jsx frontend/src/App.jsx
git commit -m "feat: 수수료 분석 탭 사이드바/라우팅 등록"
```

---

## Task 9: 프로덕션 배포 + 실데이터 검증

**Files:** (배포만, 코드 변경 없음)
- Deploy: `fee_analysis.py`, `server.py`

**Interfaces:**
- Consumes: 전체 파이프라인
- Produces: 프로드에서 동작하는 `/api/fee-analysis*` + 실 정산 데이터 기준 캐시 파일

- [ ] **Step 1: 백엔드 배포**

레포 루트에서 (사용자가 `!` 로 실행하거나 배포 권한 필요):
```bash
gcloud compute scp ./fee_analysis.py ./server.py ys101312@instance-20260709-123435:/home/ys101312/ --zone=us-central1-a --project=gen-lang-client-0363132726
gcloud compute ssh ys101312@instance-20260709-123435 --zone=us-central1-a --project=gen-lang-client-0363132726 --command="cd /home/ys101312/store/store/onepick-dashboard && cp /home/ys101312/fee_analysis.py ./fee_analysis.py && cp /home/ys101312/server.py ./server.py && rm -f /home/ys101312/fee_analysis.py /home/ys101312/server.py && sudo systemctl restart onepick.service && sleep 8 && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/api/health"
```
Expected: `200`

- [ ] **Step 2: 지난달 정산 갱신 실행**

```bash
gcloud compute ssh ys101312@instance-20260709-123435 --zone=us-central1-a --project=gen-lang-client-0363132726 --command="curl -s -X POST http://127.0.0.1:8000/api/fee-analysis/refresh -H 'Content-Type: application/json' -d '{\"month\":\"2026-07\"}' | python3 -m json.tool | head -60"
```
Expected: `status: success`, `channels.naver.revenue`/`actual_fee` 양수, `rows` 비어있지 않음, `warnings` 확인

- [ ] **Step 3: 스팟 체크**

응답에서 상위 3개 `rows` 를 골라 — 해당 상품의 `actual_fee / revenue` 비율이 상식 범위(네이버 ~3%, 쿠팡 ~10.6%)인지, `diff_amount` 부호(음수 = 예상보다 더 뗌)가 말이 되는지 육안 확인. 이상하면 `_aggregate`/`_compute_row` 재점검.

- [ ] **Step 4: GET 재조회 + 캐시 파일 확인**

```bash
gcloud compute ssh ys101312@instance-20260709-123435 --zone=us-central1-a --project=gen-lang-client-0363132726 --command="cd /home/ys101312/store/store/onepick-dashboard && ls -la fee_cache_2026-07.json && curl -s 'http://127.0.0.1:8000/api/fee-analysis?month=2026-07' | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d[\"status\"], len(d[\"rows\"]), \"rows\")'"
```
Expected: 캐시 파일 존재, `success N rows`

- [ ] **Step 5: 프론트 확인**

`frontend/src/apiBase.js` 가 트라이클라우드 터널 주소인지 확인 후 `npm run dev` → "수수료 분석" 탭 → 2026-07 선택 → "정산 갱신" → 로딩 문구·비활성·흐림 처리가 보이고, 30~60초 후 요약 카드 + 테이블이 채워지는지 확인

- [ ] **Step 6: 최종 커밋 (문서/플랜 체크박스)**

```bash
git add docs/superpowers/plans/2026-08-28-fee-analysis-tab.md
git commit -m "docs: 수수료 분석 구현 플랜 진행 체크"
```

---

## Self-Review

**Spec coverage:**

| 스펙 항목 | 담당 태스크 |
|---|---|
| §2.1 네이버 settle/case (결제월 필터, periodType, 페이지네이션) | Task 4 |
| §2.2 쿠팡 revenue-history (`token=""`, 2분할, nextToken, REFUND) | Task 5 |
| §2.3 채널 총액 교차검증 | 범위 밖(스펙에서도 "구현 선택") — 미포함 |
| §2.4 네이버 product-orders/query 실제 수량 | Task 4 |
| §3 매칭 (ID → 이름 fuzzy → 미매칭, 다:1 합산) | Task 1, Task 3 |
| §4 계산 (실매출 기준, 수수료만 교체, diff, VAT 가정) | Task 2 |
| §4 채널 요약 카드 값 | Task 3 |
| §5 결제월 기준 조회창 [M-01 … (M+1)-20] | Task 4 (`_month_window`), Task 5 |
| §6.1 GET/POST 엔드포인트 + 캐시 + 동시성 가드 | Task 6 |
| §6.2 내부 함수 | Task 4–6 |
| §6.3 캐시 스키마 | Task 6 (`build_payload`) |
| §7 프론트 (월 선택, 갱신 로딩 UX, 요약 카드, 정렬 테이블, 미매칭 섹션, ⚠️/이름매칭 배지) | Task 7 |
| §7 Sidebar/App 등록 | Task 8 |
| §8 에러 처리 (캐시 없음, 조회 실패 warnings, 동시 refresh) | Task 6 (+ Task 7 배너) |
| §9 범위 밖 | 해당 태스크 없음(의도적) |
| §10 리스크 (lookback, 반품 net 수량, qty_partial) | Task 4 (`_fetch_naver_quantities` 누락 처리), Task 6 (`_build_naver_lines` 반품 부호) |

갭: §2.3 교차검증 로그는 스펙에서도 선택이라 생략. 나머지 요구사항은 태스크에 매핑됨.

**Placeholder scan:** "TBD"/"적절히 처리"/"위와 유사" 없음. 모든 코드 스텝에 실제 코드 포함. 테스트 스텝에 실제 assert 포함.

**Type consistency:**
- `_match_product` 반환 `(row, method, confidence)` — Task 1 정의, Task 3 에서 그대로 사용 ✓
- `_compute_row(agg, margin_row, channel)` 의 `agg` 키 `{revenue, actual_fee, qty, qty_partial}` — Task 2 정의, Task 3 `_aggregate` 버킷이 동일 키로 생성 ✓
- `_aggregate` 반환 `{channels, rows, unmatched}`, `rows` 원소에 `match_method`/`match_confidence` 추가 — Task 3 정의, Task 6 `build_payload` 가 그대로 페이로드에 병합, Task 7 프론트가 `r.match_method`/`r.match_confidence`/`r.diff_amount`/`r.diff_pct`/`r.qty_partial` 참조 ✓
- 네이버 라인 키 `{product_id, product_name, revenue, fee, qty, qty_partial}` — Task 6 `_build_naver_lines` 생성, Task 3 `_aggregate` 의 `naver_lines` 계약과 일치 ✓
- 쿠팡 라인 키 `{vendor_item_id, product_id, product_name, revenue, fee, qty}` — Task 5 생성, Task 3 `coupang_lines` 계약과 일치 ✓
- `build_payload` 페이로드 키 `{month, basis, fetched_at, channels, rows, unmatched, warnings}` — Task 6 정의, Task 7 프론트가 `data.channels`/`data.rows`/`data.unmatched`/`data.warnings`/`data.fetched_at` 참조 ✓
- 캐시 파일명 `fee_cache_{month}.json` — Task 6 `_cache_path` 단일 정의 ✓
- `.gitignore` 패턴 `fee_cache_*.json` ↔ 파일명 일치 ✓
