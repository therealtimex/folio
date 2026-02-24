import { useState } from "react";
import { AlertTriangle, Clock, Calendar, ChevronDown, ChevronUp, Minimize2, Sparkles } from "lucide-react";
import { Button } from "../ui/button";
import { toast } from "../Toast";
import type { MigrationStatus } from "../../lib/migration-check";
import { cn } from "@/lib/utils";

interface MigrationBannerProps {
    /** Migration status from checkMigrationStatus */
    status: MigrationStatus;
    /** Callback when banner is snoozed */
    onSnooze?: (until: Date) => void;
    /** Callback when user clicks to open modal */
    onOpenModal?: () => void;
}

export function MigrationBanner({
    status,
    onSnooze,
    onOpenModal,
}: MigrationBannerProps) {
    const [isMinimized, setIsMinimized] = useState(false);
    const [showDetails, setShowDetails] = useState(false);

    const handleSnooze = (hours: number) => {
        const until = new Date(Date.now() + hours * 60 * 60 * 1000);
        onSnooze?.(until);
        toast.success(`Reminder snoozed until ${until.toLocaleTimeString()}`);
    };

    const features = [
        "Enhanced TTS voice support (Piper, Supertonic)",
        "Real-time audio streaming infrastructure",
        "Improved AI model provider resolution",
    ];

    // Minimized pill view
    if (isMinimized) {
        return (
            <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[60] animate-in slide-in-from-top-5">
                <button
                    onClick={() => setIsMinimized(false)}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-amber-950 rounded-full shadow-2xl shadow-amber-500/20 hover:scale-105 active:scale-95 transition-all text-[11px] font-black uppercase tracking-widest border border-amber-400/50 backdrop-blur-md"
                >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>System Update Available</span>
                </button>
            </div>
        );
    }

    // Full banner view
    return (
        <div className="fixed top-0 left-0 right-0 z-[60] animate-in slide-in-from-top-10 duration-700">
            <div className="bg-amber-500 text-amber-950 px-6 py-4 shadow-2xl border-b border-amber-400/50 backdrop-blur-xl relative overflow-hidden">
                {/* Animated background element */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl pointer-events-none" />

                <div className="max-w-5xl mx-auto relative">
                    <div className="flex items-start gap-6">
                        <div className="w-12 h-12 rounded-2xl bg-amber-950/10 flex items-center justify-center shrink-0">
                            <AlertTriangle className="h-6 w-6" />
                        </div>

                        <div className="flex-1 space-y-3">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                                        Foundational Update Required
                                        <span className="text-[10px] px-2 py-0.5 bg-amber-950/10 rounded-full border border-amber-950/20 uppercase tracking-widest font-black">
                                            v{status.appVersion}
                                        </span>
                                    </h2>
                                    <p className="text-sm font-medium opacity-80 mt-1 max-w-2xl leading-relaxed">
                                        New architecture components detected. Migration is necessary to enable real-time audio streaming and enhanced AI provider resolution.
                                    </p>
                                </div>

                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-amber-950 hover:bg-amber-950/10 rounded-full shrink-0"
                                    onClick={() => setIsMinimized(true)}
                                >
                                    <Minimize2 className="h-4 w-4" />
                                </Button>
                            </div>

                            {/* Details expandable section */}
                            {showDetails && (
                                <div className="bg-amber-950/5 rounded-2xl p-4 border border-amber-950/10 animate-in fade-in slide-in-from-top-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-3">Protocol Improvements:</p>
                                    <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                                        {features.map((feature, i) => (
                                            <li key={i} className="text-xs flex items-center gap-2 font-bold">
                                                <div className="w-1 h-1 rounded-full bg-amber-950/40" />
                                                {feature}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Action buttons */}
                            <div className="flex flex-wrap items-center gap-3 pt-1">
                                <Button
                                    size="sm"
                                    className="h-9 px-6 bg-amber-950 text-amber-50 hover:bg-black rounded-full font-black text-[10px] uppercase tracking-[0.2em] shadow-xl shadow-amber-950/20 active:scale-95 transition-all"
                                    onClick={onOpenModal}
                                >
                                    Apply Update Now
                                </Button>

                                <div className="h-4 w-px bg-amber-950/20 hidden sm:block mx-1" />

                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-9 text-amber-950 font-black text-[10px] uppercase tracking-widest hover:bg-amber-950/10 rounded-full"
                                    onClick={() => handleSnooze(1)}
                                >
                                    <Clock className="h-3.5 w-3.5 mr-2 opacity-60" />
                                    Snooze 1h
                                </Button>

                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-9 text-amber-950 font-black text-[10px] uppercase tracking-widest hover:bg-amber-950/10 rounded-full"
                                    onClick={() => handleSnooze(24)}
                                >
                                    <Calendar className="h-3.5 w-3.5 mr-2 opacity-60" />
                                    Tomorrow
                                </Button>

                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-9 text-amber-950 font-black text-[10px] uppercase tracking-widest hover:bg-amber-950/10 rounded-full ml-auto"
                                    onClick={() => setShowDetails(!showDetails)}
                                >
                                    {showDetails ? (
                                        <ChevronUp className="h-4 w-4" />
                                    ) : (
                                        <ChevronDown className="h-4 w-4" />
                                    )}
                                    <span className="ml-2">{showDetails ? "Hide Details" : "Inspect Protocol"}</span>
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
