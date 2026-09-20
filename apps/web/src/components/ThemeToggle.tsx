import { memo } from 'react';
import { useThemeStore } from '#/stores/themeStore';
import { Sun, Moon } from 'reicon-react';

interface ThemeToggleProps {
  className?: string;
}

export const ThemeToggle = memo(function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const toggle = useThemeStore((s) => s.toggle);

  return (
    <button
      type="button"
      onClick={toggle}
      className={`p-2.5 rounded-full bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-white/10 shadow-sm transition-all duration-300 hover:shadow-lg hover:shadow-primary/20 dark:hover:shadow-dark-primary/20 ${className}`}
      aria-label="تغییر تم"
    >
      <Sun size={22} className="hidden dark:block text-dark-primary" />
      <Moon size={22} className="block dark:hidden text-primary" />
    </button>
  );
});