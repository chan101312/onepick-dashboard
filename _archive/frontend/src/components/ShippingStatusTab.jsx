import { useState, useEffect } from 'react';
import { API_BASE } from '../apiBase';

export default function ShippingStatusTab() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/orders`)
      .then(res => res.json())
      .then(data => {
        // 💡 [핵심] 전체 데이터 중 '배송' 상태인 것만 걸러서 보여줍니다.
        const shippingOrders = data.data.filter(order => order.주문상태.includes('배송'));
        setOrders(shippingOrders);
        setLoading(false);
      });
  }, []);

  return (
    <div>
      <h2>🚚 배송 중 / 배송 완료 현황</h2>
      <p style={{ color: 'var(--text-2)' }}>고객에게 발송된 상품들의 배송 상태를 추적합니다.</p>

      {loading ? <p>데이터 불러오는 중...</p> : (
        <table border="0" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', marginTop: '10px' }}>
          <thead>
            <tr>
              <th style={{ padding: '10px' }}>마켓</th>
              <th>주문상태</th>
              <th>상품명</th>
              <th>수량</th>
              <th>운송장번호</th>
            </tr>
          </thead>
          <tbody>
            {orders.length > 0 ? orders.map((order, idx) => (
              <tr key={idx}>
                <td style={{ padding: '10px' }}>{order.마켓}</td>
                <td style={{ color: order.주문상태.includes('완료') ? 'var(--success)' : 'var(--accent)', fontWeight: 750 }}>
                  {order.주문상태}
                </td>
                <td>{order.상품명}</td>
                <td>{order.수량}</td>
                <td>1234-5678-9012 (CJ대한통운)</td>
              </tr>
            )) : (
              <tr><td colSpan="5" style={{ padding: '20px', color: 'gray' }}>현재 배송 중인 주문이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}