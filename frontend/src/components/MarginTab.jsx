import React, { useState, useEffect } from 'react';
import { API_BASE } from '../apiBase';
import { Emoji, EmojiText } from './Icons';
import Pagination from './Pagination';

export default function MarginTab() {
  const [file, setFile] = useState(null);
  const [fullData, setFullData] = useState([]);
  const [summaryData, setSummaryData] = useState([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [sortType, setSortType] = useState("default");
  const [fees, setFees] = useState(() => {
    const savedFees = localStorage.getItem('marginFees');
    return savedFees ? JSON.parse(savedFees) : { naver: 6.0, coupang: 11.0, baemin: 11.0, lotteon: 13.0, sikbom: 6.0 };
  });

  const [marginThreshold, setMarginThreshold] = useState(() => {
    const savedThreshold = localStorage.getItem('marginThreshold');
    return savedThreshold ? JSON.parse(savedThreshold) : 10;
  });

  const handleThresholdChange = (value) => {
    const newThreshold = isNaN(parseFloat(value)) ? 0 : parseFloat(value);
    setMarginThreshold(newThreshold);
    localStorage.setItem('marginThreshold', JSON.stringify(newThreshold));
  };

  const [currentFileName, setCurrentFileName] = useState("");
  const [loadMsg, setLoadMsg] = useState("서버에서 단가표를 찾고 있습니다...");
  const [searchTerm, setSearchTerm] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [priceAlerts, setPriceAlerts] = useState([]);

  const [ackPrices, setAckPrices] = useState(() => {
    const savedPrices = localStorage.getItem('acknowledgedPrices');
    return savedPrices ? JSON.parse(savedPrices) : {};
  });

  // 🔗 채널(쿠팡/네이버/식봄) 연결
  const CHANNEL_LABELS = { coupang: '쿠팡', naver: '네이버', sikbom: '식봄' };
  const [channelLinks, setChannelLinks] = useState({}); // { 상품명: { coupang: {id,name,linked_at}, ... } }
  const [linkModalProduct, setLinkModalProduct] = useState(null); // 열려있는 모달의 상품명 (null이면 닫힘)
  const [linkCandidates, setLinkCandidates] = useState(null); // { coupang: [...], naver: [...], sikbom: [...] }
  const [linkLoading, setLinkLoading] = useState(false);
  const [selectedCandidates, setSelectedCandidates] = useState({}); // { coupang: {id,name}|null, naver: ..., sikbom: ... }
  const [isConnecting, setIsConnecting] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState(""); // 모달 검색창의 현재 입력값
  const [optionCandidates, setOptionCandidates] = useState({}); // { naver: {loading, options:[{id,name}]}, coupang: {...} }
  const [selectedOptionByChannel, setSelectedOptionByChannel] = useState({}); // { naver: {id,name}|null, coupang: {...} }

  // 💰 원가 저장 시 채널 가격 변경 미리보기
  const [priceChanges, setPriceChanges] = useState(null); // null이면 모달 닫힘, 배열이면 열림
  const [priceChangeSelected, setPriceChangeSelected] = useState({}); // { idx: boolean }
  const [isSyncingPrices, setIsSyncingPrices] = useState(false);
  const [priceSyncResults, setPriceSyncResults] = useState(null); // null이면 아직 반영 전, 배열이면 반영 결과 표시

  const fetchChannelLinks = () => {
    fetch(`${API_BASE}/api/channel-link`, { headers: { 'ngrok-skip-browser-warning': '69420' } })
      .then(res => res.json())
      .then(data => { if (data.status === 'success') setChannelLinks(data.data || {}); })
      .catch(err => console.error('채널 연결 목록 조회 실패', err));
  };

  // 이미 연결된 채널은 그 후보가 선택된 상태로 시작한다 (API 호출 없이 로컬 channelLinks만 사용).
  const computeInitialSelection = (productName) => {
    const linked = channelLinks[productName] || {};
    const initialSelection = {};
    Object.keys(CHANNEL_LABELS).forEach((channel) => {
      if (linked[channel]) initialSelection[channel] = { id: linked[channel].id, name: linked[channel].name };
    });
    return initialSelection;
  };

  // productName: 실제로 연결 대상인 상품명(고정) / keyword: 채널 후보 검색에 쓸 검색어(재검색 시 바뀜)
  const runChannelSearch = (productName, keyword) => {
    setLinkCandidates(null);
    setLinkLoading(true);
    fetch(`${API_BASE}/api/channel-link/search?product_name=${encodeURIComponent(keyword)}`, {
      headers: { 'ngrok-skip-browser-warning': '69420' }
    })
      .then(res => res.json())
      .then(data => {
        setLinkCandidates(data.status === 'success' ? data.candidates : { coupang: [], naver: [], sikbom: [] });
        setSelectedCandidates(computeInitialSelection(productName));
        setLinkLoading(false);
      })
      .catch(err => {
        console.error('채널 후보 검색 실패', err);
        setLinkCandidates({ coupang: [], naver: [], sikbom: [] });
        setLinkLoading(false);
      });
  };

  // 모달을 열 때는 검색창에 상품명만 미리 채우고 선택 상태만 복원한다.
  // 실제 후보 검색(API 호출)은 사용자가 "검색" 버튼을 누르거나 Enter를 칠 때만 실행한다.
  const openLinkModal = (productName) => {
    setLinkModalProduct(productName);
    setSearchKeyword(productName);
    setLinkCandidates(null);
    setLinkLoading(false);
    setSelectedCandidates(computeInitialSelection(productName));
  };

  const handleSearchCandidates = () => {
    const keyword = searchKeyword.trim();
    if (!keyword) {
      alert('검색어를 입력해주세요.');
      return;
    }
    runChannelSearch(linkModalProduct, keyword);
  };

  const closeLinkModal = () => {
    setLinkModalProduct(null);
    setLinkCandidates(null);
    setSelectedCandidates({});
    setSearchKeyword("");
    setOptionCandidates({});
    setSelectedOptionByChannel({});
  };

  const fetchOptionCandidates = (channel, candidateId) => {
    if (channel === 'naver') {
      setOptionCandidates(prev => ({ ...prev, naver: { loading: true, options: [] } }));
      fetch(`${API_BASE}/api/naver/products/${encodeURIComponent(candidateId)}`, { headers: { 'ngrok-skip-browser-warning': '69420' } })
        .then(res => res.json())
        .then(data => {
          const combos = data.status === 'success'
            ? ((data.data?.originProduct?.optionInfo?.optionCombinations) || [])
            : [];
          setOptionCandidates(prev => ({ ...prev, naver: { loading: false, options: combos.map(c => ({ id: String(c.id), name: c.optionName1 })) } }));
        })
        .catch(() => setOptionCandidates(prev => ({ ...prev, naver: { loading: false, options: [] } })));
    } else if (channel === 'coupang') {
      setOptionCandidates(prev => ({ ...prev, coupang: { loading: true, options: [] } }));
      fetch(`${API_BASE}/api/coupang/products/${encodeURIComponent(candidateId)}`, { headers: { 'ngrok-skip-browser-warning': '69420' } })
        .then(res => res.json())
        .then(data => {
          const items = data.status === 'success' ? ((data.data?.items) || []) : [];
          const options = items.map(it => ({ id: String(it.vendorItemId), name: it.itemName || it.externalVendorSku || String(it.vendorItemId) }));
          setOptionCandidates(prev => ({ ...prev, coupang: { loading: false, options } }));
          // 옵션이 1개뿐이면 사용자에게 선택지를 보여줄 필요 없이 바로 그 vendorItemId를 써야 한다(쿠팡은 옵션 없어도 vendorItemId가 필수).
          if (options.length === 1) {
            setSelectedOptionByChannel(prev => ({ ...prev, coupang: options[0] }));
          }
        })
        .catch(() => setOptionCandidates(prev => ({ ...prev, coupang: { loading: false, options: [] } })));
    }
  };

  const handleConnectSelected = async () => {
    console.log('[DEBUG] handleConnectSelected 호출됨, selectedCandidates =', selectedCandidates);
    const entries = Object.entries(selectedCandidates).filter(([, candidate]) => candidate);
    console.log('[DEBUG] entries.length =', entries.length, entries);
    if (entries.length === 0) {
      console.log('[DEBUG] entries가 비어서 여기서 return됨 (confirm 도달 못 함)');
      alert('연결할 채널을 선택해주세요.');
      return;
    }
    console.log('[DEBUG] window.confirm 호출 직전');
    const confirmed = window.confirm(`${entries.length}개 채널을 연결하시겠습니까?`);
    console.log('[DEBUG] window.confirm 결과 =', confirmed);
    if (!confirmed) {
      return;
    }
    setIsConnecting(true);
    for (const [channel, candidate] of entries) {
      try {
        const chosenOption = selectedOptionByChannel[channel] || null;
        const res = await fetch(`${API_BASE}/api/channel-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '69420' },
          body: JSON.stringify({
            product_name: linkModalProduct, channel,
            channel_id: String(candidate.id), channel_name: candidate.name,
            option_id: channel === 'naver' ? (chosenOption?.id || null) : null,
            option_name: chosenOption?.name || null,
            vendor_item_id: channel === 'coupang' ? (chosenOption?.id || null) : null,
          })
        });
        const data = await res.json();
        if (data.status !== 'success') {
          alert(`${CHANNEL_LABELS[channel]} 연결 실패: ${data.message || '알 수 없는 오류'}`);
        }
      } catch (err) {
        alert(`${CHANNEL_LABELS[channel]} 연결 실패: 서버에 연결할 수 없습니다. (${err.message})`);
      }
    }
    setIsConnecting(false);
    fetchChannelLinks();
  };

  const handleUnlinkChannel = (channel) => {
    fetch(`${API_BASE}/api/channel-link/${encodeURIComponent(channel)}?product_name=${encodeURIComponent(linkModalProduct)}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          setSelectedCandidates(prev => ({ ...prev, [channel]: null }));
          fetchChannelLinks();
        } else alert(data.message || '연결 해제에 실패했습니다.');
      })
      .catch(err => alert(`연결 해제 실패: 서버에 연결할 수 없습니다. (${err.message})`));
  };

  const fetchPriceAlerts = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/esangin-stock`, {
        headers: { 'ngrok-skip-browser-warning': '69420' }
      });
      const result = await res.json();
      
      if (result.status === 'success') {
        // 무조건 금고(localStorage)를 뜯어서 최신 상태 확인 (새로고침 무적 방어)
        const currentAckPrices = JSON.parse(localStorage.getItem('acknowledgedPrices') || '{}');
        const alerts = [];

        result.data.forEach(item => {
          if (item.name.includes('스티로폼') || item.name.includes('아이스팩')) return;

          const currentPrice = Number(String(item.inPrice || '0').replace(/[^0-9]/g, ''));
          const prevPrice = item.prevInPrice !== undefined 
                          ? Number(String(item.prevInPrice).replace(/[^0-9]/g, '')) 
                          : currentPrice;

          const itemKey = `${item.name}_${item.spec || ''}`;
          const lastSeenPrice = currentAckPrices[itemKey]; 
          const referencePrice = lastSeenPrice !== undefined ? lastSeenPrice : prevPrice;

          if (currentPrice !== referencePrice && referencePrice > 0) {
            alerts.push({
              id: itemKey,
              name: item.name,
              spec: item.spec,
              oldPrice: referencePrice,
              newPrice: currentPrice,
              diff: currentPrice - referencePrice
            });
          }
        });
        
        alerts.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
        setPriceAlerts(alerts);
      }
    } catch (e) {
      console.error("가격 알림 체크 실패", e);
    }
  };

  // 💡 개별 확인 버튼: 0.1초만에 화면에서 날려버림!
  const handleConfirmAlert = (alert) => {
    if (window.confirm("해당 변동 내역을 확인하셨습니까? (목록에서 숨겨집니다)")) {
      const newAck = { ...ackPrices, [alert.id]: alert.newPrice };
      setAckPrices(newAck);
      localStorage.setItem('acknowledgedPrices', JSON.stringify(newAck));
      
      // 🚀 화면을 그리고 있는 배열에서 즉시 도려냅니다!
      setPriceAlerts(prev => prev.filter(a => a.id !== alert.id));
    }
  };

  // 💡 전체 확인 버튼: 0.1초만에 화면 전체를 폭파시킴!
  const handleConfirmAllAlerts = () => {
    if (window.confirm("모든 가격 변동 알림을 확인 처리하시겠습니까? (전부 숨겨집니다)")) {
      const newAck = { ...ackPrices };
      priceAlerts.forEach(alert => {
        newAck[alert.id] = alert.newPrice;
      });
      setAckPrices(newAck);
      localStorage.setItem('acknowledgedPrices', JSON.stringify(newAck));
      
      // 🚀 화면을 그리고 있는 배열 자체를 빈 깡통([])으로 강제 초기화! 절대 못 버팁니다!
      setPriceAlerts([]);
    }
  };

  // 이제 priceAlerts 자체를 지워버리기 때문에 2중 필터링은 거들 뿐입니다.
  const visibleAlerts = priceAlerts.filter(alert => ackPrices[alert.id] !== alert.newPrice);

  const loadInitialData = () => {
    setIsCalculating(true);
    fetch(`${API_BASE}/api/margin/data`, {
      headers: { 'ngrok-skip-browser-warning': '69420' }
    })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          const recalculated = recalcFullDataWithFees(data.full_data || [], fees);
          setFullData(recalculated);
          setSummaryData(buildSummaryDataFromFull(recalculated));
          setCurrentFileName("online.csv"); 
          setLoadMsg("");
        } else {
          setLoadMsg("금고에 저장된 단가표가 없습니다. 파일을 한 번 업로드해주세요!");
        }
        setIsCalculating(false);
      })
      .catch(err => {
        console.error('로드 에러:', err);
        setLoadMsg("서버 연결 실패. 파이썬 서버를 확인해주세요.");
        setIsCalculating(false);
      });

    fetchPriceAlerts();
  };

  useEffect(() => { loadInitialData(); fetchChannelLinks(); }, []);

  const handleAddRow = () => {
    const currentData = fullData || [];
    const newRow = {};
    if (currentData.length > 0 && currentData[0]) {
      Object.keys(currentData[0]).forEach(key => {
        if (key.includes('상품명')) newRow[key] = "신규 상품명 입력";
        else if (key === '과세구분') newRow[key] = '과세';
        else newRow[key] = 0;
      });
    } else {
      newRow['온라인 상품명'] = "신규 상품명 입력";
      newRow['매입가'] = 0;
      newRow['마진'] = 0;
      newRow['과세구분'] = '과세';
    }
    
    const newData = [newRow, ...currentData];
    const recalculated = recalcFullDataWithFees(newData, fees);
    
    setFullData(recalculated);
    setSummaryData(buildSummaryDataFromFull(recalculated));
    setSearchTerm("");
    setSortType("default");
    setCurrentPage(1);
  };

  const calculateMargin = (currentFile, currentFees) => {
    if (!currentFile) return;
    setIsCalculating(true);
    const formData = new FormData();
    formData.append('file', currentFile);
    formData.append('fee_naver', currentFees.naver);
    formData.append('fee_coupang', currentFees.coupang);
    formData.append('fee_baemin', currentFees.baemin);
    formData.append('fee_lotteon', currentFees.lotteon);
    formData.append('fee_sikbom', currentFees.sikbom);

    fetch(`${API_BASE}/api/margin/calculate`, { 
      method: 'POST', 
      headers: { 'ngrok-skip-browser-warning': '69420' },
      body: formData 
    })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          const recalculated = recalcFullDataWithFees(data.full_data || [], fees);
          setFullData(recalculated);
          setSummaryData(buildSummaryDataFromFull(recalculated));
          setCurrentFileName(data.saved_as);
          setCurrentPage(1);
          setSearchTerm("");
          setLoadMsg("");
          alert("✅ 단가표가 성공적으로 업로드 및 저장되었습니다!");
          fetchPriceAlerts(); 
        } else { alert(data.message); }
        setIsCalculating(false);
      })
      .catch(err => { console.error('계산 에러:', err); setIsCalculating(false); });
  };

  const updateMarginWithData = (dataToUpdate, currentFees, showAlert = true) => {
    setIsCalculating(true);
    fetch(`${API_BASE}/api/margin/update`, {
      method: 'POST', 
      headers: { 
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': '69420' 
      },
      body: JSON.stringify({
        data: dataToUpdate || [], 
        fee_naver: currentFees.naver, 
        fee_coupang: currentFees.coupang,
        fee_baemin: currentFees.baemin, 
        fee_lotteon: currentFees.lotteon,
        fee_sikbom: currentFees.sikbom
      })
    })
    .then(res => res.json())
    .then(data => {
      console.log('[DEBUG] 저장 응답:', data);
      console.log('[DEBUG] data.price_changes:', data.price_changes, '/ 개수:', Array.isArray(data.price_changes) ? data.price_changes.length : 'N/A(배열 아님)');
      if (data.status === 'success') {
        const source = data.full_data || dataToUpdate || [];
        const recalculated = recalcFullDataWithFees(source, currentFees);
        setFullData(recalculated);
        setSummaryData(buildSummaryDataFromFull(recalculated));
        fetchPriceAlerts();

        const hasPriceChanges = Array.isArray(data.price_changes) && data.price_changes.length > 0;
        console.log('[DEBUG] hasPriceChanges:', hasPriceChanges);
        if (hasPriceChanges) {
          const initialSelection = {};
          data.price_changes.forEach((_, idx) => { initialSelection[idx] = true; });
          setPriceChanges(data.price_changes);
          setPriceChangeSelected(initialSelection);
          setPriceSyncResults(null);
          console.log('[DEBUG] setPriceChanges 호출 완료, 모달이 열려야 함');
        } else if (showAlert) {
          // 💡 가격 변경 미리보기 모달을 띄울 때는 굳이 blocking alert로 먼저 막지 않는다.
          // alert()는 동기/블로킹이라 이 뒤의 setPriceChanges 호출이 사용자가 alert를 닫을 때까지
          // 지연되어, "모달이 안 뜬다"처럼 보이는 원인이 된다.
          alert("✅ 데이터가 저장되고 최종 판매가가 업데이트되었습니다!");
        }
      } else if (showAlert) {
        alert(data.message || "서버 계산 중 오류가 발생했습니다.");
      }
      setIsCalculating(false);
    })
    .catch(err => { console.error('업데이트 에러:', err); setIsCalculating(false); });
  };

  const closePriceChangeModal = () => {
    setPriceChanges(null);
    setPriceChangeSelected({});
    setPriceSyncResults(null);
  };

  const handleToggleSelectAllPriceChanges = () => {
    const allSelected = (priceChanges || []).every((_, idx) => priceChangeSelected[idx]);
    const next = {};
    (priceChanges || []).forEach((_, idx) => { next[idx] = !allSelected; });
    setPriceChangeSelected(next);
  };

  const handleNewPriceInputChange = (idx, value) => {
    const parsed = value === '' ? 0 : Number(value);
    setPriceChanges((prev) => prev.map((c, i) => (i === idx ? { ...c, new_price: parsed } : c)));
  };

  const handleSyncPrices = async () => {
    const selectedChanges = (priceChanges || []).filter((_, idx) => priceChangeSelected[idx]);
    if (selectedChanges.length === 0) {
      alert('반영할 항목을 선택해주세요.');
      return;
    }
    if (!window.confirm(`${selectedChanges.length}건을 채널에 반영하시겠습니까?`)) {
      return;
    }
    setIsSyncingPrices(true);
    try {
      const res = await fetch(`${API_BASE}/api/channel-price-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '69420' },
        body: JSON.stringify({
          changes: selectedChanges.map(c => ({
            product_name: c.product_name,
            channel: c.channel,
            channel_id: c.channel_id,
            channel_name: c.channel_name,
            new_price: c.new_price
          }))
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setPriceSyncResults(data.results || []);
      } else {
        alert(data.message || '채널 가격 반영에 실패했습니다.');
      }
    } catch (err) {
      alert(`채널 가격 반영 실패: 서버에 연결할 수 없습니다. (${err.message})`);
    }
    setIsSyncingPrices(false);
  };

  const handleFeeChange = (platform, value) => {
    const newFees = { ...fees, [platform]: value };
    setFees(newFees);
    localStorage.setItem('marginFees', JSON.stringify(newFees));

    if (fullData && fullData.length > 0) {
      const recalculated = recalcFullDataWithFees(fullData, newFees);
      setFullData(recalculated);
      setSummaryData(buildSummaryDataFromFull(recalculated));
    }
  };

  const handleRefreshData = () => {
    if (!fullData || fullData.length === 0) return;
    const recalculated = recalcFullDataWithFees(fullData, fees);
    setFullData(recalculated);
    setSummaryData(buildSummaryDataFromFull(recalculated));
    updateMarginWithData(recalculated, fees, true);
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    calculateMargin(selectedFile, fees);
  };

  const handleCellChange = (globalIndex, column, newValue) => {
    const newData = [...(fullData || [])];
    if (!column.includes('상품명')) {
      const numericValue = parseFloat(newValue);
      newData[globalIndex][column] = isNaN(numericValue) ? 0 : numericValue;
    } else {
      newData[globalIndex][column] = newValue;
    }
    const recalculated = recalcFullDataWithFees(newData, fees);
    setFullData(recalculated);
    setSummaryData(buildSummaryDataFromFull(recalculated));
  };

  const handleTaxTypeChange = (globalIndex, value) => {
    const newData = [...(fullData || [])];
    newData[globalIndex] = { ...newData[globalIndex], '과세구분': value };
    const recalculated = recalcFullDataWithFees(newData, fees);
    setFullData(recalculated);
    setSummaryData(buildSummaryDataFromFull(recalculated));
  };

  const handleDeleteRow = (globalIndex) => {
    if (window.confirm("정말로 이 상품(줄)을 삭제하시겠습니까?")) {
      const newData = (fullData || []).filter((_, index) => index !== globalIndex);
      const recalculated = recalcFullDataWithFees(newData, fees);
      setFullData(recalculated);
      setSummaryData(buildSummaryDataFromFull(recalculated));
    }
  };

  const parseNumber = (value) => {
    if (value === null || value === undefined || value === "") return 0;
    const num = Number(String(value).toString().replace(/,/g, "").trim());
    return Number.isNaN(num) ? 0 : num;
  };

  // 💡 마진율 경고: 기존 계산 로직/저장 데이터는 건드리지 않고, 화면 표시용으로만 파생 계산합니다.
  const MARGIN_PLATFORMS = [
    { label: '네이버', priceCol: '네이버 판매가' },
    { label: '쿠팡', priceCol: '쿠팡 판매가' },
    { label: '배민', priceCol: '배민 판매가' },
    // 🚫 롯데온 판매 중단: { label: '롯데온', priceCol: '롯데온 판매가' },
    { label: '식봄', priceCol: '식봄 판매가' },
  ];

  const getMarginInfo = (row) => {
    if (!row) return { rates: {}, isLow: false };
    const marginAmount = parseNumber(row['마진']);
    const rates = {};
    let isLow = false;
    MARGIN_PLATFORMS.forEach(({ label, priceCol }) => {
      const price = parseNumber(row[priceCol]);
      const rate = price > 0 ? (marginAmount / price) * 100 : null;
      rates[label] = rate;
      if (rate !== null && rate < marginThreshold) isLow = true;
    });
    return { rates, isLow };
  };

  // 💡 표1의 "+부가세 약 XXX~YYY원" 라벨용: 플랫폼별 원가/판매가를 다시 계산해 부가세 범위만 화면에 보여줍니다.
  // (fullData에는 저장하지 않는 화면 표시 전용 값입니다.)
  // 🚫 롯데온 판매 중단: VAT_PLATFORM_FEE_KEYS/NEEDS_DELIVERY에서 lotteon 제외 (재개 시 두 줄만 복원하면 됨)
  const VAT_PLATFORM_FEE_KEYS = { 네이버: 'naver', 쿠팡: 'coupang', 배민: 'baemin', 식봄: 'sikbom' };
  const VAT_PLATFORM_NEEDS_DELIVERY = { naver: false, coupang: true, baemin: true, sikbom: false };

  const getVatRangeInfo = (row) => {
    if (!row) return null;
    const taxType = row['과세구분'] || '과세';
    if (taxType === '면세') return null;
    const isNoCredit = taxType === '과세(매입세액불공제)';
    const commonCost = getCommonCost(row);
    const deliveryCost = getDeliveryCost(row);
    const amounts = Object.values(VAT_PLATFORM_FEE_KEYS).map((feeKey) => {
      const base = VAT_PLATFORM_NEEDS_DELIVERY[feeKey] ? commonCost + deliveryCost : commonCost;
      if (feeKey === 'sikbom' && !base) return null;
      const price = calcPlatformPrice(base, parseNumber(fees[feeKey]));
      return isNoCredit ? calcVatAmountFull(price) : calcVatAmount(base, price);
    }).filter(v => v !== null);
    if (amounts.length === 0) return null;
    return { min: Math.min(...amounts), max: Math.max(...amounts) };
  };

  const getCommonCost = (row) => {
    return (
      parseNumber(row['매입'] || row['매입가']) +
      parseNumber(row['자재비']) +
      parseNumber(row['마진']) +
      parseNumber(row['기타비용']) +
      parseNumber(row['날치알'])
    );
  };

  const getDeliveryCost = (row) => {
    return parseNumber(row['배민/쿠팡 택배비'] || row['배민,쿠팡 택배비']);
  };

  const calcPlatformPrice = (baseCost, feePercent) => {
    if (feePercent >= 100) return 0;
    if (feePercent < 0) return Math.round(baseCost);
    const price = baseCost / (1 - feePercent / 100);
    return Math.ceil(price / 100) * 100;
  };

  // 💡 과세 상품 부가세: (판매가 - 원가) ÷ 1.1 × 0.1. 음수 방지용으로 0 미만은 0으로 clamp합니다.
  const calcVatAmount = (baseCost, salePrice) => {
    const raw = (salePrice - baseCost) / 1.1 * 0.1;
    return raw > 0 ? Math.round(raw) : 0;
  };

  // 💡 매입세액불공제(계산서 매입 등 매입세액 공제가 없는 과세 상품): 판매가 전체에 부가세 적용
  const calcVatAmountFull = (salePrice) => {
    const raw = salePrice / 1.1 * 0.1;
    return raw > 0 ? Math.round(raw) : 0;
  };

  const TAX_TYPE_TAXABLE = '과세';
  const TAX_TYPE_EXEMPT = '면세';
  const TAX_TYPE_NO_CREDIT = '과세(매입세액불공제)';

  const recalcFullDataWithFees = (sourceData, currentFees) => {
    if (!Array.isArray(sourceData)) return [];
    return sourceData.map((row) => {
      const commonCost = getCommonCost(row);
      const deliveryCost = getDeliveryCost(row);
      const taxType = row['과세구분'] || TAX_TYPE_TAXABLE;
      const isTaxable = taxType !== TAX_TYPE_EXEMPT;
      const isNoCredit = taxType === TAX_TYPE_NO_CREDIT;

      const naverBase = commonCost;
      const sikbomBase = commonCost;
      const coupangBase = commonCost + deliveryCost;
      const baeminBase = commonCost + deliveryCost;
      // 🚫 롯데온 판매 중단: lotteonBase/lotteonPrice 계산 중지 (기존 저장된 롯데온 판매가/수수료 값은 아래 return에서 override하지 않아 그대로 보존됩니다)
      // const lotteonBase = commonCost + deliveryCost;

      const naverPrice = calcPlatformPrice(naverBase, parseNumber(currentFees.naver));
      const coupangPrice = calcPlatformPrice(coupangBase, parseNumber(currentFees.coupang));
      const baeminPrice = calcPlatformPrice(baeminBase, parseNumber(currentFees.baemin));
      // const lotteonPrice = calcPlatformPrice(lotteonBase, parseNumber(currentFees.lotteon));
      const sikbomPrice = calcPlatformPrice(sikbomBase, parseNumber(currentFees.sikbom));

      // 💡 과세 상품만 부가세를 판매가 위에 얹습니다. 면세는 항상 basePrice 그대로 반환 (기존 로직과 동일).
      // 과세(매입세액불공제): 매입세액 공제가 없으므로 판매가 전체에 부가세를 적용합니다 (원가 차감 없음).
      const applyVat = (basePrice, baseCost) => {
        if (!isTaxable) return basePrice;
        const vat = isNoCredit ? calcVatAmountFull(basePrice) : calcVatAmount(baseCost, basePrice);
        return Math.ceil((basePrice + vat) / 100) * 100;
      };

      const naverFinal = applyVat(naverPrice, naverBase);
      const coupangFinal = applyVat(coupangPrice, coupangBase);
      const baeminFinal = applyVat(baeminPrice, baeminBase);
      // const lotteonFinal = applyVat(lotteonPrice, lotteonBase);
      const sikbomFinal = sikbomBase ? applyVat(sikbomPrice, sikbomBase) : 0;

      return {
        ...row,
        '과세구분': taxType,
        '네이버 판매가': naverFinal,
        '네이버 수수료': Math.round(naverFinal * parseNumber(currentFees.naver) / 100),
        '쿠팡 판매가': coupangFinal,
        '쿠팡 수수료': Math.round(coupangFinal * parseNumber(currentFees.coupang) / 100),
        '배민 판매가': baeminFinal,
        '배민 수수료': Math.round(baeminFinal * parseNumber(currentFees.baemin) / 100),
        // 🚫 롯데온 판매 중단: '롯데온 판매가'/'롯데온 수수료' override 중지. ...row 스프레드로 기존 저장값이 그대로 유지됩니다.
        // '롯데온 판매가': lotteonFinal,
        // '롯데온 수수료': Math.round(lotteonFinal * parseNumber(currentFees.lotteon) / 100),
        '식봄 판매가': sikbomFinal,
        '식봄 수수료': Math.round(sikbomFinal * parseNumber(currentFees.sikbom) / 100)
      };
    });
  };

  const buildSummaryDataFromFull = (sourceData) => {
    if (!Array.isArray(sourceData)) return [];
    return sourceData.map((row) => {
      const prod_name = row['온라인 상품명'] || row['상품명'] || '';
      return {
        '온라인 상품명': prod_name,
        '네이버 판매가': row['네이버 판매가'] || 0,
        '쿠팡 판매가': row['쿠팡 판매가'] || 0,
        '배민 판매가': row['배민 판매가'] || 0,
        // 🚫 롯데온 판매 중단: '롯데온 판매가': row['롯데온 판매가'] || 0,
        '식봄 판매가': row['식봄 판매가'] || 0
      };
    });
  };

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const safeFullData = fullData || [];
  const safeSummaryData = summaryData || [];

  let processedIndices = safeFullData.reduce((acc, row, idx) => {
    const isMatch = Object.values(row || {}).some(val => String(val).toLowerCase().includes(searchTerm.toLowerCase()));
    if (isMatch) acc.push(idx);
    return acc;
  }, []);

  processedIndices.sort((idxA, idxB) => {
    const rowA = safeFullData[idxA];
    const rowB = safeFullData[idxB];
    const nameA = String(rowA['온라인 상품명'] || rowA['상품명'] || "");
    const nameB = String(rowB['온라인 상품명'] || rowB['상품명'] || "");
    if (sortType === "nameAsc") return nameA.localeCompare(nameB);
    if (sortType === "nameDesc") return nameB.localeCompare(nameA);
    if (sortType === "marginDesc") {
      const marginA = Number(rowA['마진'] || 0);
      const marginB = Number(rowB['마진'] || 0);
      return marginB - marginA;
    }
    return idxA - idxB;
  });

  const filteredIndices = processedIndices;
  const filteredFullData = filteredIndices.map(idx => safeFullData[idx]);
  const filteredSummaryData = filteredIndices.map(idx => safeSummaryData[idx]).filter(item => item !== undefined);

  const indexOfLast = currentPage * itemsPerPage;
  const indexOfFirst = indexOfLast - itemsPerPage;
  const currentFullItems = filteredFullData.slice(indexOfFirst, indexOfLast);
  const currentSummaryItems = filteredSummaryData.slice(indexOfFirst, indexOfLast);
  
  const totalPages = Math.max(1, Math.ceil(filteredFullData.length / itemsPerPage));

  const getCleanColumns = (data) => {
    if (!data || data.length === 0 || !data[0]) return ['온라인 상품명', '매입가', '마진']; 
    const seen = new Set();
    const baseCols = [];
    Object.keys(data[0]).forEach(col => {
      if (col.includes('판매가') || col.includes('수수료')) return;
      if (['기타비용', '날치알', '과세구분'].includes(col)) return;
      const pureName = col.split('.')[0];
      if (!seen.has(pureName)) { baseCols.push(col); seen.add(pureName); }
    });
    // 🚫 롯데온 판매 중단: '롯데온 수수료' 컬럼 제외 (재개 시 배열에 다시 추가)
    return [...baseCols, '네이버 수수료', '쿠팡 수수료', '배민 수수료', '식봄 수수료'];
  };

  // 🚫 롯데온 판매 중단: '롯데온 판매가' 제외
  const summaryColumns = ['온라인 상품명', '네이버 판매가', '쿠팡 판매가', '배민 판매가', '식봄 판매가'];
  const detailColumns = getCleanColumns(safeFullData);
  const VAT_COLUMN_KEY = '__VAT__';
  const columnsWithVat = detailColumns.reduce((acc, col) => {
    acc.push(col);
    if (col.includes('매입')) acc.push(VAT_COLUMN_KEY);
    return acc;
  }, []);
  const formatHeader = (name) => {
    const pureName = name.split('.')[0];
    return pureName === "배민,쿠팡 택배비" ? "배민/쿠팡 택배비" : pureName;
  };

  const getPlatformColor = (colName) => {
    if (colName.includes('네이버')) return 'color-mix(in srgb, var(--success) 12%, transparent)';
    if (colName.includes('쿠팡')) return 'color-mix(in srgb, var(--danger) 12%, transparent)';
    if (colName.includes('배민')) return 'color-mix(in srgb, var(--accent) 12%, transparent)';
    // 🚫 롯데온 판매 중단: if (colName.includes('롯데온')) return 'color-mix(in srgb, var(--amber) 12%, transparent)';
    if (colName.includes('식봄')) return 'color-mix(in srgb, var(--success) 8%, transparent)';
    return 'transparent';
  };

  return (
    <div className="responsive-container" translate="no" style={{ color: 'var(--text)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <h2 style={{ textAlign: 'left', margin: 0, fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}><Emoji>📊</Emoji> 마진 산출 장부</h2>
      </div>

      {visibleAlerts.length > 0 && (
        <div style={{ background: 'var(--surface)', padding: '16px', borderRadius: '16px', border: '1px solid var(--border)', marginBottom: '20px', boxSizing: 'border-box', width: '100%', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <h3 style={{ margin: 0, color: 'var(--text)', fontSize: '16px', fontWeight: 700, wordBreak: 'keep-all', lineHeight: '1.4', display: 'flex', alignItems: 'center', gap: '8px' }}><Emoji>📢</Emoji> [알림] E상인 매입 단가 변동 감지!</h3>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                  미확인 알림 {visibleAlerts.length}건
                </span>

                <button onClick={handleConfirmAllAlerts} className="tab-btn-invert">
                  전체 확인 완료 <Emoji>🧹</Emoji>
                </button>
              </div>
            </div>

          <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: 'var(--text-3)', fontWeight: 'bold', wordBreak: 'keep-all', lineHeight: '1.5' }}>
            * 매입 원가가 변동(인상/인하)되었습니다. 아래 표에서 원가를 수정하여 마진을 최신화하세요!
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '10px', boxSizing: 'border-box', width: '100%' }}>
            {visibleAlerts.map((alert, idx) => {
              const isUp = alert.diff > 0;
              const colorCode = isUp ? 'var(--danger)' : 'var(--accent)';
              const sign = isUp ? '▲' : '▼';
              const diffAbs = Math.abs(alert.diff);

              return (
                <div key={idx} className="ui-card" style={{ padding: '14px', background: 'var(--surface-2)', borderRadius: '16px', border: `1px solid ${colorCode}`, display: 'flex', flexDirection: 'column', boxSizing: 'border-box', width: '100%', height: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <strong style={{ color: 'var(--text)', fontSize: '14px', wordBreak: 'break-word', marginRight: '10px' }}>{alert.name}</strong>
                  </div>
                  {alert.spec && (
                    <div style={{ marginBottom: '14px' }}>
                      <span style={{ color: 'var(--text-3)', fontSize: '12px', background: 'var(--surface)', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border)', display: 'inline-block' }}>{alert.spec}</span>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: 'var(--text-3)', marginBottom: '8px' }}>
                    <span>기존 매입 단가:</span>
                    <span style={{ textDecoration: 'line-through' }}>{alert.oldPrice.toLocaleString()}원</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px' }}>
                    <span>최근 매입 단가:</span>
                    <strong style={{ color: colorCode }}>{alert.newPrice.toLocaleString()}원</strong>
                  </div>

                  <div style={{ marginTop: 'auto' }}>
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px dashed color-mix(in srgb, ${colorCode} 40%, transparent)`, fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-3)' }}>{isUp ? '원가 인상폭:' : '원가 인하폭:'}</span>
                      <strong style={{ color: colorCode, fontSize: '14px' }}>{sign} {diffAbs.toLocaleString()}원</strong>
                    </div>

                    <button
                      onClick={() => handleConfirmAlert(alert)}
                      className="tab-cta-btn"
                      style={{ marginTop: '16px', width: '100%', background: colorCode, justifyContent: 'center' }}
                    >
                      {isUp ? '인상 확인 완료' : '인하 확인 완료'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ marginBottom: '14px', padding: '14px', border: '1px dashed var(--border)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', background: 'var(--surface)' }}>
        <div>
          <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Emoji>📥</Emoji> 새 단가표 업로드: </strong>
          <input type="file" accept=".csv, .xlsx" onChange={handleFileChange} style={{ maxWidth: '100%' }} />
        </div>
        {currentFileName && (
          <div style={{ backgroundColor: 'color-mix(in srgb, var(--success) 12%, transparent)', padding: '6px 12px', borderRadius: '999px', color: 'var(--text)', border: '1px solid var(--border)', fontWeight: 700, fontSize: '12px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Emoji>📄</Emoji> 파일: {currentFileName}</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '6px', backgroundColor: 'var(--surface)', padding: '14px', borderRadius: '16px', flexWrap: 'wrap', border: '1px solid var(--border)' }}>
        {Object.entries({
          '🟢 네이버': 'naver', '🚀 쿠팡': 'coupang', '🛵 배민': 'baemin', /* 🚫 롯데온 판매 중단: '🔴 롯데온': 'lotteon', */ '🥬 식봄': 'sikbom'
        }).map(([label, key]) => (
          <div key={key} style={{ flex: '1 1 120px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}><EmojiText text={label} /> (%)</label>
            <input type="number" step="0.1" value={fees[key]} onChange={(e) => handleFeeChange(key, parseFloat(e.target.value))} style={{ width: '100%', padding: '6px', backgroundColor: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '6px', boxSizing: 'border-box' }} />
          </div>
        ))}
        <div style={{ flex: '1 1 120px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', marginBottom: '5px', fontSize: '12px', color: 'var(--danger)' }}><Emoji>⚠️</Emoji> 경고 기준 마진율 (%)</label>
          <input type="number" step="0.1" value={marginThreshold} onChange={(e) => handleThresholdChange(e.target.value)} style={{ width: '100%', padding: '6px', backgroundColor: 'var(--surface-2)', color: 'var(--text)', border: '1px solid color-mix(in srgb, var(--danger) 50%, transparent)', borderRadius: '6px', boxSizing: 'border-box' }} />
        </div>
      </div>
      <p style={{ color: 'var(--text-3)', margin: '0 0 14px 0', fontSize: '12px', wordBreak: 'keep-all' }}>
        기준 원가(매입+자재비+마진+택배비)에서 선택한 채널 수수료를 적용한 자동 추천 판매가를 표시합니다.
      </p>

      <div style={{ marginBottom: '14px', padding: '14px', backgroundColor: 'var(--surface)', borderRadius: '16px', display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid var(--border)' }}>
        <input type="text" placeholder="검색어 입력..." value={searchTerm} onChange={handleSearchChange} style={{ flex: 1, backgroundColor: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '10px', borderRadius: '8px' }} />
      </div>

      <div style={{ position: 'relative' }}>
        {isCalculating && safeFullData.length > 0 && <div style={{ position: 'absolute', top: '20%', left: '50%', transform: 'translate(-50%, -50%)', backgroundColor: 'rgba(0,0,0,0.8)', color: 'white', padding: '10px 20px', borderRadius: '20px', fontWeight: 'bold', zIndex: 10, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}><Emoji>⚡</Emoji> 서버 통신 중...</div>}
        
        {safeFullData.length > 0 ? (
          <div style={{ opacity: isCalculating ? 0.4 : 1, transition: 'opacity 0.2s' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', gap: '10px', flexWrap: 'wrap' }}>
              <h3 style={{ color: 'var(--text)', margin: 0, fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}><Emoji>💰</Emoji> 1. 원가 및 상세 내역</h3>

              <div className='responsive-btn-container' style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <select value={sortType} onChange={(e) => { setSortType(e.target.value); setCurrentPage(1); }} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', outline: 'none', cursor: 'pointer', fontWeight: 700 }}>
                  <option value="default">📋 등록된 순서</option>
                  <option value="nameAsc">🔤 이름 가나다순</option>
                  <option value="nameDesc">🔡 이름 역순</option>
                  <option value="marginDesc">💸 마진 높은 순</option>
                </select>
                <button className="responsive-btn esangin-btn" onClick={handleAddRow} style={{ background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)' }}><Emoji>➕</Emoji> 상품 추가</button>
                <button className="responsive-btn esangin-btn" onClick={handleRefreshData} style={{ background: 'color-mix(in srgb, var(--amber) 10%, transparent)', color: 'var(--amber)', border: '1px solid color-mix(in srgb, var(--amber) 35%, transparent)' }}><Emoji>🔄</Emoji> 데이터 최신화</button>
                <button className="responsive-btn esangin-btn" onClick={() => updateMarginWithData(safeFullData, fees, true)} style={{ background: 'var(--accent)' }}><Emoji>💾</Emoji> 확인 및 저장</button>
              </div>
            </div>

            <div className="responsive-overflow" style={{ overflowX: 'auto', paddingBottom: '10px', marginTop: '10px', minHeight: '520px', background: 'var(--surface)', borderRadius: '16px' }}>
              <table border="0" style={{ tableLayout: 'fixed', width: '100%', minWidth: '850px', borderCollapse: 'collapse', textAlign: 'center', whiteSpace: 'nowrap' }}>
                <thead style={{ background: 'var(--surface-2)' }}>
                  <tr>
                    <th style={{ padding: '8px', width: '110px' }}>관리</th>
                    <th style={{ padding: '8px', width: '140px', fontSize: '13px' }}>과세구분</th>
                    {columnsWithVat.map(col => (
                      <th key={col} style={{ padding: '8px', fontSize: '13px', width: col.includes('상품명') ? '220px' : '85px' }}>
                        {col === VAT_COLUMN_KEY ? '부가세' : formatHeader(col)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {currentFullItems.map((row, idx) => {
                    const globalIndex = filteredIndices[indexOfFirst + idx];
                    const marginInfo = getMarginInfo(row);
                    const vatInfo = getVatRangeInfo(row);
                    const vatText = vatInfo
                      ? (vatInfo.min === vatInfo.max ? `${vatInfo.min.toLocaleString()}원` : `${vatInfo.min.toLocaleString()}~${vatInfo.max.toLocaleString()}원`)
                      : '-';
                    const productName = row['온라인 상품명'] || row['상품명'] || '';
                    const linkedChannels = channelLinks[productName] || {};
                    return (
                      <tr key={globalIndex} style={{ borderBottom: '1px solid var(--border)', backgroundColor: marginInfo.isLow ? 'color-mix(in srgb, var(--danger) 5%, transparent)' : 'transparent' }}>
                        <td style={{ padding: '6px', verticalAlign: 'top' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                            <button onClick={() => handleDeleteRow(globalIndex)} className="tab-icon-btn danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Emoji>🗑️</Emoji> 삭제</button>
                            <button onClick={() => openLinkModal(productName)} className="tab-icon-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Emoji>🔗</Emoji> 채널 연결</button>
                            {Object.keys(linkedChannels).length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                {Object.keys(CHANNEL_LABELS).filter(ch => linkedChannels[ch]).map(ch => (
                                  <span key={ch} title={linkedChannels[ch].name} style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '999px', background: 'color-mix(in srgb, var(--success) 14%, transparent)', color: 'var(--success)', border: '1px solid color-mix(in srgb, var(--success) 35%, transparent)' }}>
                                    {CHANNEL_LABELS[ch]}✓
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '6px', verticalAlign: 'top' }}>
                          <select value={row['과세구분'] || '과세'} onChange={(e) => handleTaxTypeChange(globalIndex, e.target.value)} style={{ width: '100%', padding: '8px', fontSize: '11px', border: '1px solid var(--border)', borderRadius: '8px', backgroundColor: 'var(--surface-2)', color: 'var(--text)', fontWeight: 700, cursor: 'pointer' }}>
                            <option value="과세">과세</option>
                            <option value="면세">면세</option>
                            <option value="과세(매입세액불공제)" title="매입세액 공제가 없는 과세 상품 (예: 계산서 매입 농산물) - 판매가 전체에 부가세 적용">과세(매입세액불공제)</option>
                          </select>
                        </td>
                        {columnsWithVat.map(col => {
                          if (col === VAT_COLUMN_KEY) {
                            return (
                              <td key={col} style={{ padding: '5px', verticalAlign: 'top' }}>
                                <input type="text" readOnly value={vatText} title={vatInfo ? '과세 상품 부가세 예상 범위 (플랫폼별 상이 - 표2 참고)' : undefined} style={{ width: '100%', padding: '10px', border: '1px solid var(--border)', borderRadius: '8px', backgroundColor: 'var(--surface-2)', color: 'var(--text-3)', textAlign: 'right', boxSizing: 'border-box', cursor: 'default' }} />
                              </td>
                            );
                          }
                          const isNameCol = col.includes('상품명');
                          return (
                            <td key={col} style={{ padding: '5px', verticalAlign: 'top' }}>
                              <input type="text" value={row[col] === null || row[col] === undefined ? "" : row[col]} onChange={(e) => handleCellChange(globalIndex, col, e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid var(--border)', borderRadius: '8px', backgroundColor: 'var(--surface-2)', color: 'var(--text)', textAlign: isNameCol ? 'left' : 'right', boxSizing: 'border-box' }} />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '16px', paddingBottom: '12px' }}>
              <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
            </div>

            <h3 style={{ marginTop: '28px', color: 'var(--text)', borderTop: '1px solid var(--border)', paddingTop: '14px', fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}><Emoji>🛍️</Emoji> 2. 플랫폼별 최종 판매가</h3>
            <div className="responsive-overflow" style={{ overflowX: 'auto', paddingBottom: '10px', minHeight: '480px', background: 'var(--surface)', borderRadius: '16px' }}>
              <table border="0" style={{ tableLayout: 'fixed', width: '100%', minWidth: '700px', borderCollapse: 'collapse', textAlign: 'right', whiteSpace: 'nowrap' }}>
                <thead style={{ textAlign: 'center' }}>
                  <tr>
                    {summaryColumns.map(col => (
                      <th key={col} style={{ padding: '12px', backgroundColor: getPlatformColor(col), width: col.includes('상품명') ? '220px' : '100px', borderBottom: '1px solid var(--border)', fontSize: '12px' }}>{formatHeader(col)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {currentSummaryItems.length > 0 ? currentSummaryItems.map((row, idx) => {
                    const marginInfo = getMarginInfo(currentFullItems[idx]);
                    return (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border)', backgroundColor: idx % 2 === 1 ? 'var(--surface-2)' : 'transparent' }}>
                      {summaryColumns.map((col, i) => {
                        const isNameCol = col.includes('상품명');
                        const platformLabel = col.replace(' 판매가', '');
                        const rate = !isNameCol ? marginInfo.rates[platformLabel] : null;
                        const rateColor = rate === null || rate === undefined
                          ? 'var(--text)'
                          : rate >= 10
                            ? 'var(--success)'
                            : rate >= 5
                              ? 'color-mix(in srgb, var(--highlight) 65%, var(--text) 35%)'
                              : 'var(--danger)';
                        return (
                          <td key={i} style={{ padding: '12px', color: 'var(--text)', backgroundColor: isNameCol ? 'transparent' : getPlatformColor(col), textAlign: isNameCol ? 'left' : 'right', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '13px' }}>
                            {isNameCol ? (
                              row[col] || ''
                            ) : (
                              <>
                                {typeof row[col] === 'number' ? row[col].toLocaleString() + '원' : (row[col] || "0원")}
                                {rate !== null && rate !== undefined && (
                                  <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 'bold', color: rateColor }}>
                                    ({rate.toFixed(1)}%)
                                  </span>
                                )}
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    );
                  }) : (
                    <tr><td colSpan={summaryColumns.length} style={{ padding: '30px', textAlign: 'center', color: 'var(--text-3)' }}>데이터가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

          </div>
        ) : (
          !isCalculating && <div style={{ textAlign: 'center', padding: '40px' }}><p>{loadMsg}</p></div>
        )}
      </div>

      {linkModalProduct !== null && (
        <div
          onClick={closeLinkModal}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', width: '100%', maxWidth: '600px', maxHeight: '80vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            <div style={{ flexShrink: 0, padding: '20px 20px 14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '6px' }}><Emoji>🔗</Emoji> 채널 연결</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-3)' }}>{linkModalProduct}</p>
              </div>
              <button onClick={closeLinkModal} className="tab-icon-btn"><Emoji>✕</Emoji></button>
            </div>

            <div style={{ flexShrink: 0, padding: '0 20px 14px 20px', display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearchCandidates(); }}
                placeholder="검색어를 바꿔서 후보를 다시 찾아보세요 (특히 식봄)"
                style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '8px', backgroundColor: 'var(--surface-2)', color: 'var(--text)', fontSize: '13px', boxSizing: 'border-box' }}
              />
              <button onClick={handleSearchCandidates} disabled={linkLoading} className="tab-icon-btn" style={{ whiteSpace: 'nowrap' }}>
                <Emoji>🔍</Emoji> 검색
              </button>
            </div>

            {linkLoading ? (
              <div style={{ padding: '30px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', color: 'var(--text-3)', fontSize: '13px' }}>
                <span className="searchSpinner" />
                <span>검색 중...</span>
              </div>
            ) : (
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 20px 14px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {Object.entries(CHANNEL_LABELS).map(([channel, label]) => {
                  const linked = (channelLinks[linkModalProduct] || {})[channel];
                  const rawCandidates = (linkCandidates && linkCandidates[channel]) || [];
                  // 이미 연결된 후보가 검색 결과에 없으면 목록 맨 위에 끼워넣어 선택 상태를 유지한다.
                  const candidates = linked && !rawCandidates.some(c => String(c.id) === String(linked.id))
                    ? [{ id: linked.id, name: linked.name }, ...rawCandidates]
                    : rawCandidates;
                  const selected = selectedCandidates[channel];

                  return (
                    <div key={channel} style={{ border: '1px solid var(--border)', borderRadius: '12px', padding: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>{label}</div>
                        {linked && (
                          <button onClick={() => handleUnlinkChannel(channel)} className="tab-icon-btn danger" style={{ fontSize: '11px' }}>연결 해제</button>
                        )}
                      </div>

                      {candidates.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-3)', cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name={`link-${channel}`}
                              checked={!selected}
                              onChange={() => setSelectedCandidates(prev => ({ ...prev, [channel]: null }))}
                            />
                            선택 안함
                          </label>
                          {candidates.map((c) => (
                            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--surface-2)', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name={`link-${channel}`}
                                checked={!!selected && String(selected.id) === String(c.id)}
                                onChange={() => {
                                  setSelectedCandidates(prev => ({ ...prev, [channel]: { id: c.id, name: c.name } }));
                                  setSelectedOptionByChannel(prev => ({ ...prev, [channel]: null }));
                                  if (channel === 'naver' || channel === 'coupang') fetchOptionCandidates(channel, c.id);
                                }}
                              />
                              <span style={{ fontSize: '13px', color: 'var(--text)' }}>{c.name}</span>
                              {linked && String(linked.id) === String(c.id) && (
                                <span style={{ fontSize: '10px', color: 'var(--success)', fontWeight: 700 }}>✓ 연결됨</span>
                              )}
                            </label>
                          ))}
                          {(channel === 'naver' || channel === 'coupang') && selected && optionCandidates[channel] && (
                            optionCandidates[channel].loading ? (
                              <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '4px' }}>옵션 조회 중...</div>
                            ) : optionCandidates[channel].options.length > 0 ? (
                              <div style={{ marginTop: '6px', paddingLeft: '12px', borderLeft: '2px solid var(--border)' }}>
                                <div style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '6px' }}>이 상품의 어떤 옵션인가요?</div>
                                {optionCandidates[channel].options.map(opt => (
                                  <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '4px 0', cursor: 'pointer' }}>
                                    <input
                                      type="radio"
                                      name={`option-${channel}`}
                                      checked={!!selectedOptionByChannel[channel] && selectedOptionByChannel[channel].id === opt.id}
                                      onChange={() => setSelectedOptionByChannel(prev => ({ ...prev, [channel]: opt }))}
                                    />
                                    {opt.name}
                                  </label>
                                ))}
                              </div>
                            ) : null
                          )}
                        </div>
                      ) : (
                        <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>
                          {linkCandidates === null ? '검색 버튼을 눌러 후보를 찾아보세요.' : '검색된 후보가 없습니다.'}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!linkLoading && (
              <div style={{ flexShrink: 0, padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
                {console.log('[DEBUG] 렌더 시점 - 버튼 disabled:', isConnecting || Object.values(selectedCandidates).every(v => !v), '/ isConnecting:', isConnecting, '/ selectedCandidates:', selectedCandidates)}
                <button
                  onClick={handleConnectSelected}
                  disabled={isConnecting || Object.values(selectedCandidates).every(v => !v)}
                  className="tab-cta-btn"
                  style={{ width: '100%', justifyContent: 'center', background: 'var(--accent)', opacity: isConnecting ? 0.6 : 1 }}
                >
                  {isConnecting ? '연결 중...' : '선택한 채널들 한번에 연결'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {priceChanges !== null && (
        <div
          onClick={closePriceChangeModal}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', width: '100%', maxWidth: '640px', maxHeight: '80vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            <div style={{ flexShrink: 0, padding: '20px 20px 14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '6px' }}><Emoji>💰</Emoji> 채널 가격 변경 미리보기</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-3)' }}>
                  {priceSyncResults ? '반영 결과' : `채널 연결된 상품 ${priceChanges.length}건의 판매가가 바뀌었습니다.`}
                </p>
              </div>
              <button onClick={closePriceChangeModal} className="tab-icon-btn"><Emoji>✕</Emoji></button>
            </div>

            {!priceSyncResults && (
              <div style={{ flexShrink: 0, padding: '0 20px 10px 20px', display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={handleToggleSelectAllPriceChanges} className="tab-icon-btn">
                  {priceChanges.every((_, idx) => priceChangeSelected[idx]) ? '전체 해제' : '전체 선택'}
                </button>
              </div>
            )}

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 20px 14px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {priceSyncResults ? (
                priceSyncResults.map((r, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex', flexDirection: 'column', gap: '2px', background: 'var(--surface-2)', borderRadius: '8px', padding: '10px 12px',
                      border: `1px solid ${r.success ? 'color-mix(in srgb, var(--success) 35%, transparent)' : 'color-mix(in srgb, var(--danger) 35%, transparent)'}`
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: 700 }}>{r.product_name} · {CHANNEL_LABELS[r.channel] || r.channel}</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: r.success ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }}>{r.success ? '✓ 성공' : '✕ 실패'}</span>
                    </div>
                    {!r.success && r.message && (
                      <span style={{ fontSize: '12px', color: 'var(--danger)' }}>{r.message}</span>
                    )}
                  </div>
                ))
              ) : (
                priceChanges.map((c, idx) => (
                  <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--surface-2)', borderRadius: '8px', padding: '10px 12px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!priceChangeSelected[idx]}
                      onChange={() => setPriceChangeSelected(prev => ({ ...prev, [idx]: !prev[idx] }))}
                    />
                    <div style={{ flex: 1, minWidth: 0, fontSize: '13px', color: 'var(--text)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>{CHANNEL_LABELS[c.channel] || c.channel} - </span>
                      {c.product_name}
                      {c.option_name && <span style={{ fontWeight: 400, color: 'var(--text-3)' }}> {c.option_name} 옵션</span>}
                    </div>
                    <div style={{ fontSize: '13px', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ color: 'var(--text-3)' }}>
                        {c.old_price === null || c.old_price === undefined ? '신규' : `${c.old_price.toLocaleString()}원`}
                      </span>
                      <span style={{ color: 'var(--text-3)' }}>→</span>
                      <input
                        type="number"
                        value={c.new_price}
                        disabled={!priceChangeSelected[idx]}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handleNewPriceInputChange(idx, e.target.value)}
                        style={{
                          width: '90px', padding: '4px 6px', borderRadius: '6px', textAlign: 'right',
                          border: '1px solid var(--border)', background: 'var(--surface)',
                          fontSize: '13px', fontWeight: 700,
                          opacity: priceChangeSelected[idx] ? 1 : 0.5,
                          color: c.old_price != null && c.new_price > c.old_price ? 'var(--success)'
                            : c.old_price != null && c.new_price < c.old_price ? 'var(--danger)' : 'var(--text)',
                        }}
                      />
                      <span style={{ color: 'var(--text-3)' }}>원</span>
                    </div>
                  </label>
                ))
              )}
            </div>

            <div style={{ flexShrink: 0, padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: '10px' }}>
              {priceSyncResults ? (
                <button onClick={closePriceChangeModal} className="tab-cta-btn" style={{ width: '100%', justifyContent: 'center', background: 'var(--accent)' }}>닫기</button>
              ) : (
                <>
                  <button onClick={closePriceChangeModal} className="tab-icon-btn" style={{ flexShrink: 0 }}>취소</button>
                  <button
                    onClick={handleSyncPrices}
                    disabled={isSyncingPrices || Object.values(priceChangeSelected).every(v => !v)}
                    className="tab-cta-btn"
                    style={{ flex: 1, justifyContent: 'center', background: 'var(--accent)', opacity: isSyncingPrices ? 0.6 : 1 }}
                  >
                    {isSyncingPrices ? '반영 중...' : '선택한 항목 채널에 반영'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}