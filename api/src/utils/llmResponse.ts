export function normalizeLlmContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (typeof content === "number" || typeof content === "boolean") return String(content);

    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (part && typeof part === "object") {
                    const obj = part as Record<string, unknown>;
                    if (typeof obj.text === "string") return obj.text;
                    if (typeof obj.content === "string") return obj.content;
                }
                return normalizeLlmContent(part);
            })
            .filter(Boolean)
            .join("\n");
    }

    if (content && typeof content === "object") {
        const obj = content as Record<string, unknown>;
        if (typeof obj.text === "string") return obj.text;
        if (typeof obj.content === "string") return obj.content;
        if ("content" in obj) return normalizeLlmContent(obj.content);
        try {
            return JSON.stringify(obj);
        } catch {
            return String(obj);
        }
    }

    return "";
}

/**
 * Robustly extracts the text payload from various SDK adapter response shapes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractLlmResponse(result: any): string {
    if (!result) return "";

    const candidates = [
        result.response?.content,
        result.message?.content,
        result.content,
        result.text,
        result.choices?.[0]?.message?.content,
        result.result,
        result.output,
    ];

    for (const candidate of candidates) {
        const normalized = normalizeLlmContent(candidate);
        if (normalized) return normalized;
    }

    return "";
}

export function previewLlmText(raw: string, maxChars = 240): string {
    return raw.replace(/\s+/g, " ").trim().slice(0, maxChars);
}
