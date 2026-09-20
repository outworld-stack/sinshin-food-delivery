// src/components/Toast.tsx
import { useToastStore } from '#/stores/toastStore';
import { Check, X } from 'reicon-react';

export function Toast() {
  const { message, type, isVisible, hideToast } = useToastStore();

  const isError = type === 'error';
  const bgColor = isError ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20' : 'bg-white dark:bg-[#2a1015] border-gray-200 dark:border-[#3a151c]';
  const iconBg = isError ? 'bg-red-100 dark:bg-red-500/20' : 'bg-green-100 dark:bg-green-500/20';
  const iconColor = isError ? 'text-red-500' : 'text-green-500';

  return (
    <div
      onClick={hideToast}
      className={`fixed top-6 left-1/2 -translate-x-1/2 z-100 transition-all duration-300 cursor-pointer ${
        isVisible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 -translate-y-4 pointer-events-none'
      }`}
    >
      <div className={`flex items-center gap-3 ${bgColor} border shadow-xl px-5 py-3 rounded-2xl`}>
        <div className={`w-8 h-8 rounded-full ${iconBg} flex items-center justify-center ${iconColor}`}>
          {isError ? <X size={20} /> : <Check size={20} />}
        </div>
        <span className="font-DanaMedium text-gray-800 dark:text-white">{message}</span>
      </div>
    </div>
  );
}