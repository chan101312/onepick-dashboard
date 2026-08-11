import streamlit as st
import pandas as pd
import time

# ==========================================
# 🔄 [공통/재사용] 상품 목록 불러오기
# ==========================================

def refresh_product_list():
    from apis.naver_api import get_my_products
    
    # 💡 [핵심 해결] st.spinner 를 사용해 빙글빙글 도는 로딩 애니메이션을 띄워줍니다!
    with st.spinner("📡 네이버에서 전체 상품 목록을 안전하게 긁어오고 있습니다. 잠시만 기다려주세요..."):
        products = get_my_products()
        
        if products is not None:
            st.session_state['my_products'] = products
            st.toast(f"✅ 총 {len(products)}개의 정상 상품 목록을 불러왔습니다!", icon="🔄")
        else:
            st.error("🚨 상품 목록을 불러오는데 실패했습니다. API 설정을 확인해주세요.")

# ==========================================
# 📦 [Tab 1] 상품 관리 통제 구역
# ==========================================
def fetch_product_detail(channel_no):
    from apis.naver_api import get_naver_product_detail
    return get_naver_product_detail(channel_no)

def execute_product_save(ui_data, image_files):
    from apis.naver_api import upload_naver_image, update_naver_product_advanced, create_new_naver_product
    
    with st.status("🚀 네이버 서버로 전체 데이터 전송 중...", expanded=True) as status:
        company_map = {"CJ대한통운": "CJGLS", "우체국택배": "EPOST", "롯데택배": "HYUNDAI", "로젠택배": "KGB", "한진택배": "HANJIN", "경동택배": "KDEXP", "대신택배": "DAESIN", "일양로지스": "ILYANG"}
        comp_code = company_map.get(ui_data['new_comp'])

        main_url = upload_naver_image(image_files['main_img'].getvalue(), image_files['main_img'].name) if image_files['main_img'] else None
        opt_urls = []
        if image_files['opt_imgs']:
            for f in image_files['opt_imgs'][:9]:
                u = upload_naver_image(f.getvalue(), f.name)
                if u: opt_urls.append(u)

        html_pieces = []
        if ui_data['detail_top']: html_pieces.append(f'<p style="text-align: center; font-size: 18px; margin-bottom: 20px;">{ui_data["detail_top"].replace(chr(10), "<br>")}</p>')
        if image_files['detail_imgs']:
            for f in image_files['detail_imgs']:
                u = upload_naver_image(f.getvalue(), f.name)
                if u: html_pieces.append(f'<p style="text-align: center; margin: 0;"><img src="{u}" style="max-width: 100%;"></p>')
        if ui_data['detail_bot']: html_pieces.append(f'<p style="text-align: center; font-size: 16px; margin-top: 30px;">{ui_data["detail_bot"].replace(chr(10), "<br>")}</p>')
        final_detail_html = "".join(html_pieces) if html_pieces else None

        tag_list = [t.strip() for t in ui_data['tags'].split(',')] if ui_data['tags'] else None

        final_opt_list = []
        if ui_data['use_option'] == "설정함" and ui_data['edited_opt_df'] is not None:
            for idx, row in ui_data['edited_opt_df'].iterrows():
                final_opt_list.append({"name": row["옵션명"], "price": int(row["옵션가(원)"]), "stock": int(row["재고수량(개)"]), "usable": bool(row["사용여부"])})

        ext_data = {
            "cat_id": ui_data['cat_id'], "model_name": ui_data['new_model'], "use_option": True if ui_data['use_option'] == "설정함" else False,
            "opt_name": ui_data['new_opt_name'], "opt_list": final_opt_list, "product_cond": "NEW" if ui_data['new_cond'] == "신상품" else "USED",
            "minor_purc": True if ui_data['new_minor'] == "가능" else False, "del_type": "DELIVERY" if ui_data['new_del_type'] == "택배, 소포, 등기" else "DIRECT",
            "pay_type": "PREPAID" if ui_data['new_pay_type'] == "선결제" else ("POSTPAID" if ui_data['new_pay_type'] == "착불" else "FREE"), "as_guide": ui_data['new_as_guide']
        }

        if ui_data['work_mode'] == "update":
            success, msg = update_naver_product_advanced(ui_data['channel_no'], ui_data['new_name'], ui_data['new_price'], ui_data['new_stock'], ui_data['new_manu'], ui_data['new_brand'], ui_data['new_as_tel'], comp_code, ui_data['new_fee'], ui_data['new_ret_fee'], ui_data['new_exc_fee'], main_url, opt_urls, final_detail_html, tag_list, ext_data)
        else:
            success, msg = create_new_naver_product(ui_data['channel_no'], ui_data['new_name'], ui_data['new_price'], ui_data['new_stock'], ui_data['new_manu'], ui_data['new_brand'], ui_data['new_as_tel'], comp_code, ui_data['new_fee'], ui_data['new_ret_fee'], ui_data['new_exc_fee'], main_url, opt_urls, final_detail_html, tag_list, ext_data)
            
        if success:
            status.update(label="🎉 성공적으로 반영되었습니다!", state="complete")
            # 💡 [알림] 성공
            st.toast("✅ 상품 정보가 완벽하게 저장되었습니다!", icon="🎉")
            refresh_product_list()
            return True, msg
        else:
            status.update(label="🚨 에러 발생", state="error")
            # 💡 [알림] 실패
            st.error(f"🚨 상품 저장 실패: {msg}")
            return False, msg

# ==========================================
# 🔍 [Tab 2] 황금 키워드 통제 구역
# ==========================================
def execute_keyword_search(search_keyword):
    from apis.naver_api import get_keyword_data_with_tags, get_datalab_trend, search_competitors
    with st.status(f"🔍 '{search_keyword}' 데이터 분석 중...", expanded=True) as status:
        st.session_state['kw_search_term'] = search_keyword
        total_vol, tags = get_keyword_data_with_tags(search_keyword)
        st.session_state['kw_volume'], st.session_state['kw_tags'] = total_vol, tags
        
        competitors = search_competitors(search_keyword, ignore_price=0, must_include="")
        st.session_state['kw_competitors_df'] = pd.DataFrame(competitors) if competitors else pd.DataFrame()
            
        trend_df = get_datalab_trend(search_keyword)
        st.session_state['kw_trend_df'] = trend_df
        status.update(label="✅ 분석 완료!", state="complete", expanded=False)
        # 💡 [알림] 성공
        st.toast(f"✅ '{search_keyword}' 황금 키워드 분석 완료!", icon="📊")

# ==========================================
# 📝 [Tab 3] SEO 상품명 진단 통제 구역
# ==========================================
def execute_seo_update(channel_no, new_name):
    from apis.naver_api import update_naver_product_name
    success, msg = update_naver_product_name(channel_no, new_name)
    if success: 
        # 💡 [알림] 성공
        st.toast(f"✅ [{new_name}]으로 즉시 변경되었습니다!", icon="🏆")
        refresh_product_list() 
    else:
        # 💡 [알림] 실패
        st.error(f"🚨 네이버 변경 거부: {msg}")
    return success, msg

def evaluate_seo_name(name):
    if not name: return 0, ["상품명을 입력해주세요."]
    score = 100
    messages = []
    length = len(name)
    if length < 10: score -= 20; messages.append("⚠️ 길이가 너무 짧습니다. (최소 10자 이상 권장)")
    elif length > 45: score -= 30; messages.append("🚨 길이가 너무 깁니다! (50자 초과 시 네이버 검색 노출 패널티 발생)")
    else: messages.append("✅ 상품명 길이(10~45자)가 최적화되어 있습니다.")
        
    import re
    special_chars = re.findall(r'[^a-zA-Z0-9가-힣\s\(\)\[\]\-]', name)
    if len(special_chars) > 0: score -= 20; messages.append(f"⚠️ 불필요한 특수문자가 발견되었습니다: {' '.join(set(special_chars))} (사용 자제)")
    else: messages.append("✅ 특수문자 사용이 깔끔합니다.")
        
    words = name.split()
    word_counts = {}
    for w in words: word_counts[w] = word_counts.get(w, 0) + 1
    repeated = [w for w, c in word_counts.items() if c > 1]
    if repeated: score -= 20; messages.append(f"🚨 동일한 단어가 반복되었습니다: '{', '.join(repeated)}' (중복 기재 패널티 주의!)")
    else: messages.append("✅ 단어 중복(어뷰징) 없이 깔끔하게 구성되었습니다.")
    if score < 0: score = 0
    return score, messages

# ==========================================
# 🛒 [Tab 4] 주문 관리 통제 구역
# ==========================================
# ==========================================
# 🛒 [Tab 4] 주문 관리 통제 구역
# ==========================================
def fetch_all_orders():
    from apis.naver_api import get_new_orders
    from apis.coupang_api import get_coupang_orders
    from apis._old_backup.utils import get_blacklist
    
    blacklist = get_blacklist() 
    
    # 🟢 1. 네이버 수집 (진짜 데이터)
    raw_naver = get_new_orders()
    df_n = pd.DataFrame(raw_naver) if raw_naver else pd.DataFrame()
    if not df_n.empty:
        if '마켓' in df_n.columns: df_n.drop(columns=['마켓'], inplace=True)
        df_n.insert(0, '마켓', '🟢 네이버')
    
    # 🚀 2. 쿠팡 수집 (진짜 데이터)
    raw_coupang = get_coupang_orders()
    df_c = pd.DataFrame(raw_coupang) if raw_coupang else pd.DataFrame()
    if not df_c.empty:
        if '마켓' in df_c.columns: df_c.drop(columns=['마켓'], inplace=True)
        df_c.insert(0, '마켓', '🚀 쿠팡')
        if '주문상태' not in df_c.columns:
            df_c['주문상태'] = df_c['상품주문번호'].astype(str).apply(lambda x: "📦 발주확인 (상품준비중)" if x in blacklist else "🟢 신규주문 (결제완료)")

    # 🔴 3. 롯데온 수집 (💡 고정 IP 세팅 전까지 가짜 데이터 사용)
    # 대표님의 탭 필터링 조건에 맞게 주문상태에 '신규'라는 단어를 넣었습니다.
    mock_lotteon = [
        {"상품주문번호": "L-10001", "주문일시": "2026-03-11 10:45", "상품명": "[롯데온] 테스트 상품 D", "수량": 3, "결제금액": 45000, "주문상태": "🟢 신규 (결제완료)"}
    ]
    df_l = pd.DataFrame(mock_lotteon)
    df_l.insert(0, '마켓', '🔴 롯데온')
    # 롯데온도 쿠팡처럼 로컬 블랙리스트(발주처리)를 타게 만듭니다.
    df_l['주문상태'] = df_l['상품주문번호'].astype(str).apply(lambda x: "📦 발주확인" if x in blacklist else "🟢 신규")

    # 🥬 4. 식봄 수집 (💡 크롤러 완성 전까지 가짜 데이터 사용)
    mock_sikbom = [
        {"상품주문번호": "S-20002", "주문일시": "2026-03-11 07:10", "상품명": "[식자재] 대용량 양파 5kg", "수량": 5, "결제금액": 55000, "주문상태": "🟢 신규 (입금대기)"}
    ]
    df_s = pd.DataFrame(mock_sikbom)
    df_s.insert(0, '마켓', '🥬 식봄')
    df_s['주문상태'] = df_s['상품주문번호'].astype(str).apply(lambda x: "📦 발주확인" if x in blacklist else "🟢 신규")

    # 💡 4개 마켓 모두 병합!
    frames = [df for df in [df_n, df_c, df_l, df_s] if not df.empty]
    all_df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    
    if not all_df.empty:
        # 합친 후 최신 주문일시 기준으로 정렬
        if '주문일시' in all_df.columns:
            all_df = all_df.sort_values(by='주문일시', ascending=False).reset_index(drop=True)
            
        all_df.insert(0, '선택', False) # 전체 선택 기본값을 빈칸(False)으로 깔끔하게 세팅
        st.session_state['all_orders_df'] = all_df
        # 💡 [알림] 성공
        st.toast("✅ 전 채널 주문 데이터를 성공적으로 동기화했습니다!", icon="📥")
    else:
        st.session_state['all_orders_df'] = None
        st.toast("✅ 현재 처리할 주문이 없습니다.", icon="👍")
        
    st.session_state['order_key_idx'] = st.session_state.get('order_key_idx', 0) + 1


def execute_order_confirm(selected_df):
    from apis.naver_api import confirm_naver_orders
    from apis._old_backup.utils import add_to_blacklist
    
    naver_ids = selected_df[selected_df['마켓'] == '🟢 네이버']['상품주문번호'].astype(str).tolist()
    coupang_ids = selected_df[selected_df['마켓'] == '🚀 쿠팡']['상품주문번호'].astype(str).tolist()
    lotteon_ids = selected_df[selected_df['마켓'] == '🔴 롯데온']['상품주문번호'].astype(str).tolist() 
    sikbom_ids = selected_df[selected_df['마켓'] == '🥬 식봄']['상품주문번호'].astype(str).tolist() # 식봄 추가!
    
    with st.status("🚀 통합 발주 처리 중...", expanded=True) as s:
        # 네이버는 진짜 API로 발주 처리
        if naver_ids:
            success, msg = confirm_naver_orders(naver_ids)
            if not success: 
                st.error(f"🚨 네이버 발주 처리 에러: {msg}")
                return False, msg
                
        # 💡 쿠팡, 롯데온, 식봄은 아직 내부 블랙리스트 방식으로 '발주확인' 탭으로 넘깁니다!
        local_confirm_ids = coupang_ids + lotteon_ids + sikbom_ids
        if local_confirm_ids: 
            add_to_blacklist(local_confirm_ids)
        
        s.update(label="✅ 발주 요청 전송 완료!", state="complete", expanded=False)
        st.toast("✅ 선택한 주문의 발주가 완벽하게 처리되었습니다!", icon="📦")
        fetch_all_orders() # 처리 후 화면 새로고침
        return True, "발주가 완료되었습니다!"


def execute_order_confirm(selected_df):
    from apis.naver_api import confirm_naver_orders
    from apis._old_backup.utils import add_to_blacklist
    
    naver_ids = selected_df[selected_df['마켓'] == '🟢 네이버']['상품주문번호'].astype(str).tolist()
    coupang_ids = selected_df[selected_df['마켓'] == '🚀 쿠팡']['상품주문번호'].astype(str).tolist()
    lotteon_ids = selected_df[selected_df['마켓'] == '🔴 롯데온']['상품주문번호'].astype(str).tolist() # 💡 롯데온 ID 추출 추가!
    
    with st.status("🚀 통합 발주 처리 중...", expanded=True) as s:
        if naver_ids:
            success, msg = confirm_naver_orders(naver_ids)
            if not success: 
                # 💡 [알림] 실패
                st.error(f"🚨 네이버 발주 처리 에러: {msg}")
                return False, msg
                
        # 💡 쿠팡과 롯데온 주문 건을 모아서 한 번에 발주 확인(블랙리스트) 처리!
        local_confirm_ids = coupang_ids + lotteon_ids
        if local_confirm_ids: 
            add_to_blacklist(local_confirm_ids)
        
        s.update(label="✅ 발주 요청 전송 완료!", state="complete", expanded=False)
        # 💡 [알림] 성공
        st.toast("✅ 선택한 주문의 발주가 완벽하게 처리되었습니다!", icon="📦")
        fetch_all_orders() 
        return True, "발주가 완료되었습니다!"

# ==========================================
# 💰 [Tab 5] 마진 장부 통제 구역
# ==========================================
def sync_margin_fees(fee_n, fee_c, fee_b, fee_l):
    from apis._old_backup.utils import save_settings
    save_settings({"fee_naver": fee_n, "fee_coupang": fee_c, "fee_baemin": fee_b, "fee_lotteon": fee_l})
    # 💡 [알림] 성공 (수수료율을 바꿀 때마다 우측 하단에 살짝 뜸)
    st.toast("✅ 변경된 수수료율이 자동 저장되었습니다!", icon="💾")