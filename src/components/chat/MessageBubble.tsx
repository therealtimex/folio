import { Bot, User as UserIcon } from "lucide-react";
import type { Message } from "./ChatPage";

interface MessageBubbleProps {
    message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
    const isUser = message.role === "user";

    // A simple text formatter until we install react-markdown
    const formatText = (text: string) => {
        return text.split("\n").map((line, i) => (
            <span key={i}>
                {line}
                <br />
            </span>
        ));
    };

    return (
        <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
            <div className={`flex gap-3 max-w-[85%] ${isUser ? "flex-row-reverse" : "flex-row"}`}>
                {/* Avatar */}
                <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${isUser
                            ? "bg-primary text-primary-foreground"
                            : "bg-surface border border-border shadow-inner text-foreground"
                        }`}
                >
                    {isUser ? <UserIcon size={14} strokeWidth={2.5} /> : <Bot size={14} className="text-primary" strokeWidth={2.5} />}
                </div>

                {/* Bubble */}
                <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                    <div
                        className={`px-4 py-3 rounded-2xl text-[13px] leading-relaxed shadow-sm ${isUser
                                ? "bg-primary text-primary-foreground rounded-tr-sm"
                                : "bg-surface border border-border/60 text-foreground rounded-tl-sm"
                            }`}
                    >
                        <div className="font-sans break-words whitespace-pre-wrap">
                            {formatText(message.content)}
                        </div>
                    </div>

                    {/* Timestamp */}
                    <div className="flex items-center gap-2 mt-1.5 px-1">
                        <span className="text-[10px] text-muted-foreground/50 font-medium tracking-wide">
                            {new Date(message.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        </span>

                        {!isUser && message.context_sources && message.context_sources.length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary/20 text-secondary border border-secondary/20 flex items-center gap-1 font-medium">
                                <Bot size={10} />
                                {message.context_sources.length} sources
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
