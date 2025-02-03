type WebSocketListener = (data: any) => void;

interface WebSocketOptions {
  url: string;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  maxRetries?: number;
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private retryCount = 0;
  private readonly initialRetryDelay: number;
  private readonly maxRetryDelay: number;
  private readonly maxRetries: number;
  private retryTimeout: number | null = null;
  private isIntentionallyClosed = false;
  private listeners: {
    connected: Array<() => void>;
    disconnected: Array<() => void>;
    message: Array<WebSocketListener>;
    error: Array<(error: any) => void>;
  };

  constructor(options: WebSocketOptions) {
    this.url = options.url;
    this.initialRetryDelay = options.initialRetryDelayMs || 1000;
    this.maxRetryDelay = options.maxRetryDelayMs || 30000;
    this.maxRetries = options.maxRetries || Infinity;
    this.listeners = {
      connected: [],
      disconnected: [],
      message: [],
      error: [],
    };
  }

  private calculateRetryDelay(): number {
    // Exponential backoff: delay = min(initialDelay * 2^retryCount, maxDelay)
    const delay = Math.min(
      this.initialRetryDelay * Math.pow(2, this.retryCount),
      this.maxRetryDelay
    );
    return delay;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.isIntentionallyClosed = false;
    this.ws = new WebSocket(this.url);

    this.ws.addEventListener('open', () => {
      console.log('WebSocket connected successfully');
      this.retryCount = 0;
      this.listeners.connected.forEach(listener => listener());
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        this.listeners.message.forEach(listener => listener(data));
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
        this.listeners.error.forEach(listener => listener(error));
      }
    });

    this.ws.addEventListener('close', () => {
      console.log('WebSocket connection closed. Attempting to reconnect...');
      this.listeners.disconnected.forEach(listener => listener());

      if (!this.isIntentionallyClosed && this.retryCount < this.maxRetries) {
        const delay = this.calculateRetryDelay();
        this.retryTimeout = window.setTimeout(() => {
          this.retryCount++;
          this.connect();
        }, delay);
      }
    });

    this.ws.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      this.listeners.error.forEach(listener => listener(error));
    });
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;
    if (this.retryTimeout !== null) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(data: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    this.ws.send(JSON.stringify(data));
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  on(event: 'connected' | 'disconnected', listener: () => void): void;
  on(event: 'message', listener: WebSocketListener): void;
  on(event: 'error', listener: (error: any) => void): void;
  on(event: string, listener: any): void {
    if (event in this.listeners) {
      this.listeners[event as keyof typeof this.listeners].push(listener);
    }
  }

  off(event: 'connected' | 'disconnected', listener: () => void): void;
  off(event: 'message', listener: WebSocketListener): void;
  off(event: 'error', listener: (error: any) => void): void;
  off(event: string, listener: any): void {
    if (event in this.listeners) {
      const listeners = this.listeners[event as keyof typeof this.listeners];
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }
}