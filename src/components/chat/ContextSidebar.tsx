import { X, ExternalLink, BookOpen } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { RetrievedChunk } from "../../../api/src/services/RAGService";

interface ContextSidebarProps {
    sources: RetrievedChunk[];
    onClose: () => void;
}

export function ContextSidebar({ sources, onClose }: ContextSidebarProps) {
    if (!sources || sources.length === 0) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex flex-col h-full"
            >
                <div className="p-4 border-b border-border flex items-center justify-between bg-surface/15">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground/80">
                        <BookOpen size={16} className="text-secondary" />
                        <span>Retrieved Context</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-surface rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    >
                        <X size={14} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-on-hover">
                    {sources.map((source, idx) => {
                        // In Folio, the chunk text is the `content`. 
                        // It belongs to an `ingestion_id` which we can link to.
                        const scorePct = Math.round(source.similarity * 100);

                        return (
                            <div
                                key={idx}
                                className="p-3 bg-surface/20 hover:bg-surface/50 border border-border rounded-xl transition-all group"
                            >
                                {/* Source Header */}
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2 text-[10px] font-bold">
                                        <span className="flex items-center justify-center w-4 h-4 bg-primary/10 text-primary rounded">
                                            {idx + 1}
                                        </span>
                                        <span className={`px-1.5 py-0.5 rounded border ${scorePct >= 80
                                                ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                                                : "bg-blue-500/10 text-blue-500 border-blue-500/20"
                                            }`}>
                                            {scorePct}% Match
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => {
                                            // In the future: dispatch event or context hook to open the IngestionDetailModal
                                            console.log("Open Ingestion ID:", source.ingestion_id);
                                        }}
                                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-primary transition-opacity focus-visible:ring-2 focus-visible:ring-primary/40 rounded cursor-pointer"
                                        title="View Source Document"
                                    >
                                        <ExternalLink size={12} />
                                    </button>
                                </div>

                                {/* Summary / Content */}
                                <div className="text-[11px] text-muted-foreground leading-relaxed line-clamp-4 font-mono bg-black/5 p-2 rounded-lg border border-border/40">
                                    "{source.content}"
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="p-3 border-t border-border bg-surface/20 text-[10px] text-center text-muted-foreground/50 font-medium">
                    {sources.length} document chunk{sources.length !== 1 ? "s" : ""} retrieved
                </div>
            </motion.div>
        </AnimatePresence>
    );
}
