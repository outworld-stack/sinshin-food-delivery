// src/components/Pagination.tsx
import type { PaginationProps } from '#/types/shared/ui'
// آیکون‌های فلش (اگه ارور دادن، با اسم‌های مشابه تو پکیجت عوض کن)
import { AnglesRight , ChevronRight, ChevronLeft, AnglesLeft } from 'reicon-react'

function getSmartPages(currentPage: number, totalPages: number): (number | string)[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages: (number | string)[] = [];
  pages.push(1);
  
  const leftBound = Math.max(2, currentPage - 1);
  const rightBound = Math.min(totalPages - 1, currentPage + 1);
  
  if (leftBound > 2) pages.push('...');
  for (let i = leftBound; i <= rightBound; i++) {
    pages.push(i);
  }
  if (rightBound < totalPages - 1) pages.push('...');
  
  pages.push(totalPages);
  return pages;
}

export function Pagination({ currentPage, totalPages, itemsPerPage, totalItems, onPageChange, onItemsPerPageChange, pageSizeOptions = [5, 10, 20, 50] }: PaginationProps) {
  if (totalPages <= 1 && !onItemsPerPageChange) return null;

  const pages = getSmartPages(currentPage, totalPages);
  const startItem = totalItems && itemsPerPage ? ((currentPage - 1) * itemsPerPage) + 1 : 0;
  const endItem = totalItems && itemsPerPage ? Math.min(currentPage * itemsPerPage, totalItems) : 0;

  return (
    <div className="flex flex-col lg:flex-row items-center lg:justify-between gap-4 mt-6 w-full">
      {totalItems && itemsPerPage && (
        <div className="flex items-center gap-2 w-full lg:w-auto justify-center lg:justify-start">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium whitespace-nowrap">
            نمایش {startItem.toLocaleString('fa-IR')} تا {endItem.toLocaleString('fa-IR')} از {totalItems.toLocaleString('fa-IR')} مورد
          </span>
          {onItemsPerPageChange && (
            <select 
              value={itemsPerPage} 
              onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
              className="px-1.5 py-1 rounded-lg bg-gray-100 dark:bg-[#1a0a0e] border border-gray-200 dark:border-white/10 text-xs text-gray-600 dark:text-gray-300 outline-none cursor-pointer"
            >
              {pageSizeOptions.map(num => (
                <option key={num} value={num}>{num.toLocaleString('fa-IR')} مورد</option>
              ))}
            </select>
          )}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center gap-1 flex-wrap justify-center lg:justify-end w-full lg:w-auto">
          <button onClick={() => onPageChange(1)} disabled={currentPage === 1} className="p-1.5 rounded-lg bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer shrink-0">
            <AnglesRight  size={16} />
          </button>
          <button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} className="p-1.5 rounded-lg bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer shrink-0">
            <ChevronRight size={16} />
          </button>
          
          {pages.map((page, index) => {
            if (page === '...') {
              return <span key={`dots-${index}`} className="px-1.5 text-xs text-gray-400 select-none shrink-0">...</span>;
            }
            return (
              <button 
                key={page} 
                onClick={() => onPageChange(page as number)} 
                className={`w-8 h-8 rounded-lg text-xs font-DanaDemiBold transition cursor-pointer shrink-0 ${
                  currentPage === page 
                    ? 'bg-primary dark:bg-dark-primary text-white' 
                    : 'bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3a151c]'
                }`}
              >
                {(page as number).toLocaleString('fa-IR')}
              </button>
            );
          })}

          <button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} className="p-1.5 rounded-lg bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer shrink-0">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => onPageChange(totalPages)} disabled={currentPage === totalPages} className="p-1.5 rounded-lg bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer shrink-0">
            <AnglesLeft size={16} />
          </button>
        </div>
      )}
    </div>
  );
}