import { useState, useEffect } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css'; 
import { CATEGORY_DB } from './categoryData'; 
import { API_BASE } from '../apiBase';

const findCategoryPath = (targetId) => {
  if(!targetId) return null;
  for (const d1 in CATEGORY_DB) {
    if (d1 === "직접입력") continue;
    for (const d2 in CATEGORY_DB[d1]) {
      for (const d3 in CATEGORY_DB[d1][d2]) {
        for (const d4 in CATEGORY_DB[d1][d2][d3]) {
          if (CATEGORY_DB[d1][d2][d3][d4] === String(targetId)) return [d1, d2, d3, d4];
        }
      }
    }
  }
  return null;
};

const quillModules = {
  toolbar: [
    [{ 'header': [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'color': [] }, { 'background': [] }],
    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
    [{ 'align': [] }],
    ['link', 'image'],
    ['clean']
  ],
};

export default function NaverUploadTab({ onClose }) {
  const [myProducts, setMyProducts] = useState([]);
  const [selectedChannelNo, setSelectedChannelNo] = useState("");
  const [isLoadingList, setIsLoadingList] = useState(false);

  const [depth1, setDepth1] = useState("식품");
  const [depth2, setDepth2] = useState("수산물");
  const [depth3, setDepth3] = useState("생선");
  const [depth4, setDepth4] = useState("연어/훈제연어");
  const [customCatId, setCustomCatId] = useState("");

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("5");
  const [detailContent, setDetailContent] = useState("");
  const [useRichEditor, setUseRichEditor] = useState(true); // 퀼 편집기 실패 시 textarea 대체
  
  // 💡 텍스트 URL이 아니라 진짜 '파일 객체'를 담는 상태!
  const [mainImageFile, setMainImageFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    setIsLoadingList(true);
    fetch(`${API_BASE}/api/naver/products`)
      .then(res => res.json())
      .then(data => {
        if(data.status === 'success') setMyProducts(data.data || []);
        setIsLoadingList(false);
      })
      .catch(() => setIsLoadingList(false));
  }, []);

  useEffect(() => { setDepth2(Object.keys(CATEGORY_DB[depth1] || {})[0] || ""); }, [depth1]);
  useEffect(() => { setDepth3(Object.keys(CATEGORY_DB[depth1]?.[depth2] || {})[0] || ""); }, [depth2]);
  useEffect(() => { setDepth4(Object.keys(CATEGORY_DB[depth1]?.[depth2]?.[depth3] || {})[0] || ""); }, [depth3]);

  let finalCatId = CATEGORY_DB[depth1]?.[depth2]?.[depth3]?.[depth4] === "CUSTOM" ? customCatId : (CATEGORY_DB[depth1]?.[depth2]?.[depth3]?.[depth4] || "");

  const handleLoadProduct = (e) => {
    const channelNo = e.target.value;
    setSelectedChannelNo(channelNo);
    if (!channelNo) {
      setName(""); setPrice(""); setDetailContent(""); setMainImageFile(null);
      return;
    }

    fetch(`${API_BASE}/api/naver/products/${channelNo}`)
      .then(res => res.json())
      .then(resData => {
        if (resData.status !== 'success') return alert("데이터 불러오기 실패!");
        const op = resData.data.originProduct || {};
        
        setName(`[복사본] ${op.name || ""}`);
        setPrice(op.salePrice || "");
        setStock(op.stockQuantity || "5");
        setDetailContent(op.detailContent || "");
        setMainImageFile(null); 

        const targetCatId = op.leafCategoryId || op.categoryId;
        const path = findCategoryPath(targetCatId);
        if (path) {
          setDepth1(path[0]); setTimeout(() => {
            setDepth2(path[1]); setTimeout(() => {
              setDepth3(path[2]); setTimeout(() => setDepth4(path[3]), 50);
            }, 50);
          }, 50);
        } else {
          setDepth1("직접입력"); setDepth2("수동입력"); setDepth3("카테고리 번호가 목록에 없나요?"); setDepth4("직접 번호 입력하기");
          setCustomCatId(targetCatId || "");
        }
      })
      .catch(err => console.error(err));
  };

  const checkSEO = (text) => {
    if (!text) return { status: 'none', msg: '네이버 검색 노출을 위해 상품명을 입력해주세요.', color: 'gray' };
    if (text.length < 10) return { status: 'bad', msg: '❌ 상품명이 너무 짧습니다. (최소 10자 이상 권장)', color: '#e74c3c' };
    if (text.length > 50) return { status: 'bad', msg: '❌ 상품명이 너무 깁니다. (최대 50자 이하 권장)', color: '#e74c3c' };
    const specialCharRegex = /[!@#$%^&*()_+={}\[\]:;"'<>,.?/\\]/;
    if (specialCharRegex.test(text)) return { status: 'bad', msg: '❌ 특수문자가 포함되어 있습니다. (검색 노출 하락 주의!)', color: '#e74c3c' };
    return { status: 'good', msg: '✅ 네이버 SEO에 완벽하게 최적화된 훌륭한 상품명입니다!', color: '#27ae60' };
  };
  const seoStatus = checkSEO(name);

  const handleUpload = () => {
    if (!name || !price || !finalCatId) return alert("🚨 카테고리, 상품명, 판매가는 필수입니다!");
    
    // 💡 템플릿 없이 완전 신규면 이미지 파일 무조건 첨부!
    if (!selectedChannelNo && !mainImageFile) {
      return alert("🚨 템플릿 없이 완전 신규 등록 시 '대표 이미지 파일'을 꼭 첨부해주세요!");
    }

    // SEO 경고는 보여주되, 고객이 작성을 강행할 수 있도록 허용합니다.
    // (네이버가 강제하는 길이 제한보다 유동적으로 대응하도록 UX 개선)
    if (seoStatus.status === 'bad') {
      console.warn("네이버 SEO 경고(연결 시 주의):", seoStatus.msg);
    }

    let isUpdate = false;
    let mode = "create"; 
    if (selectedChannelNo) {
      isUpdate = window.confirm("선택한 기존 상품을 이 내용으로 '덮어쓰기(수정)' 하시겠습니까?\n\n(취소를 누르면 기존 상품은 놔두고 '새로운 상품'으로 복제 등록됩니다.)");
      mode = isUpdate ? "update" : "create";
    }

    setIsUploading(true);
    
    // 💡 파일을 서버로 보내기 위한 특별한 박스(FormData) 조립!
    const formData = new FormData();
    formData.append("mode", mode);
    formData.append("channel_no", selectedChannelNo || "");
    formData.append("name", name || "");
    formData.append("price", price || "");
    formData.append("stock", stock || "5");
    formData.append("detailContent", detailContent || "");
    formData.append("cat_id", finalCatId || "");
    
    if (mainImageFile) {
      formData.append("main_image", mainImageFile);
    }

    fetch(`${API_BASE}/api/naver/products/upload`, {
      method: 'POST',
      body: formData // 파일 통째로 쏘기!
    })
    .then(async res => {
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `서버 에러 (${res.status})`);
      }
      return res.json();
    })
    .then(data => {
      if (data.status === 'success') {
        alert(`✅ 상품 등록(수정)에 성공했습니다!\n\n네이버: ${data.message}`);
        setName(""); setPrice(""); setStock("5"); setDetailContent(""); 
        setMainImageFile(null); 
        setSelectedChannelNo(""); 
      } else {
        alert(`❌ 상품 등록 실패!\n\n에러 내용: ${data.message}`);
      }
      setIsUploading(false);
    })
    .catch(err => {
      console.error("업로드 에러:", err);
      alert("❌ 서버와 통신 중 오류가 발생했습니다.\n\n" + err.message);
      setIsUploading(false);
    });
  };

  return (
    <div style={{ padding: '40px', boxSizing: 'border-box', position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <button onClick={onClose} style={{ position: 'absolute', top: '20px', right: '30px', background: 'none', border: 'none', fontSize: '28px', cursor: 'pointer', color: '#7f8c8d' }}>✖</button>
      <h2 style={{ color: '#27ae60', marginTop: '0', marginBottom: '10px' }}>📤 스마트스토어 상세 등록 데스크</h2>
      <p style={{ color: 'gray', marginBottom: '20px', fontSize: '15px' }}>기존 상품을 템플릿으로 불러와 복제/수정하거나, 빈 칸을 채워 완전 새로운 상품을 등록하세요.</p>

      <div style={{ padding: '20px', backgroundColor: '#e8f8f5', borderRadius: '8px', marginBottom: '20px', border: '1px solid #1abc9c' }}>
        <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#16a085' }}>
          🔄 기존 상품 불러오기 (이미지/배송비 등 복제) {isLoadingList && "⏳ (리스트 로딩 중...)"}
        </label>
        <select value={selectedChannelNo} onChange={handleLoadProduct} style={{ width: '100%', padding: '12px', borderRadius: '5px', border: '1px solid #ccc', fontSize: '15px' }}>
          <option value="">-- 템플릿 선택 (선택 사항: 안 고르면 쌩신규 등록) --</option>
          {myProducts.map(p => (
            <option key={p.channelProductNo} value={p.channelProductNo}>
              {p.name} ({p.price}원)
            </option>
          ))}
        </select>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingRight: '10px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
          
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <h3 style={{ borderBottom: '2px solid #eee', paddingBottom: '10px', marginTop: 0 }}>📦 카테고리 및 기본정보</h3>
            
            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <select value={depth1} onChange={e => setDepth1(e.target.value)} style={{ flex: 1, padding: '10px', borderRadius: '5px' }}>
                {Object.keys(CATEGORY_DB).map(k => <option key={k} value={k}>{k}</option>)}
              </select>
              <select value={depth2} onChange={e => setDepth2(e.target.value)} style={{ flex: 1, padding: '10px', borderRadius: '5px' }}>
                {Object.keys(CATEGORY_DB[depth1] || {}).map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <select value={depth3} onChange={e => setDepth3(e.target.value)} style={{ flex: 1, padding: '10px', borderRadius: '5px' }}>
                {Object.keys(CATEGORY_DB[depth1]?.[depth2] || {}).map(k => <option key={k} value={k}>{k}</option>)}
              </select>
              <select value={depth4} onChange={e => setDepth4(e.target.value)} style={{ flex: 1, padding: '10px', borderRadius: '5px' }}>
                {Object.keys(CATEGORY_DB[depth1]?.[depth2]?.[depth3] || {}).map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>

            {CATEGORY_DB[depth1]?.[depth2]?.[depth3]?.[depth4] === "CUSTOM" ? (
              <input type="text" value={customCatId} onChange={e => setCustomCatId(e.target.value)} placeholder="📁 카테고리 번호 직접 입력 (예: 50002476)" style={{ width: '100%', padding: '10px', marginBottom: '20px', boxSizing: 'border-box' }} />
            ) : (
              <div style={{ padding: '10px', backgroundColor: '#e8f5e9', color: '#2e7d32', fontWeight: 'bold', borderRadius: '5px', marginBottom: '20px' }}>✅ 선택된 카테고리 번호: {finalCatId}</div>
            )}

            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>🏷️ 상품명 (SEO 자동 진단)</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="네이버 검색 최적화 상품명 입력" style={{ width: '100%', padding: '12px', marginBottom: '5px', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '5px' }} />
            <div style={{ padding: '8px 12px', borderRadius: '5px', backgroundColor: seoStatus.color === '#27ae60' ? '#e8f8f5' : seoStatus.color === '#e74c3c' ? '#fdedec' : '#f2f4f4', color: seoStatus.color, fontSize: '13px', fontWeight: 'bold', marginBottom: '15px' }}>{seoStatus.msg}</div>

            {/* 💡 이 부분이 바뀌었는지 꼭 확인하세요! "파일 선택" 버튼이 나와야 합니다! */}
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px', color: '#e67e22' }}>🖼️ 대표 이미지 파일 첨부 (필수)</label>
            <input 
              type="file" 
              accept="image/*" 
              onChange={e => setMainImageFile(e.target.files[0])} 
              style={{ width: '100%', padding: '10px', marginBottom: '5px', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '5px', backgroundColor: '#fff' }} 
            />
            <p style={{ fontSize: '12px', color: '#7f8c8d', marginTop: '3px', marginBottom: '15px' }}>* 이미지 용량 제한 없음 (최대 100MB 등 클라이언트 제약 없음).</p>

            <div style={{ display: 'flex', gap: '15px', marginBottom: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>💰 판매가 (원)</label>
                <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="15000" style={{ width: '100%', padding: '12px', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '5px' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>📦 재고 (개)</label>
                <input type="number" value={stock} onChange={e => setStock(e.target.value)} style={{ width: '100%', padding: '12px', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '5px' }} />
              </div>
            </div>
          </div>

          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <h3 style={{ borderBottom: '2px solid #eee', paddingBottom: '10px', marginTop: 0 }}>🖼️ 이미지 및 상세 에디터</h3>
            
            <div style={{ padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '8px', marginBottom: '20px', border: '1px dashed #ccc' }}>
              <p style={{ margin: 0, fontSize: '13px', color: '#555', lineHeight: '1.6' }}>
                🚨 <b>안내:</b> 지금은 신속한 복제를 위해 <b>상단에서 선택한 기존 템플릿 상품의 이미지(대표/추가 이미지)가 그대로 복사</b>됩니다. 템플릿 없이 신규 등록할 경우 좌측에 첨부한 사진 파일이 대표 이미지로 올라갑니다.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <label style={{ display: 'block', fontWeight: 'bold' }}>📝 상세페이지 통합 에디터</label>
              <button onClick={() => setUseRichEditor(prev => !prev)} style={{ border: '1px solid #ccc', borderRadius: '6px', padding: '4px 8px', background: '#f7f7f7'}}>{useRichEditor ? '텍스트 모드로 전환' : '리치 에디터로 전환'}</button>
            </div>
            <p style={{ fontSize: '12px', color: '#7f8c8d', marginTop: 0, marginBottom: '10px' }}>* 글을 쓰다가 <b>상단 아이콘 메뉴에서 [그림(액자) 아이콘]</b>을 누르면 본문 원하는 위치에 사진을 넣을 수 있습니다!</p>
            
            <div style={{ marginBottom: '40px', height: '100%' }}>
              {useRichEditor ? (
                <ReactQuill
                  theme="snow"
                  modules={quillModules}
                  value={detailContent}
                  onChange={setDetailContent}
                  readOnly={false}
                  style={{ height: '100%' }}
                  placeholder="여기에 상품에 대한 모든 설명과 이미지를 자유롭게 적어주세요!"
                />
              ) : (
                <textarea
                  value={detailContent}
                  onChange={(e) => setDetailContent(e.target.value)}
                  placeholder="여기에 상품에 대한 모든 설명을 작성하세요."
                  style={{ width: '100%', height: '100%', minHeight: '360px', padding: '12px', borderRadius: '8px', border: '1px solid #ccc', resize: 'none' }}
                />
              )}
            </div>

          </div>
        </div>
      </div>

      <button onClick={handleUpload} disabled={isUploading} style={{ width: '100%', padding: '18px', marginTop: '20px', backgroundColor: isUploading ? '#95a5a6' : '#27ae60', color: 'white', border: 'none', borderRadius: '8px', fontSize: '20px', fontWeight: 'bold', cursor: isUploading ? 'not-allowed' : 'pointer', flexShrink: 0 }}>
        {isUploading ? '⏳ 서버와 통신 중...' : '🚀 네이버 스마트스토어 전송 시작!'}
      </button>
      
    </div>
  );
}