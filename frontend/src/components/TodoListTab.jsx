import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import { Emoji } from './Icons';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toDateStr(y, m, d) {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

function todayStr() {
  const t = new Date();
  return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
}

const NOTIFIED_KEY = 'onepick_todo_notified_date';

function alreadyNotifiedToday() {
  try {
    return localStorage.getItem(NOTIFIED_KEY) === todayStr();
  } catch {
    return false;
  }
}

function markNotifiedToday() {
  try {
    localStorage.setItem(NOTIFIED_KEY, todayStr());
  } catch {
    // localStorage 접근 실패는 무시 (알림만 매번 다시 뜨는 정도의 영향)
  }
}

export default function TodoListTab() {
  const [todos, setTodos] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-indexed
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [input, setInput] = useState('');

  // 퇴근 전 체크리스트 (불끄기, 문단속 등 매일 반복되는 고정 항목 — 날짜 바뀌면 자동으로 미체크 상태로 초기화)
  const [checklistItems, setChecklistItems] = useState([]);
  const [checklistDate, setChecklistDate] = useState('');
  const [checklistInput, setChecklistInput] = useState('');

  const fetchChecklist = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/checklist`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        setChecklistItems(result.items || []);
        setChecklistDate(result.date || '');
      }
    } catch (e) {
      console.error('체크리스트 조회 실패', e);
    }
  }, []);

  useEffect(() => {
    fetchChecklist();
  }, [fetchChecklist]);

  const toggleChecklistItem = async (item) => {
    const nextDone = !item.done;
    setChecklistItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: nextDone } : i)));
    try {
      await fetch(`${API_BASE}/api/checklist/toggle`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, done: nextDone }),
      });
    } catch (e) {
      console.error('체크리스트 상태 변경 실패', e);
    }
  };

  const addChecklistItem = async () => {
    const text = checklistInput.trim();
    if (!text) return;
    try {
      const res = await fetch(`${API_BASE}/api/checklist/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.status === 'success') {
        setChecklistItems((prev) => [...prev, { ...result.data, done: false }]);
        setChecklistInput('');
      }
    } catch (e) {
      console.error('체크리스트 항목 추가 실패', e);
    }
  };

  const deleteChecklistItem = async (itemId) => {
    try {
      const res = await fetch(`${API_BASE}/api/checklist/items/${itemId}`, { method: 'DELETE' });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.status === 'success') {
        setChecklistItems((prev) => prev.filter((i) => i.id !== itemId));
      }
    } catch (e) {
      console.error('체크리스트 항목 삭제 실패', e);
    }
  };

  const fetchTodos = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/todos`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        setTodos(result.data || []);
        setErrorMsg('');
      } else {
        setErrorMsg(result.message || '할 일을 불러오지 못했습니다.');
      }
    } catch (e) {
      setErrorMsg('서버에 연결할 수 없습니다.');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  // 오늘 마감인 미완료 할 일이 있으면 브라우저 데스크톱 알림으로 알려준다.
  // 대시보드 화면이 열려 있을 때만 동작하고, 새로고침마다 반복되지 않도록 하루 한 번만 띄운다.
  useEffect(() => {
    if (todos.length === 0) return;
    if (typeof Notification === 'undefined') return;
    if (alreadyNotifiedToday()) return;

    const todayTodos = todos.filter((t) => t.due_date === todayStr() && !t.done);
    if (todayTodos.length === 0) return;

    const showNotification = () => {
      const body = todayTodos.length === 1
        ? todayTodos[0].text
        : `${todayTodos.map((t) => t.text).slice(0, 3).join(', ')}${todayTodos.length > 3 ? ` 외 ${todayTodos.length - 3}건` : ''}`;
      new Notification(`오늘 할 일 ${todayTodos.length}건`, { body });
      markNotifiedToday();
    };

    if (Notification.permission === 'granted') {
      showNotification();
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') showNotification();
      });
    }
  }, [todos]);

  const addTodo = async () => {
    const text = input.trim();
    if (!text) return;
    try {
      const res = await fetch(`${API_BASE}/api/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, due_date: selectedDate }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.status === 'success') {
        setTodos((prev) => [...prev, result.data]);
        setInput('');
      } else {
        alert(`추가 실패: ${result.message || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert(`추가 실패: 서버에 연결할 수 없습니다. (${e.message})`);
    }
  };

  const toggleTodo = async (todo) => {
    try {
      const res = await fetch(`${API_BASE}/api/todos/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: !todo.done }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.status === 'success') {
        setTodos((prev) => prev.map((t) => (t.id === todo.id ? result.data : t)));
      }
    } catch (e) {
      console.error('할 일 상태 변경 실패', e);
    }
  };

  const deleteTodo = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/api/todos/${id}`, { method: 'DELETE' });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.status === 'success') {
        setTodos((prev) => prev.filter((t) => t.id !== id));
      } else {
        alert(`삭제 실패: ${result.message || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert(`삭제 실패: 서버에 연결할 수 없습니다. (${e.message})`);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') addTodo();
  };

  // 달력에 표시할 날짜별 할 일 개수/완료여부 집계
  const todosByDate = todos.reduce((acc, t) => {
    (acc[t.due_date] = acc[t.due_date] || []).push(t);
    return acc;
  }, {});

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = firstOfMonth.getDay(); // 0=일
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const calendarCells = [];
  for (let i = 0; i < startWeekday; i++) calendarCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarCells.push(d);

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };
  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };
  const goToday = () => {
    const t = new Date();
    setViewYear(t.getFullYear());
    setViewMonth(t.getMonth());
    setSelectedDate(todayStr());
  };

  const selectedTodos = (todosByDate[selectedDate] || []).sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));

  return (
    <div className="responsive-container">
      {errorMsg && (
        <div style={{
          marginBottom: '16px', padding: '12px 16px', borderRadius: '10px',
          background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 35%, transparent)',
          color: 'var(--amber)', fontSize: '13px', fontWeight: 600,
        }}>
          <Emoji>⚠️</Emoji> {errorMsg}
        </div>
      )}

      {checklistDate && (
        <div style={{
          marginBottom: '20px', padding: '16px', borderRadius: '12px',
          background: 'var(--surface)', border: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <span style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text)' }}>
              <Emoji>🔒</Emoji> 퇴근 전 체크리스트 {checklistDate ? `(${checklistDate})` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
            {checklistItems.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '12px 14px', borderRadius: '8px', background: 'var(--surface-2)',
                  flex: '0 1 auto', whiteSpace: 'nowrap',
                }}
              >
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => toggleChecklistItem(item)}
                  style={{ width: '22px', height: '22px', cursor: 'pointer', flexShrink: 0 }}
                />
                <span style={{
                  fontSize: '17px', color: item.done ? 'var(--text-3)' : 'var(--text)',
                  textDecoration: item.done ? 'line-through' : 'none',
                }}>
                  {item.text}
                </span>
                <button
                  onClick={() => deleteChecklistItem(item.id)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}
                  title="이 항목 삭제 (매일 목록에서 제거됩니다)"
                >
                  <Emoji>✕</Emoji>
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={checklistInput}
              onChange={(e) => setChecklistInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addChecklistItem(); }}
              placeholder="매일 반복할 항목 추가 (예: 가스 밸브 잠그기)"
              style={{
                flex: 1, padding: '10px 12px', borderRadius: '8px',
                border: '1px solid var(--border)', background: 'rgba(255,255,255,0.04)',
                color: 'var(--text)', fontSize: '15px', outline: 'none',
              }}
            />
            <button onClick={addChecklistItem} className="esangin-btn" style={{ padding: '10px 16px', fontSize: '15px' }}>추가</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        {/* 캘린더 */}
        <div style={{ flex: '1 1 380px', minWidth: '320px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <button onClick={goPrevMonth} className="esangin-btn" style={{ padding: '6px 12px' }}>◀</button>
            <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>
              {viewYear}년 {viewMonth + 1}월
            </div>
            <button onClick={goNextMonth} className="esangin-btn" style={{ padding: '6px 12px' }}>▶</button>
          </div>

          <div style={{ textAlign: 'right', marginBottom: '10px' }}>
            <button
              onClick={goToday}
              style={{
                background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-3)',
                borderRadius: '8px', padding: '5px 12px', fontSize: '12px', cursor: 'pointer',
              }}
            >
              오늘로 이동
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '6px' }}>
            {WEEKDAYS.map((w, i) => (
              <div
                key={w}
                style={{
                  textAlign: 'center', fontSize: '12px', fontWeight: 700, padding: '6px 0',
                  color: i === 0 ? 'var(--danger)' : i === 6 ? 'var(--accent)' : 'var(--text-3)',
                }}
              >
                {w}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
            {calendarCells.map((d, idx) => {
              if (d === null) return <div key={`empty-${idx}`} />;
              const dateStr = toDateStr(viewYear, viewMonth, d);
              const dayTodos = todosByDate[dateStr] || [];
              const doneCount = dayTodos.filter((t) => t.done).length;
              const isSelected = dateStr === selectedDate;
              const isToday = dateStr === todayStr();
              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(dateStr)}
                  style={{
                    minHeight: '58px', borderRadius: '8px', padding: '6px 4px', cursor: 'pointer',
                    background: isSelected ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--surface)',
                    border: isSelected ? '1px solid var(--accent)' : isToday ? '1px solid var(--border-2)' : '1px solid var(--border)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                  }}
                >
                  <span style={{ fontSize: '13px', fontWeight: isToday ? 800 : 500, color: isToday ? 'var(--accent)' : 'var(--text)' }}>
                    {d}
                  </span>
                  {dayTodos.length > 0 && (
                    <span style={{
                      fontSize: '10px', padding: '1px 6px', borderRadius: '999px',
                      background: doneCount === dayTodos.length ? 'color-mix(in srgb, var(--success) 18%, transparent)' : 'color-mix(in srgb, var(--danger) 18%, transparent)',
                      color: doneCount === dayTodos.length ? 'var(--success)' : 'var(--danger)', fontWeight: 700,
                    }}>
                      {doneCount}/{dayTodos.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 선택한 날짜의 할 일 목록 */}
        <div style={{ flex: '1 1 300px', minWidth: '280px' }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)', marginBottom: '12px' }}>
            {selectedDate} 할 일
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="할 일을 입력하고 Enter"
              style={{
                flex: 1, padding: '10px 12px', borderRadius: '10px',
                border: '1px solid var(--border)', background: 'rgba(255,255,255,0.04)',
                color: 'var(--text)', fontSize: '14px', outline: 'none',
              }}
            />
            <button onClick={addTodo} className="esangin-btn">추가</button>
          </div>

          {isLoading ? (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
              불러오는 중...
            </div>
          ) : selectedTodos.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
              이 날짜에 등록된 할 일이 없습니다.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {selectedTodos.map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    background: t.done ? 'var(--surface-2)' : 'var(--surface)',
                    border: '1px solid var(--border)', borderRadius: '10px', padding: '10px 12px',
                    opacity: t.done ? 0.6 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={t.done}
                    onChange={() => toggleTodo(t)}
                    style={{ width: '17px', height: '17px', cursor: 'pointer', flexShrink: 0 }}
                  />
                  <span style={{
                    flex: 1, fontSize: '14px', color: t.done ? 'var(--text-3)' : 'var(--text)',
                    textDecoration: t.done ? 'line-through' : 'none',
                  }}>
                    {t.text}
                  </span>
                  <button
                    onClick={() => deleteTodo(t.id)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}
                    title="삭제 (서버에서도 삭제됩니다)"
                  >
                    <Emoji>✕</Emoji>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}