import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from "react";

interface TerminalContextType {
    isExpanded: boolean;
    setIsExpanded: (expanded: boolean) => void;
    openTerminal: () => void;
    closeTerminal: () => void;
}

const TerminalContext = createContext<TerminalContextType | undefined>(undefined);

export function TerminalProvider({ children }: { children: ReactNode }) {
    const [isExpanded, setIsExpanded] = useState(false);

    const openTerminal = useCallback(() => setIsExpanded(true), []);
    const closeTerminal = useCallback(() => setIsExpanded(false), []);

    const value = useMemo(() => ({
        isExpanded,
        setIsExpanded,
        openTerminal,
        closeTerminal
    }), [isExpanded, openTerminal, closeTerminal]);

    return (
        <TerminalContext.Provider value={value}>
            {children}
        </TerminalContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTerminal() {
    const context = useContext(TerminalContext);
    if (context === undefined) {
        throw new Error("useTerminal must be used within a TerminalProvider");
    }
    return context;
}
