import { useState, useEffect } from 'react';
import { API_BASE } from '../apiBase';

export default function OrdersTab() {
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all'); // all | new | prepare | shipping
  const [importMarket, setImportMarket] = useState('sikbom');
  const [importFile, setImportFile] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  
  // 💡 [핵심] 체크박스로 선택한 주문 번호들을 담아둘 장바구니
  const [selectedIds, setSelectedIds] = useState([]);

  const fetchOrders = () => {
    setLoadingOrders(true);
    fetch(`${API_BASE}/api/orders`)
      .then(res => res.json())
      .then(data => {
        setOrders(data.data);
        setLoadingOrders(false);
        setSelectedIds([]); // 데이터 새로고침 시 선택된 체크박스 초기화
      });
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const matchStatus = (order) => {
    const s = String(order?.주문상태 || '');
    if (statusFilter === 'all') return true;
    if (statusFilter === 'new') return s.includes('신규') || s.includes('결제완료') || s.includes('PAYED');
    if (statusFilter === 'prepare') return s.includes('발주') || s.includes('준비');
    if (statusFilter === 'shipping') return s.includes('배송');
    return true;
  };

  const filteredOrders = orders.filter(matchStatus);

  const handleImport = () => {
    if (!importFile) {
      alert("주문 파일을 선택해주세요.");
      return;
    }
    setIsImporting(true);
    const form = new FormData();
    form.append('market', importMarket);
    form.append('file', importFile);
    fetch(`${API_BASE}/api/orders/import`, { method: 'POST', body: form })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          alert(data.message);
          setImportFile(null);
          fetchOrders();
        } else {
          alert(data.message || '가져오기 실패');
        }
      })
      .catch((e) => {
        console.error(e);
        alert("가져오기 중 오류가 발생했습니다.");
      })
      .finally(() => setIsImporting(false));
  };

  // 1. 체크박스 단일 선택/해제 로직
  const handleCheck = (orderId) => {
    setSelectedIds(prev => 
      prev.includes(orderId) 
        ? prev.filter(id => id !== orderId) // 이미 장바구니에 있으면 뺌
        : [...prev, orderId] // 없으면 넣음
    );
  };

  // 2. 전체 선택 로직
  const handleSelectAll = () => {
    const allIds = filteredOrders.map(order => order.상품주문번호);
    setSelectedIds(allIds);
  };

  // 3. 전체 해제 로직
  const handleDeselectAll = () => {
    setSelectedIds([]);
  };

  // 4. 🚀 [발주 확인] 파이썬 서버로 명령 내리기
  const handleBatchConfirm = () => {
    if (selectedIds.length === 0) {
      alert("🚨 선택된 주문이 없습니다!");
      return;
    }

    // 서버에 네이버 발주 기능이 연결되어 있으므로, 선택된 것 중 네이버 주문 번호만 쏙 골라냅니다.
    const naverIds = orders
      .filter(order => selectedIds.includes(order.상품주문번호) && order.마켓.includes('네이버'))
      .map(order => order.상품주문번호);

    if (naverIds.length === 0) {
      alert("🚨 선택한 주문 중 처리 가능한 네이버 주문이 없습니다. (현재 네이버 우선 연동 상태)");
      return;
    }

    // 파이썬 FastAPI 서버에 "이 네이버 주문들 발주 처리해 줘!" 라고 던짐
    fetch(`${API_BASE}/api/orders/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ naver_ids: naverIds })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        alert(data.message); // ✅ 성공 알림창 띄우기
        fetchOrders(); // 성공했으니 주문 목록 표 다시 긁어오기 (상태 업데이트)
      } else {
        alert(data.message); // 🚨 실패 알림창
      }
    })
    .catch(err => console.error("발주 에러:", err));
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>📦 신규 주문 관리</h2>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[
              { key: 'all', label: '전체' },
              { key: 'new', label: '신규' },
              { key: 'prepare', label: '준비중' },
              { key: 'shipping', label: '배송중' },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => { setStatusFilter(t.key); setSelectedIds([]); }}
                style={{
                  padding: '8px 10px',
                  cursor: 'pointer',
                  borderRadius: '999px',
                  border: '1px solid var(--border)',
                  background: statusFilter === t.key ? 'rgba(47,107,255,0.18)' : 'rgba(255,255,255,0.03)',
                  color: 'var(--text)',
                  fontWeight: statusFilter === t.key ? 800 : 650,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ color: 'var(--text-3)', fontSize: '12px', fontWeight: 650 }}>
            {filteredOrders.length}건
          </div>
        </div>
        
        {/* 💡 상단 컨트롤 버튼들 */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '12px', background: 'rgba(255,255,255,0.02)' }}>
            <select value={importMarket} onChange={(e) => setImportMarket(e.target.value)} style={{ padding: '8px 10px', borderRadius: '10px' }}>
              <option value="sikbom">🥬 식봄 업로드</option>
              <option value="baemin">🛵 배민 업로드</option>
              <option value="lotteon_manual">🔴 롯데온(수동) 업로드</option>
            </select>
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              style={{ maxWidth: '240px' }}
            />
            <button
              onClick={handleImport}
              disabled={isImporting}
              style={{
                padding: '10px 12px',
                cursor: isImporting ? 'not-allowed' : 'pointer',
                background: isImporting ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.04)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                color: 'var(--text)',
                fontWeight: 750,
                opacity: isImporting ? 0.6 : 1,
              }}
            >
              {isImporting ? '가져오는 중…' : '가져오기'}
            </button>
          </div>
          <button onClick={handleSelectAll} style={{ padding: '10px 12px', cursor: 'pointer', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text)' }}>
            ✅ 전체 선택
          </button>
          <button onClick={handleDeselectAll} style={{ padding: '10px 12px', cursor: 'pointer', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text)' }}>
            🔲 전체 해제
          </button>
          <button onClick={handleBatchConfirm} style={{ padding: '10px 14px', cursor: 'pointer', background: 'linear-gradient(180deg, rgba(47,107,255,0.95), rgba(30,94,255,0.9))', color: 'var(--text)', border: '1px solid rgba(47,107,255,0.35)', borderRadius: '10px', fontWeight: 750 }}>
            🚀 선택 주문 발주 확인
          </button>
        </div>
      </div>

      {loadingOrders ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="spinner" aria-hidden="true" />
          <div>데이터를 불러오는 중입니다...</div>
        </div>
      ) : (
        <table border="0" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
          <thead>
            <tr>
              <th style={{ padding: '10px', width: '50px' }}>선택</th>
              <th style={{ padding: '10px' }}>마켓</th>
              <th>주문상태</th>
              <th>상품명</th>
              <th>수량</th>
              <th>결제금액</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map((order, idx) => (
              <tr key={idx} style={{ backgroundColor: selectedIds.includes(order.상품주문번호) ? 'rgba(47,107,255,0.10)' : 'transparent' }}>
                <td style={{ padding: '10px' }}>
                  {/* 💡 깜빡임 0%의 마법, React 체크박스 */}
                  <input 
                    type="checkbox" 
                    checked={selectedIds.includes(order.상품주문번호)}
                    onChange={() => handleCheck(order.상품주문번호)}
                    style={{ cursor: 'pointer', transform: 'scale(1.5)' }}
                  />
                </td>
                <td style={{ padding: '10px' }}>{order.마켓}</td>
                <td>{order.주문상태}</td>
                <td>{order.상품명}</td>
                <td>{order.수량}</td>
                <td>{order.결제금액.toLocaleString()}원</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}