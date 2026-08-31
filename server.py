import csv
import re
from difflib import SequenceMatcher
from fastapi import FastAPI, Request, File, UploadFile, Form, Query, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from fastapi.responses import PlainTextResponse
from fastapi.responses import JSONResponse
from threading import Lock
from urllib.parse import unquote
from collections import defaultdict, Counter
from bs4 import BeautifulSoup
import subprocess # 👈 맨 위에 추가
import pandas as pd
import io
import os
import time
import json
import uuid
import requests
import pymysql


# 💡 분리해둔 네이버 API 모듈 불러오기
from apis import naver_api
from apis import coupang_api, lotteon_api
from apis import sikbom_api
from apis import playauto_rpa

# 💡 재발주 알림 라우터
from reorder import router as reorder_router
# 💡 메모장 라우터 (자유메모 + 메모 카드) — memos.py 분리 모듈
from memos import router as memos_router
# 💡 오늘 할 일 라우터 — todos.py 분리 모듈
from todos import router as todos_router
# 💡 퇴근 전 체크리스트 라우터 (TodoListTab.jsx 하단에서 같이 씀) — checklist.py 분리 모듈
from checklist import router as checklist_router
# 💡 상품 이미지 배경 제거 라우터 — bgremove.py 분리 모듈
from bgremove import router as bgremove_router
# 💡 수수료분석 라우터 (정산 수수료 vs 예측 수수료) — fee_analysis.py 분리 모듈
from fee_analysis import router as fee_analysis_router

app = FastAPI()
app.include_router(reorder_router)
app.include_router(memos_router)
app.include_router(todos_router)
app.include_router(checklist_router)
app.include_router(bgremove_router)
app.include_router(fee_analysis_router)


# React와 통신 허가
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False, # 👈 [유지 완료] False 세팅 완벽합니다!
    allow_methods=["*"],
    allow_headers=["*"],
)

MARGIN_FILE_PATH = "uploads/online.csv"
ORDERS_IMPORT_DIR = "uploads/orders_import"
ORDERS_FILE = 'playauto_orders.json'
STOCK_FILE = 'e_sangin_stock_all.csv'
MAPPING_FILE = 'mapping.csv'
os.makedirs(ORDERS_IMPORT_DIR, exist_ok=True)

# ==========================================
# ⚡ 간단 TTL 캐시 (서버 프로세스 메모리)
# ==========================================
_cache_lock = Lock()
_cache: dict[str, tuple[float, object]] = {}

def cache_get(key: str):
    now = time.time()
    with _cache_lock:
        item = _cache.get(key)
        if not item: return None
        expires_at, value = item
        if expires_at < now:
            _cache.pop(key, None)
            return None
        return value

def cache_set(key: str, value, ttl_seconds: int):
    with _cache_lock:
        _cache[key] = (time.time() + ttl_seconds, value)

# ==========================================
# 🧾 요청 로깅 (간단/구조화)
# ==========================================
@app.middleware("http")
async def log_requests(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    start = time.time()
    try:
        response = await call_next(request)
        elapsed_ms = int((time.time() - start) * 1000)
        print(f"[{request_id}] {request.method} {request.url.path} {response.status_code} {elapsed_ms}ms")
        response.headers["x-request-id"] = request_id
        return response
    except Exception as e:
        elapsed_ms = int((time.time() - start) * 1000)
        print(f"[{request_id}] {request.method} {request.url.path} 500 {elapsed_ms}ms err={e}")
        raise

# ==========================================
# 🔄 price_changes 계산 (순수 로직)
# ==========================================
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

# ==========================================
# 🛠️ [핵심] 엑셀 데이터 정제 함수 (중복 제거 및 이름 수정)
# ==========================================
def clean_dataframe(df):
    df.columns = [str(col).strip() for col in df.columns]
    df = df.loc[:, ~df.columns.duplicated(keep='first')]
    df = df.loc[:, ~df.columns.str.contains(r'\.\d+$')]
    df = df.loc[:, ~df.columns.str.contains('^Unnamed')]
    df = df.rename(columns={"배민,쿠팡 택배비": "배민/쿠팡 택배비"})
    return df.fillna("")

def load_saved_data():
    if os.path.exists(MARGIN_FILE_PATH):
        try:
            if MARGIN_FILE_PATH.endswith('.csv'): df = pd.read_csv(MARGIN_FILE_PATH)
            else: df = pd.read_excel(MARGIN_FILE_PATH)
            df = clean_dataframe(df)
            print(f"[OK] Loaded '{MARGIN_FILE_PATH}' after cleanup")
            return df.to_dict(orient="records")
        except Exception as e:
            print(f"[ERR] Auto load failed: {e}")
    return []

current_margin_data = load_saved_data()

# ==========================================
# ✅ Request Models (프론트 계약 고정)
# ==========================================
class OrdersConfirmRequest(BaseModel):
    naver_ids: list[str] = Field(default_factory=list)

class NaverSeoRequest(BaseModel):
    channel_no: str = ""
    new_name: str = ""

# ==========================================
# 📥 Orders import (식봄/배민/롯데온 등 API 없는 마켓용)
# ==========================================
REQUIRED_ORDER_COLUMNS = ["상품주문번호", "주문상태", "상품명", "수량", "결제금액"]
_imported_orders_lock = Lock()
_imported_orders: dict[str, list[dict]] = {}

def _read_table_from_upload(filename: str, content: bytes) -> pd.DataFrame:
    if filename.lower().endswith(".csv"):
        try: return pd.read_csv(io.BytesIO(content), encoding="utf-8-sig")
        except Exception: return pd.read_csv(io.BytesIO(content))
    return pd.read_excel(io.BytesIO(content))

def _normalize_import_orders(df: pd.DataFrame, market_label: str) -> list[dict]:
    df = clean_dataframe(df)
    cols = list(df.columns)

    def pick(*candidates):
        for c in candidates:
            if c in cols: return c
        return None

    order_id_col = pick("상품주문번호", "상품주문번호(상품주문번호)", "주문번호", "주문ID", "주문아이디", "order_id")
    status_col = pick("주문상태", "상태", "배송상태", "진행상태")
    name_col = pick("상품명", "상품명/옵션", "상품정보", "상품", "제품명", "품목명")
    qty_col = pick("수량", "주문수량", "구매수량", "개수", "수량(개)")
    amount_col = pick("결제금액", "결제금액(원)", "총결제금액", "결제액", "주문금액", "판매금액", "합계")

    orders = []
    for i, row in df.iterrows():
        product_order_id = str(row.get(order_id_col, "")).strip() if order_id_col else f"IMPORT-{market_label}-{i+1}"
        status = str(row.get(status_col, "")).strip() if status_col else "신규주문"
        name = str(row.get(name_col, "")).strip() if name_col else ""
        try: qty = int(float(str(row.get(qty_col, 1)).replace(",", "").strip() or "1"))
        except: qty = 1
        try: amount = int(float(str(row.get(amount_col, 0)).replace(",", "").replace("원", "").strip() or "0"))
        except: amount = 0

        orders.append({
            "상품주문번호": product_order_id, "마켓": market_label, "주문상태": status,
            "상품명": name, "수량": qty, "결제금액": amount,
        })
    return [o for o in orders if o.get("상품명") or o.get("결제금액") or o.get("수량")]

def _load_imported_orders_from_disk():
    market_files = {
        "sikbom": ("🥬 식봄", os.path.join(ORDERS_IMPORT_DIR, "sikbom.csv")),
        "baemin": ("🛵 배민", os.path.join(ORDERS_IMPORT_DIR, "baemin.csv")),
        "lotteon_manual": ("🔴 롯데온(수동)", os.path.join(ORDERS_IMPORT_DIR, "lotteon_manual.csv")),
    }
    with _imported_orders_lock:
        for key, (label, path) in market_files.items():
            if not os.path.exists(path): continue
            try:
                df = pd.read_csv(path, encoding="utf-8-sig")
                _imported_orders[key] = _normalize_import_orders(df, label)
            except Exception as e: print(f"[ERR] Imported orders load failed ({key}): {e}")

_load_imported_orders_from_disk()

@app.get("/api/orders/import/template", response_class=PlainTextResponse)
def orders_import_template():
    return ",".join(REQUIRED_ORDER_COLUMNS) + "\nSAMPLE-001,신규주문,상품명 예시,1,10000\n"

@app.post("/api/orders/import")
async def import_orders(market: str = Form(...), file: UploadFile = File(...)):
    market_key = (market or "").strip().lower()
    market_label_map = {"sikbom": "🥬 식봄", "baemin": "🛵 배민", "lotteon_manual": "🔴 롯데온(수동)"}
    if market_key not in market_label_map: return {"status": "error", "message": "잘못된 마켓입니다."}

    try:
        content = await file.read()
        df = _read_table_from_upload(file.filename or "upload.csv", content)
        orders = _normalize_import_orders(df, market_label_map[market_key])
        pd.DataFrame(orders).to_csv(os.path.join(ORDERS_IMPORT_DIR, f"{market_key}.csv"), index=False, encoding="utf-8-sig")
        with _imported_orders_lock: _imported_orders[market_key] = orders
        with _cache_lock: _cache.pop("orders_all_v1", None)
        return {"status": "success", "message": f"{market_label_map[market_key]} 주문 가져오기 성공"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# ==========================================
# 📦 1. 신규 주문 조회 API
# ==========================================
@app.get("/api/orders")
def get_orders(page: int = Query(1, ge=1), page_size: int = Query(200, ge=1, le=1000)):
    cached_all = cache_get("orders_all_v1")
    if isinstance(cached_all, list):
        start = (page - 1) * page_size
        return {"status": "success", "data": cached_all[start:start + page_size]}

    orders: list[dict] = []
    
    # 네이버
    try:
        for o in naver_api.get_new_orders() or []:
            orders.append({
                "상품주문번호": str(o.get("상품주문번호", "")).strip(), "마켓": "🟢 네이버",
                "주문상태": str(o.get("주문상태", "")).strip(), "상품명": o.get("상품명", ""),
                "수량": int(o.get("수량", 0) or 0), "결제금액": int(o.get("결제금액", 0) or 0)
            })
    except Exception as e: print(f"[ERR] Naver orders: {e}")

    # 쿠팡
    try:
        for o in coupang_api.get_coupang_orders() or []:
            orders.append({
                "상품주문번호": str(o.get("상품주문번호", "")).strip(), "마켓": "🚀 쿠팡",
                "주문상태": str(o.get("주문상태", "신규주문")).strip() or "신규주문", "상품명": o.get("상품명", ""),
                "수량": int(o.get("수량", 0) or 0), "결제금액": int(o.get("결제금액", 0) or 0)
            })
    except Exception as e: print(f"[ERR] Coupang orders: {e}")

    # 롯데온
    try:
        for o in lotteon_api.get_lotteon_orders() or []:
            orders.append({
                "상품주문번호": str(o.get("상품주문번호", "")).strip(), "마켓": "🔴 롯데온",
                "주문상태": str(o.get("주문상태", "신규주문")).strip() or "신규주문", "상품명": o.get("상품명", ""),
                "수량": int(o.get("수량", 0) or 0), "결제금액": int(o.get("결제금액", 0) or 0)
            })
    except Exception as e: print(f"[ERR] Lotteon orders: {e}")

    # ==========================================
    # 🤖 플레이오토 연동 추가!
    # ==========================================
    try:
        for o in playauto_api.get_playauto_orders() or []:
            orders.append(o) # playauto_api.py에서 이미 규격에 맞게 정리해서 주니까 바로 append!
    except Exception as e: print(f"[ERR] PlayAuto orders: {e}")
    # ==========================================

    # 수동 수집
    try:
        with _imported_orders_lock:
            for imported in _imported_orders.values():
                if isinstance(imported, list): orders.extend(imported)
    except Exception as e: print(f"[ERR] Imported merge: {e}")

    orders = [o for o in orders if o.get("상품주문번호")]
    orders.sort(key=lambda x: x.get("상품주문번호", ""), reverse=True)
    cache_set("orders_all_v1", orders, ttl_seconds=10)

    start = (page - 1) * page_size
    return {"status": "success", "data": orders[start:start + page_size]}

@app.post("/api/orders/confirm")
def confirm_orders(payload: OrdersConfirmRequest):
    try:
        naver_ids = [str(x).strip() for x in (payload.naver_ids or []) if str(x).strip()]
        if not naver_ids: return {"status": "error", "message": "처리할 주문이 없습니다."}
        success, msg = naver_api.confirm_naver_orders(naver_ids)
        return {"status": "success" if success else "error", "message": msg}
    except Exception as e: return {"status": "error", "message": str(e)}

# ==========================================
# 📊 2. 마진 장부 데이터 조회 (수정됨)
# ==========================================
@app.get("/api/margin/data")
def get_margin_data():
    global current_margin_data
    
    # 💡 [핵심 해킹 포인트] 머리가 비어있어도, 하드디스크(파일)에 저장된 파일이 있으면 불러와서 기억을 되살립니다!
    if not current_margin_data:
        if os.path.exists(MARGIN_FILE_PATH):
            try:
                df = pd.read_csv(MARGIN_FILE_PATH, encoding='utf-8-sig')
                # 빈 칸(NaN) 때문에 에러가 나지 않도록 처리
                df = df.where(pd.notnull(df), None) 
                current_margin_data = df.to_dict(orient="records")
            except Exception as e:
                print(f"⚠️ 저장된 파일 읽기 에러: {e}")

    # 파일을 열어봐도 진짜 데이터가 없으면 에러 반환
    if not current_margin_data: 
        return {"status": "error", "message": "저장된 데이터 없음"}
        
    summary = []
    for row in current_margin_data:
        prod_name = row.get("온라인 상품명", row.get("상품명", "이름없음"))
        summary.append({
            "온라인 상품명": prod_name, "네이버 판매가": row.get("네이버 판매가", 0),
            "쿠팡 판매가": row.get("쿠팡 판매가", 0), "배민 판매가": row.get("배민 판매가", 0),
            "롯데온 판매가": row.get("롯데온 판매가", 0), "식봄 판매가": row.get("식봄 판매가", 0)
        })
    return {"status": "success", "full_data": current_margin_data, "summary_data": summary}

@app.post("/api/margin/calculate")
async def calculate_margin(file: UploadFile = File(None)):
    global current_margin_data
    try:
        if not file: return {"status": "error", "message": "파일 없음"}
        contents = await file.read()
        if file.filename.endswith('.csv'): df = pd.read_csv(io.BytesIO(contents))
        else: df = pd.read_excel(io.BytesIO(contents))
        
        df = clean_dataframe(df)
        current_margin_data = df.to_dict(orient="records")
        df.to_csv(MARGIN_FILE_PATH, index=False, encoding='utf-8-sig')

        summary = [{"온라인 상품명": row.get("온라인 상품명", row.get("상품명", "이름없음"))} for row in current_margin_data]
        return {"status": "success", "full_data": current_margin_data, "summary_data": summary, "saved_as": os.path.basename(MARGIN_FILE_PATH)}
    except Exception as e: return {"status": "error", "message": str(e)}

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

# ==========================================
# 🏷️ 5. 네이버 API 관련
# ==========================================
@app.get("/api/naver/products")
def list_naver_products():
    cached = cache_get("naver_products_v1")
    if isinstance(cached, list): return {"status": "success", "data": cached}

    raw = naver_api.get_my_products() or []
    data = [{**p, "channel_no": p.get("channel_no") or p.get("channelProductNo") or ""} for p in raw if isinstance(p, dict)]
    cache_set("naver_products_v1", data, ttl_seconds=30)
    return {"status": "success", "data": data}

@app.get("/api/naver/products/{channel_no}")
def get_naver_product_detail(channel_no: str):
    data = naver_api.get_naver_product_detail(channel_no)
    if data: return {"status": "success", "data": data}
    return {"status": "error", "message": "상세 정보 불러오기 실패"}

@app.get("/api/coupang/products/{seller_product_id}")
def get_coupang_product_detail_route(seller_product_id: str):
    data = coupang_api.get_coupang_product_detail(seller_product_id)
    if data: return {"status": "success", "data": data}
    return {"status": "error", "message": "상세 정보 불러오기 실패"}

@app.get("/api/naver/keyword/{keyword}")
def get_naver_keyword(keyword: str):
    try:
        kw = unquote(keyword).strip()
        if not kw: return {"status": "error", "message": "키워드가 비어있습니다."}
        volume, tags = naver_api.get_keyword_data_with_tags(kw)
        return {"status": "success", "data": {"keyword": kw, "volume": int(volume or 0), "tags": tags or []}}
    except Exception as e: return {"status": "error", "message": str(e)}

@app.post("/api/naver/seo")
def update_naver_seo(payload: NaverSeoRequest):
    try:
        if not payload.channel_no or not payload.new_name: return {"status": "error", "message": "필수값 누락"}
        success, msg = naver_api.update_naver_product_name(payload.channel_no, payload.new_name)
        return {"status": "success" if success else "error", "message": msg}
    except Exception as e: return {"status": "error", "message": str(e)}

@app.get("/api/health")
def health(): return {"status": "success"}


@app.get("/api/prod-drift-status")
def get_prod_drift_status():
    """prod_drift_check.py가 cron으로 주기 실행하며 남기는 결과 파일을 그대로 읽어서
    돌려준다. 아직 cron이 한 번도 안 돌았거나(첫 배포 직후) 파일이 없으면, 프론트가
    배너를 잘못 띄우지 않도록 "정상"으로 간주하는 안전한 기본값을 준다."""
    default = {"checked_at": None, "ok": True, "never_run": True}
    status = _load_json_file("prod_drift_status.json", default)
    return {"status": "success", "data": status}

@app.post("/api/naver/products/upload")
async def upload_naver_product(
    mode: str = Form(...), channel_no: str = Form(""), name: str = Form(...), price: str = Form(...),
    stock: str = Form("5"), detailContent: str = Form(""), cat_id: str = Form(""), main_image: UploadFile = File(None)
):
    try:
        ext_data = {"cat_id": cat_id, "product_cond": "NEW", "minor_purc": True, "use_option": False, "del_type": "DELIVERY", "pay_type": "PREPAID", "as_guide": "상세페이지 참조"}
        main_image_url = None
        
        if main_image and main_image.filename:
            url, msg = naver_api.upload_image_to_naver(await main_image.read(), main_image.filename)
            if not url: return {"status": "error", "message": f"이미지 업로드 실패: {msg}"}
            main_image_url = url 

        if mode == "update":
            success, msg = naver_api.update_naver_product_advanced(channel_no, name, price, stock, "자체제작", "자체브랜드", "010-0000-0000", "CJGLS", 3000, 3000, 6000, None, [], detailContent, [], ext_data)
        else:
            if channel_no:
                success, msg = naver_api.create_new_naver_product(channel_no, name, price, stock, "자체제작", "자체브랜드", "010-0000-0000", "CJGLS", 3000, 3000, 6000, None, [], detailContent, [], ext_data)
            else:
                success, msg = naver_api.create_completely_new_product(name, price, stock, "자체제작", "자체브랜드", "010-0000-0000", "CJGLS", 3000, 3000, 6000, main_image_url, [], detailContent, [], ext_data)
        
        return {"status": "success" if success else "error", "message": msg}
    except Exception as e: return {"status": "error", "message": str(e)}

# ==========================================
# 🏢 8. E상인 실시간 재고 연동 API (🔥 진정한 직전 매입가 추적 엔진)
# ==========================================
@app.get("/api/esangin-stock")
def get_esangin_stock():
    backup_file = "esangin_backup.json" 
    tracker_file = "price_tracker.json" # 💡 [신규] 가격이 변할 때만 기록하는 AI 비밀 장부

    # 1. AI 비밀 장부 불러오기
    price_tracker = {}
    if os.path.exists(tracker_file):
        try:
            with open(tracker_file, "r", encoding="utf-8") as f:
                price_tracker = json.load(f)
        except Exception as e:
            print(f"장부 읽기 에러 (무시됨): {e}")

    try:
        conn = pymysql.connect(
            host='112.168.103.43', port=3306, user='root', password='softclass', db='essedata', charset='utf8'
        )
        
        with conn.cursor() as cursor:
            sql = "SELECT JPName, JPGuKuk, JPDanWe, JPBoxSu, JPCurrentJeaGo, JPInDanga, JPLOutDate, JPLInDate FROM `jeapum` WHERE IFNULL(JPKilled, '') != 'Y' ORDER BY JPCode DESC;"
            cursor.execute(sql)
            results = cursor.fetchall()
            
        stock_data = []
        for r in results:
            def safe_decode(val):
                if val is None: return ""
                if isinstance(val, bytes):
                    try: return val.decode('cp949').strip()
                    except: return val.decode('utf-8', errors='ignore').strip()
                return str(val).strip()

            try: box_qty = float(safe_decode(r[3]).replace(',', '')) if safe_decode(r[3]) else 0
            except: box_qty = 0
            try: stock_qty = int(float(safe_decode(r[4]).replace(',', ''))) if safe_decode(r[4]) else 0
            except: stock_qty = 0
            try: current_price = float(safe_decode(r[5]).replace(',', '')) if safe_decode(r[5]) else 0
            except: current_price = 0
            
            name = safe_decode(r[0])
            spec = safe_decode(r[1])
            unique_key = f"{name}_{spec}" # 💡 이름과 규격이 합쳐져야 진짜 동일 상품!

            # ==========================================
            # 💡 [핵심 엔진] 진짜 직전 매입가 감지 및 기록
            # ==========================================
            if unique_key not in price_tracker:
                # 우리 시스템이 처음 본 상품이면, 현재 가격으로 초기 세팅 (알람 안 울림)
                price_tracker[unique_key] = {"current": current_price, "prev": current_price}
            else:
                saved_current = price_tracker[unique_key]["current"]
                
                # DB의 오늘 가격이, 장부에 적힌 가격과 '다를 때만' 과거 기록을 밀어냅니다!
                if current_price != saved_current:
                    price_tracker[unique_key]["prev"] = saved_current   # 어제까지의 가격을 '이전 가격'으로 박제
                    price_tracker[unique_key]["current"] = current_price # '현재 가격' 갱신

            # 진정한 직전 매입가 추출!
            true_prev_price = price_tracker[unique_key]["prev"]
            
            stock_data.append({
                "name": name,
                "spec": spec,
                "unit": safe_decode(r[2]),
                "boxQty": box_qty,
                "stock": stock_qty,
                "inPrice": current_price,       # 최근 매입가
                "prevInPrice": true_prev_price, # 👈 직전 매입가 (가격 변동이 있었을 때만 다름!)
                "lastSalesDate": safe_decode(r[6]) if len(r) > 6 else "",
                "lastInDate": safe_decode(r[7]) if len(r) > 7 else ""
            })
            
        # 2. AI 장부와 백업 파일 모두 안전하게 저장
        with open(tracker_file, "w", encoding="utf-8") as f:
            json.dump(price_tracker, f, ensure_ascii=False, indent=2)
        with open(backup_file, "w", encoding="utf-8") as f:
            json.dump(stock_data, f, ensure_ascii=False, indent=2)
            
        return {"status": "success", "data": stock_data, "source": "db"}

    except Exception as e:
        print(f"\n🚨🚨🚨 [긴급 에러 원인 포착] E상인 DB 접속 실패: {str(e)}\n")
        if os.path.exists(backup_file):
            with open(backup_file, "r", encoding="utf-8") as f:
                backup_data = json.load(f)
            return {"status": "success", "data": backup_data, "source": "backup"}
        return {"status": "error", "message": "사무실 PC가 꺼져있고, 백업 파일도 없습니다.", "data": []}

# ==========================================
# 💾 9. E상인 비상 백업 수동 저장 API
# ==========================================
@app.post("/api/esangin-stock/local-update")
async def update_esangin_local_backup(request: Request):
    try:
        data = await request.json()
        with open("esangin_backup.json", "w", encoding="utf-8") as f:
            json.dump(data.get("data", []), f, ensure_ascii=False, indent=2)
        return {"status": "success", "message": "대시보드 서버에 안전하게 저장되었습니다!"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
    
# ==========================================
# 🏆 10. 플랫폼별 TOP 5 랭킹 추출 API (월별 필터 + 진짜 DB 연동 완벽 복구!)
# ==========================================
@app.get("/api/orders/top5")
def get_top5_orders():
    try:
        conn = pymysql.connect(
            host='112.168.103.43', port=3306, user='root', password='softclass', db='essedata', charset='utf8'
        )
        with conn.cursor() as cursor:
            # 💡 [진짜 정답 복구] 대표님이 찾아주셨던 saleticketlist 테이블에서 날짜(STLDate)까지 가져옵니다!
            try:
                sql = "SELECT STLUTSangHo, STLJPName, STLJPSu, STLDate FROM `saleticketlist` WHERE STLJPName IS NOT NULL AND STLJPName != ''"
                cursor.execute(sql)
            except:
                # 혹시 수량 컬럼이 다를 경우를 대비한 백업 쿼리
                sql = "SELECT STLUTSangHo, STLJPName, STLSu, STLDate FROM `saleticketlist` WHERE STLJPName IS NOT NULL AND STLJPName != ''"
                cursor.execute(sql)
                
            results = cursor.fetchall()
            
        # 월별로 데이터를 담을 거대한 바구니 준비
        market_sales = {}
        
        def add_sales(month_key, market, name, qty):
            if month_key not in market_sales:
                market_sales[month_key] = {
                    "🟢 스마트스토어 (네이버)": defaultdict(float),
                    "🛵 우아한형제 (배민)": defaultdict(float),
                    "🔴 롯데ON": defaultdict(float),
                    "🥬 식봄": defaultdict(float),
                    "🚀 쿠팡": defaultdict(float) 
                }
            market_sales[month_key][market][name] += qty
            
        for r in results:
            raw_client = r[0]
            raw_name = r[1]
            raw_qty = r[2]
            raw_date = r[3] # 📅 드디어 추가된 날짜 데이터!
            
            if not raw_client or not raw_name: continue
            
            def safe_decode(val):
                if isinstance(val, bytes):
                    try: return val.decode('cp949').strip()
                    except: return val.decode('utf-8', errors='ignore').strip()
                return str(val).strip()
                
            client = safe_decode(raw_client)
            client_no_space = client.replace(" ", "").lower()
            name = safe_decode(raw_name).strip()
            
            # 날짜 정제 (20260422 같은 형태에서 '2026-04'만 뽑아냄)
            date_str = safe_decode(raw_date).replace("-", "").replace(".", "").replace("/", "").strip()
            month_key = f"{date_str[:4]}-{date_str[4:6]}" if len(date_str) >= 6 else "기타"
            
            try: qty = float(safe_decode(raw_qty).replace(',', ''))
            except: qty = 0
            
            if qty <= 0: continue
            
            # 🎯 거래처 상호명 자동 분류
            target_market = None
            if '스마트스토어' in client_no_space or '네이버' in client_no_space: target_market = "🟢 스마트스토어 (네이버)"
            elif '우아한형제' in client_no_space or '배민' in client_no_space or '배달의민족' in client_no_space: target_market = "🛵 우아한형제 (배민)"
            elif '롯데' in client_no_space: target_market = "🔴 롯데ON"
            elif '식봄' in client_no_space: target_market = "🥬 식봄"
            elif '쿠팡' in client_no_space: target_market = "🚀 쿠팡"
            
            if target_market:
                # 1. 전체 누적 장부에 기록
                add_sales('all', target_market, name, qty)
                # 2. 해당 월(예: 2026-04) 장부에 따로 기록
                if month_key != "기타":
                    add_sales(month_key, target_market, name, qty)

        # 랭킹 정렬 및 결과 정리
        result_data = {}
        for month_key, markets in market_sales.items():
            month_top5 = {}
            for market, sales in markets.items():
                sorted_sales = sorted(sales.items(), key=lambda x: x[1], reverse=True)
                clean_top5 = [{"name": k, "qty": int(v)} for k, v in sorted_sales if k][:5]
                if clean_top5: month_top5[market] = clean_top5
            if month_top5: result_data[month_key] = month_top5

        # 존재하는 월 목록만 뽑아서 최신순으로 정렬
        available_months = sorted([m for m in result_data.keys() if m != 'all'], reverse=True)

        return {"status": "success", "data": result_data, "months": available_months}

    except Exception as e:
        # 혹시라도 날짜 컬럼 이름이 다를 경우를 대비한 친절한 에러 메시지
        if "Unknown column" in str(e) and "STLDate" in str(e):
            return {"status": "error", "message": "🚨 날짜 컬럼 이름이 'STLDate'가 아닙니다! E상인 매출 기둥 이름들 중에 날짜(Date)가 들어간 영어 단어를 하나만 알려주세요!"}
        return {"status": "error", "message": f"DB 접속 에러: {str(e)}"}
    
# ==========================================
# 🦋 11. 공급망 나비효과 레이더 (실시간 환율 크롤링)
# ==========================================
@app.get("/api/radar/indicators")
def get_market_indicators():
    try:
        # 1. 네이버 금융에서 오늘의 환율 정보 훔쳐오기!
        url = "https://finance.naver.com/marketindex/"
        res = requests.get(url)
        soup = BeautifulSoup(res.text, 'html.parser')
        
        # 미국 USD 환율 숫자만 쏙 뽑아내기
        usd_rate_str = soup.select_one('#exchangeList > li.on > a.head.usd > div > span.value').text
        usd_rate = float(usd_rate_str.replace(',', ''))
        
        # 💡 [AI 판단 로직] 환율이 1350원을 넘으면 '위험', 1300원을 넘으면 '경계'
        status = "안정"
        trend = "보합"
        if usd_rate >= 1350:
            status = "위험"
            trend = "고환율 지속"
        elif usd_rate >= 1300:
            status = "경계"
            trend = "상승 압박"
            
        action_msg = "✅ 수입 단가 안정적. 정상 발주 유지"
        if status == "위험":
            action_msg = "🚨 환율 1,350원 돌파! 향후 1~2달 내 수입 수산물 원가 상승 확실. 여유 자금 내 2개월치 선확보 강력 권장!"

        radar_data = [
            {
                "category": "🦐 수입 수산물 (새우, 오징어 등)",
                "indicators": [
                    { "name": "실시간 원/달러 환율", "status": status, "trend": f"{usd_rate:,.2f}원", "desc": "수입 원가를 결정하는 핵심 선행 지표" }
                ],
                "action": action_msg
            }
        ]
        
        return {"status": "success", "data": radar_data}

    except Exception as e:
        return {"status": "error", "message": f"지표 수집 에러: {str(e)}"}
    
# ==========================================
# 👑 12. VVIP Top 20 매출 랭킹 자동 추출 API (최근 3개월 누적 판매량 기준!)
# ==========================================
@app.get("/api/esangin/vvip-top20")
def get_vvip_top20():
    try:
        conn = pymysql.connect(
            host='112.168.103.43', port=3306, user='root', password='softclass', db='essedata', charset='utf8'
        )
        with conn.cursor() as cursor:
            # 💡 [핵심] 이번엔 날짜(STLDate)까지 같이 긁어옵니다!
            try:
                sql = "SELECT STLJPName, STLJPSu, STLDate FROM `saleticketlist` WHERE STLJPName IS NOT NULL AND STLJPName != ''"
                cursor.execute(sql)
            except:
                sql = "SELECT STLJPName, STLSu, STLDate FROM `saleticketlist` WHERE STLJPName IS NOT NULL AND STLJPName != ''"
                cursor.execute(sql)
            results = cursor.fetchall()
            
        import datetime
        # 💡 오늘 기준으로 정확히 3개월(90일) 전 날짜를 계산합니다.
        three_months_ago = datetime.datetime.now() - datetime.timedelta(days=90)
        three_months_ago_int = int(three_months_ago.strftime("%Y%m%d"))
            
        sales_volume = defaultdict(float)
        for r in results:
            raw_name = r[0]
            raw_qty = r[1]
            raw_date = r[2] if len(r) > 2 else ""
            
            if not raw_name: continue
            
            def safe_decode(val):
                if isinstance(val, bytes):
                    try: return val.decode('cp949').strip()
                    except: return val.decode('utf-8', errors='ignore').strip()
                return str(val).strip()
            
            name = safe_decode(raw_name).strip()
            
            # ==========================================
            # ⏳ [핵심 필터] 3개월이 지난 옛날 거래 내역은 과감히 버립니다!
            # ==========================================
            date_str = safe_decode(raw_date).replace("-", "").replace(".", "").replace("/", "").strip()
            try: 
                date_int = int(date_str[:8])
                if date_int < three_months_ago_int: 
                    continue # 3개월보다 오래된 과거 영광의 상품은 제외!
            except: 
                continue # 날짜가 안 적혀있는 찌꺼기 데이터도 제외!
            
            # 택배비, 아이스팩 같은 가짜 상품들은 랭킹에서 제외!
            excluded = ['택배비', '배송비', '아이스팩', '스티로폼', '광고비', '수수료', '정산', '기타']
            if any(x in name for x in excluded): continue
            
            try: qty = float(safe_decode(raw_qty).replace(',', ''))
            except: qty = 0
            
            if qty > 0:
                sales_volume[name] += qty
                
        # 최근 3개월 판매량 기준으로 1등부터 줄 세워서 딱 20등까지만 자릅니다!
        sorted_sales = sorted(sales_volume.items(), key=lambda x: x[1], reverse=True)[:20]
        
        # 프론트엔드 검색창에 바로 넣을 수 있게 콤마(,)로 예쁘게 묶어줍니다
        top_20_names = ", ".join([k for k, v in sorted_sales])
        top_20_details = [{"name": k, "qty": int(v)} for k, v in sorted_sales]
        
        return {"status": "success", "suggested_keywords": top_20_names, "details": top_20_details}

    except Exception as e:
        return {"status": "error", "message": f"VVIP 추출 에러: {str(e)}"}
    
# ==========================================
# ⏳ 13. AI 품절 D-Day 예측 API (최근 14일 판매속도 기반)
# ==========================================
@app.get("/api/esangin/d-day-predict")
def predict_stock_d_day():
    try:
        conn = pymysql.connect(
            host='112.168.103.43', port=3306, user='root', password='softclass', db='essedata', charset='utf8'
        )
        
        def safe_decode(val):
            if isinstance(val, bytes):
                try: return val.decode('cp949').strip()
                except: return val.decode('utf-8', errors='ignore').strip()
            return str(val).strip()

        # 1. 현재 창고에 있는 진짜 재고 파악
        stock_dict = {}
        with conn.cursor() as cursor:
            cursor.execute("SELECT JPName, JPGuKuk, JPCurrentJeaGo FROM `jeapum` WHERE IFNULL(JPKilled, '') != 'Y'")
            for r in cursor.fetchall():
                name = safe_decode(r[0]).strip()
                spec = safe_decode(r[1]).strip()
                try: stock_qty = int(float(safe_decode(r[2]).replace(',', ''))) if safe_decode(r[2]) else 0
                except: stock_qty = 0
                if name:
                    stock_dict[name] = {"stock": stock_qty, "spec": spec}

        # 2. 최근 14일 동안의 무서운 판매 속도 파악!
        with conn.cursor() as cursor:
            try:
                cursor.execute("SELECT STLJPName, STLJPSu, STLDate FROM `saleticketlist` ORDER BY STLDate DESC LIMIT 30000")
            except:
                cursor.execute("SELECT STLJPName, STLSu, STLDate FROM `saleticketlist` ORDER BY STLDate DESC LIMIT 30000")
            sales_results = cursor.fetchall()

        import datetime
        fourteen_days_ago = datetime.datetime.now() - datetime.timedelta(days=14)
        fourteen_days_ago_int = int(fourteen_days_ago.strftime("%Y%m%d"))

        sales_volume = {}
        for r in sales_results:
            raw_name = r[0]
            raw_qty = r[1]
            raw_date = r[2]
            if not raw_name or not raw_date: continue
            
            name = safe_decode(raw_name).strip()
            date_str = safe_decode(raw_date).replace("-", "").replace(".", "").replace("/", "").strip()
            
            try: 
                date_int = int(date_str[:8])
                if date_int < fourteen_days_ago_int: continue # 14일보다 오래된 건 버림
            except: continue

            try: qty = float(safe_decode(raw_qty).replace(',', ''))
            except: qty = 0
            
            excluded = ['택배비', '배송비', '아이스팩', '스티로폼', '광고비', '수수료', '정산', '기타']
            if any(x in name for x in excluded): continue

            if qty > 0:
                sales_volume[name] = sales_volume.get(name, 0) + qty

        # 3. D-Day 계산 (재고 나누기 하루 평균 판매량)
        d_day_list = []
        for name, data in stock_dict.items():
            stock = data["stock"]
            spec = data["spec"]
            sales_14_days = sales_volume.get(name, 0)
            
            daily_avg = sales_14_days / 14.0
            
            if daily_avg > 0:
                d_day = stock / daily_avg
                if d_day < 0: d_day = 0 # 마이너스 재고는 즉시 0일로 처리
                
                d_day_list.append({
                    "name": name,
                    "spec": spec,
                    "stock": stock,
                    "daily_avg": round(daily_avg, 1),
                    "d_day": int(d_day)
                })

        # 14일 안에 품절될 진짜 위험한 녀석들만 정렬해서 추출!
        urgent_list = [x for x in d_day_list if x["d_day"] <= 14 and x["stock"] > 0]
        urgent_list.sort(key=lambda x: x["d_day"])

        return {"status": "success", "data": urgent_list[:20]}

    except Exception as e:
        return {"status": "error", "message": f"D-Day 계산 에러: {str(e)}"}

# ==========================================
# 📉 14. 판매 둔화 / 급증 / 신규 인기상품 감지 API (지난달 vs 이번달 비교)
# ==========================================
def _fetch_month_over_month_sales():
    """saleticketlist에서 이번달/지난달 상품별 판매수량·매출을 집계한다.
    sales-decline / sales-surge / new-popular이 공유하는 조회+집계 로직."""
    conn = pymysql.connect(
        host='112.168.103.43', port=3306, user='root', password='softclass', db='essedata', charset='utf8'
    )

    def safe_decode(val):
        if isinstance(val, bytes):
            try: return val.decode('cp949').strip()
            except: return val.decode('utf-8', errors='ignore').strip()
        return str(val).strip()

    with conn.cursor() as cursor:
        try:
            cursor.execute("SELECT STLJPName, STLJPSu, STLMoney, STLDate FROM `saleticketlist` WHERE STLJPName IS NOT NULL AND STLJPName != ''")
        except:
            cursor.execute("SELECT STLJPName, STLSu, STLMoney, STLDate FROM `saleticketlist` WHERE STLJPName IS NOT NULL AND STLJPName != ''")
        rows = cursor.fetchall()

    import datetime
    today = datetime.date.today()
    this_month_key = today.strftime("%Y%m")
    last_month_end = today.replace(day=1) - datetime.timedelta(days=1)
    last_month_key = last_month_end.strftime("%Y%m")

    excluded = ['택배비', '배송비', '아이스팩', '스티로폼', '광고비', '수수료', '정산', '기타']

    this_month_qty = defaultdict(float)
    last_month_qty = defaultdict(float)
    this_month_amt = defaultdict(float)
    last_month_amt = defaultdict(float)
    all_rows_meta = []  # (상품명, month_key) 전체 이력 — sales-decline의 브랜드 패턴 분석용

    for r in rows:
        raw_name, raw_qty, raw_money, raw_date = r[0], r[1], r[2], r[3]
        if not raw_name or not raw_date: continue

        name = safe_decode(raw_name).strip()
        if any(x in name for x in excluded): continue

        date_str = safe_decode(raw_date).replace("-", "").replace(".", "").replace("/", "").strip()
        if len(date_str) < 6: continue
        month_key = date_str[:6]
        all_rows_meta.append((name, month_key))

        try: qty = float(safe_decode(raw_qty).replace(',', ''))
        except: qty = 0
        try: amt = float(safe_decode(raw_money).replace(',', ''))
        except: amt = 0

        if month_key == this_month_key:
            this_month_qty[name] += qty
            this_month_amt[name] += amt
        elif month_key == last_month_key:
            last_month_qty[name] += qty
            last_month_amt[name] += amt

    return {
        "this_month_qty": this_month_qty, "last_month_qty": last_month_qty,
        "this_month_amt": this_month_amt, "last_month_amt": last_month_amt,
        "this_month": today.strftime("%Y-%m"), "last_month": last_month_end.strftime("%Y-%m"),
        "all_rows_meta": all_rows_meta,
    }


def _extract_core_name(name):
    """맨 앞 대괄호 공급처 태그를 뗀 '핵심명'. 공급처가 바뀌어도 상품 자체는
    같은 경우([해성] 찐새우(아마애비)-캐 → [산호] 찐새우(아마애비)) 비교용."""
    return re.sub(r'^\[[^\]]+\]\s*', '', name).strip()


# ==========================================
# 🔍 상품명 토큰 매칭 (쿠팡 "풀어쓴 문장형" vs E상인 "[브랜드]-제품명(포장)" 압축형 대조용)
# 예: "오뚜기 케찹 3.2kg 3개 스파우트팩" (쿠팡) vs "[오뚜기]-케챂(스파우트팩)" (E상인)
# 문자열 전체 유사도(SequenceMatcher)로는 구조가 달라서 매칭이 안 되므로,
# 규격/수량/포장 표현을 걷어내고 남는 '핵심 키워드' 단위로 토큰 대 토큰 매칭한다.
# ==========================================
_TOKEN_DELIM_RE = re.compile(r'[\[\]\(\)\-,·/]+')
_LETTER_DIGIT_BOUNDARY_RE = re.compile(r'(?<=[가-힣a-zA-Z])(?=\d)')
# 숫자(+소수점) 뒤에 흔한 단위/수량 표기가 붙은 토큰 전체(예: 3.2kg, 1.84L, 6개, 70)를 걸러낸다.
_QTY_UNIT_RE = re.compile(
    r'^\d+(\.\d+)?(kg|g|mg|l|ml|개|팩|병|봉|box|박스|입|매|장|ea)?$', re.IGNORECASE
)
# 숫자에 안 붙어도 그 자체로 규격/포장/마케팅 표현이라 상품 식별에 도움이 안 되는 단어들.
_STOPWORD_TOKENS = {
    'x', '×', 'X', '개', '팩', '병', '봉', 'box', '박스', '세트', 'set', 'SET',
    '대용량', '업소용', '기획', '정품', '단품', '벌크', '실속', '가정용', '업소',
    '미u', '미U', 'kg', 'g', 'l', 'ml',
}

# 토큰 쌍이 이 유사도 미만이면 "다른 단어"로 취급 (정확 일치가 아니어도 오타/표기차이 흡수용)
_TOKEN_SIMILARITY_THRESHOLD = 0.7


def _tokenize_product_name(name):
    """상품명에서 브랜드/제품명 등 '핵심 키워드' 토큰만 남기고 규격·수량·포장 표현은 제거한다.
    예: '오뚜기 케찹 3.2kg 3개 스파우트팩' -> ['오뚜기', '케찹', '스파우트팩']
        '[오뚜기]-케챂(스파우트팩)'        -> ['오뚜기', '케챂', '스파우트팩']"""
    s = _TOKEN_DELIM_RE.sub(' ', name or '')
    s = _LETTER_DIGIT_BOUNDARY_RE.sub(' ', s)  # "모밀국물1.84L" -> "모밀국물 1.84L"

    tokens = []
    for raw in s.split():
        t = raw.strip()
        if not t:
            continue
        if t.lower() in _STOPWORD_TOKENS:
            continue
        if _QTY_UNIT_RE.match(t):
            continue
        tokens.append(t)
    return tokens


def _token_match_score(tokens_a, tokens_b):
    """두 키워드 토큰 리스트를 그리디하게 짝지어서 (매칭된 쌍 목록, 점수 합)을 반환한다.
    정확히 같은 토큰=1.0점, 다르지만 유사도 0.7 이상이면 그 유사도만큼, 그 미만은 매칭 안 됨
    (예: '케찹'/'케챂'처럼 한 글자만 다른 표기 오타를 흡수하기 위함)."""
    used_b = set()
    pairs = []
    for ta in tokens_a:
        best_j, best_score = None, 0.0
        for j, tb in enumerate(tokens_b):
            if j in used_b:
                continue
            score = 1.0 if ta == tb else SequenceMatcher(None, ta, tb).ratio()
            if score < _TOKEN_SIMILARITY_THRESHOLD:
                score = 0.0
            if score > best_score:
                best_score, best_j = score, j
        if best_j is not None and best_score > 0:
            used_b.add(best_j)
            pairs.append((ta, tokens_b[best_j], best_score))
    return pairs, sum(p[2] for p in pairs)


def _find_best_token_match(channel_name, esangin_names):
    """channel_name(쿠팡/네이버 등 주문 상품명)과 esangin_names(그날 실제 팔린 E상인 상품명
    후보 목록) 중 토큰 기준으로 가장 잘 맞는 걸 찾는다.

    매칭 판단 기준: 브랜드 토큰 하나만 우연히 겹치는 걸로는 오탐이 나기 쉬워서
    (예: '오뚜기' 브랜드가 같다고 사과식초와 케찹이 매칭되면 안 됨),
    기본적으로 토큰이 최소 2쌍 이상 맞아야 매칭으로 인정한다.
    양쪽 다 토큰이 1~2개뿐인 짧은 이름끼리는 완전 일치 1쌍만으로도 예외적으로 인정한다.

    반환: (matched: bool, matched_esangin_name, confidence "high"/"medium"/None)
    """
    tokens_a = _tokenize_product_name(channel_name)
    if not tokens_a:
        return False, None, None

    best = None  # (esangin_name, pairs, total_score, len_b)
    for esangin_name in esangin_names:
        tokens_b = _tokenize_product_name(esangin_name)
        if not tokens_b:
            continue
        pairs, total_score = _token_match_score(tokens_a, tokens_b)
        if not pairs:
            continue
        if best is None or len(pairs) > len(best[1]) or (len(pairs) == len(best[1]) and total_score > best[2]):
            best = (esangin_name, pairs, total_score, len(tokens_b))

    if best is None:
        return False, None, None

    esangin_name, pairs, total_score, len_b = best
    denom = max(len(tokens_a), len_b)
    match_ratio = (total_score / denom) if denom else 0.0

    if len(pairs) >= 2:
        # 브랜드 토큰과 제품명 토큰 등 여러 개가 맞았으면 high, 일부(비중 낮게)만 맞았으면 medium
        return True, esangin_name, ("high" if match_ratio >= 0.66 else "medium")

    # 원래 토큰이 짧은(1~2개) 이름끼리 완전 일치 1쌍만 있는 경우의 예외 허용
    if len(pairs) == 1 and pairs[0][2] >= 0.999 and max(len(tokens_a), len_b) <= 2:
        return True, esangin_name, "medium"

    return False, None, None


def _recent_month_keys(n):
    """오늘 기준 최근 n개월치 month_key(YYYYMM) 집합."""
    import datetime
    today = datetime.date.today()
    y, m = today.year, today.month
    keys = set()
    for _ in range(n):
        keys.add(f"{y:04d}{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return keys


def _detect_parallel_brand_cores(all_rows_meta, months=6):
    """
    core_name(브랜드 태그 뗀 핵심명)별로 최근 N개월 판매 이력을 보고
    '병행형'(같은 달에 서로 다른 브랜드가 동시에 팔림) vs '순차 교체형'
    (항상 한 시점엔 브랜드가 하나만 유통됨)을 판별한다.

    반환: (parallel_cores: set[str], 병행형/순차형이 갈린 core_name들에 대한 로그 출력)
    """
    recent_keys = _recent_month_keys(months)
    core_month_brands = defaultdict(lambda: defaultdict(set))

    for name, month_key in all_rows_meta:
        if month_key not in recent_keys:
            continue
        core = _extract_core_name(name)
        core_month_brands[core][month_key].add(name)

    parallel_cores = set()
    for core, months_seen in core_month_brands.items():
        all_brands = set()
        for brands in months_seen.values():
            all_brands |= brands
        if len(all_brands) < 2:
            continue  # 브랜드가 하나뿐이면 순차/병행 판단 자체가 의미 없음 (그냥 스킵)

        is_parallel = any(len(brands) >= 2 for brands in months_seen.values())
        if is_parallel:
            parallel_cores.add(core)

        kind = "병행형" if is_parallel else "순차형"
        print(f"[판매둔화-브랜드패턴] '{core}' → {kind} (관측된 브랜드: {sorted(all_brands)})")

    return parallel_cores


@app.get("/api/sales-decline")
def get_sales_decline():
    try:
        d = _fetch_month_over_month_sales()
    except Exception as e:
        return {"status": "error", "message": f"판매 둔화 분석 에러: {str(e)}"}

    # core_name(브랜드 태그 뗀 이름)별로 최근 6개월간 병행 유통(여러 브랜드 상시 판매)
    # 이력이 있는지 미리 판별한다. 병행형은 브랜드가 여러 개 보이는 게 정상이므로
    # 아래 대체 매칭 대상에서 제외한다.
    parallel_brand_cores = _detect_parallel_brand_cores(d["all_rows_meta"])

    # 이번달에 새로 등장한 상품(지난달 0개 → 이번달 판매) 목록. 공급처 전환 후보를 여기서 찾는다.
    new_this_month = [
        (name, qty) for name, qty in d["this_month_qty"].items()
        if qty > 0 and d["last_month_qty"].get(name, 0) <= 0
    ]

    # 지난달 10개 이상 팔렸는데 이번달 30% 이상 감소한 상품만 추출
    results = []
    substituted = []
    for name, last_qty in d["last_month_qty"].items():
        if last_qty < 10:
            continue
        this_qty = d["this_month_qty"].get(name, 0)
        decline_rate = ((last_qty - this_qty) / last_qty) * 100
        if decline_rate < 30:
            continue

        # 이번달 판매가 완전히 0으로 끊긴 경우만 공급처 전환 여부를 확인한다
        # (요구사항 범위: -100% 후보만. 부분 감소는 그냥 진짜 둔화로 취급)
        if this_qty == 0:
            core_old = _extract_core_name(name)

            if core_old in parallel_brand_cores:
                print(f"[판매둔화] '{name}' (핵심명 '{core_old}')는 병행 유통 이력이 있어 "
                      f"대체 매칭에서 제외 → 개별 판매둔화로 유지")
            else:
                best_match, best_ratio = None, 0.0
                for new_name, new_qty in new_this_month:
                    ratio = SequenceMatcher(None, core_old, _extract_core_name(new_name)).ratio()
                    if ratio > best_ratio:
                        best_match, best_ratio = (new_name, new_qty), ratio

                if best_match and best_ratio >= 0.6:
                    new_name, new_qty = best_match
                    qty_ratio = new_qty / last_qty  # 지난달 수량 대비 이번달 대체 수량
                    confidence = "high" if 0.5 <= qty_ratio <= 2.0 else "medium"
                    substituted.append({
                        "old_name": name,
                        "old_last_month_qty": int(last_qty),
                        "new_name": new_name,
                        "new_this_month_qty": int(new_qty),
                        "confidence": confidence,
                        "reason": "과거 6개월간 단일 브랜드만 순차 유통된 이력 확인",
                    })
                    continue  # 진짜 둔화 리스트에서는 제외

        if decline_rate >= 70: severity = "critical"
        elif decline_rate >= 50: severity = "warning"
        else: severity = "caution"

        results.append({
            "product_name": name,
            "last_month": int(last_qty),
            "this_month": int(this_qty),
            "decline_rate": round(decline_rate, 1),
            "last_month_sales": int(d["last_month_amt"].get(name, 0)),
            "this_month_sales": int(d["this_month_amt"].get(name, 0)),
            "severity": severity,
        })

    results.sort(key=lambda x: x["decline_rate"], reverse=True)
    substituted.sort(key=lambda x: x["old_last_month_qty"], reverse=True)
    return {
        "status": "success",
        "data": results,
        "substituted": substituted,
        "this_month": d["this_month"],
        "last_month": d["last_month"],
    }


@app.get("/api/sales-surge")
def get_sales_surge():
    try:
        d = _fetch_month_over_month_sales()
    except Exception as e:
        return {"status": "error", "message": f"판매 급증 분석 에러: {str(e)}"}

    # 지난달 10개 이상 팔렸고(노이즈 방지) 이번달 수량이 30% 이상 늘어난 상품만 추출
    # (sales-decline과 동일하게 수량 기준. last_month_qty < 10은 급증률이 왜곡되므로 제외)
    results = []
    for name, last_qty in d["last_month_qty"].items():
        if last_qty < 10:
            continue
        this_qty = d["this_month_qty"].get(name, 0)
        growth_rate = ((this_qty - last_qty) / last_qty) * 100
        if growth_rate < 30:
            continue

        if growth_rate >= 100: severity = "explosive"
        elif growth_rate >= 50: severity = "high"
        else: severity = "notable"

        results.append({
            "product_name": name,
            "last_month": int(last_qty),
            "this_month": int(this_qty),
            "growth_rate": round(growth_rate, 1),
            "severity": severity,
        })

    results.sort(key=lambda x: x["growth_rate"], reverse=True)
    return {"status": "success", "data": results, "this_month": d["this_month"], "last_month": d["last_month"]}


@app.get("/api/new-popular")
def get_new_popular_products():
    try:
        d = _fetch_month_over_month_sales()
    except Exception as e:
        return {"status": "error", "message": f"신규 인기상품 분석 에러: {str(e)}"}

    # 지난달엔 수량이 0이었는데 이번달 처음 팔리기 시작한 상품 (신규 상품이라 노이즈 필터 없음)
    results = []
    for name, this_qty in d["this_month_qty"].items():
        if this_qty <= 0:
            continue
        if d["last_month_qty"].get(name, 0) > 0:
            continue
        results.append({"product_name": name, "this_month": int(this_qty)})

    results.sort(key=lambda x: x["this_month"], reverse=True)
    return {"status": "success", "data": results, "this_month": d["this_month"], "last_month": d["last_month"]}

# ==========================================
# 🧮 15. 재고 정합성 체크 (E상인 vs 쿠팡/네이버/식봄)
# ==========================================
def _fetch_esangin_stock_by_name():
    """jeapum(E상인 재고 원장)에서 상품명별 현재 재고(JPCurrentJeaGo)를 가져온다."""
    conn = pymysql.connect(
        host='112.168.103.43', port=3306, user='root', password='softclass', db='essedata', charset='utf8'
    )

    def safe_decode(val):
        if isinstance(val, bytes):
            try: return val.decode('cp949').strip()
            except: return val.decode('utf-8', errors='ignore').strip()
        return str(val).strip()

    stock_by_name = {}
    with conn.cursor() as cursor:
        cursor.execute("SELECT JPName, JPCurrentJeaGo FROM `jeapum` WHERE IFNULL(JPKilled, '') != 'Y'")
        for r in cursor.fetchall():
            name = safe_decode(r[0]).strip()
            if not name:
                continue
            try:
                qty = int(float(safe_decode(r[1]).replace(',', ''))) if safe_decode(r[1]) else 0
            except Exception:
                qty = 0
            stock_by_name[name] = qty

    return stock_by_name


def _match_esangin_name(channel_name, esangin_stock_by_name):
    """채널 상품명을 E상인 상품명과 매칭한다. 정확히 일치 -> 브랜드 태그 뗀 핵심명 일치 순으로 시도.
    TODO: mapping.csv(플레이오토 온라인명↔장부명 매핑 사전, get_mapping_dict() 참고)를
    재사용하면 매칭 정확도를 더 높일 수 있음 — 지금은 이름 유사도만으로 매칭한다."""
    if channel_name in esangin_stock_by_name:
        return channel_name

    core = _extract_core_name(channel_name)
    for esangin_name in esangin_stock_by_name:
        if _extract_core_name(esangin_name) == core:
            return esangin_name

    return None


def _fetch_esangin_sales_by_date(start_date_str, end_date_str=None):
    """saleticketlist에서 [start_date, end_date] 기간(YYYY-MM-DD, 포함) 동안 실제로 판매 입력된
    상품명을 날짜별 + 거래처(STLUTSangHo)별로 나눠서 가져온다:
    {"YYYY-MM-DD": {"거래처명": Counter({상품명: 건수, ...}), ...}, ...}.
    거래처 구분 없이 전체를 하나로 합치면 다른 채널 매출이 우연히 같은 상품명이라 잘못
    매칭될 수 있어서, 호출부(order_reconcile)가 채널별로 정확한 거래처명만 골라 쓰도록
    거래처별로 쪼개서 반환한다. (주문일 다음날 처리되는 주문을 매칭할 때도 "주문일 vs
    주문일+1" 날짜별로 따로 봐야 해서 날짜도 쪼갠다.)
    건수를 Counter로 세는 이유: 같은 상품이 하루에 여러 건 팔리면 E상인에도 그만큼 여러 번
    입력되는데, 단순 set으로 담으면 중복 제거돼서 "그날 이 이름이 존재하는지"만 남고 "몇 건
    있는지"가 사라진다 — 그러면 주문이 2건 이상이어도 그 중 1건만 매칭되고 나머지는 실제로는
    전표가 있는데도 영원히 미확인으로 남는다(2026-08-31 "[미노] 보통맛떡볶이" 2주문/전표 4건
    사례로 재발 확인). set이 아니라 Counter를 쓰는 게 이번이 처음이 아니라 원칙임 — 회귀 방지용.
    end_date_str 생략 시 start_date_str 하루만 조회.
    (토큰 매칭용으로 온전한 이름이 필요해서 핵심명이 아니라 원본 이름을 그대로 반환한다.)
    날짜 파싱 로직은 _fetch_month_over_month_sales와 동일한 방식(문자열 정리 후 앞 8자리 비교)을 재사용."""
    conn = pymysql.connect(
        host='112.168.103.43', port=3306, user='root', password='softclass', db='essedata', charset='utf8'
    )

    def safe_decode(val):
        if isinstance(val, bytes):
            try: return val.decode('cp949').strip()
            except: return val.decode('utf-8', errors='ignore').strip()
        return str(val).strip()

    start_int = int(start_date_str.replace("-", ""))
    end_int = int((end_date_str or start_date_str).replace("-", ""))
    entered_by_date = {}

    with conn.cursor() as cursor:
        cursor.execute(
            "SELECT STLJPName, STLDate, STLUTSangHo FROM `saleticketlist` "
            "WHERE STLJPName IS NOT NULL AND STLJPName != ''"
        )
        # TODO: STLDate 컬럼이 진짜 DATE 타입인지 문자열인지에 따라 WHERE절에서 바로 날짜 필터링하면
        # 매번 전체 테이블을 긁어오지 않아도 돼서 더 빠름 — 지금은 기존 코드 관례(전체 조회 후 파이썬에서 필터)를 따름.
        for r in cursor.fetchall():
            name = safe_decode(r[0]).strip()
            if not name:
                continue
            date_str = safe_decode(r[1]).replace("-", "").replace(".", "").replace("/", "").strip()
            if len(date_str) < 8:
                continue
            try:
                d = int(date_str[:8])
                if d < start_int or d > end_int:
                    continue
            except Exception:
                continue
            vendor = safe_decode(r[2]).strip()
            day_key = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
            entered_by_date.setdefault(day_key, {}).setdefault(vendor, Counter())[name] += 1

    return entered_by_date


# 채널명(order_reconcile의 channel_label) → E상인 STLUTSangHo(거래처) 정확일치 값.
# 실데이터로 확인함(2026-08-03 기준: 쿠팡 1378건/스마트스토어 762건/식봄 403건, 서로 배타적).
# 네이버(세금)/네이버(예준마켓)/네이버(예림수산) 등 "네이버"가 들어간 다른 거래처는 스마트스토어와
# 무관한 별개 거래처라 절대 포함하면 안 됨 — "스마트스토어" 정확일치만 사용.
CHANNEL_VENDOR_MAP = {
    "쿠팡": "쿠팡",
    "네이버": "스마트스토어",
    "식봄": "식봄",
    "배민상회": "우아한형제들",  # 참고용 — 배민은 공식 API가 없어 자동 대조 대상이 아님(수동 확인)
}


# ==========================================
# 🧩 온라인-E상인 상품명 수동 매핑 사전
# 브랜드 표기가 아예 달라서(예: "아지노모도 혼다시A" vs "[농심]-A혼다시") 알고리즘 유사도로
# 못 잡는 케이스를 사람이 한 번 확인하면 영구히 기억하도록 저장한다.
# E상인 상품 하나에 여러 채널의 별명(alias)을 리스트로 쌓는 구조 — 채널 구분 없이 전체
# 사전에서 alias를 찾고, 실제 매칭 시점엔 CHANNEL_VENDOR_MAP으로 이미 좁혀진 해당 채널의
# 전표 풀에서만 esangin_core_name을 찾는다(채널 분리 로직은 그대로 유지).
# ==========================================
PRODUCT_MAPPING_FILE = "product_mapping.json"
_product_mapping_lock = Lock()


def _find_mapped_esangin_core(channel_product_name):
    """channel_product_name이 매핑 사전 어딘가의 alias와 정확히 일치하면 그 매핑의
    esangin_core_name을 반환한다. 없으면 None. (사전은 채널 구분 없이 전체를 검색 —
    "어느 채널에서든 이 이름으로 오면 인식"이라는 요구사항)"""
    mapping = _load_json_file(PRODUCT_MAPPING_FILE, [])
    for entry in mapping:
        if channel_product_name in entry.get("aliases", []):
            return entry.get("esangin_core_name")
    return None


def _pool_match_by_core(pool, esangin_core_name):
    """매핑된 esangin_core_name이 채널 전표 풀(이름→남은 건수 Counter)에 정확히 있으면
    그대로, 없으면 핵심명(대괄호 공급처 태그 제거)이 같은 항목을 찾아서 반환한다.
    이미 다 소비돼서 건수가 0이 된 이름은 후보에서 제외한다. 못 찾으면 None."""
    if pool.get(esangin_core_name, 0) > 0:
        return esangin_core_name
    target_core = _extract_core_name(esangin_core_name)
    for n, count in pool.items():
        if count > 0 and _extract_core_name(n) == target_core:
            return n
    return None


@app.get("/api/order-reconcile")
def order_reconcile(date: str = Query(None), start_date: str = Query(None), end_date: str = Query(None)):
    """
    채널(쿠팡/네이버)의 지정 기간 주문과 E상인 saleticketlist를 상품명 토큰 기준으로
    대조해서, 온라인에서 팔렸는데 E상인에 판매전표 입력이 빠진 것으로 의심되는 건을 찾는다.
    쿠팡은 "브랜드+제품명+용량+수량+포장형태"를 풀어쓴 문장형이고 E상인은 "[브랜드]-제품명(포장)"
    압축 코드형이라 구조가 달라서, 전체 문자열 유사도 대신 _find_best_token_match()로 대조한다
    (자세한 설계는 _tokenize_product_name / _token_match_score / _find_best_token_match 참고).
    막히는 채널이 있어도 나머지 채널은 계속 진행한다.

    기간 파라미터: start_date/end_date를 우선 사용. start_date만 오면 end_date=start_date.
    둘 다 없으면 기존 date(하위호환, 하루만) → 그것도 없으면 오늘 하루.
    """
    import datetime
    today_str = datetime.date.today().strftime("%Y-%m-%d")
    if start_date or end_date:
        target_start = (start_date or end_date or "").strip()
        target_end = (end_date or target_start).strip()
    else:
        target_start = target_end = (date or "").strip() or today_str

    def _next_date_str(date_str):
        try:
            return (datetime.date.fromisoformat(date_str) + datetime.timedelta(days=1)).isoformat()
        except Exception:
            return date_str

    def _order_processing_started(channel_label, sample_item):
        """3시 마감 이후 주문은 결제완료(ACCEPT) 상태로 하루 넘게 머물다 다음날 처리되는 게 정상이라,
        아직 처리 시작 전(=결제완료 단계만)인 주문은 원래 E상인 입력이 없는 게 맞으므로 애초에
        미입력 의심 대조 대상에서 제외한다. 상태 필드가 없는 채널은 판단할 수 없으니
        필터링하지 않고 그대로 포함한다."""
        if channel_label == "쿠팡":
            status = str(sample_item.get('주문상태', '')).strip()
            return status != 'ACCEPT' if status else True
        if channel_label == "네이버":
            status = str(sample_item.get('주문상태', ''))
            return not status.startswith('🟢 신규주문') if status else True
        if channel_label == "식봄":
            # 식봄은 orderStatus가 PENDING_CONFIRMATION(신규주문/발송전)일 땐 아직 발송 준비도
            # 안 된 단계라 E상인 입력 시점이 아니다. SHIPPED(배송중)/DELIVERED(배송완료)부터만
            # 대조 대상으로 삼는다(실데이터 기준 이 세 값만 관측됨 — apis/sikbom_api.py의
            # SIKBOM_SHIPPED_OR_LATER 참고).
            status = str(sample_item.get('주문상태', '')).strip()
            return status in sikbom_api.SIKBOM_SHIPPED_OR_LATER
        return True

    # E상인 대조 범위를 (target_end + 1일)과 오늘 중 더 늦은 날짜까지 늘려서, 주문일 이후
    # 며칠씩 밀려서 입력되는 전표까지도 "주문일~오늘" 매칭에서 확인할 수 있게 한다.
    esangin_fetch_end = max(_next_date_str(target_end), today_str)
    try:
        esangin_by_date = _fetch_esangin_sales_by_date(target_start, esangin_fetch_end)
    except Exception as e:
        return {"status": "error", "message": f"E상인 판매전표 조회 실패: {e}"}

    # missing(미입력 의심) 항목의 confidence 판정용 — E상인에 등록된 적 있는 상품(핵심명)인지
    # (jeapum 카탈로그 기준. 이건 "매칭이 맞다는 확신"이 아니라 "정말 입력을 빠뜨린 걸로 보이는지"에 대한 확신임)
    try:
        known_core_names = {_extract_core_name(n) for n in _fetch_esangin_stock_by_name()}
    except Exception as e:
        known_core_names = set()
        print(f"[주문대조] E상인 상품 카탈로그 조회 실패 (confidence 판정 정확도에만 영향, 계속 진행): {e}")

    missing = []
    matched_count = 0
    channel_notes = {}

    def _check_orders(channel_label, orders):
        nonlocal matched_count
        vendor = CHANNEL_VENDOR_MAP.get(channel_label)

        # 이 채널이 매칭에 쓸 수 있는 날짜별 E상인 풀 — 거래처(STLUTSangHo)로 이미 좁혀진
        # {이름: 남은 건수} Counter. 한 번 매칭에 쓰인 이름은 건수를 1 줄여서(소비), 같은
        # 이름의 전표가 그날 여러 장 있으면 그 장 수만큼 서로 다른 주문에 매칭될 수 있게 한다
        # (set으로 존재 여부만 담으면 하루에 같은 상품이 여러 건 팔려도 1건만 매칭되고 나머지는
        # 전표가 있어도 영원히 미확인으로 남는다 — 2026-08-31 재발 확인된 회귀, Counter가 원칙).
        # 채널별 mutable copy라 다른 채널엔 영향 없음.
        date_pools = {}

        def _pool_for(date_key):
            if date_key not in date_pools:
                date_pools[date_key] = Counter(esangin_by_date.get(date_key, {}).get(vendor, {})) if vendor else Counter()
            return date_pools[date_key]

        def _pools_for_window(start_date_str):
            """order_date부터 오늘까지 날짜별 풀을 리스트로 반환 — 주문일 이후 며칠씩
            밀려서 입력되는 전표까지 대조 대상에 포함시키기 위함. start_date_str이 오늘보다
            미래(이례적 케이스)면 최소 그 날짜 하나는 포함한다."""
            try:
                d = datetime.date.fromisoformat(start_date_str)
                end_d = max(d, datetime.date.fromisoformat(today_str))
            except Exception:
                return [_pool_for(start_date_str)]
            pools = []
            while d <= end_d:
                pools.append(_pool_for(d.isoformat()))
                d += datetime.timedelta(days=1)
            return pools

        today_orders = [o for o in orders if target_start <= str(o.get('결제일시', ''))[:10] <= target_end]

        # get_coupang_orders/get_new_orders는 상품 줄(item) 단위로 한 행씩 내려주기 때문에,
        # 상품이 여러 개인 주문 하나가 여러 행으로 쪼개져서 온다. 부모 주문번호(주문번호) 기준으로
        # 다시 묶어야 order_count/missing이 "주문 몇 건"을 정확히 나타낸다.
        orders_by_id = {}
        order_ids_seen = []
        for o in today_orders:
            order_id = str(o.get('주문번호', '')).strip()
            if not order_id:
                order_id = f"__no_order_id_{len(order_ids_seen)}"  # 주문번호 자체가 비어있는 이례적 케이스 방어
            if order_id not in orders_by_id:
                orders_by_id[order_id] = []
                order_ids_seen.append(order_id)
            orders_by_id[order_id].append(o)

        for order_id in order_ids_seen:
            order_rows = orders_by_id[order_id]

            if not _order_processing_started(channel_label, order_rows[0]):
                continue  # 결제완료(ACCEPT) 단계만인 주문 — 아직 처리 전이라 대조 대상에서 제외

            order_date = str(order_rows[0].get('결제일시', ''))[:10]
            match_window = _pools_for_window(order_date)

            missing_items = []
            checked_any = False

            for o in order_rows:
                name = str(o.get('상품명', '')).strip()
                if not name:
                    continue
                checked_any = True

                # 후보는 "그 날짜 풀에 남은 건수(count>0)"가 있는 이름만 — 이미 다른 주문에
                # 다 소비된 이름(count==0)은 실제로는 더 이상 쓸 수 있는 전표가 없으므로 제외한다.
                candidate_names = {n for pool in match_window for n, count in pool.items() if count > 0}
                matched, matched_name, _match_confidence = _find_best_token_match(name, candidate_names)
                if matched:
                    # 소비: 매칭된 전표는 "이 주문 대조범위 안에서 실제로 그 이름이 남아있는
                    # 가장 이른 날짜의 풀" 딱 하나에서 건수만 1 줄인다(전체 삭제 아님 — 같은
                    # 이름이 그날 여러 건이면 나머지는 다른 주문이 계속 쓸 수 있어야 한다).
                    # match_window 전체에서 지우면, 반복 판매되는 상품처럼 여러 날짜에 각각
                    # 별도 전표가 있는 경우 이 주문과 무관한 다른 날짜의 전표까지 함께 사라져서,
                    # 그 전표가 필요한 다른 주문이 (아직 처리되지 않았다면) 억울하게 미확인으로
                    # 잘못 뜬다.
                    for pool in match_window:
                        if pool.get(matched_name, 0) > 0:
                            pool[matched_name] -= 1
                            break
                    continue

                # 토큰 유사도로 못 잡았으면, 사람이 예전에 확인해서 등록해둔 수동 매핑 사전을 확인한다
                # (브랜드 표기가 아예 달라서 유사도로는 원래 못 잡는 케이스 보완용).
                mapped_core = _find_mapped_esangin_core(name)
                if mapped_core:
                    hit = None
                    hit_pool = None
                    for pool in match_window:
                        hit = _pool_match_by_core(pool, mapped_core)
                        if hit:
                            hit_pool = pool
                            break
                    if hit:
                        # 위와 같은 이유로 실제로 찾아낸 그 날짜의 풀에서만 건수를 소비한다.
                        hit_pool[hit] -= 1
                        continue

                core = _extract_core_name(name)
                missing_items.append({
                    "product_name": name,
                    "qty": o.get('수량', 0),
                    "receiver_name": o.get('수취인명', ''),
                    # 핵심명이 E상인 상품 카탈로그에 원래 있는 상품이면(그냥 오늘 입력만 깜빡) high,
                    # 카탈로그에서도 못 찾으면(이름 매칭 문제일 수도 있음) medium
                    "confidence": "high" if core in known_core_names else "medium",
                })

            if missing_items:
                # 이 주문 안의 상품 중 하나라도 못 찾았으면 주문 하나 아래 상품 리스트로 묶어서 남긴다
                ordered_at = str(orders_by_id[order_id][0].get('결제일시', '')).strip()
                missing.append({
                    "channel": channel_label,
                    "order_id": order_id,
                    "ordered_at": ordered_at,
                    "items": missing_items,
                })
            elif checked_any:
                matched_count += 1  # 이 주문의 상품 줄이 전부 E상인에서 확인됨 → 주문 1건 매칭

        return len(order_ids_seen)  # 고유 주문 수 (상품 줄 수 아님)

    # 쿠팡 — 기존에 이미 만들어져 있는 주문조회 API(get_coupang_orders) 재사용
    try:
        count = _check_orders("쿠팡", coupang_api.get_coupang_orders(target_start, target_end))
        channel_notes["쿠팡"] = {"status": "ok", "order_count": count}
    except Exception as e:
        print(f"[주문대조] 쿠팡 주문 조회 실패, 다음 채널로 진행: {e}")
        channel_notes["쿠팡"] = {"status": "error", "message": str(e)}

    # 네이버 — 기존 get_new_orders 재사용
    try:
        count = _check_orders("네이버", naver_api.get_new_orders(target_start, target_end))
        channel_notes["네이버"] = {"status": "ok", "order_count": count}
    except Exception as e:
        print(f"[주문대조] 네이버 주문 조회 실패, 다음 채널로 진행: {e}")
        channel_notes["네이버"] = {"status": "error", "message": str(e)}

    # 식봄 — 공식 주문조회 API 문서가 없어 미확정 (apis/sikbom_api.py TODO 참고). 하루 단위 함수라 기간을
    # 날짜별로 순회해서 합친다 — 미구현이라 첫 호출에서 바로 NotImplementedError로 끝남.
    try:
        sikbom_orders = []
        d = datetime.date.fromisoformat(target_start)
        end_d = datetime.date.fromisoformat(target_end)
        while d <= end_d:
            sikbom_orders.extend(sikbom_api.get_sikbom_orders_by_date(d.strftime("%Y-%m-%d")) or [])
            d += datetime.timedelta(days=1)
        count = _check_orders("식봄", sikbom_orders)
        channel_notes["식봄"] = {"status": "ok", "order_count": count}
    except NotImplementedError as e:
        channel_notes["식봄"] = {"status": "not_implemented", "message": str(e)}
    except Exception as e:
        print(f"[주문대조] 식봄 주문 조회 실패: {e}")
        channel_notes["식봄"] = {"status": "error", "message": str(e)}

    # 배민상회 — 공식 API가 없어 자동 대조 대상 자체가 아님 (재고 실사 탭에서 수동으로 확인)
    channel_notes["배민상회"] = {"status": "manual_only", "message": "공식 API가 없어 자동 대조 불가 — 수동으로 확인해주세요."}

    return {
        "status": "success",
        "date": target_start,  # 하위호환용 — start와 동일한 값
        "period": {"start": target_start, "end": target_end},
        "missing": missing,
        "matched_count": matched_count,
        "missing_count": len(missing),
        "channel_notes": channel_notes,
    }


class ConfirmMatchIn(BaseModel):
    channel_product_name: str
    esangin_core_name: str


@app.post("/api/order-reconcile/confirm-match")
def confirm_match(payload: ConfirmMatchIn):
    """'미입력 의심'으로 뜬 채널 상품명이 사실은 이 E상인 상품이었다고 사람이 확인해준 것을
    영구히 기억한다. 같은 E상인 상품에 채널 무관하게 여러 alias가 쌓일 수 있다."""
    channel_name = payload.channel_product_name.strip()
    esangin_name = payload.esangin_core_name.strip()
    if not channel_name or not esangin_name:
        return {"status": "error", "message": "channel_product_name / esangin_core_name은 비어있으면 안 됩니다."}

    import datetime
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with _product_mapping_lock:
        mapping = _load_json_file(PRODUCT_MAPPING_FILE, [])
        entry = next((e for e in mapping if e.get("esangin_core_name") == esangin_name), None)
        if entry:
            if channel_name not in entry.get("aliases", []):
                entry.setdefault("aliases", []).append(channel_name)
                entry["updated_at"] = now_str
        else:
            entry = {
                "esangin_core_name": esangin_name,
                "aliases": [channel_name],
                "created_at": now_str,
                "updated_at": now_str,
            }
            mapping.append(entry)
        _save_json_file(PRODUCT_MAPPING_FILE, mapping)

    return {"status": "success", "mapping": entry}


@app.get("/api/product-mapping")
def get_product_mapping():
    """상품명 매핑 사전 전체 목록 조회. frontend/ProductMappingTab.jsx 화면에서 쓴다.
    (등록/추가는 confirm_match가 이미 담당 — 이 라우트는 조회/삭제 전용으로 빠져있던 걸 보충)."""
    mapping = _load_json_file(PRODUCT_MAPPING_FILE, [])
    return {"status": "success", "data": mapping}


@app.delete("/api/product-mapping/{esangin_name}")
def delete_product_mapping(esangin_name: str, alias: str = Query(None)):
    """alias 쿼리파라미터가 있으면 그 별칭 하나만, 없으면 esangin_name 항목 전체를 삭제한다.
    별칭을 하나씩 지우다 마지막 하나까지 지워지면 빈 항목으로 남기지 않고 항목 자체도 정리한다."""
    with _product_mapping_lock:
        mapping = _load_json_file(PRODUCT_MAPPING_FILE, [])
        entry = next((e for e in mapping if e.get("esangin_core_name") == esangin_name), None)
        if not entry:
            return {"status": "error", "message": f"'{esangin_name}' 매핑을 찾을 수 없습니다."}

        if alias:
            aliases = entry.get("aliases", [])
            if alias not in aliases:
                return {"status": "error", "message": f"별칭 '{alias}'을(를) 찾을 수 없습니다."}
            aliases.remove(alias)
            if aliases:
                import datetime
                entry["updated_at"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            else:
                mapping.remove(entry)
        else:
            mapping.remove(entry)

        _save_json_file(PRODUCT_MAPPING_FILE, mapping)

    return {"status": "success"}


# ==========================================
# 🔄 채널 재고 동기화 미리보기 (dry-run 전용, 실제 반영 없음)
# ==========================================
STOCK_SNAPSHOT_FILE = "stock_snapshot.json"
SYNC_LOG_FILE = "sync_log.json"
_sync_lock = Lock()


def _load_json_file(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _save_json_file(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


@app.get("/api/sync-preview")
def get_sync_preview():
    """
    호출될 때마다 E상인 재고를 직전 스냅샷과 비교해서 바뀐 상품을 찾고,
    '이 채널에 이 수량으로 갱신 예정'이라는 dry-run 로그만 남긴 뒤(실제 채널 API 호출 없음),
    최근 로그를 반환한다.

    TODO: 지금은 이 엔드포인트가 호출될 때만 비교가 일어난다(스케줄러가 없음).
    진짜 주기적 감지가 필요하면 cron 등 외부 스케줄러가 이 로직을 별도로 호출하게 분리할 것.
    TODO: dry_run=False로 실제 반영하려면, 아래에서 채널별로
    coupang_api.update_coupang_stock(...) / naver_api.update_naver_product_advanced(...) 같은
    실제 갱신 함수를 호출하는 분기를 추가하고, 이 스위치를 명시적으로 켤 수 있게 만들 것.
    지금은 절대 실제 채널에 반영하지 않는다.
    """
    DRY_RUN = True  # ⚠️ 지금은 무조건 True로 고정 — 실제 반영 코드는 아직 연결 안 함

    try:
        current_stock = _fetch_esangin_stock_by_name()

        with _sync_lock:
            snapshot = _load_json_file(STOCK_SNAPSHOT_FILE, [])
            previous_stock = snapshot[-1].get("stock", {}) if snapshot else {}
            changed = [
                {"product_name": name, "old_qty": previous_stock[name], "new_qty": qty}
                for name, qty in current_stock.items()
                if name in previous_stock and previous_stock[name] != qty
            ]

            import datetime
            now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            snapshot.append({"timestamp": now_str, "stock": current_stock})
            _save_json_file(STOCK_SNAPSHOT_FILE, snapshot[-5:])  # 최근 5개 스냅샷만 유지

            if changed:
                sync_log = _load_json_file(SYNC_LOG_FILE, [])
                # TODO: 지금은 변경분마다 3채널 모두에 로그를 남긴다(실제 호출은 안 하니 안전).
                # 나중엔 그 채널에 실제 등록된 상품일 때만 로그를 남기도록
                # coupang_api.get_coupang_stock_by_product_name() 등으로 필터링하면 더 정확해짐.
                for c in changed:
                    for channel in ["쿠팡", "네이버", "식봄"]:
                        sync_log.append({
                            "timestamp": now_str,
                            "product_name": c["product_name"],
                            "channel": channel,
                            "old_qty": c["old_qty"],
                            "new_qty": c["new_qty"],
                            "status": "dry_run",
                        })
                _save_json_file(SYNC_LOG_FILE, sync_log)
    except Exception as e:
        print(f"[동기화미리보기] 스냅샷 비교/로그 기록 실패, 기존 로그만 반환: {e}")

    with _sync_lock:
        sync_log = _load_json_file(SYNC_LOG_FILE, [])

    return {"status": "success", "dry_run": DRY_RUN, "data": list(reversed(sync_log))[:200]}


# ==========================================
# 📋 16. 재고 실사 (배민상회 등 API 미제공 채널용 수동 도구)
# ==========================================
STOCK_AUDIT_FILE = "stock_audit_history.json"
_stock_audit_lock = Lock()


def _load_stock_audit_history():
    if not os.path.exists(STOCK_AUDIT_FILE):
        return []
    try:
        with open(STOCK_AUDIT_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save_stock_audit_history(records):
    with open(STOCK_AUDIT_FILE, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)


class StockAuditIn(BaseModel):
    product_name: str
    physical_qty: float


@app.get("/api/stock-audit/search")
def search_stock_audit_products(q: str = Query("")):
    try:
        esangin_stock = _fetch_esangin_stock_by_name()
    except Exception as e:
        return {"status": "error", "message": f"E상인 재고 조회 실패: {e}"}

    keyword = (q or "").strip()
    results = [
        {"product_name": name, "system_qty": qty}
        for name, qty in esangin_stock.items()
        if not keyword or keyword in name
    ]
    results.sort(key=lambda x: x["product_name"])
    return {"status": "success", "data": results[:50]}


@app.post("/api/stock-audit")
def create_stock_audit(payload: StockAuditIn):
    name = payload.product_name.strip()
    if not name:
        return {"status": "error", "message": "상품명을 입력해주세요."}

    try:
        esangin_stock = _fetch_esangin_stock_by_name()
    except Exception as e:
        return {"status": "error", "message": f"E상인 재고 조회 실패: {e}"}

    system_qty = esangin_stock.get(name)
    if system_qty is None:
        matched_name = _match_esangin_name(name, esangin_stock)
        system_qty = esangin_stock.get(matched_name) if matched_name else None

    diff = (payload.physical_qty - system_qty) if system_qty is not None else None

    import datetime
    record = {
        "date": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "product_name": name,
        "physical_qty": payload.physical_qty,
        "system_qty": system_qty,
        "diff": diff,
        "mismatch": bool(diff is not None and diff != 0),
    }

    with _stock_audit_lock:
        history = _load_stock_audit_history()
        history.append(record)
        _save_stock_audit_history(history)

    return {"status": "success", "data": record}


@app.get("/api/stock-audit/history")
def get_stock_audit_history():
    with _stock_audit_lock:
        history = _load_stock_audit_history()
    return {"status": "success", "data": list(reversed(history))}


# 플레이오토 api
# --- [부품] 매핑 사전(온라인이름 -> 장부이름) 읽어오기 ---
def get_mapping_dict():
    mapping = {}
    if os.path.exists(MAPPING_FILE):
        try:
            with open(MAPPING_FILE, mode='r', encoding='utf-8-sig') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    # '온라인상품명'을 키로, '장부상품명'을 값으로 저장
                    mapping[row['온라인상품명'].strip()] = row['장부상품명'].strip()
        except Exception as e:
            print(f"⚠️ 매핑 파일 읽기 실패: {e}")
    return mapping

# ====================================================
# 🚀 1. 리액트 버튼 클릭 시 로봇 출동 (백그라운드 실행)
# ====================================================
@app.post("/api/run-playauto")
def run_playauto_robot():
    print("🚀 원격 명령 수신: 플레이오토 로봇 출동!!")
    try:
        # subprocess.Popen은 로봇이 도는 동안 서버가 멈추지 않게 해줍니다.
        subprocess.Popen(["python", "apis/playauto_rpa.py"]) 
        return {"success": True, "message": "로봇이 출동했습니다!"}
    except Exception as e:
        return {"success": False, "error": str(e)}

# ====================================================
# 📥 2. 로봇이 긁어온 주문을 서버에 저장 (POST)
# ====================================================
@app.post("/api/playauto-orders")
async def save_playauto_orders(request: Request):
    try:
        orders = await request.json()
        with open(ORDERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(orders, f, ensure_ascii=False, indent=2)
        print(f"📡 {len(orders)}건의 주문 데이터 저장 완료!")
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

# ====================================================
# 📤 3. 리액트 화면에 [주문 + 매핑 + 재고] 합쳐서 전송 (GET)
# ====================================================
@app.get("/api/playauto-orders")
def get_orders_with_stock_logic():
    if not os.path.exists(ORDERS_FILE):
        return []

    # 1) 수집된 원본 주문 읽기
    with open(ORDERS_FILE, 'r', encoding='utf-8') as f:
        orders = json.load(f)

    # 2) 매핑 사전 & E상인 재고 데이터 준비
    mapping = get_mapping_dict()
    stock_dict = {}
    
    if os.path.exists(STOCK_FILE):
        try:
            df = pd.read_csv(STOCK_FILE, encoding='utf-8-sig')
            for _, row in df.iterrows():
                name = str(row['상품명']).strip()
                stock = int(row['현재재고'])
                stock_dict[name] = stock
        except Exception as e:
            print(f"⚠️ 재고 파일 분석 에러: {e}")

    # 3) 주문 1건씩 돌면서 '장부명' 찾고 '재고' 대조하기
    for order in orders:
        online_name = order.get('raw_name', '')
        
        # 💡 [매핑 로직] 온라인 이름을 장부 이름으로 변환
        # mapping.csv에 있으면 변환된 이름을 쓰고, 없으면 그대로 둠
        real_name = mapping.get(online_name, online_name)
        order['product_name'] = real_name # 화면에 보여줄 장부 상품명

        # 💡 [재고 대조] 변환된 이름으로 재고 파일에서 숫자 찾기
        current_stock = stock_dict.get(real_name, -1) # 장부에 없으면 -1
        order['inventory'] = current_stock
        
        # 💡 [상태 결정] 
        if current_stock == -1:
            order['can_ship'] = "🟡 장부미등록"
        elif current_stock >= order['qty']:
            order['can_ship'] = "🟢 배송가능"
        else:
            order['can_ship'] = "🔴 재고부족"

    return orders


# ==========================================
# 🔗 마진산출장부 상품 ↔ 채널(쿠팡/네이버/식봄) 연결
# 마진산출장부의 "온라인 상품명"은 자유 텍스트라 채널 API의 실제 상품과 자동으로 안 이어져서,
# 상품명으로 채널별 후보를 검색해 보여주고 사람이 고른 걸 영구히 저장한다.
# 후보 검색은 order_reconcile에서 이미 쓰는 _tokenize_product_name/_token_match_score를 재사용한다.
# ==========================================
CHANNEL_LINK_FILE = "channel_link.json"
_channel_link_lock = Lock()
CHANNEL_LINK_CHANNELS = ("coupang", "naver", "sikbom")


def _search_channel_candidates(product_name, products, name_key, id_key, limit=5):
    """products(채널 상품 리스트)를 product_name과 토큰 매칭 점수로 정렬해 상위 후보만 반환한다."""
    tokens_a = _tokenize_product_name(product_name)
    scored = []
    for p in products:
        name = str(p.get(name_key, "")).strip()
        if not name:
            continue
        _, score = _token_match_score(tokens_a, _tokenize_product_name(name))
        if score > 0:
            scored.append((score, {"id": p.get(id_key), "name": name}))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in scored[:limit]]


@app.get("/api/channel-link/search")
def search_channel_link(product_name: str = Query(...)):
    product_name = (product_name or "").strip()
    if not product_name:
        return {"status": "error", "message": "product_name은 비어있으면 안 됩니다."}

    candidates = {}

    try:
        candidates["coupang"] = _search_channel_candidates(
            product_name, coupang_api.get_coupang_products(), "sellerProductName", "sellerProductId"
        )
    except Exception as e:
        print(f"[채널연결] 쿠팡 상품 검색 실패: {e}")
        candidates["coupang"] = []

    try:
        candidates["naver"] = _search_channel_candidates(
            product_name, naver_api.get_my_products(), "name", "channelProductNo"
        )
    except Exception as e:
        print(f"[채널연결] 네이버 상품 검색 실패: {e}")
        candidates["naver"] = []

    try:
        stock_by_name = sikbom_api.get_sikbom_stock_by_product_name()
        sikbom_products = [{"id": name, "name": name} for name in stock_by_name.keys()]
        candidates["sikbom"] = _search_channel_candidates(product_name, sikbom_products, "name", "id")
    except NotImplementedError:
        candidates["sikbom"] = []  # 식봄 공식 API 미연동 — apis/sikbom_api.py 참고
    except Exception as e:
        print(f"[채널연결] 식봄 상품 검색 실패: {e}")
        candidates["sikbom"] = []

    return {"status": "success", "keyword_used": product_name, "candidates": candidates}


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


@app.get("/api/channel-link")
def get_channel_links():
    data = _load_json_file(CHANNEL_LINK_FILE, {})
    return {"status": "success", "data": data}


@app.delete("/api/channel-link/{channel}")
def delete_channel_link(channel: str, product_name: str = Query(...)):
    # 💡 product_name을 경로가 아닌 쿼리 파라미터로 받는다: 상품명에 "/"가 있으면(예: "31/40")
    # 퍼센트 인코딩(%2F)해도 ASGI 라우팅이 매칭 전에 %2F를 실제 "/"로 되돌려 경로 세그먼트가 어긋나 404가 난다.
    with _channel_link_lock:
        data = _load_json_file(CHANNEL_LINK_FILE, {})
        entry = data.get(product_name)
        if not entry or channel not in entry:
            return {"status": "error", "message": "연결된 정보가 없습니다."}
        del entry[channel]
        if not entry:
            del data[product_name]
        _save_json_file(CHANNEL_LINK_FILE, data)

    return {"status": "success"}


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
        try:
            ok, msg = coupang_api.update_coupang_item_price(c.vendor_item_id, c.new_price)
        except Exception as e:
            ok, msg = False, f"처리 중 오류: {e}"
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
            try:
                option_results = naver_api.update_naver_option_prices(channel_id, option_updates)
            except Exception as e:
                option_results = [{"success": False, "message": f"처리 중 오류: {e}", "matched_option_id": None} for _ in with_option]
            for c, r in zip(with_option, option_results):
                results.append({"product_name": c.product_name, "channel": "naver", "option_name": c.option_name,
                                 "success": r["success"], "message": r["message"]})
                if r["success"] and r.get("matched_option_id") is not None and str(r["matched_option_id"]) != str(c.option_id):
                    channel_link_id_fixes.append((c.product_name, c.option_id, str(r["matched_option_id"])))

        # 같은 channel_id에 옵션 가격 변경 건이 있으면 대표가(salePrice)는 절대 같이 바꾸지 않는다.
        # 옵션 가격은 salePrice 대비 delta로 저장되므로, 방금 맞춰둔 옵션 delta가 salePrice 변경으로 틀어져버린다.
        if with_option and without_option:
            for c in without_option:
                results.append({"product_name": c.product_name, "channel": "naver", "option_name": None, "success": False,
                                 "message": "같은 상품에 옵션 가격 변경과 대표가 변경이 동시에 요청되어 건너뜀 (옵션 있는 상품은 대표가를 별도로 바꿀 수 없음)"})
        elif without_option:
            for c in without_option:
                try:
                    ok, msg = naver_api.update_naver_sale_price(channel_id, c.new_price)
                except Exception as e:
                    ok, msg = False, f"처리 중 오류: {e}"
                results.append({"product_name": c.product_name, "channel": "naver", "option_name": None, "success": ok, "message": msg})

    for c in unsupported_changes:
        results.append({"product_name": c.product_name, "channel": c.channel, "option_name": c.option_name,
                         "success": False, "message": f"'{c.channel}' 채널은 자동 가격 반영을 지원하지 않습니다."})

    if channel_link_id_fixes:
        with _channel_link_lock:
            link_data = _load_json_file(CHANNEL_LINK_FILE, {})
            changed = False
            for product_name, old_option_id, new_option_id in channel_link_id_fixes:
                entry = (link_data.get(product_name) or {}).get("naver")
                if entry and str(entry.get("option_id")) == str(old_option_id):
                    entry["option_id"] = new_option_id
                    changed = True
            if changed:
                _save_json_file(CHANNEL_LINK_FILE, link_data)

    return {"status": "success", "results": results}