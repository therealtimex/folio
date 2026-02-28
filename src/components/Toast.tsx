import { useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
    id: string;
    type: ToastType;
    message: string;
    duration?: number;
    count?: number;
    lastUpdated?: number;
}

// Simple toast store
let toasts: Toast[] = [];
// eslint-disable-next-line prefer-const
let listeners: Set<() => void> = new Set();

function notify() {
    listeners.forEach(listener => listener());
}

// eslint-disable-next-line react-refresh/only-export-components
export const toast = {
    success: (message: string, duration?: number) => addToast('success', message, duration),
    error: (message: string, duration?: number) => addToast('error', message, duration),
    info: (message: string, duration?: number) => addToast('info', message, duration),
    warning: (message: string, duration?: number) => addToast('warning', message, duration),
};

function addToast(type: ToastType, message: string, duration = 5000) {
    const existingIndex = toasts.findIndex(t => t.message === message && t.type === type);

    if (existingIndex !== -1) {
        const existing = toasts[existingIndex];
        toasts = [...toasts];
        toasts[existingIndex] = {
            ...existing,
            count: (existing.count || 1) + 1,
            lastUpdated: Date.now()
        };
        notify();
        return;
    }

    const id = Math.random().toString(36).substr(2, 9);
    toasts = [...toasts, { id, type, message, duration, count: 1, lastUpdated: Date.now() }];
    notify();

    if (duration > 0) {
        setTimeout(() => removeToast(id), duration);
    }
}

function removeToast(id: string) {
    toasts = toasts.filter(t => t.id !== id);
    notify();
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToasts() {
    const [, setTick] = useState(0);

    useEffect(() => {
        const listener = () => setTick(t => t + 1);
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);

    return toasts;
}

const icons = {
    success: CheckCircle,
    error: AlertCircle,
    info: Info,
    warning: AlertTriangle,
};

const styles = {
    success: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400',
    error: 'bg-destructive/10 border-destructive/20 text-destructive',
    info: 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400',
    warning: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-600 dark:text-yellow-400',
};

function ToastItem({ toast: t }: { toast: Toast }) {
    const Icon = icons[t.type];

    return (
        <div className={cn(
            'flex items-start gap-3 p-4 rounded-lg border shadow-lg backdrop-blur-sm',
            'animate-in slide-in-from-left-full duration-300',
            styles[t.type]
        )}>
            <div className="relative">
                <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                {t.count && t.count > 1 && (
                    <span className="absolute -top-2 -right-2 bg-primary text-primary-foreground text-[10px] font-bold px-1.5 rounded-full border border-background scale-90 animate-in zoom-in duration-200">
                        {t.count}
                    </span>
                )}
            </div>
            <p className="text-sm flex-1">{t.message}</p>
            <button
                onClick={() => removeToast(t.id)}
                className="p-1 hover:bg-black/10 rounded transition-colors"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}

export function ToastContainer() {
    const toastList = useToasts();

    if (toastList.length === 0) return null;

    return (
        <div className="fixed bottom-4 left-4 z-[100] flex flex-col-reverse gap-2 max-w-sm w-full">
            {toastList.map(t => (
                <ToastItem key={t.id} toast={t} />
            ))}
        </div>
    );
}
