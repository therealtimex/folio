import React, { createContext, useContext, useState, ReactNode, useMemo, useCallback } from 'react';
import { Locale, fallbackTranslations } from '../locales';

interface LanguageContextType {
    language: Locale;
    setLanguage: (lang: Locale) => void;
    t: (key: string) => string;
    isLoading: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
    const [language] = useState<Locale>('en');
    const [isLoading] = useState(false);

    const setLanguage = useCallback((_lang: Locale) => {
        // Only English for now
    }, []);

    const t = useCallback((key: string): string => {
        return (fallbackTranslations as Record<string, string>)[key] || key;
    }, []);

    const value = useMemo(() => ({
        language,
        setLanguage,
        t,
        isLoading
    }), [language, t, isLoading]);

    return (
        <LanguageContext.Provider value={value}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (context === undefined) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
}
