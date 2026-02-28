import { createContext, useContext, useReducer, useEffect, ReactNode, useMemo } from 'react';
import { getSupabaseClient } from '../lib/supabase-config';
import { api } from '../lib/api';
import { EmailAccount, Rule, UserSettings, Stats, Profile } from '../lib/types';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { toast } from '../components/Toast';
import { AuthChangeEvent, Session } from '@supabase/supabase-js';

// Helper to extract error message from API response error
function getErrorMessage(error: { message?: string; code?: string } | string | undefined, fallback: string): string {
    if (!error) return fallback;
    if (typeof error === 'string') return error;
    return error.message || fallback;
}

// State
interface AppState {
    // Auth
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: any | null;
    isAuthenticated: boolean;

    // Data
    profile: Profile | null;
    accounts: EmailAccount[];
    rules: Rule[];
    settings: UserSettings | null;
    stats: Stats | null;

    // UI
    isLoading: boolean;
    isInitialized: boolean;
    error: string | null;
}

const initialState: AppState = {
    user: null,
    isAuthenticated: false,
    profile: null,
    accounts: [],
    rules: [],
    settings: null,
    stats: null,
    isLoading: true,
    isInitialized: false,
    error: null,
};

// Actions
type Action =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | { type: 'SET_USER'; payload: any }
    | { type: 'SET_LOADING'; payload: boolean }
    | { type: 'SET_INITIALIZED'; payload: boolean }
    | { type: 'SET_ERROR'; payload: string | null }
    | { type: 'SET_PROFILE'; payload: Profile }
    | { type: 'UPDATE_PROFILE'; payload: Profile }
    | { type: 'SET_ACCOUNTS'; payload: EmailAccount[] }
    | { type: 'ADD_ACCOUNT'; payload: EmailAccount }
    | { type: 'REMOVE_ACCOUNT'; payload: string }
    | { type: 'SET_RULES'; payload: Rule[] }
    | { type: 'ADD_RULE'; payload: Rule }
    | { type: 'UPDATE_RULE'; payload: Rule }
    | { type: 'REMOVE_RULE'; payload: string }
    | { type: 'SET_SETTINGS'; payload: UserSettings }
    | { type: 'SET_STATS'; payload: Stats }
    | { type: 'CLEAR_DATA' };

function reducer(state: AppState, action: Action): AppState {
    switch (action.type) {
        case 'SET_USER': {
            const isAuthenticated = !!action.payload;
            return {
                ...state,
                user: action.payload,
                isAuthenticated,
                isLoading: false,
            };
        }
        case 'SET_LOADING':
            return { ...state, isLoading: action.payload };
        case 'SET_INITIALIZED':
            return { ...state, isInitialized: action.payload };
        case 'SET_ERROR':
            return { ...state, error: action.payload, isLoading: false };
        case 'SET_PROFILE':
            return { ...state, profile: action.payload };
        case 'UPDATE_PROFILE':
            return { ...state, profile: action.payload };
        case 'SET_ACCOUNTS':
            return { ...state, accounts: action.payload };
        case 'ADD_ACCOUNT':
            return { ...state, accounts: [action.payload, ...state.accounts] };
        case 'REMOVE_ACCOUNT':
            return {
                ...state,
                accounts: state.accounts.filter(a => a.id !== action.payload),
            };
        case 'SET_RULES':
            return { ...state, rules: action.payload };
        case 'ADD_RULE':
            return { ...state, rules: [action.payload, ...state.rules] };
        case 'UPDATE_RULE':
            return {
                ...state,
                rules: state.rules.map(r =>
                    r.id === action.payload.id ? action.payload : r
                ),
            };
        case 'REMOVE_RULE':
            return {
                ...state,
                rules: state.rules.filter(r => r.id !== action.payload),
            };
        case 'SET_SETTINGS':
            return { ...state, settings: action.payload };
        case 'SET_STATS':
            return { ...state, stats: action.payload };
        case 'CLEAR_DATA':
            return { ...initialState, isLoading: false, isInitialized: true };
        default:
            return state;
    }
}

// Context
interface AppContextType {
    state: AppState;
    dispatch: React.Dispatch<Action>;
    actions: {
        fetchAccounts: () => Promise<void>;
        fetchRules: () => Promise<void>;
        fetchSettings: () => Promise<void>;
        fetchProfile: () => Promise<void>;
        fetchStats: () => Promise<void>;
        disconnectAccount: (accountId: string) => Promise<boolean>;
        updateSettings: (settings: Partial<UserSettings>) => Promise<boolean>;
        updateProfile: (updates: { first_name?: string; last_name?: string; avatar_url?: string }) => Promise<boolean>;
        createRule: (rule: Omit<Rule, 'id' | 'user_id' | 'created_at'>) => Promise<boolean>;
        updateRule: (ruleId: string, updates: Partial<Rule>) => Promise<boolean>;
        deleteRule: (ruleId: string) => Promise<boolean>;
        toggleRule: (ruleId: string) => Promise<boolean>;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any; // Using any or SupabaseClient
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(reducer, initialState);
    const supabase = useMemo(() => getSupabaseClient(), []);

    // Initialize auth
    useEffect(() => {
        if (!supabase) {
            dispatch({ type: 'SET_INITIALIZED', payload: true });
            return;
        }

        async function init() {
            if (!supabase) return;
            const { data: { session } } = await supabase.auth.getSession();
            dispatch({ type: 'SET_USER', payload: session?.user || null });
            dispatch({ type: 'SET_INITIALIZED', payload: true });

            const { data: { subscription } } = supabase.auth.onAuthStateChange(
                (_event: AuthChangeEvent, session: Session | null) => {
                    dispatch({ type: 'SET_USER', payload: session?.user || null });
                    if (!session) {
                        dispatch({ type: 'CLEAR_DATA' });
                    }
                }
            );

            return () => subscription.unsubscribe();
        }
        init();
    }, [supabase]);

    // Actions
    const actions = useMemo(() => ({
        fetchAccounts: async () => {
            if (!supabase) return;
            const { data: { session } } = await supabase.auth.getSession();
            const response = await api.getAccounts(session?.access_token);
            if (response.data) {
                dispatch({ type: 'SET_ACCOUNTS', payload: response.data.accounts });
            }
        },

        fetchRules: async () => {
            if (!supabase) return;
            const { data: { session } } = await supabase.auth.getSession();
            const response = await api.getRules(session?.access_token);
            if (response.data) {
                dispatch({ type: 'SET_RULES', payload: response.data.rules });
            }
        },

        fetchSettings: async () => {
            if (!supabase) return;
            const { data: { session } } = await supabase.auth.getSession();
            const response = await api.getSettings(session?.access_token);
            if (response.data && response.data.settings) {
                dispatch({ type: 'SET_SETTINGS', payload: response.data.settings });
            }
        },

        fetchProfile: async () => {
            if (!supabase) return;
            const { data: { session } } = await supabase.auth.getSession();
            // In Folio, we might want a getProfile endpoint if it's not already there
            // For now, let's assume it exists or we'll add it
            const response = await api.getProfile(session?.access_token);
            if (response.data) {
                dispatch({ type: 'SET_PROFILE', payload: response.data });
            }
        },

        fetchStats: async () => {
            if (!supabase) return;
            const { data: { session } } = await supabase.auth.getSession();
            const response = await api.getStats(session?.access_token);
            if (response.data) {
                dispatch({ type: 'SET_STATS', payload: response.data.stats });
            }
        },

        disconnectAccount: async (accountId: string) => {
            if (!supabase) return false;
            const { data: { session } } = await supabase.auth.getSession();
            const response = await api.disconnectAccount(accountId, session?.access_token);
            if (response.data?.success) {
                dispatch({ type: 'REMOVE_ACCOUNT', payload: accountId });
                return true;
            }
            dispatch({ type: 'SET_ERROR', payload: getErrorMessage(response.error, 'Failed to disconnect') });
            return false;
        },

        updateSettings: async (settings: Partial<UserSettings>) => {
            if (!supabase) return false;
            const { data: { session } } = await supabase.auth.getSession();
            const response = await api.updateSettings(settings, session?.access_token);
            if (response.data && response.data.settings) {
                dispatch({ type: 'SET_SETTINGS', payload: response.data.settings });
                return true;
            }
            dispatch({ type: 'SET_ERROR', payload: getErrorMessage(response.error, 'Failed to update settings') });
            return false;
        },

        updateProfile: async (updates: { first_name?: string; last_name?: string; avatar_url?: string }) => {
            if (!supabase) return false;
            const { data: { session } } = await supabase.auth.getSession();
            const response = await api.updateProfile(updates, session?.access_token);
            if (response.data) {
                dispatch({ type: 'UPDATE_PROFILE', payload: response.data });
                return true;
            }
            dispatch({ type: 'SET_ERROR', payload: getErrorMessage(response.error, 'Failed to update profile') });
            return false;
        },

        createRule: async (rule: Omit<Rule, 'id' | 'user_id' | 'created_at'>) => {
            if (!supabase) return false;
            const { data: { session } } = await supabase.auth.getSession();
            const response = await api.createRule(rule, session?.access_token);
            if (response.data) {
                dispatch({ type: 'ADD_RULE', payload: response.data.rule });
                return true;
            }
            dispatch({ type: 'SET_ERROR', payload: getErrorMessage(response.error, 'Failed to create rule') });
            return false;
        },

        updateRule: async (ruleId: string, updates: Partial<Rule>) => {
            if (!supabase) return false;
            const { data: { session } } = await supabase.auth.getSession();
            const response = await api.updateRule(ruleId, updates, session?.access_token);
            if (response.data) {
                dispatch({ type: 'UPDATE_RULE', payload: response.data.rule });
                return true;
            }
            dispatch({ type: 'SET_ERROR', payload: getErrorMessage(response.error, 'Failed to update rule') });
            return false;
        },

        deleteRule: async (ruleId: string) => {
            if (!supabase) return false;
            const { data: { session } } = await supabase.auth.getSession();
            const response = await api.deleteRule(ruleId, session?.access_token);
            if (response.data?.success) {
                dispatch({ type: 'REMOVE_RULE', payload: ruleId });
                return true;
            }
            dispatch({ type: 'SET_ERROR', payload: getErrorMessage(response.error, 'Failed to delete rule') });
            return false;
        },

        toggleRule: async (ruleId: string) => {
            if (!supabase) return false;
            const { data: { session } } = await supabase.auth.getSession();
            const response = await api.toggleRule(ruleId, session?.access_token);
            if (response.data) {
                dispatch({ type: 'UPDATE_RULE', payload: response.data.rule });
                return true;
            }
            dispatch({ type: 'SET_ERROR', payload: getErrorMessage(response.error, 'Failed to toggle rule') });
            return false;
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [state.accounts, state.rules]);

    const value = useMemo(() => ({
        state,
        dispatch,
        actions,
        supabase
    }), [state, actions, supabase]);

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useApp must be used within AppProvider');
    }
    return context;
}
