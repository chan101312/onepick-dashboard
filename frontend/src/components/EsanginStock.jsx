import React, { useState, useEffect } from 'react';
import { API_BASE } from '../apiBase';
import { Emoji } from './Icons';

function EsanginStock({ menuType = 'stock' }) {
  const [stockList, setStockList] = useState([]);
  const [priceAlerts, setPriceAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [dataSource, setDataSource] = useState(""); 
  
  const [reorderThreshold, setReorderThreshold] = useState(5);
  const [reorderSearchTerm, setReorderSearchTerm] = useState("");

  const [focusKeywords, setFocusKeywords] = useState("연근, 유부");
  const [focusThreshold, setFocusThreshold] = useState(20);
  
  const [isFetchingVvip, setIsFetchingVvip] = useState(false);
  
  // 💡 [새로운 상태] AI D-Day 예측 결과 저장용!
  const [dDayItems, setDDayItems] = useState([]);
  const [isFetchingDDay, setIsFetchingDDay] = useState(false);

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [alertPage, setAlertPage] = useState(1);
  const [badInvPage, setBadInvPage] = useState(1);
  const [reorderPage, setReorderPage] = useState(1);
  const [deadStockPage, setDeadStockPage] = useState(1);
  
  const cardItemsPerPage = isMobile ? 5 : 20;
  const reorderItemsPerPage = isMobile ? 5 : 30; 
  const itemsPerPage = 20;

  const [confirmedAlertIds, setConfirmedAlertIds] = useState([]);
  const [isLight, setIsLight] = useState(() => document.documentElement.getAttribute('data-theme') === 'light');

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsLight(document.documentElement.getAttribute('data-theme') === 'light');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const themeColors = {
    boxBg: isLight ? '#ffffff' : 'rgba(255,255,255,0.02)',
    text: isLight ? '#111827' : '#ffffff',
    textMuted: isLight ? '#6b7280' : '#9ca3af',
    border: isLight ? '#e5e7eb' : 'rgba(255,255,255,0.1)',
    inputBg: isLight ? '#f9fafb' : 'rgba(0,0,0,0.2)',
    headerBg: isLight ? '#f3f4f6' : 'rgba(255,255,255,0.05)',
  };

  useEffect(() => {
    const fetchSpecificData = async () => {
      setLoading(true);
      setError(null);
      try {
        const stockRes = await fetch(`${API_BASE}/api/esangin-stock`, { headers: { 'ngrok-skip-browser-warning': '69420' } });
        const stockResult = await stockRes.json();

        if (stockResult.status === 'success') {
          const sorted = [...stockResult.data].sort((a, b) => (b.stock || 0) - (a.stock || 0));
          setStockList(sorted);
          setDataSource(stockResult.source);

          if (menuType === 'alert') {
            const alerts = [];
            sorted.forEach(item => {
              const currentPrice = Number(String(item.inPrice || '0').replace(/[^0-9]/g, ''));
              const prevPrice = item.prevInPrice !== undefined 
                              ? Number(String(item.prevInPrice).replace(/[^0-9]/g, '')) 
                              : currentPrice;

              if (currentPrice > prevPrice && prevPrice > 0) {
                alerts.push({ id: `${item.name}_${item.spec}`, name: item.name, spec: item.spec, oldPrice: prevPrice, newPrice: currentPrice, diff: currentPrice - prevPrice });
              }
            });
            alerts.sort((a, b) => b.diff - a.diff);
            setPriceAlerts(alerts);
          }
        } else { setError(stockResult.message); }
      } catch (err) { setError(err.message); } 
      finally { setLoading(false); }
    };
    fetchSpecificData();
  }, [menuType]);

  const fetchVvipTop20 = async () => {
    setIsFetchingVvip(true);
    try {
      const res = await fetch(`${API_BASE}/api/esangin/vvip-top20`, { headers: { 'ngrok-skip-browser-warning': '69420' } });
      const result = await res.json();
      if (result.status === 'success') {
        setFocusKeywords(result.suggested_keywords);
        alert(`👑 E상인 전체 매출 기준 Top 20 품목이 성공적으로 추출되었습니다!\n\n이제 이 VVIP 상품들이 ${focusThreshold}개 미만으로 떨어지면 즉각 경고합니다!`);
      } else {
        alert("데이터를 불러오지 못했습니다: " + result.message);
      }
    } catch (e) {
      alert("서버 연결 실패: " + e.message);
    } finally {
      setIsFetchingVvip(false);
    }
  };

  // 💡 [핵심 엔진] AI D-Day 호출 함수!
  const fetchDDayPredict = async () => {
    setIsFetchingDDay(true);
    try {
      const res = await fetch(`${API_BASE}/api/esangin/d-day-predict`, { headers: { 'ngrok-skip-browser-warning': '69420' } });
      const result = await res.json();
      if (result.status === 'success') {
        if (result.data.length === 0) {
          alert("🎉 대박! 현재 판매 속도 기준으로 14일 안에 품절될 상품이 단 하나도 없습니다! 재고 관리 완벽합니다!");
        }
        setDDayItems(result.data);
      } else {
        alert("D-Day 데이터를 불러오지 못했습니다: " + result.message);
      }
    } catch (e) {
      alert("서버 연결 실패: " + e.message);
    } finally {
      setIsFetchingDDay(false);
    }
  };

  const handleConfirmAlert = (alertId) => {
    if (window.confirm("해당 변동 내역을 확인하셨습니까?")) setConfirmedAlertIds(prev => [...prev, alertId]);
  };

  const visibleAlerts = priceAlerts.filter(alert => !confirmedAlertIds.includes(alert.id));

  const parseDate = (dateStr) => {
    if (!dateStr) return new Date(0); 
    const str = String(dateStr).trim();
    if (str === '') return new Date(0);
    const nativeDate = new Date(str);
    if (!isNaN(nativeDate.getTime())) return nativeDate;
    let cleanStr = str.replace(/[^0-9]/g, ''); 
    if (cleanStr.length >= 8) return new Date(`${cleanStr.substring(0, 4)}-${cleanStr.substring(4, 6)}-${cleanStr.substring(6, 8)}`);
    return new Date(0);
  };

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const deadStockItems = stockList.filter(item => {
    const outDate = parseDate(item.lastSalesDate); 
    const inDate = parseDate(item.lastInDate);     
    const isInactive = outDate < threeMonthsAgo && inDate < threeMonthsAgo;
    return (item.stock <= 0 && isInactive) || (item.stock <= reorderThreshold && isInactive);
  });

  const focusItemsList = stockList.filter(item => {
    if (!focusKeywords.trim()) return false;
    const keywords = focusKeywords.split(',').map(k => k.trim()).filter(k => k);
    if (keywords.length === 0) return false;
    
    const name = String(item.name || '');
    const isFocusItem = keywords.some(k => name.includes(k));
    return isFocusItem && (item.stock !== undefined && item.stock < focusThreshold);
  });

  const reorderList = stockList.filter(item => {
    const isLowStock = item.stock !== undefined && item.stock <= reorderThreshold;
    if (!isLowStock) return false;
    
    const outDate = parseDate(item.lastSalesDate); 
    const hasRecentSales = outDate >= threeMonthsAgo;
    if (!hasRecentSales) return false; 
    
    const name = String(item.name || '');
    const excludedKeywords = ['택배비', '배송비', '아이스팩', '스티로폼', '광고비', '수수료', '정산', '지원금', '위약금', '기타'];
    if (excludedKeywords.some(keyword => name.includes(keyword))) return false;
    
    if (reorderSearchTerm.trim() && !name.toLowerCase().includes(reorderSearchTerm.trim().toLowerCase())) return false;
    return true;
  });

  const badInventoryList = stockList.filter(item => {
    const inDate = parseDate(item.lastInDate);
    const outDate = parseDate(item.lastSalesDate);
    const hasStock = (item.stock || 0) > 0;
    const isOldIn = inDate < threeMonthsAgo;
    const isOldOut = outDate < threeMonthsAgo;
    return hasStock && isOldIn && isOldOut;
  }).sort((a, b) => ((b.stock || 0) * (b.inPrice || 0)) - ((a.stock || 0) * (a.inPrice || 0)));

  const filteredList = stockList.filter(item => {
    if (!searchTerm.trim()) return true;
    return [item.name, item.spec, item.unit].some(val => String(val || '').toLowerCase().includes(searchTerm.trim().toLowerCase()));
  });

  const alertTotalPages = Math.max(1, Math.ceil(visibleAlerts.length / cardItemsPerPage));
  const paginatedAlerts = visibleAlerts.slice((alertPage - 1) * cardItemsPerPage, alertPage * cardItemsPerPage);
  const badInvTotalPages = Math.max(1, Math.ceil(badInventoryList.length / cardItemsPerPage));
  const paginatedBadInv = badInventoryList.slice((badInvPage - 1) * cardItemsPerPage, badInvPage * cardItemsPerPage);
  const reorderTotalPages = Math.max(1, Math.ceil(reorderList.length / reorderItemsPerPage));
  const paginatedReorderList = reorderList.slice((reorderPage - 1) * reorderItemsPerPage, reorderPage * reorderItemsPerPage);
  const deadStockTotalPages = Math.max(1, Math.ceil(deadStockItems.length / cardItemsPerPage));
  const paginatedDeadStock = deadStockItems.slice((deadStockPage - 1) * cardItemsPerPage, deadStockPage * cardItemsPerPage);
  const totalPages = Math.max(1, Math.ceil(filteredList.length / itemsPerPage));
  const page = Math.min(Math.max(currentPage, 1), totalPages);
  const pageItems = filteredList.slice((page - 1) * itemsPerPage, page * itemsPerPage);
  const goToPage = (pageNum) => setCurrentPage(Math.min(Math.max(pageNum, 1), totalPages));
  const handleSearchChange = (e) => { setSearchTerm(e.target.value); setCurrentPage(1); };

  const handleCopyReorderList = () => {
    if (reorderList.length === 0 && focusItemsList.length === 0 && dDayItems.length === 0) { alert("발주할 상품이 없습니다."); return; }
    
    let text = `🚨 [긴급 발주 요청 리스트] 🚨\n\n`;
    let count = 1;
    
    if(dDayItems.length > 0) {
      text += `--- 🧠 AI 예측: 14일 내 품절 임박 ---\n`;
      dDayItems.forEach(item => { text += `${count++}. ${item.name} (${item.spec || '-'}) / 재고: ${item.stock}개 (D-${item.d_day})\n`; });
      text += `\n`;
    }

    if(focusItemsList.length > 0) {
      text += `--- 🌟 VVIP 대량 매입 필요 ---\n`;
      focusItemsList.forEach(item => { text += `${count++}. ${item.name} (${item.spec || '-'}) / 현재재고: ${item.stock}개\n`; });
      text += `\n`;
    }

    text += `--- 🛒 일반 스마트 발주 ---\n`;
    reorderList.forEach(item => { text += `${count++}. ${item.name} (${item.spec || '-'}) / 현재재고: ${item.stock}개\n`; });
    
    if (navigator.clipboard) { navigator.clipboard.writeText(text).then(() => alert("📋 발주 목록이 복사되었습니다!")).catch(err => alert("복사 실패: " + err));
    } else {
      const textArea = document.createElement("textarea"); textArea.value = text; document.body.appendChild(textArea); textArea.select();
      try { document.execCommand('copy'); alert("📋 발주 목록이 복사되었습니다! (비상 복사 모드)"); } catch (err) { alert("복사 실패: 브라우저가 지원하지 않습니다."); }
      document.body.removeChild(textArea);
    }
  };

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: themeColors.text }}>데이터를 똑똑하게 불러오는 중입니다... <Emoji>🚀</Emoji></div>;
  if (error) return <div style={{ color: 'var(--danger)', padding: '20px' }}><Emoji>❌</Emoji> 에러 발생: {error}</div>;

  return (
    <div style={{ padding: '20px', color: themeColors.text, transition: 'all 0.3s ease', boxSizing: 'border-box' }}>

      {/* 1️⃣ 매입 단가 인상 감지 (Alert) */}
      {menuType === 'alert' && (
        <div style={{ background: themeColors.boxBg, padding: '24px', borderRadius: '16px', border: `1px solid ${themeColors.border}`, boxShadow: isLight ? '0 4px 6px rgba(0,0,0,0.02)' : 'none', boxSizing: 'border-box', width: '100%', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <h3 style={{ margin: 0, color: 'var(--danger)', fontSize: '18px', wordBreak: 'keep-all', lineHeight: '1.4' }}><Emoji>🚨</Emoji> 매입 단가 인상 감지 (E상인 기준)</h3>
            <span style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)', padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>남은 알림 {visibleAlerts.length}건</span>
          </div>
          
          {paginatedAlerts.length > 0 ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '16px', width: '100%', boxSizing: 'border-box' }}>
                {paginatedAlerts.map((alert, idx) => (
                  <div key={idx} style={{ padding: '16px', background: themeColors.inputBg, borderRadius: '12px', border: `1px solid ${themeColors.border}`, boxShadow: isLight ? '0 2px 4px rgba(0,0,0,0.02)' : 'none', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <strong style={{ color: themeColors.text, fontSize: '15px', wordBreak: 'break-word', marginRight: '10px', lineHeight: '1.3' }}>{alert.name}</strong>
                    </div>
                    {alert.spec && (
                      <div style={{ marginBottom: '12px' }}>
                        <span style={{ color: themeColors.textMuted, fontSize: '12px', background: themeColors.boxBg, padding: '4px 8px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, display: 'inline-block' }}>{alert.spec}</span>
                      </div>
                    )}
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: themeColors.textMuted, marginBottom: '6px' }}>
                      <span>이전 매입 단가:</span>
                      <span style={{ textDecoration: 'line-through' }}>{alert.oldPrice.toLocaleString()}원</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px' }}>
                      <span>최근 매입 단가:</span>
                      <strong style={{ color: 'var(--danger)' }}>{alert.newPrice.toLocaleString()}원</strong>
                    </div>

                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px dashed ${themeColors.border}`, fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: themeColors.textMuted }}>원가 인상폭:</span>
                      <strong style={{ color: 'var(--danger)', fontSize: '15px' }}>▲ {alert.diff.toLocaleString()}원</strong>
                    </div>

                    <button 
                      onClick={() => handleConfirmAlert(alert.id)}
                      style={{ marginTop: '16px', width: '100%', padding: '10px', borderRadius: '8px', border: 'none', background: themeColors.border, color: themeColors.text, fontWeight: 'bold', cursor: 'pointer', transition: 'opacity 0.2s', flexShrink: 0, fontSize: '13px' }}
                      onMouseOver={(e) => e.target.style.opacity = '0.8'}
                      onMouseOut={(e) => e.target.style.opacity = '1'}
                    >
                      내용 확인 완료
                    </button>
                  </div>
                ))}
              </div>
              
              {alertTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${themeColors.border}`, flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ fontSize: '13px', color: themeColors.textMuted }}>전체 {visibleAlerts.length}개 · {alertTotalPages}페이지</div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button onClick={() => setAlertPage(prev => Math.max(prev - 1, 1))} disabled={alertPage === 1} style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, background: themeColors.inputBg, cursor: alertPage === 1 ? 'not-allowed' : 'pointer', color: themeColors.text, fontSize: '12px' }}>이전</button>
                    <span style={{ fontWeight: 'bold', color: themeColors.text, fontSize: '13px' }}>{alertPage} / {alertTotalPages}</span>
                    <button onClick={() => setAlertPage(prev => Math.min(prev + 1, alertTotalPages))} disabled={alertPage === alertTotalPages} style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, background: themeColors.inputBg, cursor: alertPage === alertTotalPages ? 'not-allowed' : 'pointer', color: themeColors.text, fontSize: '12px' }}>다음</button>
                  </div>
                </div>
              )}
            </>
          ) : ( 
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--success)', fontWeight: 'bold', fontSize: '14px', background: themeColors.inputBg, borderRadius: '12px' }}>
              <Emoji>✅</Emoji> 모든 변동 내역을 확인하셨거나, 인상된 상품이 없습니다!
            </div>
          )}
        </div>
      )}

      {/* 2️⃣ 악성재고 긴급 리스트 (Deadstock Menu) */}
      {menuType === 'deadstock' && (
        <div style={{ background: themeColors.boxBg, border: `1px solid ${themeColors.border}`, borderRadius: '16px', padding: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.02)', boxSizing: 'border-box', width: '100%', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ margin: 0, color: 'var(--danger)', fontSize: '18px', wordBreak: 'keep-all', lineHeight: '1.4' }}><Emoji>🔥</Emoji> 악성재고 긴급 리스트</h3>
              <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: themeColors.textMuted, wordBreak: 'keep-all', lineHeight: '1.4' }}>* 매입한지 3개월이 넘었는데 창고에 쌓여서 안 나가는 상품들입니다.</p>
            </div>
            <span style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)', padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>총 {badInventoryList.length}개 발견</span>
          </div>

          {paginatedBadInv.length > 0 ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '16px', width: '100%', boxSizing: 'border-box' }}>
                {paginatedBadInv.map((item, idx) => {
                  const totalValue = (item.stock || 0) * (item.inPrice || 0);
                  return (
                    <div key={idx} style={{ padding: '16px', background: themeColors.inputBg, borderRadius: '12px', border: `1px solid ${themeColors.border}`, boxShadow: isLight ? '0 2px 4px rgba(0,0,0,0.02)' : 'none', boxSizing: 'border-box', width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <strong style={{ color: themeColors.text, fontSize: '15px', wordBreak: 'break-word', marginRight: '10px', lineHeight: '1.3' }}>{item.name}</strong>
                        <span style={{ color: themeColors.text, fontSize: '14px', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0 }}>{item.stock}개 잔류</span>
                      </div>
                      {item.spec && (
                        <div style={{ marginBottom: '12px' }}>
                          <span style={{ color: themeColors.textMuted, fontSize: '12px', background: themeColors.boxBg, padding: '4px 8px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, display: 'inline-block' }}>{item.spec}</span>
                        </div>
                      )}
                      <div style={{ fontSize: '12px', color: themeColors.textMuted, lineHeight: '1.6' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ fontSize: '13px' }}><Emoji>📅</Emoji></span> 마지막 매입: {item.lastInDate || '기록없음'}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ fontSize: '13px' }}><Emoji>📅</Emoji></span> 마지막 매출: {item.lastSalesDate || '기록없음'}</div>
                      </div>
                      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px dashed ${themeColors.border}`, fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: themeColors.textMuted }}>묶인 원가:</span>
                        <strong style={{ color: themeColors.text }}>{totalValue.toLocaleString()}원</strong>
                      </div>
                    </div>
                  );
                })}
              </div>

              {badInvTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${themeColors.border}`, flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ fontSize: '13px', color: themeColors.textMuted }}>전체 {badInventoryList.length}개 · {badInvTotalPages}페이지</div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button onClick={() => setBadInvPage(prev => Math.max(prev - 1, 1))} disabled={badInvPage === 1} style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, background: themeColors.inputBg, cursor: badInvPage === 1 ? 'not-allowed' : 'pointer', color: themeColors.text, fontSize: '12px' }}>이전</button>
                    <span style={{ fontWeight: 'bold', color: themeColors.text, fontSize: '13px' }}>{badInvPage} / {badInvTotalPages}</span>
                    <button onClick={() => setBadInvPage(prev => Math.min(prev + 1, badInvTotalPages))} disabled={badInvPage === badInvTotalPages} style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, background: themeColors.inputBg, cursor: badInvPage === badInvTotalPages ? 'not-allowed' : 'pointer', color: themeColors.text, fontSize: '12px' }}>다음</button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--success)', fontWeight: 'bold', fontSize: '14px', background: themeColors.inputBg, borderRadius: '12px' }}>
              <Emoji>✅</Emoji> 3개월 이상 정체된 악성 재고가 없습니다!
            </div>
          )}
        </div>
      )}

      {/* 3️⃣ 전체 재고 테이블 (Stock) */}
      {menuType === 'stock' && (
        <div style={{ boxSizing: 'border-box', width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
            <input type="text" value={searchTerm} onChange={handleSearchChange} placeholder="검색: 상품명/규격" style={{ padding: '10px 14px', borderRadius: '8px', border: `1px solid ${themeColors.border}`, background: themeColors.inputBg, color: themeColors.text, flex: '1', minWidth: '0' }} />
          </div>

          <div style={{ overflowX: 'auto', background: themeColors.boxBg, borderRadius: '12px', border: `1px solid ${themeColors.border}`, width: '100%' }}>
            <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse', textAlign: 'center' }}>
              <thead style={{ background: themeColors.headerBg, borderBottom: `1px solid ${themeColors.border}` }}>
                <tr>
                  <th style={{ padding: '10px', color: themeColors.text, fontSize: '13px' }}>상품명</th><th style={{ padding: '10px', color: themeColors.text, fontSize: '13px' }}>매입가</th><th style={{ padding: '10px', color: themeColors.text, fontSize: '13px' }}>규격</th>
                  <th style={{ padding: '10px', color: themeColors.text, fontSize: '13px' }}>단위</th><th style={{ padding: '10px', color: themeColors.text, fontSize: '13px' }}>박스수량</th><th style={{ padding: '10px', color: themeColors.text, fontSize: '13px' }}>재고</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item, index) => (
                  <tr key={index} style={{ borderBottom: `1px solid ${themeColors.border}` }}>
                    <td style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold', color: themeColors.text, fontSize: '13px' }}>{item.name}</td>
                    <td style={{ padding: '10px', color: themeColors.text, fontSize: '13px' }}>{Number(item.inPrice || 0).toLocaleString()}원</td>
                    <td style={{ padding: '10px', color: themeColors.textMuted, fontSize: '13px' }}>{item.spec || '-'}</td><td style={{ padding: '10px', color: themeColors.textMuted, fontSize: '13px' }}>{item.unit || '-'}</td>
                    <td style={{ padding: '10px', color: themeColors.text, fontSize: '13px' }}>{Number(item.boxQty || 0).toLocaleString()}</td>
                    <td style={{ padding: '10px', color: item.stock <= reorderThreshold ? 'var(--danger)' : themeColors.text, fontWeight: item.stock <= reorderThreshold ? '900' : 'normal', fontSize: '13px' }}>{Number(item.stock || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ fontSize: '13px', color: themeColors.textMuted }}>전체 {filteredList.length}개 · {totalPages}페이지</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button onClick={() => goToPage(page - 1)} disabled={page === 1} style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, background: themeColors.inputBg, cursor: page === 1 ? 'not-allowed' : 'pointer', color: themeColors.text, fontSize: '12px' }}>이전</button>
              <span style={{ fontWeight: 'bold', color: themeColors.text, fontSize: '13px' }}>{page} / {totalPages}</span>
              <button onClick={() => goToPage(page + 1)} disabled={page === totalPages} style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, background: themeColors.inputBg, cursor: page === totalPages ? 'not-allowed' : 'pointer', color: themeColors.text, fontSize: '12px' }}>다음</button>
            </div>
          </div>
        </div>
      )}

      {/* 4️⃣ 스마트 발주 도우미 (Reorder Menu) */}
      {menuType === 'reorder' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', boxSizing: 'border-box', width: '100%' }}>
          
          {/* 🧠 [NEW] AI 품절 D-Day 예측 레이더 */}
          <div style={{ padding: '20px', background: isLight ? 'rgba(236, 72, 153, 0.05)' : 'rgba(236, 72, 153, 0.1)', border: `2px solid rgba(236, 72, 153, 0.4)`, borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.02)', boxSizing: 'border-box', width: '100%', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '15px' }}>
              <div>
                <h3 style={{ margin: 0, color: '#ec4899', fontSize: '18px', wordBreak: 'keep-all', lineHeight: '1.4' }}><Emoji>🧠</Emoji> AI 품절 D-Day 예측</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: themeColors.textMuted }}>최근 14일 판매 속도를 분석하여 품절 임박(D-14 이내) 상품을 찾아냅니다.</p>
              </div>
              
              <button 
                onClick={fetchDDayPredict} 
                disabled={isFetchingDDay}
                style={{ background: 'linear-gradient(135deg, #ec4899, #be185d)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: isFetchingDDay ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', opacity: isFetchingDDay ? 0.6 : 1, boxShadow: '0 2px 8px rgba(236,72,153,0.3)' }}
              >
                {isFetchingDDay ? <><Emoji>⏳</Emoji> AI 분석 중...</> : <><Emoji>🎯</Emoji> 14일 내 품절 예상 상품 스캔</>}
              </button>
            </div>

            {dDayItems.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '12px', width: '100%', boxSizing: 'border-box' }}>
                  {dDayItems.map((item, idx) => (
                    <div key={idx} style={{ padding: '14px', background: themeColors.inputBg, borderRadius: '12px', border: `1px dashed rgba(236, 72, 153, 0.5)`, boxShadow: isLight ? '0 2px 4px rgba(0,0,0,0.02)' : 'none', boxSizing: 'border-box', width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <strong style={{ color: themeColors.text, fontSize: '15px', wordBreak: 'break-word', marginRight: '10px', lineHeight: '1.3' }}>{item.name}</strong>
                        <span style={{ color: '#ec4899', fontSize: '16px', fontWeight: '900', whiteSpace: 'nowrap', flexShrink: 0 }}>D-{item.d_day} <Emoji>🚨</Emoji></span>
                      </div>
                      {item.spec && (
                        <div style={{ marginBottom: '8px' }}>
                          <span style={{ color: themeColors.textMuted, fontSize: '12px', background: themeColors.boxBg, padding: '4px 8px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, display: 'inline-block' }}>{item.spec}</span>
                        </div>
                      )}
                      <div style={{ fontSize: '12px', color: themeColors.textMuted, display: 'flex', justifyContent: 'space-between' }}>
                        <span>현재 재고: <strong>{item.stock}개</strong></span>
                        <span>하루 평균: <strong>{item.daily_avg}개 판매</strong></span>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: '#ec4899', fontWeight: 'bold', fontSize: '14px', background: themeColors.inputBg, borderRadius: '12px' }}>
                버튼을 눌러 AI 스캔을 시작하세요! (최근 판매 데이터가 없으면 비어있을 수 있습니다)
              </div>
            )}
          </div>

          {/* 🌟 VVIP 집중 관리 품목 경고 카드 */}
          <div style={{ padding: '20px', background: isLight ? 'rgba(139, 92, 246, 0.05)' : 'rgba(139, 92, 246, 0.1)', border: `2px solid rgba(139, 92, 246, 0.4)`, borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.02)', boxSizing: 'border-box', width: '100%', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '15px' }}>
              <div>
                <h3 style={{ margin: 0, color: '#8b5cf6', fontSize: '18px', wordBreak: 'keep-all', lineHeight: '1.4' }}><Emoji>🌟</Emoji> VVIP 품목 집중 감시망</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: themeColors.textMuted }}>대량 매입/주력 상품을 별도 수량으로 감시합니다.</p>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', background: themeColors.boxBg, padding: '8px 12px', borderRadius: '10px', border: `1px solid ${themeColors.border}` }}>
                <button 
                  onClick={fetchVvipTop20} 
                  disabled={isFetchingVvip}
                  style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: isFetchingVvip ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', opacity: isFetchingVvip ? 0.6 : 1 }}
                >
                  {isFetchingVvip ? <><Emoji>⏳</Emoji> 추출 중...</> : <><Emoji>👑</Emoji> 매출 Top 20 자동 추출</>}
                </button>
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: themeColors.textMuted, marginLeft: '8px' }}>대상:</span>
                <input 
                  type="text" 
                  value={focusKeywords} 
                  onChange={(e) => setFocusKeywords(e.target.value)} 
                  placeholder="추출 버튼을 눌러보세요!" 
                  style={{ 
                    flex: '1', minWidth: '120px', padding: '6px 10px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, 
                    background: themeColors.inputBg, color: themeColors.text, outline: 'none', fontSize: '12px'
                  }} 
                />
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: themeColors.textMuted, marginLeft: '4px' }}>경고 기준:</span>
                <input 
                  type="number" 
                  value={focusThreshold} 
                  onChange={(e) => setFocusThreshold(Number(e.target.value))} 
                  style={{ width: '45px', padding: '6px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, background: themeColors.inputBg, color: themeColors.text, outline: 'none', textAlign: 'center', fontSize: '12px' }} 
                />
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: themeColors.textMuted }}>개 미만</span>
              </div>
            </div>

            {focusItemsList.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '12px', width: '100%', boxSizing: 'border-box' }}>
                  {focusItemsList.map((item, idx) => (
                    <div key={idx} style={{ padding: '14px', background: themeColors.inputBg, borderRadius: '12px', border: `1px dashed rgba(139, 92, 246, 0.5)`, boxShadow: isLight ? '0 2px 4px rgba(0,0,0,0.02)' : 'none', boxSizing: 'border-box', width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <strong style={{ color: themeColors.text, fontSize: '15px', wordBreak: 'break-word', marginRight: '10px', lineHeight: '1.3' }}>{item.name}</strong>
                        <span style={{ color: '#8b5cf6', fontSize: '15px', fontWeight: '900', whiteSpace: 'nowrap', flexShrink: 0 }}>{item.stock}개 남음!!</span>
                      </div>
                      {item.spec && (
                        <div>
                          <span style={{ color: themeColors.textMuted, fontSize: '12px', background: themeColors.boxBg, padding: '4px 8px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, display: 'inline-block' }}>{item.spec}</span>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: '#8b5cf6', fontWeight: 'bold', fontSize: '14px', background: themeColors.inputBg, borderRadius: '12px' }}>
                <Emoji>✅</Emoji> 집중 관리 품목( {focusKeywords ? 'VVIP 20개 등' : '없음'} )의 재고가 모두 {focusThreshold}개 이상 유지 중입니다!
              </div>
            )}
          </div>

          <div style={{ padding: '20px', background: themeColors.boxBg, border: `1px solid ${themeColors.border}`, borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.02)', boxSizing: 'border-box', width: '100%', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
              <h3 style={{ margin: 0, color: 'var(--amber)', fontSize: '18px', wordBreak: 'keep-all', lineHeight: '1.4' }}><Emoji>🛒</Emoji> 스마트 발주 (일반 품목)</h3>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', width: '100%' }}>
                <input 
                  type="text" 
                  value={reorderSearchTerm} 
                  onChange={(e) => { setReorderSearchTerm(e.target.value); setReorderPage(1); }} 
                  placeholder="🔍 상품 검색..." 
                  style={{ flex: '1', minWidth: '120px', padding: '8px 12px', borderRadius: '8px', border: `1px solid ${themeColors.border}`, background: themeColors.inputBg, color: themeColors.text, outline: 'none', fontSize: '13px' }} 
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: themeColors.inputBg, padding: '6px 10px', borderRadius: '8px', border: `1px solid ${themeColors.border}` }}>
                  <span style={{ fontSize: '12px', fontWeight: 'bold', color: themeColors.textMuted }}>일반 기준:</span>
                  <input type="number" value={reorderThreshold} onChange={(e) => { setReorderThreshold(Number(e.target.value)); setReorderPage(1); }} style={{ width: '40px', padding: '4px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, background: themeColors.boxBg, color: themeColors.text, outline: 'none', textAlign: 'center', fontSize: '12px' }} />
                  <span style={{ fontSize: '12px', fontWeight: 'bold', color: themeColors.textMuted }}>개</span>
                </div>
                <button onClick={handleCopyReorderList} style={{ flexShrink: 0, background: 'var(--amber)', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 2px 4px color-mix(in srgb, var(--amber) 30%, transparent)', fontSize: '12px' }}><Emoji>📋</Emoji> 통합 발주서 복사</button>
              </div>
            </div>

            {paginatedReorderList.length > 0 ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '16px', width: '100%', boxSizing: 'border-box' }}>
                    {paginatedReorderList.map((item, idx) => (
                      <div key={idx} style={{ padding: '16px', background: themeColors.inputBg, borderRadius: '12px', border: `1px solid ${themeColors.border}`, boxShadow: isLight ? '0 2px 4px rgba(0,0,0,0.02)' : 'none', boxSizing: 'border-box', width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                          <strong style={{ color: themeColors.text, fontSize: '15px', wordBreak: 'break-word', marginRight: '10px', lineHeight: '1.3' }}>{item.name}</strong>
                          <span style={{ color: themeColors.text, fontSize: '14px', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0 }}>{item.stock}개 잔류</span>
                        </div>
                        {item.spec && (
                          <div>
                            <span style={{ color: themeColors.textMuted, fontSize: '12px', background: themeColors.boxBg, padding: '4px 8px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, display: 'inline-block' }}>{item.spec}</span>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
                
                {reorderTotalPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${themeColors.border}`, flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ fontSize: '13px', color: themeColors.textMuted }}>발주 대상 {reorderList.length}개 · {reorderTotalPages}페이지</div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <button onClick={() => setReorderPage(prev => Math.max(prev - 1, 1))} disabled={reorderPage === 1} style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, background: themeColors.inputBg, cursor: reorderPage === 1 ? 'not-allowed' : 'pointer', color: themeColors.text, fontSize: '12px' }}>이전</button>
                      <span style={{ fontWeight: 'bold', color: themeColors.text, fontSize: '13px' }}>{reorderPage} / {reorderTotalPages}</span>
                      <button onClick={() => setReorderPage(prev => Math.min(prev + 1, reorderTotalPages))} disabled={reorderPage === reorderTotalPages} style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, background: themeColors.inputBg, cursor: reorderPage === reorderTotalPages ? 'not-allowed' : 'pointer', color: themeColors.text, fontSize: '12px' }}>다음</button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ padding: '30px', textAlign: 'center', color: themeColors.textMuted, fontSize: '14px', background: themeColors.inputBg, borderRadius: '12px' }}>
                조건에 맞는 발주 필요 상품이 없습니다.
              </div>
            )}
          </div>

          <div style={{ padding: '20px', background: themeColors.boxBg, border: `1px solid ${themeColors.border}`, borderRadius: '16px', boxSizing: 'border-box', width: '100%', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <h3 style={{ margin: 0, color: '#8c8c8c', fontSize: '16px', wordBreak: 'keep-all', lineHeight: '1.4' }}><Emoji>⚠️</Emoji> 단종 의심 (3개월 미거래)</h3>
              <span style={{ background: themeColors.headerBg, padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', color: themeColors.textMuted, whiteSpace: 'nowrap' }}>총 {deadStockItems.length}개</span>
            </div>
            
            {paginatedDeadStock.length > 0 ? (
               <>
                 <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '12px', boxSizing: 'border-box', width: '100%' }}>
                   {paginatedDeadStock.map((item, idx) => (
                      <div key={idx} style={{ padding: '14px', background: themeColors.inputBg, borderRadius: '12px', border: `1px solid ${themeColors.border}`, boxShadow: isLight ? '0 2px 4px rgba(0,0,0,0.02)' : 'none', boxSizing: 'border-box', width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                          <strong style={{ color: themeColors.text, fontSize: '14px', wordBreak: 'break-word', marginRight: '10px', lineHeight: '1.3' }}>{item.name}</strong>
                          <span style={{ color: themeColors.text, fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0 }}>{item.stock}개 잔류</span>
                        </div>
                        {item.spec && (
                          <div style={{ marginBottom: '10px' }}>
                            <span style={{ color: themeColors.textMuted, fontSize: '11px', background: themeColors.boxBg, padding: '4px 8px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, display: 'inline-block' }}>{item.spec}</span>
                          </div>
                        )}
                        <div style={{ fontSize: '11px', color: themeColors.textMuted, lineHeight: '1.6' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ fontSize: '12px' }}><Emoji>📅</Emoji></span> 매입: {item.lastInDate || '기록없음'}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ fontSize: '12px' }}><Emoji>📅</Emoji></span> 매출: {item.lastSalesDate || '기록없음'}</div>
                        </div>
                      </div>
                   ))}
                 </div>

                 {deadStockTotalPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${themeColors.border}`, flexWrap: 'wrap', gap: '10px' }}>
                      <div style={{ fontSize: '13px', color: themeColors.textMuted }}>전체 {deadStockItems.length}개 · {deadStockTotalPages}페이지</div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <button onClick={() => setDeadStockPage(prev => Math.max(prev - 1, 1))} disabled={deadStockPage === 1} style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, background: themeColors.inputBg, cursor: deadStockPage === 1 ? 'not-allowed' : 'pointer', color: themeColors.text, fontSize: '12px' }}>이전</button>
                        <span style={{ fontWeight: 'bold', color: themeColors.text, fontSize: '13px' }}>{deadStockPage} / {deadStockTotalPages}</span>
                        <button onClick={() => setDeadStockPage(prev => Math.min(prev + 1, deadStockTotalPages))} disabled={deadStockPage === deadStockTotalPages} style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${themeColors.border}`, background: themeColors.inputBg, cursor: deadStockPage === deadStockTotalPages ? 'not-allowed' : 'pointer', color: themeColors.text, fontSize: '12px' }}>다음</button>
                      </div>
                    </div>
                  )}
               </>
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: themeColors.textMuted, fontSize: '13px' }}>
                단종 의심 상품이 없습니다.
              </div>
            )}
          </div>

        </div>
      )}

    </div>
  );
}

export default EsanginStock;