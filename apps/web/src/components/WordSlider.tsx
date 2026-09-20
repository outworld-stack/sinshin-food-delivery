// src/components/WordSlider.tsx
import { useState, useEffect } from 'react';
import type { WordSliderProps } from '#/types/shared/ui';

export function WordSlider({ words, className }: WordSliderProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % words.length);
    }, 2500);
    return () => clearInterval(timer);
  }, [words]);

  return (
    <span className="inline-grid justify-items-start">
      {words.map((word, i) => (
        <span
          key={`${i}-${word}`}
          style={{ gridArea: '1 / 1' }}
          className={`transition-all duration-500 ease-in-out ${className} ${i === index
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-2'
            }`}
        >
          {word}
        </span>
      ))}
    </span>
  );
}