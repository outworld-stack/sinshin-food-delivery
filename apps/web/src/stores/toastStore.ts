// src/stores/toastStore.ts
import { create } from 'zustand';

interface ToastState {
  message: string;
  type: 'success' | 'error';
  isVisible: boolean;
  showToast: (message: string, type?: 'success' | 'error') => void;
  hideToast: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastState>((set) => ({
  message: '',
  type: 'success',
  isVisible: false,
  showToast: (message, type = 'success') => {
    // تایمر قبلی رو بکش تا توست جدید زودتر از موعد بسته نشه
    if (toastTimer) clearTimeout(toastTimer);
    set({ message, type, isVisible: true });
    toastTimer = setTimeout(() => {
      set({ isVisible: false });
      toastTimer = null;
    }, 3000);
  },
  hideToast: () => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    set({ isVisible: false });
  },
}));