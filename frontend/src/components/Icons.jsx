// SVG 아이콘 라이브러리 — 이모지 아이콘을 대체하는 B2B 대시보드용 스트로크 아이콘 세트.
// 사용법: <Emoji>🔥</Emoji> 처럼 감싸면 매핑된 SVG로 렌더링되고, 매핑이 없으면 원래 문자를 그대로 출력한다.
function Svg({ children, size = 16, className, style, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, verticalAlign: '-2px', ...style }}
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Bulb = (p) => <Svg {...p}><path d="M9 18h6M10 22h4M12 2a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 2Z" /></Svg>;
export const Calculator = (p) => <Svg {...p}><rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" /><line x1="8" y1="10" x2="8" y2="10" /><line x1="12" y1="10" x2="12" y2="10" /><line x1="16" y1="10" x2="16" y2="10" /><line x1="8" y1="14" x2="8" y2="14" /><line x1="12" y1="14" x2="12" y2="14" /><line x1="16" y1="14" x2="16" y2="18" /><line x1="8" y1="18" x2="8" y2="18" /><line x1="12" y1="18" x2="12" y2="18" /></Svg>;
export const BarChart = (p) => <Svg {...p}><line x1="4" y1="20" x2="20" y2="20" /><rect x="6" y="12" width="3" height="8" /><rect x="10.5" y="7" width="3" height="13" /><rect x="15" y="4" width="3" height="16" /></Svg>;
export const Trophy = (p) => <Svg {...p}><path d="M8 3h8v5a4 4 0 0 1-8 0V3Z" /><path d="M8 4H4v2a4 4 0 0 0 4 4" /><path d="M16 4h4v2a4 4 0 0 1-4 4" /><line x1="12" y1="12" x2="12" y2="17" /><path d="M8 21h8" /><path d="M10 17h4l1 4H9l1-4Z" /></Svg>;
export const Bell = (p) => <Svg {...p}><path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z" /><path d="M10 20a2 2 0 0 0 4 0" /></Svg>;
export const TrendDown = (p) => <Svg {...p}><polyline points="4 8 10 14 13 11 20 18" /><polyline points="20 11 20 18 13 18" /></Svg>;
export const TrendUp = (p) => <Svg {...p}><polyline points="4 17 10 11 13 14 20 6" /><polyline points="14 6 20 6 20 12" /></Svg>;
export const Clipboard = (p) => <Svg {...p}><rect x="6" y="4" width="12" height="17" rx="2" /><rect x="9" y="2" width="6" height="4" rx="1" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="15" y2="16" /></Svg>;
export const CheckCircle = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><polyline points="8 12.5 11 15.5 16 9" /></Svg>;
export const LinkIcon = (p) => <Svg {...p}><path d="M9 15 15 9" /><path d="M11 6 13 4a4 4 0 1 1 6 6l-2 2" /><path d="M13 18 11 20a4 4 0 1 1-6-6l2-2" /></Svg>;
export const Edit = (p) => <Svg {...p}><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" /><line x1="13" y1="6.5" x2="17.5" y2="11" /></Svg>;
export const Package = (p) => <Svg {...p}><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /><path d="m3.3 7 8.7-5 8.7 5v10l-8.7 5-8.7-5V7Z" /></Svg>;
export const Flame = (p) => <Svg {...p}><path d="M12 22c4 0 6.5-2.6 6.5-6.2 0-2.6-1.4-4-2.3-5.6-.4 1.5-1.2 2.3-2 2.3.4-2.7-.7-5.4-3-7-.2 2.3-1 3.6-2.4 5C7.2 12 6 13.7 6 15.8 6 19.4 8 22 12 22Z" /></Svg>;
export const Dot = ({ tone = 'red', ...p }) => {
  const colors = { red: 'var(--danger)', green: 'var(--success)', yellow: '#facc15', orange: 'var(--amber)' };
  return <Svg {...p}><circle cx="12" cy="12" r="7" fill={colors[tone] || colors.red} stroke="none" /></Svg>;
};
export const StoreBadge = (p) => <Svg {...p}><path d="M4 9V4h16v5" /><path d="M4 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" /><path d="M5 9v11h14V9" /><path d="M10 20v-6h4v6" /></Svg>;
export const Sun = (p) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>;
export const Moon = (p) => <Svg {...p}><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" /></Svg>;
export const Warning = (p) => <Svg {...p}><path d="M12 3 2 20h20L12 3Z" /><line x1="12" y1="10" x2="12" y2="14.5" /><line x1="12" y1="17" x2="12" y2="17" /></Svg>;
export const Refresh = (p) => <Svg {...p}><path d="M4 12a8 8 0 0 1 14-5.3L20 9" /><polyline points="20 4 20 9 15 9" /><path d="M20 12a8 8 0 0 1-14 5.3L4 15" /><polyline points="4 20 4 15 9 15" /></Svg>;
export const Crown = (p) => <Svg {...p}><path d="m3 17 1.5-9L9 12l3-7 3 7 4.5-4L21 17H3Z" /><line x1="4" y1="20" x2="20" y2="20" /></Svg>;
export const Sparkles = (p) => <Svg {...p}><path d="M12 3v5M12 16v5M4.5 10h5M14.5 10h5M6 5l2 2M16 15l2 2M18 5l-2 2M8 15l-2 2" /></Svg>;
export const Siren = (p) => <Svg {...p}><path d="M12 3v3" /><path d="M5 12a7 7 0 0 1 14 0v6H5v-6Z" /><line x1="3" y1="21" x2="21" y2="21" /><line x1="4" y1="15" x2="6" y2="15" /><line x1="18" y1="15" x2="20" y2="15" /></Svg>;
export const Brain = (p) => <Svg {...p}><path d="M9 3a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3.5 3.5 0 0 0 2 6.4V19a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M15 3a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3.5 3.5 0 0 1-2 6.4V19a3 3 0 0 1-6 0" /></Svg>;
export const Star = (p) => <Svg {...p}><path d="m12 3 2.7 5.9 6.3.7-4.7 4.4 1.3 6.3L12 17.2 6.4 20.3l1.3-6.3-4.7-4.4 6.3-.7L12 3Z" /></Svg>;
export const Cart = (p) => <Svg {...p}><circle cx="10" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h2l2.2 12.4a2 2 0 0 0 2 1.6h9.1a2 2 0 0 0 2-1.6L21 7H6" /></Svg>;
export const Rocket = (p) => <Svg {...p}><path d="M13 3c3 1 6 4 7 7-3 0-6.5 1.5-9 4-1.5-1.5-2-3-1-5 1-2.2 2-4.5 3-6Z" /><path d="M8 14l-4 4 1-5" /><circle cx="15" cy="9" r="1.3" fill="currentColor" stroke="none" /></Svg>;
export const XCircle = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" /></Svg>;
export const Calendar = (p) => <Svg {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" /></Svg>;
export const Target = (p) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /></Svg>;
export const Search = (p) => <Svg {...p}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.2" y2="16.2" /></Svg>;
export const Ban = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><line x1="5.6" y1="5.6" x2="18.4" y2="18.4" /></Svg>;
export const Bike = (p) => <Svg {...p}><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M6 17 10 9h5l3 5" /><path d="M10 9h6" /><path d="M13 17H9" /></Svg>;
export const Leaf = (p) => <Svg {...p}><path d="M5 14C5 7 10 3 20 3c0 10-4 15-11 15" /><path d="M5 14c0 4 3 7 7 7" /></Svg>;
export const Megaphone = (p) => <Svg {...p}><path d="M3 10v4h3l6 4V6l-6 4H3Z" /><path d="M15 9a3.5 3.5 0 0 1 0 6" /><path d="M18 6a7 7 0 0 1 0 12" /></Svg>;
export const Broom = (p) => <Svg {...p}><path d="m19 4-8.5 8.5" /><path d="M13.5 10 5 15c-1.5 1.5-2 3-2 5 2 0 3.5-.5 5-2l5-8.5" /><path d="M9 15l-3 3" /></Svg>;
export const Download = (p) => <Svg {...p}><path d="M12 3v13" /><polyline points="7 11 12 16 17 11" /><path d="M4 19h16" /></Svg>;
export const FileText = (p) => <Svg {...p}><path d="M7 3h7l4 4v14H7Z" /><path d="M14 3v4h4" /><line x1="9.5" y1="12" x2="14.5" y2="12" /><line x1="9.5" y1="16" x2="14.5" y2="16" /></Svg>;
export const Zap = (p) => <Svg {...p}><polygon points="13 2 4 14 11 14 10 22 20 9 13 9 13 2" /></Svg>;
export const Wallet = (p) => <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3" /><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-4a2.5 2.5 0 0 1 0-5h4" /><circle cx="16" cy="14" r="1" fill="currentColor" stroke="none" /></Svg>;
export const TypeIcon = (p) => <Svg {...p}><line x1="5" y1="5" x2="19" y2="5" /><line x1="12" y1="5" x2="12" y2="19" /><line x1="8" y1="19" x2="16" y2="19" /></Svg>;
export const Banknote = (p) => <Svg {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /><line x1="6" y1="10" x2="6" y2="10" /><line x1="18" y1="14" x2="18" y2="14" /></Svg>;
export const Plus = (p) => <Svg {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Svg>;
export const Save = (p) => <Svg {...p}><path d="M5 3h12l4 4v14H5Z" /><path d="M8 3v6h8V3" /><path d="M7 21v-8h10v8" /></Svg>;
export const Trash = (p) => <Svg {...p}><line x1="4" y1="7" x2="20" y2="7" /><path d="M6 7l1 14h10l1-14" /><path d="M10 11v6M14 11v6" /><path d="M9 7V4h6v3" /></Svg>;
export const ShoppingBag = (p) => <Svg {...p}><path d="M6 8h12l-1 13H7L6 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></Svg>;
export const Turtle = (p) => <Svg {...p}><path d="M8 10a5 5 0 0 1 9-3l2-1v3l-1.5 1a5 5 0 0 1-1.5 6l1 3h-3l-.5-2a6 6 0 0 1-4 0l-.5 2H5l1-3a5 5 0 0 1-1-3H3v-2h2a5 5 0 0 1 3-3Z" /><circle cx="16.5" cy="8" r="0.6" fill="currentColor" stroke="none" /></Svg>;
export const Shuffle = (p) => <Svg {...p}><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></Svg>;
export const XMark = (p) => <Svg {...p}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></Svg>;
export const Lock = (p) => <Svg {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>;
export const Archive = (p) => <Svg {...p}><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><line x1="10" y1="12" x2="14" y2="12" /></Svg>;
export const Receipt = (p) => <Svg {...p}><path d="M6 2h12v20l-2.5-1.5L13 22l-2.5-1.5L8 22l-2-1.5V2Z" /><line x1="9" y1="7" x2="15" y2="7" /><line x1="9" y1="11" x2="15" y2="11" /><line x1="9" y1="15" x2="12.5" y2="15" /></Svg>;
export const Eagle = (p) => <Svg {...p}><path d="M12 3c1 2 3 3 5 3-1 2-3 3-5 3-2 0-4-1-5-3 2 0 4-1 5-3Z" /><path d="M12 9v5l-6 5 2-7-3-2 5-1" /><path d="M12 14l6 5-2-7 3-2-5-1" /></Svg>;
export const Hourglass = (p) => <Svg {...p}><path d="M6 2h12M6 22h12" /><path d="M8 2v4a4 4 0 0 0 8 0V2" /><path d="M8 22v-4a4 4 0 0 1 8 0v4" /></Svg>;

export const EMOJI_ICON_MAP = {
  '💡': Bulb, '🧮': Calculator, '📊': BarChart, '🏆': Trophy, '🔔': Bell,
  '📉': TrendDown, '📈': TrendUp, '📋': Clipboard, '✅': CheckCircle, '🔗': LinkIcon,
  '📝': Edit, '📦': Package, '🔥': Flame, '🔴': (p) => <Dot tone="red" {...p} />,
  '🟢': (p) => <Dot tone="green" {...p} />, '🟡': (p) => <Dot tone="yellow" {...p} />, '🟠': (p) => <Dot tone="orange" {...p} />,
  '🦅': Eagle, '☀': Sun, '🗒': Edit, '⚠': Warning, '🔄': Refresh,
  '👑': Crown, '🎉': Sparkles, '🚨': Siren, '🧠': Brain, '🌟': Star,
  '🛒': Cart, '🚀': Rocket, '❌': XCircle, '📅': Calendar, '🎯': Target,
  '🔍': Search, '🚫': Ban, '🛵': Bike, '🥬': Leaf, '📢': Megaphone,
  '🧹': Broom, '📥': Download, '📄': FileText, '⚡': Zap, '💰': Wallet,
  '🔤': TypeIcon, '🔡': TypeIcon, '💸': Banknote, '➕': Plus, '💾': Save,
  '🗑': Trash, '🛍': ShoppingBag, '🐢': Turtle, '🍢': Shuffle, '✕': XMark,
  '🔒': Lock, '🗂': Archive, '🧾': Receipt, '🆕': Sparkles, '✨': Sparkles, '⏳': Hourglass,
};
// 🌙만 별도 등록 (달 이모지, U+1F319 변형 방지 위해 명시적으로 마지막에 지정)
EMOJI_ICON_MAP['🌙'] = Moon;

/**
 * 이모지 문자를 감싸면 매핑된 SVG 아이콘으로 렌더링한다.
 * 매핑이 없는 문자는 원래 텍스트를 그대로 반환해 데이터/로직에 영향을 주지 않는다.
 */
export function Emoji({ children, size = 16, className, style }) {
  const VARIATION_SELECTOR_16 = String.fromCodePoint(0xfe0f);
  const key = typeof children === 'string' && children.endsWith(VARIATION_SELECTOR_16)
    ? children.slice(0, -1)
    : children;
  const Comp = EMOJI_ICON_MAP[key];
  if (!Comp) return children;
  return <Comp size={size} className={className} style={style} />;
}

const LEADING_EMOJI = /^(\p{Extended_Pictographic}️?)\s*/u;

/**
 * "🟢 스마트스토어 (네이버)"처럼 이모지가 데이터 문자열(맵 키 등) 맨 앞에 붙어있는 값을
 * 렌더링 지점에서만 SVG 아이콘 + 텍스트로 표시한다. 원본 문자열(키 비교 로직)은 건드리지 않는다.
 * 선행 이모지가 없으면 텍스트를 그대로 렌더링한다.
 */
export function EmojiText({ text, size = 16, className, style }) {
  if (typeof text !== 'string') return text;
  const m = text.match(LEADING_EMOJI);
  if (!m) return text;
  const rest = text.slice(m[0].length);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <Emoji size={size} className={className} style={style}>{m[1]}</Emoji>
      {rest}
    </span>
  );
}
