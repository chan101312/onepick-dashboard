import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import { Emoji } from './Icons';

export default function MemoTab() {
  const [freeformText, setFreeformText] = useState('');
  const [savedFreeform, setSavedFreeform] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [memos, setMemos] = useState([]);
  const [newMemoText, setNewMemoText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const fetchFreeform = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/memos/freeform`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        setFreeformText(result.text || '');
        setSavedFreeform(result.text || '');
      }
    } catch (e) {
      console.error('자유메모 조회 실패', e);
    }
  }, []);

  const fetchMemos = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/memos`, {
        headers: { 'ngrok-skip-browser-warning': '69420' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        setMemos(result.data || []);
        setErrorMsg('');
      } else {
        setErrorMsg(result.message || '메모를 불러오지 못했습니다.');
      }
    } catch (e) {
      setErrorMsg('서버에 연결할 수 없습니다.');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchFreeform();
    fetchMemos();
  }, [fetchFreeform, fetchMemos]);

  const saveFreeform = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/memos/freeform`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: freeformText }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.status === 'success') {
        setSavedFreeform(freeformText);
        setSaveMsg('저장됐어요!');
        setTimeout(() => setSaveMsg(''), 2000);
      }
    } catch (e) {
      alert(`저장 실패: 서버에 연결할 수 없습니다. (${e.message})`);
    }
    setIsSaving(false);
  };

  const hasUnsaved = freeformText !== savedFreeform;

  const addMemo = async () => {
    const text = newMemoText.trim();
    if (!text) return;
    try {
      const res = await fetch(`${API_BASE}/api/memos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.status === 'success') {
        setMemos((prev) => [result.data, ...prev]);
        setNewMemoText('');
      } else {
        alert(`추가 실패: ${result.message || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert(`추가 실패: 서버에 연결할 수 없습니다. (${e.message})`);
    }
  };

  const startEdit = (memo) => {
    setEditingId(memo.id);
    setEditingText(memo.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText('');
  };

  const saveEdit = async (id) => {
    const text = editingText.trim();
    if (!text) return;
    try {
      const res = await fetch(`${API_BASE}/api/memos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.status === 'success') {
        setMemos((prev) => prev.map((m) => (m.id === id ? result.data : m)));
        cancelEdit();
      } else {
        alert(`저장 실패: ${result.message || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert(`저장 실패: 서버에 연결할 수 없습니다. (${e.message})`);
    }
  };

  const deleteMemo = async (id) => {
    if (!window.confirm('이 메모를 삭제할까요?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/memos/${id}`, { method: 'DELETE' });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.status === 'success') {
        setMemos((prev) => prev.filter((m) => m.id !== id));
      } else {
        alert(`삭제 실패: ${result.message || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert(`삭제 실패: 서버에 연결할 수 없습니다. (${e.message})`);
    }
  };

  const reorderMemos = async (orderedIds) => {
    const bodyStr = JSON.stringify({ ordered_ids: orderedIds });
    console.log('[MemoTab][debug] PUT /api/memos/reorder request body:', bodyStr);
    console.log('[MemoTab][debug] ordered_ids element types:', orderedIds.map((v) => typeof v));
    try {
      const res = await fetch(`${API_BASE}/api/memos/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
      });
      const result = await res.json().catch(() => ({}));
      console.log('[MemoTab][debug] reorder response status:', res.status, 'body:', result);
      if (!(res.ok && result.status === 'success')) {
        alert(`순서 저장 실패: ${result.message || '알 수 없는 오류'}`);
        fetchMemos();
      }
    } catch (e) {
      console.error('[MemoTab][debug] reorder fetch threw:', e);
      alert(`순서 저장 실패: 서버에 연결할 수 없습니다. (${e.message})`);
      fetchMemos();
    }
  };

  const handleDragStart = (id) => (e) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (id) => (e) => {
    e.preventDefault();
    if (dragOverId !== id) setDragOverId(id);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDrop = (targetId) => (e) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    const fromIdx = memos.findIndex((m) => m.id === draggedId);
    const toIdx = memos.findIndex((m) => m.id === targetId);
    if (fromIdx === -1 || toIdx === -1) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    const list = [...memos];
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    setMemos(list);
    setDraggedId(null);
    setDragOverId(null);
    reorderMemos(list.map((m) => m.id));
  };

  return (
    <div className="responsive-container">
      {/* 자유 메모장 */}
      <div style={{
        marginBottom: '24px', padding: '16px', borderRadius: '16px',
        background: 'var(--surface)', border: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}><Emoji>📝</Emoji> 자유 메모장</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {saveMsg && <span style={{ color: 'var(--success)', fontSize: '13px' }}>{saveMsg}</span>}
            <button
              onClick={saveFreeform}
              className="esangin-btn"
              disabled={isSaving || !hasUnsaved}
              style={{ padding: '6px 14px', fontSize: '13px', opacity: hasUnsaved ? 1 : 0.5 }}
            >
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
        <textarea
          value={freeformText}
          onChange={(e) => setFreeformText(e.target.value)}
          placeholder="자유롭게 메모를 남겨보세요..."
          style={{
            width: '100%', minHeight: '180px', padding: '12px', borderRadius: '16px',
            border: '1px solid var(--border)', background: 'var(--surface-2)',
            color: 'var(--text)', fontSize: '14px', lineHeight: 1.6, resize: 'vertical',
            outline: 'none', fontFamily: 'inherit',
          }}
        />
        {hasUnsaved && (
          <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '6px' }}>
            저장하지 않은 변경사항이 있어요.
          </div>
        )}
      </div>

      {/* 개별 메모 카드 */}
      <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', marginBottom: '12px' }}>
        <Emoji>🗒️</Emoji> 메모 카드
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input
          type="text"
          value={newMemoText}
          onChange={(e) => setNewMemoText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addMemo(); }}
          placeholder="새 메모 추가하고 Enter"
          style={{
            flex: 1, padding: '10px 12px', borderRadius: '16px',
            border: '1px solid var(--border)', background: 'var(--surface-2)',
            color: 'var(--text)', fontSize: '14px', outline: 'none',
          }}
        />
        <button onClick={addMemo} className="esangin-btn">추가</button>
      </div>

      {errorMsg && (
        <div style={{
          marginBottom: '16px', padding: '12px 16px', borderRadius: '16px',
          background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 35%, transparent)',
          color: 'var(--amber)', fontSize: '13px', fontWeight: 600,
        }}>
          <Emoji>⚠️</Emoji> {errorMsg}
        </div>
      )}

      {isLoading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
          불러오는 중...
        </div>
      ) : memos.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-3)', fontSize: '13px' }}>
          등록된 메모가 없습니다.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px', alignItems: 'start' }}>
          {memos.map((memo) => {
            const isDragging = draggedId === memo.id;
            const isDragOver = dragOverId === memo.id && draggedId !== null && draggedId !== memo.id;
            const canDrag = editingId !== memo.id;

            return (
              <div
                key={memo.id}
                className="ui-card"
                draggable={canDrag}
                onDragStart={handleDragStart(memo.id)}
                onDragOver={handleDragOver(memo.id)}
                onDrop={handleDrop(memo.id)}
                onDragEnd={handleDragEnd}
                style={{
                  background: 'var(--surface)',
                  border: isDragOver ? '2px dashed var(--accent)' : '1px solid var(--border)',
                  borderRadius: '16px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px',
                  opacity: isDragging ? 0.4 : 1,
                  cursor: canDrag ? 'grab' : 'default',
                  transition: 'opacity .15s, border-color .15s',
                }}
              >
                {editingId === memo.id ? (
                  <textarea
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    style={{
                      width: '100%', minHeight: '80px', padding: '8px', borderRadius: '8px',
                      border: '1px solid var(--border)', background: 'var(--surface-2)',
                      color: 'var(--text)', fontSize: '13px', outline: 'none', resize: 'vertical',
                      fontFamily: 'inherit',
                    }}
                  />
                ) : (
                  <div style={{
                    fontSize: '13px', color: 'var(--text)', whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word', minHeight: '40px',
                  }}>
                    {memo.text}
                  </div>
                )}

                <div style={{ fontSize: '11px', color: 'var(--text-3)' }}>
                  {memo.updated_at}
                </div>
                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                  {editingId === memo.id ? (
                    <>
                      <button
                        onClick={() => saveEdit(memo.id)}
                        className="tab-icon-btn"
                        style={{ border: '1px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--text)' }}
                      >
                        저장
                      </button>
                      <button onClick={cancelEdit} className="tab-icon-btn">
                        취소
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(memo)} className="tab-icon-btn">
                        수정
                      </button>
                      <button onClick={() => deleteMemo(memo.id)} className="tab-icon-btn danger">
                        삭제
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}