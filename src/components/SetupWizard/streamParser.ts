import { SSEEvent } from "./types";

export class SSEStreamParser {
  private buffer = "";

  processChunk(chunk: string): SSEEvent[] {
    const events: SSEEvent[] = [];

    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) {
        continue;
      }

      try {
        const event = JSON.parse(line.slice(6)) as SSEEvent;
        events.push(event);
      } catch {
        // Ignore malformed event chunks and continue.
      }
    }

    return events;
  }

  flush(): SSEEvent[] {
    if (!this.buffer.trim()) {
      return [];
    }

    const events: SSEEvent[] = [];
    if (this.buffer.startsWith("data: ")) {
      try {
        events.push(JSON.parse(this.buffer.slice(6)) as SSEEvent);
      } catch {
        // Ignore malformed final buffer.
      }
    }

    this.buffer = "";
    return events;
  }

  reset() {
    this.buffer = "";
  }
}

export async function readStream(
  response: Response,
  onEvent: (event: SSEEvent) => void,
  options: {
    timeout?: number;
    onError?: (error: Error) => void;
  } = {}
): Promise<void> {
  const { timeout = 300_000, onError } = options;

  if (!response.body) {
    throw new Error("Response body is empty");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SSEStreamParser();

  const timeoutId = setTimeout(() => {
    reader.cancel("Timeout").catch(() => undefined);
  }, timeout);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        parser.flush().forEach(onEvent);
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      parser.processChunk(chunk).forEach(onEvent);
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (onError) {
      onError(err);
    } else {
      throw err;
    }
  } finally {
    clearTimeout(timeoutId);
    parser.reset();
  }
}
