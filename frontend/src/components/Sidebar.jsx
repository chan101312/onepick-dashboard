import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Emoji, Calculator as CalculatorIcon, SearchIcon, StarIcon } from './Icons';

const FAVORITES_KEY = 'onepick_favorite_menus';

export const NAV_ITEMS = [
  { key: 'margin', label: '마진 산출 장부', icon: '📊', group: 'sales' },
  { key: 'ranking', label: '플랫폼 TOP 5 랭킹', icon: '🏆', group: 'sales' },
  { key: 'sales_decline', label: '판매둔화', icon: '📉', group: 'sales' },
  { key: 'sales_surge', label: '판매급증', icon: '📈', group: 'sales' },

  { key: 'reorder_alerts', label: '재발주', icon: '🔔', group: 'stock' },
  { key: 'stock_reconcile', label: '재고 정확성', icon: '🧮', group: 'stock' },
  { key: 'deadstock_promotion', label: '재고 처분 추천', icon: '🏷️', group: 'stock' },
  { key: 'surge_channel_expansion', label: '채널 확장 추천', icon: '🚀', group: 'stock' },

  { key: 'todo_list', label: '오늘 할 일', icon: '✅', group: 'tools' },
  { key: 'memo', label: '메모장', icon: '📝', group: 'tools' },
  { key: 'product_mapping', label: '상품명 매핑', icon: '🔗', group: 'tools' },
];

export const ESANGIN_ITEMS = [
  { key: 'esangin_stock', label: '재고 파악', icon: '📦' },
  { key: 'esangin_deadstock', label: '악성 재고', icon: '🔥' },
];

const GROUP_IDS = ['sales', 'stock', 'tools'];
const ALL_ITEMS = [...NAV_ITEMS, ...ESANGIN_ITEMS];

function loadFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

// ====================================================
// 🧮 찐 일반 계산기 (사이드바용 + 키보드 완벽 지원)
// ====================================================
function SidebarCalculator() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

      const key = e.key;
      if (/[0-9+\-*/]/.test(key)) {
        e.preventDefault();
        handleClick(key);
      }
      else if (key === 'Enter' || key === '=') {
        e.preventDefault();
        handleClick('=');
      }
      else if (key === 'Escape' || key.toLowerCase() === 'c') {
        e.preventDefault();
        handleClick('C');
      }
      else if (key === 'Backspace') {
        e.preventDefault();
        handleClick('DEL');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleClick = (val) => {
    setInput(prev => {
      if (val === 'C') return '';
      if (val === 'DEL') return prev === 'Error' ? '' : prev.slice(0, -1);
      if (val === '=') {
        try {
          // eslint-disable-next-line
          const result = new Function('return ' + prev)();
          return String(Math.round(result * 100) / 100);
        } catch (e) {
          return 'Error';
        }
      }
      if (prev === 'Error') return val;
      return prev + val;
    });
  };

  const btns = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', 'C', '0', '=', '+'];

  return (
    <div className="railCalcWrap">
      <button
        className={`railBtn ${isOpen ? 'railBtnActive' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="퀵 계산기"
      >
        <CalculatorIcon size={20} />
      </button>

      {isOpen && createPortal(
        <>
          <div className="railBackdrop" onClick={() => setIsOpen(false)} />
          <div className="railCalcPanel">
            <input
              type="text"
              value={input}
              readOnly
              placeholder="0"
              className="railCalcInput"
            />
            <div className="railCalcGrid">
              {btns.map(b => (
                <button
                  key={b}
                  onClick={() => handleClick(b)}
                  className={`railCalcBtn ${b === 'C' ? 'railCalcBtnClear' : ''}`}
                >
                  {b}
                </button>
              ))}
            </div>
            <p className="railCalcHint">⌨️ 키보드 넘패드 지원!</p>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

function Sidebar({ activeTab, setActiveTab, reorderUrgentCount }) {
  const [favorites, setFavorites] = useState(loadFavorites);
  const [hover, setHover] = useState(null); // { type: 'leaf'|'group', key, top, label }
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTop, setSearchTop] = useState(0);
  const [query, setQuery] = useState('');
  const hoverTimeout = useRef(null);

  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  const toggleFavorite = (key) => {
    setFavorites(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const openHover = (data) => {
    if (hoverTimeout.current) {
      clearTimeout(hoverTimeout.current);
      hoverTimeout.current = null;
    }
    setHover(data);
  };
  const closeHoverSoon = () => {
    hoverTimeout.current = setTimeout(() => setHover(null), 150);
  };

  const navigate = (key) => {
    setActiveTab(key);
    setSearchOpen(false);
    setQuery('');
    setHover(null);
  };

  const handleSearchToggle = (e) => {
    if (searchOpen) {
      setSearchOpen(false);
      return;
    }
    setSearchTop(e.currentTarget.getBoundingClientRect().top);
    setSearchOpen(true);
  };

  const filteredResults = query.trim()
    ? ALL_ITEMS.filter((i) => i.label.includes(query.trim()))
    : ALL_ITEMS;

  const favoriteItems = ALL_ITEMS.filter((i) => favorites.includes(i.key));

  const renderRailButton = (item) => (
    <button
      key={item.key}
      className={`railBtn ${activeTab === item.key ? 'railBtnActive' : ''}`}
      onClick={() => navigate(item.key)}
      onMouseEnter={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        openHover({ type: 'leaf', key: item.key, top: rect.top + rect.height / 2, label: item.label });
      }}
      onMouseLeave={closeHoverSoon}
    >
      <Emoji size={20}>{item.icon}</Emoji>
      {item.key === 'reorder_alerts' && reorderUrgentCount > 0 && (
        <span className="railBadge">{reorderUrgentCount}</span>
      )}
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="railBrand">
        <div className="brandLogo">O</div>
      </div>

      <div className="mobileTabSelector">
        <select
          value={activeTab}
          onChange={(e) => setActiveTab(e.target.value)}
        >
          <optgroup label="메인 메뉴">
            {NAV_ITEMS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.icon} {item.label}
                {item.key === 'reorder_alerts' && reorderUrgentCount > 0 ? ` 🔴${reorderUrgentCount}` : ''}
              </option>
            ))}
          </optgroup>
          <optgroup label="E상인 통합 관리">
            {ESANGIN_ITEMS.map((item) => (
              <option key={item.key} value={item.key}>{item.icon} {item.label}</option>
            ))}
          </optgroup>
        </select>
      </div>

      <nav className="railNav">
        <button className="railBtn" onClick={handleSearchToggle} aria-label="메뉴 검색">
          <SearchIcon size={20} />
        </button>

        {favoriteItems.length > 0 && (
          <>
            <div className="railGroup">
              {favoriteItems.map(renderRailButton)}
            </div>
            <div className="railDivider" />
          </>
        )}

        {GROUP_IDS.map((groupId) => (
          <div key={groupId}>
            <div className="railGroup">
              {NAV_ITEMS.filter((i) => i.group === groupId).map(renderRailButton)}
            </div>
            <div className="railDivider" />
          </div>
        ))}

        <div className="railGroup">
          <button
            className={`railBtn ${activeTab.startsWith('esangin') ? 'railBtnActive' : ''}`}
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              openHover({ type: 'group', top: rect.top });
            }}
            onMouseLeave={closeHoverSoon}
            aria-label="E상인 통합 관리"
          >
            <Emoji size={20}>🦅</Emoji>
          </button>
        </div>

        <SidebarCalculator />
      </nav>

      {createPortal(
        <>
          {hover?.type === 'leaf' && (
            <div
              className="railTooltip"
              style={{ top: hover.top }}
              onMouseEnter={() => openHover(hover)}
              onMouseLeave={closeHoverSoon}
            >
              <span>{hover.label}</span>
              <button
                className="railStarBtn"
                onClick={() => toggleFavorite(hover.key)}
                aria-label="즐겨찾기 토글"
              >
                <StarIcon size={14} fill={favorites.includes(hover.key) ? 'currentColor' : 'none'} />
              </button>
            </div>
          )}

          {hover?.type === 'group' && (
            <div
              className="railSubmenu"
              style={{ top: hover.top }}
              onMouseEnter={() => openHover(hover)}
              onMouseLeave={closeHoverSoon}
            >
              {ESANGIN_ITEMS.map((sub) => (
                <div key={sub.key} className="railSubmenuRow">
                  <button
                    className={`railSubmenuItem ${activeTab === sub.key ? 'railSubmenuItemActive' : ''}`}
                    onClick={() => navigate(sub.key)}
                  >
                    <Emoji size={16}>{sub.icon}</Emoji><span>{sub.label}</span>
                  </button>
                  <button
                    className="railStarBtn"
                    onClick={() => toggleFavorite(sub.key)}
                    aria-label="즐겨찾기 토글"
                  >
                    <StarIcon size={13} fill={favorites.includes(sub.key) ? 'currentColor' : 'none'} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {searchOpen && (
            <>
              <div className="railBackdrop" onClick={() => setSearchOpen(false)} />
              <div className="railSearchPanel" style={{ top: searchTop }}>
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setSearchOpen(false); }}
                  placeholder="메뉴 검색..."
                  className="railSearchInput"
                />
                <div className="railSearchResults">
                  {filteredResults.length === 0 && (
                    <div className="railSearchEmpty">검색 결과 없음</div>
                  )}
                  {filteredResults.map((item) => (
                    <button key={item.key} className="railSearchResultItem" onClick={() => navigate(item.key)}>
                      <Emoji size={16}>{item.icon}</Emoji><span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </>,
        document.body
      )}
    </aside>
  );
}

export default Sidebar;
