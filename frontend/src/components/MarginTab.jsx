import React, { useState, useEffect } from 'react';
import { API_BASE } from '../apiBase';
import { useTheme } from '../ThemeContext';

export default function MarginTab() {
  const [file, setFile] = useState(null);
  const [fullData, setFullData] = useState([]);
  const [summaryData, setSummaryData] = useState([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [sortType, setSortType] = useState("default");
  const { theme } = useTheme();
  
  const isLight = theme === 'light';
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
  const pageGroupSize = 5; 

  const [priceAlerts, setPriceAlerts] = useState([]);
  
  const [ackPrices, setAckPrices] = useState(() => {
    const savedPrices = localStorage.getItem('acknowledgedPrices');
    return savedPrices ? JSON.parse(savedPrices) : {};
  });

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

  useEffect(() => { loadInitialData(); }, []);

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
      if (data.status === 'success') {
        const source = data.full_data || dataToUpdate || [];
        const recalculated = recalcFullDataWithFees(source, currentFees);
        setFullData(recalculated);
        setSummaryData(buildSummaryDataFromFull(recalculated));
        if (showAlert) alert("✅ 데이터가 저장되고 최종 판매가가 업데이트되었습니다!"); 
        fetchPriceAlerts(); 
      } else if (showAlert) {
        alert(data.message || "서버 계산 중 오류가 발생했습니다.");
      }
      setIsCalculating(false);
    })
    .catch(err => { console.error('업데이트 에러:', err); setIsCalculating(false); });
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
  const currentGroup = Math.ceil(currentPage / pageGroupSize);
  const startPage = (currentGroup - 1) * pageGroupSize + 1;
  const endPage = Math.min(startPage + pageGroupSize - 1, totalPages);
  const pages = [];
  for (let i = startPage; i <= endPage; i++) pages.push(i);

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

  const themeVars = {
    '--local-box': isLight ? '#f0f1f3' : 'rgba(255,255,255,0.02)',
    '--local-text': isLight ? '#1a1a1a' : 'var(--text)',
    '--local-text-muted': isLight ? '#4b5563' : 'var(--text-muted)',
    '--local-border': isLight ? '#a0a9bf' : 'var(--border)',
    '--local-input-bg': isLight ? '#e8eaef' : 'rgba(255,255,255,0.03)',
    '--local-table-header': isLight ? '#dfe4f0' : 'transparent',
    color: 'var(--local-text)',
    transition: 'all 0.3s ease'
  };

  const getPlatformColor = (colName) => {
    if (colName.includes('네이버')) return isLight ? 'rgba(47, 211, 122, 0.15)' : 'rgba(47, 211, 122, 0.08)';
    if (colName.includes('쿠팡')) return isLight ? 'rgba(255, 77, 79, 0.15)' : 'rgba(255, 77, 79, 0.08)';
    if (colName.includes('배민')) return isLight ? 'rgba(47, 107, 255, 0.15)' : 'rgba(47, 107, 255, 0.08)';
    // 🚫 롯데온 판매 중단: if (colName.includes('롯데온')) return isLight ? 'rgba(255, 153, 0, 0.15)' : 'rgba(255, 153, 0, 0.08)';
    if (colName.includes('식봄')) return isLight ? 'rgba(47, 211, 122, 0.1)' : 'rgba(47, 211, 122, 0.05)';
    return 'transparent';
  };

  return (
    <div className="responsive-container" translate="no" style={themeVars}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <h2 style={{ textAlign: 'left', margin: 0 }}>📊 마진 산출 장부</h2>
      </div>
      
      {visibleAlerts.length > 0 && (
        <div style={{ background: 'var(--local-box)', padding: '20px', borderRadius: '16px', border: `2px solid var(--local-border)`, marginBottom: '20px', boxSizing: 'border-box', width: '100%', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <h3 style={{ margin: 0, color: 'var(--local-text)', fontSize: '18px', wordBreak: 'keep-all', lineHeight: '1.4' }}>📢 [알림] E상인 매입 단가 변동 감지!</h3>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ background: 'var(--local-input-bg)', border: '1px solid var(--local-border)', color: 'var(--local-text)', padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                  미확인 알림 {visibleAlerts.length}건
                </span>
                
                <button 
                  onClick={handleConfirmAllAlerts}
                  style={{ 
                    background: isLight ? '#1a1a1a' : '#f0f0f0', 
                    color: isLight ? '#ffffff' : '#1a1a1a', 
                    border: 'none', padding: '6px 14px', 
                    borderRadius: '20px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer',
                    transition: 'all 0.2s', whiteSpace: 'nowrap'
                  }}
                  onMouseOver={(e) => { e.target.style.transform = 'scale(1.05)'; e.target.style.background = isLight ? '#404040' : '#ffffff'; }}
                  onMouseOut={(e) => { e.target.style.transform = 'scale(1)'; e.target.style.background = isLight ? '#1a1a1a' : '#f0f0f0'; }}
                >
                  전체 확인 완료 🧹
                </button>
              </div>
            </div>

          <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: 'var(--local-text-muted)', fontWeight: 'bold', wordBreak: 'keep-all', lineHeight: '1.5' }}>
            * 매입 원가가 변동(인상/인하)되었습니다. 아래 표에서 원가를 수정하여 마진을 최신화하세요!
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '16px', boxSizing: 'border-box', width: '100%' }}>
            {visibleAlerts.map((alert, idx) => {
              const isUp = alert.diff > 0;
              const colorCode = isUp ? '#ff4d4f' : '#2f6bff';
              const sign = isUp ? '▲' : '▼';
              const diffAbs = Math.abs(alert.diff);

              return (
                <div key={idx} style={{ padding: '16px', background: 'var(--local-input-bg)', borderRadius: '12px', border: `1px solid ${colorCode}`, display: 'flex', flexDirection: 'column', boxSizing: 'border-box', width: '100%', height: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <strong style={{ color: 'var(--local-text)', fontSize: '15px', wordBreak: 'break-word', marginRight: '10px' }}>{alert.name}</strong>
                  </div>
                  {alert.spec && (
                    <div style={{ marginBottom: '14px' }}>
                      <span style={{ color: 'var(--local-text-muted)', fontSize: '13px', background: 'var(--local-box)', padding: '4px 8px', borderRadius: '6px', border: `1px solid var(--local-border)`, display: 'inline-block' }}>{alert.spec}</span>
                    </div>
                  )}
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: 'var(--local-text-muted)', marginBottom: '8px' }}>
                    <span>기존 매입 단가:</span>
                    <span style={{ textDecoration: 'line-through' }}>{alert.oldPrice.toLocaleString()}원</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px' }}>
                    <span>최근 매입 단가:</span>
                    <strong style={{ color: colorCode }}>{alert.newPrice.toLocaleString()}원</strong>
                  </div>
                  
                  <div style={{ marginTop: 'auto' }}>
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px dashed ${colorCode}40`, fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--local-text-muted)' }}>{isUp ? '원가 인상폭:' : '원가 인하폭:'}</span>
                      <strong style={{ color: colorCode, fontSize: '15px' }}>{sign} {diffAbs.toLocaleString()}원</strong>
                    </div>

                    <button 
                      onClick={() => handleConfirmAlert(alert)}
                      style={{ 
                        marginTop: '16px', width: '100%', padding: '10px', 
                        borderRadius: '8px', border: 'none', background: colorCode, 
                        color: '#fff', fontWeight: 'bold', cursor: 'pointer', transition: 'opacity 0.2s', flexShrink: 0
                      }}
                      onMouseOver={(e) => e.target.style.opacity = '0.8'}
                      onMouseOut={(e) => e.target.style.opacity = '1'}
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

      <div style={{ marginBottom: '14px', padding: '14px', border: `1px dashed var(--local-border)`, borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', background: 'var(--local-box)' }}>
        <div>
          <strong>📥 새 단가표 업로드: </strong>
          <input type="file" accept=".csv, .xlsx" onChange={handleFileChange} style={{ maxWidth: '100%' }} />
        </div>
        {currentFileName && (
          <div style={{ backgroundColor: 'rgba(47,211,122,0.12)', padding: '6px 12px', borderRadius: '999px', color: 'var(--local-text)', border: `1px solid var(--local-border)`, fontWeight: 700, fontSize: '12px', whiteSpace: 'nowrap' }}>📄 파일: {currentFileName}</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '6px', backgroundColor: 'var(--local-box)', padding: '14px', borderRadius: '14px', flexWrap: 'wrap', border: `1px solid var(--local-border)` }}>
        {Object.entries({
          '🟢 네이버': 'naver', '🚀 쿠팡': 'coupang', '🛵 배민': 'baemin', /* 🚫 롯데온 판매 중단: '🔴 롯데온': 'lotteon', */ '🥬 식봄': 'sikbom'
        }).map(([label, key]) => (
          <div key={key} style={{ flex: '1 1 120px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px', fontSize: '13px' }}>{label} (%)</label>
            <input type="number" step="0.1" value={fees[key]} onChange={(e) => handleFeeChange(key, parseFloat(e.target.value))} style={{ width: '100%', padding: '6px', backgroundColor: 'var(--local-input-bg)', color: 'var(--local-text)', border: `1px solid var(--local-border)`, borderRadius: '6px', boxSizing: 'border-box' }} />
          </div>
        ))}
        <div style={{ flex: '1 1 120px' }}>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px', fontSize: '13px', color: '#ff4d4f' }}>⚠️ 경고 기준 마진율 (%)</label>
          <input type="number" step="0.1" value={marginThreshold} onChange={(e) => handleThresholdChange(e.target.value)} style={{ width: '100%', padding: '6px', backgroundColor: 'var(--local-input-bg)', color: 'var(--local-text)', border: '1px solid rgba(255,77,79,0.5)', borderRadius: '6px', boxSizing: 'border-box' }} />
        </div>
      </div>
      <p style={{ color: 'var(--local-text-muted)', margin: '0 0 14px 0', fontSize: '0.85rem', wordBreak: 'keep-all' }}>
        기준 원가(매입+자재비+마진+택배비)에서 선택한 채널 수수료를 적용한 자동 추천 판매가를 표시합니다.
      </p>

      <div style={{ marginBottom: '14px', padding: '14px', backgroundColor: 'var(--local-box)', borderRadius: '14px', display: 'flex', alignItems: 'center', gap: '10px', border: `1px solid var(--local-border)` }}>
        <input type="text" placeholder="검색어 입력..." value={searchTerm} onChange={handleSearchChange} style={{ flex: 1, backgroundColor: 'var(--local-input-bg)', color: 'var(--local-text)', border: `1px solid var(--local-border)`, padding: '10px', borderRadius: '8px' }} />
      </div>

      <div style={{ position: 'relative' }}>
        {isCalculating && safeFullData.length > 0 && <div style={{ position: 'absolute', top: '20%', left: '50%', transform: 'translate(-50%, -50%)', backgroundColor: 'rgba(0,0,0,0.8)', color: 'white', padding: '10px 20px', borderRadius: '20px', fontWeight: 'bold', zIndex: 10, whiteSpace: 'nowrap' }}>⚡ 서버 통신 중...</div>}
        
        {safeFullData.length > 0 ? (
          <div style={{ opacity: isCalculating ? 0.4 : 1, transition: 'opacity 0.2s' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', gap: '10px', flexWrap: 'wrap' }}>
              <h3 style={{ color: 'var(--local-text)', margin: 0, fontSize: '14px', fontWeight: 750 }}>💰 1. 원가 및 상세 내역</h3>
              
              <div className='responsive-btn-container' style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <select value={sortType} onChange={(e) => { setSortType(e.target.value); setCurrentPage(1); }} style={{ padding: '9px 12px', borderRadius: '10px', border: `1px solid var(--local-border)`, background: 'var(--local-input-bg)', color: 'var(--local-text)', outline: 'none', cursor: 'pointer', fontWeight: 700 }}>
                  <option value="default" style={{ background: isLight ? '#fff' : '#1e1e1e', color: isLight ? '#000' : '#fff' }}>📋 등록된 순서</option>
                  <option value="nameAsc" style={{ background: isLight ? '#fff' : '#1e1e1e', color: isLight ? '#000' : '#fff' }}>🔤 이름 가나다순</option>
                  <option value="nameDesc" style={{ background: isLight ? '#fff' : '#1e1e1e', color: isLight ? '#000' : '#fff' }}>🔡 이름 역순</option>
                  <option value="marginDesc" style={{ background: isLight ? '#fff' : '#1e1e1e', color: isLight ? '#000' : '#fff' }}>💸 마진 높은 순</option>
                </select>
                <button className="responsive-btn" onClick={handleAddRow} style={{ background: 'var(--local-input-bg)', color: 'var(--local-text)', padding: '10px 14px', borderRadius: '10px', fontWeight: 750, border: `1px solid var(--local-border)`, cursor: 'pointer' }}>➕ 상품 추가</button>
                <button className="responsive-btn" onClick={handleRefreshData} style={{ background: 'rgba(255,159,10,0.1)', color: isLight ? '#d97706' : 'var(--text)', padding: '10px 14px', borderRadius: '10px', fontWeight: 750, border: '1px solid rgba(255,159,10,0.35)', cursor: 'pointer' }}>🔄 데이터 최신화</button>
                <button className="responsive-btn" onClick={() => updateMarginWithData(safeFullData, fees, true)} style={{ background: 'linear-gradient(180deg, rgba(47,107,255,0.95), rgba(30,94,255,0.9))', color: '#fff', padding: '10px 14px', borderRadius: '10px', fontWeight: 750, border: '1px solid rgba(47,107,255,0.35)', cursor: 'pointer' }}>💾 확인 및 저장</button>
              </div>
            </div>

            <div className="responsive-overflow" style={{ overflowX: 'auto', paddingBottom: '10px', marginTop: '10px', minHeight: '520px', background: 'var(--local-box)', borderRadius: '12px' }}>
              <table border="0" style={{ tableLayout: 'fixed', width: '100%', minWidth: '850px', borderCollapse: 'collapse', textAlign: 'center', whiteSpace: 'nowrap' }}>
                <thead style={{ background: 'var(--local-table-header)' }}>
                  <tr>
                    <th style={{ padding: '8px', width: '60px' }}>관리</th>
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
                    return (
                      <tr key={globalIndex} style={{ borderBottom: `1px solid var(--local-border)`, backgroundColor: marginInfo.isLow ? (isLight ? 'rgba(255,77,79,0.05)' : 'rgba(255,77,79,0.04)') : 'transparent' }}>
                        <td style={{ padding: '6px', verticalAlign: 'top' }}><button onClick={() => handleDeleteRow(globalIndex)} style={{ backgroundColor: 'transparent', color: 'rgba(255,77,79,0.95)', border: '1px solid rgba(255,77,79,0.35)', borderRadius: '10px', cursor: 'pointer', padding: '8px 10px', fontSize: '12px' }}>🗑️ 삭제</button></td>
                        <td style={{ padding: '6px', verticalAlign: 'top' }}>
                          <select value={row['과세구분'] || '과세'} onChange={(e) => handleTaxTypeChange(globalIndex, e.target.value)} style={{ width: '100%', padding: '8px', fontSize: '11px', border: `1px solid var(--local-border)`, borderRadius: '10px', backgroundColor: 'var(--local-input-bg)', color: 'var(--local-text)', fontWeight: 700, cursor: 'pointer' }}>
                            <option value="과세" style={{ background: isLight ? '#fff' : '#1e1e1e', color: isLight ? '#000' : '#fff' }}>과세</option>
                            <option value="면세" style={{ background: isLight ? '#fff' : '#1e1e1e', color: isLight ? '#000' : '#fff' }}>면세</option>
                            <option value="과세(매입세액불공제)" title="매입세액 공제가 없는 과세 상품 (예: 계산서 매입 농산물) - 판매가 전체에 부가세 적용" style={{ background: isLight ? '#fff' : '#1e1e1e', color: isLight ? '#000' : '#fff' }}>과세(매입세액불공제)</option>
                          </select>
                        </td>
                        {columnsWithVat.map(col => {
                          if (col === VAT_COLUMN_KEY) {
                            return (
                              <td key={col} style={{ padding: '5px', verticalAlign: 'top' }}>
                                <input type="text" readOnly value={vatText} title={vatInfo ? '과세 상품 부가세 예상 범위 (플랫폼별 상이 - 표2 참고)' : undefined} style={{ width: '100%', padding: '10px', border: `1px solid var(--local-border)`, borderRadius: '10px', backgroundColor: 'var(--local-input-bg)', color: isLight ? '#6b7280' : '#9ca3af', textAlign: 'right', boxSizing: 'border-box', cursor: 'default' }} />
                              </td>
                            );
                          }
                          const isNameCol = col.includes('상품명');
                          return (
                            <td key={col} style={{ padding: '5px', verticalAlign: 'top' }}>
                              <input type="text" value={row[col] === null || row[col] === undefined ? "" : row[col]} onChange={(e) => handleCellChange(globalIndex, col, e.target.value)} style={{ width: '100%', padding: '10px', border: `1px solid var(--local-border)`, borderRadius: '10px', backgroundColor: 'var(--local-input-bg)', color: 'var(--local-text)', textAlign: isNameCol ? 'left' : 'right', boxSizing: 'border-box' }} />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="margin-pagination" aria-label="페이지 네비게이션" style={{ display: 'flex', justifyContent: 'center', gap: isMobile ? '6px' : '8px', marginTop: '16px', flexWrap: 'wrap', paddingBottom: '12px', width: '100%' }}>
              <button className="margin-pagination-btn" onClick={() => setCurrentPage(startPage - 1)} disabled={startPage === 1} style={{ flexShrink: 0, whiteSpace: 'nowrap', background: 'var(--local-input-bg)', color: 'var(--local-text)', border: `1px solid var(--local-border)`, borderRadius: '6px', padding: isMobile ? '6px 10px' : '8px 14px', fontSize: isMobile ? '12px' : '14px', cursor: 'pointer', opacity: startPage === 1 ? 0.5 : 1 }}>◀ 이전</button>
              {pages.map(number => (
                <button key={number} className={`margin-page-number ${currentPage === number ? 'active' : ''}`} onClick={() => setCurrentPage(number)} style={{ flexShrink: 0, background: currentPage === number ? '#2f6bff' : 'var(--local-input-bg)', color: currentPage === number ? '#fff' : 'var(--local-text)', border: `1px solid var(--local-border)`, borderRadius: '6px', padding: isMobile ? '6px 10px' : '8px 14px', fontSize: isMobile ? '12px' : '14px', cursor: 'pointer', fontWeight: currentPage === number ? 'bold' : 'normal', minWidth: isMobile ? '32px' : '40px' }}>{number}</button>
              ))}
              <button className="margin-pagination-btn" onClick={() => setCurrentPage(endPage + 1)} disabled={endPage === totalPages} style={{ flexShrink: 0, whiteSpace: 'nowrap', background: 'var(--local-input-bg)', color: 'var(--local-text)', border: `1px solid var(--local-border)`, borderRadius: '6px', padding: isMobile ? '6px 10px' : '8px 14px', fontSize: isMobile ? '12px' : '14px', cursor: 'pointer', opacity: endPage === totalPages ? 0.5 : 1 }}>다음 ▶</button>
            </div>

            <h3 style={{ marginTop: '28px', color: 'var(--local-text)', borderTop: `1px solid var(--local-border)`, paddingTop: '14px', fontSize: '14px', fontWeight: 750 }}>🛍️ 2. 플랫폼별 최종 판매가</h3>
            <div className="responsive-overflow" style={{ overflowX: 'auto', paddingBottom: '10px', minHeight: '480px', background: 'var(--local-box)', borderRadius: '12px' }}>
              <table border="0" style={{ tableLayout: 'fixed', width: '100%', minWidth: '700px', borderCollapse: 'collapse', textAlign: 'right', whiteSpace: 'nowrap' }}>
                <thead style={{ textAlign: 'center' }}>
                  <tr>
                    {summaryColumns.map(col => (
                      <th key={col} style={{ padding: '12px', backgroundColor: getPlatformColor(col), width: col.includes('상품명') ? '220px' : '100px', borderBottom: `1px solid var(--local-border)`, fontSize: '12px' }}>{formatHeader(col)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {currentSummaryItems.length > 0 ? currentSummaryItems.map((row, idx) => {
                    const marginInfo = getMarginInfo(currentFullItems[idx]);
                    return (
                    <tr key={idx} style={{ borderBottom: `1px solid var(--local-border)`, backgroundColor: marginInfo.isLow ? (isLight ? 'rgba(255,77,79,0.05)' : 'rgba(255,77,79,0.04)') : 'transparent' }}>
                      {summaryColumns.map((col, i) => {
                        const isNameCol = col.includes('상품명');
                        const platformLabel = col.replace(' 판매가', '');
                        const rate = !isNameCol ? marginInfo.rates[platformLabel] : null;
                        const isLowCell = rate !== null && rate !== undefined && rate < marginThreshold;
                        return (
                          <td key={i} style={{ padding: '12px', color: isLight ? '#111827' : 'white', backgroundColor: isNameCol ? 'transparent' : getPlatformColor(col), textAlign: isNameCol ? 'left' : 'right', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '13px' }}>
                            {isNameCol ? (
                              row[col] || ''
                            ) : (
                              <>
                                {typeof row[col] === 'number' ? row[col].toLocaleString() + '원' : (row[col] || "0원")}
                                {rate !== null && rate !== undefined && (
                                  <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 'bold', color: isLowCell ? '#ff4d4f' : (isLight ? '#16a34a' : '#4ade80') }}>
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
                    <tr><td colSpan={summaryColumns.length} style={{ padding: '30px', textAlign: 'center', color: 'gray' }}>데이터가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

          </div>
        ) : (
          !isCalculating && <div style={{ textAlign: 'center', padding: '40px' }}><p>{loadMsg}</p></div>
        )}
      </div>
    </div>
  );
}