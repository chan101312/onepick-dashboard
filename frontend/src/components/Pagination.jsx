import React from 'react';

const PAGE_GROUP_SIZE = 5;

// ReorderAlertBanner/SalesDeclineTab 등 목록형 탭에서 공통으로 쓰는 페이지네이션.
// MarginTab에서 쓰던 .margin-pagination 계열 스타일을 그대로 재사용해서 앱 전체 톤을 맞춘다.
export default function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const currentGroup = Math.ceil(currentPage / PAGE_GROUP_SIZE);
  const startPage = (currentGroup - 1) * PAGE_GROUP_SIZE + 1;
  const endPage = Math.min(startPage + PAGE_GROUP_SIZE - 1, totalPages);
  const pages = [];
  for (let p = startPage; p <= endPage; p++) pages.push(p);

  return (
    <div className="margin-pagination" aria-label="페이지 네비게이션">
      <button className="margin-pagination-btn" onClick={() => onPageChange(startPage - 1)} disabled={startPage === 1}>
        ◀ 이전
      </button>
      {pages.map((p) => (
        <button
          key={p}
          className={`margin-page-number ${currentPage === p ? 'active' : ''}`}
          onClick={() => onPageChange(p)}
        >
          {p}
        </button>
      ))}
      <button className="margin-pagination-btn" onClick={() => onPageChange(endPage + 1)} disabled={endPage === totalPages}>
        다음 ▶
      </button>
    </div>
  );
}
