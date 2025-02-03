interface WebSocketConfig {
  url: string;
  initialDelay?: number;
  maxDelay?: number;
  maxRetries?: number;
  onMessage?: (data: any) => void;
  onClose?: () => void;
  onOpen?: () => void;
  onError?: (error: Event) => void;
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private readonly config: WebSocketConfig;
  private retryCount = 0;
  private retryTimeout: number | null = null;
  private shouldReconnect = true;

  constructor(config: WebSocketConfig) {
    this.config = {
      initialDelay: 1000,
      maxDelay: 30000,
      maxRetries: Infinity,
      ...config,
    };
  }

  private getRetryDelay(): number {
    const delay = Math.min(
      this.config.initialDelay! * Math.pow(2, this.retryCount),
      this.config.maxDelay!
    );
    return delay;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.config.url);
    this.shouldReconnect = true;

    this.ws.addEventListener('open', () => {
      console.log('WebSocket connected');
      this.retryCount = 0;
      this.config.onOpen?.();
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        this.config.onMessage?.(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    });

    this.ws.addEventListener('close', () => {
      this.ws = null;
      this.config.onClose?.();

      if (this.shouldReconnect && this.retryCount < this.config.maxRetries!) {
        const delay = this.getRetryDelay();
        console.log(`WebSocket reconnecting in ${delay}ms (attempt ${this.retryCount + 1})`);

        this.retryTimeout = window.setTimeout(() => {
          this.retryCount++;
          this.connect();
        }, delay);
      }
    });

    this.ws.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      this.config.onError?.(error);
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.retryTimeout) {
      window.clearTimeout(this.retryTimeout);
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
}