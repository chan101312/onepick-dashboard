// SVG 아이콘 라이브러리 — 이모지 아이콘을 대체하는 B2B 대시보드용 라인 아이콘 세트 (lucide-react 기반).
// 사용법: <Emoji>🔥</Emoji> 처럼 감싸면 매핑된 lucide 아이콘으로 렌더링되고, 매핑이 없으면 원래 문자를 그대로 출력한다.
import { createElement } from 'react';
import {
  Lightbulb, Calculator as LucideCalculator, BarChart3, Trophy, Bell, TrendingDown, TrendingUp,
  ClipboardList, CheckCircle2, Link2, NotebookPen, StickyNote, Package, Flame,
  Sun as LucideSun, Moon as LucideMoon, AlertTriangle, RefreshCw, Crown, Sparkles, Siren, Brain, Star,
  ShoppingCart, Rocket, XCircle, Calendar, Target, Search, Ban, Bike, Leaf, Megaphone, Eraser,
  Download, FileText, Zap, Wallet, Type, Banknote, Plus, Save, Trash2, ShoppingBag, Turtle,
  Shuffle, X, Lock, Archive, Receipt, Store, Hourglass, Tag,
} from 'lucide-react';

// lucide 컴포넌트를 기존 커스텀 Svg와 동일한 기본값(size, strokeWidth, 정렬)으로 감싼다.
function wrap(LucideComp) {
  return function WrappedIcon({ size = 16, className, style, ...rest }) {
    return createElement(LucideComp, {
      size,
      strokeWidth: 1.75,
      className,
      style: { flexShrink: 0, verticalAlign: '-2px', ...style },
      'aria-hidden': true,
      ...rest,
    });
  };
}

export const Calculator = wrap(LucideCalculator);
export const Sun = wrap(LucideSun);
export const Moon = wrap(LucideMoon);
export const SearchIcon = wrap(Search);
export const StarIcon = wrap(Star);

// 상태 표시용 색점 (실선 아이콘이 아니라 채워진 원 — lucide로 대체하지 않고 유지)
export const Dot = ({ tone = 'red', size = 16, className, style, ...rest }) => {
  const colors = { red: 'var(--danger)', green: 'var(--success)', yellow: 'var(--highlight)', orange: 'var(--amber)' };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} style={{ flexShrink: 0, verticalAlign: '-2px', ...style }} aria-hidden="true" {...rest}>
      <circle cx="12" cy="12" r="7" fill={colors[tone] || colors.red} stroke="none" />
    </svg>
  );
};

export const EMOJI_ICON_MAP = {
  '💡': wrap(Lightbulb), '🧮': Calculator, '📊': wrap(BarChart3), '🏆': wrap(Trophy), '🔔': wrap(Bell),
  '📉': wrap(TrendingDown), '📈': wrap(TrendingUp), '📋': wrap(ClipboardList), '✅': wrap(CheckCircle2), '🔗': wrap(Link2),
  '📝': wrap(NotebookPen), '📦': wrap(Package), '🔥': wrap(Flame), '🔴': (p) => <Dot tone="red" {...p} />,
  '🟢': (p) => <Dot tone="green" {...p} />, '🟡': (p) => <Dot tone="yellow" {...p} />, '🟠': (p) => <Dot tone="orange" {...p} />,
  '🦅': wrap(Store), '☀': Sun, '🗒': wrap(StickyNote), '⚠': wrap(AlertTriangle), '🔄': wrap(RefreshCw),
  '👑': wrap(Crown), '🎉': wrap(Sparkles), '🚨': wrap(Siren), '🧠': wrap(Brain), '🌟': wrap(Star),
  '🛒': wrap(ShoppingCart), '🚀': wrap(Rocket), '❌': wrap(XCircle), '📅': wrap(Calendar), '🎯': wrap(Target),
  '🔍': wrap(Search), '🚫': wrap(Ban), '🛵': wrap(Bike), '🥬': wrap(Leaf), '📢': wrap(Megaphone),
  '🧹': wrap(Eraser), '📥': wrap(Download), '📄': wrap(FileText), '⚡': wrap(Zap), '💰': wrap(Wallet),
  '🔤': wrap(Type), '🔡': wrap(Type), '💸': wrap(Banknote), '➕': wrap(Plus), '💾': wrap(Save),
  '🗑': wrap(Trash2), '🛍': wrap(ShoppingBag), '🐢': wrap(Turtle), '🍢': wrap(Shuffle), '✕': wrap(X),
  '🔒': wrap(Lock), '🗂': wrap(Archive), '🧾': wrap(Receipt), '🆕': wrap(Sparkles), '✨': wrap(Sparkles), '⏳': wrap(Hourglass),
  '🏷️': wrap(Tag), '🏷': wrap(Tag),
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
