from playwright.sync_api import sync_playwright
import time
import imaplib
import email
from email.header import decode_header
import csv
import os
import re
import requests

# 🔑 플레이오토 & 네이버 로그인 정보
PLAYAUTO_ID = "glqgkq384@naver.com  "
PLAYAUTO_PW = "hs1106!@" 
NAVER_PW = "UDC678J31QTU" 
PRODUCT_MAPPING = {}

mapping_file = 'mapping.csv' 
if os.path.exists(mapping_file):
    try:
        with open(mapping_file, mode='r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                online_name = row.get('온라인상품명', '').strip()
                real_name = row.get('장부상품명', '').strip()
                if online_name and real_name:
                    PRODUCT_MAPPING[online_name] = real_name
        print(f"📖 엑셀 사전 로딩 완료! (총 {len(PRODUCT_MAPPING)}개 상품 번역 가능)")
    except Exception as e:
        print(f"⚠️ 엑셀 사전 읽기 실패: {e}")
else:
    print("⚠️ mapping.csv 파일이 없습니다. 그냥 원본 이름 그대로 수집합니다.")
    
def get_auth_code_from_naver():
    print("🕵️‍♂️ [이메일 해커 로봇] 네이버 메일함 침투 시도 중...")
    try:
        mail = imaplib.IMAP4_SSL("imap.naver.com")
        mail.login(PLAYAUTO_ID, NAVER_PW)
        mail.select("inbox")
        for attempt in range(3):
            status, messages = mail.search(None, 'ALL')
            mail_ids = messages[0].split()
            if mail_ids:
                latest_email_id = mail_ids[-1]
                status, msg_data = mail.fetch(latest_email_id, '(RFC822)')
                for response_part in msg_data:
                    if isinstance(response_part, tuple):
                        msg = email.message_from_bytes(response_part[1])
                        body = ""
                        if msg.is_multipart():
                            for part in msg.walk():
                                if part.get_content_type() in ["text/plain", "text/html"]:
                                    body = part.get_payload(decode=True).decode(errors='ignore')
                                    break
                        else:
                            body = msg.get_payload(decode=True).decode(errors='ignore')
                        match = re.search(r'\b\d{6}\b', body)
                        if match:
                            auth_code = match.group()
                            print(f"🎯 [이메일 해커 로봇] 인증번호 획득!! 암호는: {auth_code}")
                            mail.logout()
                            return auth_code
            time.sleep(5)
        mail.logout()
        return None
    except Exception as e:
        print(f"🚨 메일함 해킹 실패: {e}")
        return None

def get_orders_from_playauto():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False) 
        page = browser.new_page()
        page.on("dialog", lambda dialog: dialog.accept())

        try:
            # 💡 [핵심 복구] 대표님이 원하시던 "계속 확인하고 없애는" 무적의 팝업 탐지기 부활!!
            def destroy_zombie_popups():
                print("🔍 팝업 레이더 가동 중...")
                popup_keywords = ["2주간 표시 안함", "다음에 변경하기", "변경사항 없음", "닫기", "오늘 하루 보지 않기"]
                
                for keyword in popup_keywords:
                    try:
                        # 1. 기존에 잘 되던 "버튼" 팝업 타격!
                        btns = page.locator(f'button:has-text("{keyword}"):visible').all()
                        for btn in btns:
                            btn.click(force=True)
                            print(f"💥 버튼형 '{keyword}' 팝업 제거!")
                            page.wait_for_timeout(500)
                            
                        # 2. 플레이오토가 꼼수로 만든 "글자(a, span)" 팝업 타격!
                        links = page.locator(f'a:has-text("{keyword}"):visible, span:has-text("{keyword}"):visible').all()
                        for link in links:
                            link.click(force=True)
                            print(f"💥 이벤트형 '{keyword}' 팝업 제거!")
                            page.wait_for_timeout(500)
                    except: pass
                    
            def force_click_payment_completed():
                try:
                    # 메뉴 강제 클릭 전에도 팝업 한번 훑어주기
                    destroy_zombie_popups()
                    
                    try:
                        page.locator("text='주문'").first.click(force=True)
                        page.wait_for_timeout(1000)
                    except: pass
                    
                    # 애니메이션 무시하고 자바스크립트로 강제 꽂아버리기!
                    page.evaluate("""
                        let paymentTab = document.querySelector('[test-id="navi-order_shipment_payment_list"]');
                        if (paymentTab) {
                            paymentTab.click();
                        } else {
                            let links = document.querySelectorAll('a, span, div');
                            for (let el of links) {
                                if (el.innerText && el.innerText.trim() === '결제완료') {
                                    el.click();
                                    break;
                                }
                            }
                        }
                    """)
                    print("✅ '결제완료' 탭 무적 강제 진입 성공!")
                except Exception as e:
                    print(f"⚠️ 탭 이동 중 에러: {e}")

            print("🚀 플레이오토 로봇 출동! 로그인 중...")
            page.goto("https://app.playauto.io/login.html")
            page.wait_for_timeout(3000) 
            
            inputs = page.locator("input").all()
            if len(inputs) >= 2:
                inputs[0].fill(PLAYAUTO_ID)
                inputs[1].fill(PLAYAUTO_PW)
                
            print("🖱️ 파란색 로그인 버튼 물리 타격!")
            try:
                login_btn = page.locator('button:has-text("Sign In"), button:has-text("로그인")').first
                login_btn.click(force=True)
            except:
                page.keyboard.press("Enter")
                
            page.wait_for_timeout(4000) 
            
            # 💡 중복 접속 팝업 강제 탈취 로직 (원본 유지)
            try:
                if page.locator("text='다른 환경'").is_visible(timeout=3000) or page.locator("text='중복'").is_visible(timeout=3000):
                    print("🚨 중복 접속 팝업 발견! 강제로 빼앗아옵니다!")
                    page.locator('button:has-text("확인"), button:has-text("로그인")').last.click(force=True)
                    page.wait_for_timeout(4000)
            except: pass
            
            try:
                auth_input = page.locator('input[placeholder*="인증번호"]').first
                if auth_input.is_visible(timeout=5000):
                    print("\n🚨 2차 인증 감지! 이메일 해킹 시작...")
                    auth_code = get_auth_code_from_naver()
                    if auth_code:
                        auth_input.fill(auth_code)
                        page.locator('button:has-text("확인")').first.click()
                        print("✅ 인증 돌파 대성공!\n")
                        page.wait_for_timeout(5000)
            except: pass

            # 💡 로그인 직후 팝업 1차 소탕
            destroy_zombie_popups()

            print("🏃‍♂️ [주문] -> [결제완료] 화면으로 이동...")
            force_click_payment_completed()
            page.wait_for_timeout(4000)
            
            # 💡 결제완료 화면 진입 후 팝업 2차 소탕 (혹시 몰라서 확인사살)
            destroy_zombie_popups()
            page.wait_for_timeout(1000)
            destroy_zombie_popups() 

            print("🎯 [퀵수집] 버튼 타격!")
            quick_btn = page.locator('button:has-text("퀵수집")').first
            
            if quick_btn.is_visible():
                quick_btn.click(force=True)
                page.wait_for_timeout(2000)
                
                setup_modal = page.locator("text='퀵 수집 항목 설정'").first
                if setup_modal.is_visible():
                    print("🚨 설정 창 감지! 스마트 필터링 가동!")
                    try:
                        page.evaluate("""
                            let allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
                            if (allCheckboxes.length > 0 && !allCheckboxes[0].checked) {
                                allCheckboxes[0].click();
                            }
                            allCheckboxes.forEach((input, index) => {
                                if (index === 0) return; 
                                let parentText = input.parentElement.innerText || "";
                                if (parentText.includes("결제완료 주문 가져오기")) {
                                    if (!input.checked) input.click();
                                } 
                                else if (parentText.includes("동기화") || parentText.includes("문의") || parentText.includes("메세지") || parentText.includes("상품평")) {
                                    if (input.checked) input.click();
                                }
                            });
                        """)
                        page.wait_for_timeout(1500)
                        page.locator('button:has-text("저장"):visible').first.click(force=True)
                        page.wait_for_timeout(2000)
                        
                        confirm_btns = page.locator('button:has-text("확인"):visible').all()
                        if len(confirm_btns) > 0:
                            confirm_btns[-1].click(force=True)
                            print("✅ 최종 팝업 [확인] 성공! 수집 시작!")
                    except Exception as e:
                        print(f"⚠️ 설정 창 처리 중 에러: {e}")

                print("⏳ 마켓 데이터 수집 중... (25초 대기)")
                page.wait_for_timeout(25000) 
            else:
                print("🚨 화면에 퀵수집 버튼이 없습니다!")

            print("🏃‍♂️ 수집 완료! 데이터 갱신을 위해 [결제완료] 다시 클릭...")
            force_click_payment_completed()
            page.wait_for_timeout(6000)
            
            # 💡 수집 후 데이터 긁기 전에 팝업 3차 소탕!
            destroy_zombie_popups()

            print("📋 '결제완료' 목록에서 진짜 상품명과 수량 추출 중...")
            orders_data = []
            page.wait_for_selector(".ui-grid-row", timeout=10000)
            rows = page.locator(".ui-grid-row").all() 
            
            for i, row in enumerate(rows):
                try:
                    text_content = row.inner_text().split('\n')
                    text_content = [t.strip() for t in text_content if t.strip()] 
                    
                    if len(text_content) < 7: continue 
                    
                    market_text = text_content[0]       
                    order_id_text = text_content[1]     
                    raw_product_name = text_content[4]  
                    qty_text = text_content[6]          
                    
                    try:
                        qty = int(re.sub(r'[^0-9]', '', qty_text)) if re.sub(r'[^0-9]', '', qty_text) else 1
                    except:
                        qty = 1

                    orders_data.append({
                        "market": market_text, 
                        "order_id": order_id_text,
                        "raw_name": raw_product_name, 
                        "qty": qty
                    })
                except Exception as e:
                    print(f"⚠️ {i+1}번째 데이터 추출 실패: {e}")
                    continue

            print(f"✅ 총 {len(orders_data)}건의 주문 수집 완료!")
            browser.close()
            return orders_data

        except Exception as e:
            print(f"🚨 로봇 에러: {e}")
            browser.close()
            return []

if __name__ == "__main__":
    orders = get_orders_from_playauto()
    print("\n================ [수집 결과] ================")
    for o in orders:
        print(f"📦 [{o['market']}] 상품명: {o['raw_name']} | {o['qty']}개")

    API_URL = "http://localhost:8000/api/playauto-orders" 
    if len(orders) > 0:
        try:
            print("\n📡 대시보드 서버로 데이터 전송 중...")
            headers = {'ngrok-skip-browser-warning': '69420'}
            res = requests.post(API_URL, json=orders, headers=headers)
            if res.status_code == 200:
                print("✅ 서버 전송 대성공!! 대시보드를 확인하세요! 🚀")
        except Exception as e:
            print(f"🚨 서버 연결 실패: {e}")