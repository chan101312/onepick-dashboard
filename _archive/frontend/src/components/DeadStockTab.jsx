import React, { useState, useEffect } from 'react';
import { API_BASE } from '../apiBase';

export default function DeadStockTab() {
  const [deadStockList, setDeadStockList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [isLight, setIsLight] = useState(() => document.documentElement.getAttribute('data-theme') === 'light');

  useEffect(() => {
    const observer = new MutationObserver(() => setIsLight(document.documentElement.getAttribute('data-theme') === 'light'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const fetchDeadStock = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/esangin-stock`, { headers: { 'ngrok-skip-browser-warning': '69420' } });
        const result = await res.json();
        
        if (result.status === 'success') {
          const now = new Date();
          const threeMonthsAgo = new Date();
          threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

          const parseDate = (d) => {
            if (!d) return new Date(0);
            const s = String(d).replace(/[^0-9]/g, '');
            return s.length === 8 ? new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`) : new Date(0);
          };

          // 💡 [악성재고 판정 로직]
          // 1. 재고가 0보다 크고
          // 2. 마지막 매입일이 3개월 전이며
          // 3. 마지막 매출일도 3개월 전(또는 없음) 인 상품
          const filtered = result.data.filter(item => {
            const inDate = parseDate(item.lastInDate);
            const outDate = parseDate(item.lastSalesDate);
            const hasStock = (item.stock || 0) > 0;
            
            const isOldIn = inDate < threeMonthsAgo;
            const isOldOut = outDate < threeMonthsAgo;

            return hasStock && isOldIn && isOldOut;
          }).sort((a, b) => (b.stock * b.inPrice) - (a.stock * a.inPrice)); // 금액이 큰 순서대로 정렬

          setDeadStockList(filtered);
        }
      } catch (err) {
        setError("데이터 로딩 실패");
      } finally {
        setLoading(false);
      }
    };
    fetchDeadStock();
  }, []);

  const themeVars = {
    bg: isLight ? '#ffffff' : 'rgba(255,255,255,0.02)',
    text: isLight ? '#111827' : '#ffffff',
    border: isLight ? '#e5e7eb' : 'rgba(255,255,255,0.1)',
    cardBg: isLight ? '#fff1f0' : 'rgba(255,77,79,0.05)',
  };

  if (loading) return <div style={{ padding: '40px', color: themeVars.text }}>악성 재고를 분석 중입니다... 🔎</div>;

  return (
    <div style={{ padding: '20px', color: themeVars.text }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
          🚨 악성재고 긴급 리스트 (3개월 이상 미거래)
        </h2>
        <p style={{ marginTop: '8px', color: 'gray' }}>* 매입/매출 기록이 90일 이상 없으면서 창고에 쌓여있는 상품들입니다.</p>
      </div>

      {deadStockList.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '20px' }}>
          {deadStockList.map((item, idx) => {
            const totalValue = (item.stock || 0) * (item.inPrice || 0);
            return (
              <div key={idx} style={{ 
                background: themeVars.bg, border: `2px solid #ff4d4f`, borderRadius: '16px', padding: '20px',
                boxShadow: '0 4px 12px rgba(255, 77, 79, 0.1)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                  <span style={{ fontSize: '18px', fontWeight: 'bold' }}>{item.name}</span>
                  <span style={{ color: '#ff4d4f', fontWeight: '900' }}>{item.stock}개 잔약</span>
                </div>
                
                <div style={{ fontSize: '14px', lineHeight: '1.8', color: 'gray' }}>
                  <div>📍 규격/단위: {item.spec} / {item.unit}</div>
                  <div>📅 마지막 매입: <span style={{color: themeVars.text}}>{item.lastInDate || '기록없음'}</span></div>
                  <div>📅 마지막 매출: <span style={{color: themeVars.text}}>{item.lastSalesDate || '기록없음'}</span></div>
                  <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px dashed ${themeVars.border}`, fontSize: '16px' }}>
                    💰 묶여있는 금액: <strong style={{color: '#ff4d4f'}}>{totalValue.toLocaleString()}원</strong>
                  </div>
                </div>

                <div style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
                  <button style={{ flex: 1, padding: '8px', borderRadius: '8px', border: 'none', background: '#ff4d4f', color: '#white', fontWeight: 'bold', cursor: 'pointer' }}>할인 행사 품목 지정</button>
                  <button style={{ flex: 1, padding: '8px', borderRadius: '8px', border: `1px solid #ff4d4f`, background: 'transparent', color: '#ff4d4f', fontWeight: 'bold', cursor: 'pointer' }}>재고 폐기 검토</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ padding: '50px', textAlign: 'center', background: themeVars.bg, borderRadius: '16px', border: `1px dashed ${themeVars.border}` }}>
          ✅ 3개월 이상 정체된 악성 재고가 없습니다! 창고 회전이 아주 건강합니다.
        </div>
      )}
    </div>
  );
}