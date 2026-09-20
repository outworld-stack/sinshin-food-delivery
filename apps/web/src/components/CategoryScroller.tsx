// src/components/CategoryScroller.tsx
import { useRef, useState, useEffect } from 'react';
import type { CategoryScrollerProps } from '#/types/shared/ui';
import { ChevronRight, ChevronLeft } from 'reicon-react';

export function CategoryScroller({ items }: CategoryScrollerProps) {
  const [isAtStart, setIsAtStart] = useState(true);
  const [isAtEnd, setIsAtEnd] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const checkScrollPosition = () => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const currentScroll = Math.abs(el.scrollLeft);
    setIsAtStart(currentScroll < 5);
    setIsAtEnd(currentScroll >= maxScroll - 5);
  };

  const scrollByAmount = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = 200;
    const delta = direction === 'left' ? -amount : amount;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  };

  useEffect(() => {
    checkScrollPosition();
    const timer = setTimeout(checkScrollPosition, 100);
    return () => clearTimeout(timer);
  }, [items]);

  return (
    <div className="flex items-center gap-2 mb-6">
      <button 
        onClick={() => scrollByAmount('right')} 
        disabled={isAtStart}
        className={`p-1.5 rounded-full bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] shadow-sm transition shrink-0 ${
          isAtStart ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-[#3a151c] cursor-pointer'
        }`}
        aria-label="اسکرول به راست"
      >
        <ChevronRight size={20} className="text-gray-600 dark:text-gray-300" />
      </button>

      <div 
        ref={scrollRef}
        onScroll={checkScrollPosition}
        className="flex-1 flex gap-2 overflow-x-auto no-scrollbar items-center"
      >
        {items.map((item) => (
          <button 
            key={item.id}
            onClick={item.onClick}
            className={`shrink-0 px-5 py-2 rounded-full whitespace-nowrap transition font-DanaMedium ${
              item.isActive 
                ? 'bg-primary dark:bg-dark-primary text-white shadow-sm' 
                : 'bg-gray-100 dark:bg-[#2a1015] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3a151c]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <button 
        onClick={() => scrollByAmount('left')} 
        disabled={isAtEnd}
        className={`p-1.5 rounded-full bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] shadow-sm transition shrink-0 ${
          isAtEnd ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-[#3a151c] cursor-pointer'
        }`}
        aria-label="اسکرول به چپ"
      >
        <ChevronLeft size={20} className="text-gray-600 dark:text-gray-300" />
      </button>
    </div>
  );
}