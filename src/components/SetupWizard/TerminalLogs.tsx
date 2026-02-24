import { useEffect, useRef } from "react";
import { LogEntry } from "./types";
import { cn } from "@/lib/utils";

interface TerminalLogsProps {
  logs: LogEntry[];
}

export function TerminalLogs({ logs }: TerminalLogsProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div
      className="bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden shadow-2xl flex flex-col h-[300px]"
      role="log"
      aria-live="polite"
      aria-label="Setup logs"
    >
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
        <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
        <span className="ml-2 text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Foundation Trace</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 font-mono text-[13px] leading-relaxed scrollbar-thin scrollbar-thumb-zinc-800">
        {logs.length === 0 ? (
          <div className="text-zinc-600 italic">Awaiting setup activity...</div>
        ) : (
          logs.map((log, i) => (
            <div
              key={`${log.timestamp}-${log.type}-${log.message}-${i}`}
              className={cn(
                "mb-1 flex gap-3",
                log.type === "error" && "text-red-400",
                log.type === "success" && "text-emerald-400",
                log.type === "info" && "text-blue-400",
                log.type === "stderr" && "text-amber-400",
                log.type === "stdout" && "text-zinc-300"
              )}
            >
              <span className="text-zinc-600 shrink-0 select-none">
                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="break-all">{log.message}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
