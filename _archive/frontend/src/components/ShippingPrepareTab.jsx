import { useState, useEffect } from 'react';
import { API_BASE } from '../apiBase';

export default function ShippingPrepareTab() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/orders`)
      .then(res => res.json())
      .then(data => {
        // 💡 [핵심] 전체 데이터 중 '발주'나 '준비' 상태인 것만 걸러서 보여줍니다.
        const preparedOrders = data.data.filter(order => 
          order.주문상태.includes('발주') || order.주문상태.includes('준비')
        );
        setOrders(preparedOrders);
        setLoading(false);
      });
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '10px', flexWrap: 'wrap' }}>
        <h2>📦 발주 확인 완료 (배송 준비 중)</h2>
        <button style={{ padding: '10px 14px', cursor: 'pointer', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '10px', fontWeight: 700, color: 'var(--text)' }}>
          🚚 선택 주문 운송장 입력 및 발송처리
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="spinner" aria-hidden="true" />
          <div>데이터를 불러오는 중입니다...</div>
        </div>
      ) : (
        <table border="0" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
          <thead>
            <tr>
              <th style={{ padding: '10px', width: '50px' }}>선택</th>
              <th>마켓</th>
              <th>주문상태</th>
              <th>상품명</th>
              <th>수량</th>
              <th>택배사 / 운송장번호 입력</th>
            </tr>
          </thead>
          <tbody>
            {orders.length > 0 ? orders.map((order, idx) => (
              <tr key={idx}>
                <td style={{ padding: '10px' }}><input type="checkbox" style={{ transform: 'scale(1.5)', cursor: 'pointer' }} /></td>
                <td>{order.마켓}</td>
                <td>{order.주문상태}</td>
                <td>{order.상품명}</td>
                <td>{order.수량}</td>
                <td>
                  <input type="text" placeholder="택배사" style={{ width: '90px', marginRight: '6px' }} />
                  <input type="text" placeholder="운송장 번호" style={{ width: '160px' }} />
                </td>
              </tr>
            )) : (
              <tr><td colSpan="6" style={{ padding: '20px', color: 'gray' }}>현재 배송 준비 중인 주문이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}