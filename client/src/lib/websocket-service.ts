import { EventEmitter } from 'events';

interface WebSocketOptions {
  url: string;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  maxRetries?: number;
}

export class WebSocketService extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private retryCount = 0;
  private readonly initialRetryDelay: number;
  private readonly maxRetryDelay: number;
  private readonly maxRetries: number;
  private retryTimeout: NodeJS.Timeout | null = null;
  private isIntentionallyClosed = false;

  constructor(options: WebSocketOptions) {
    super();
    this.url = options.url;
    this.initialRetryDelay = options.initialRetryDelayMs || 1000;
    this.maxRetryDelay = options.maxRetryDelayMs || 30000;
    this.maxRetries = options.maxRetries || Infinity;
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
      this.emit('connected');
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        this.emit('message', data);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
        this.emit('error', error);
      }
    });

    this.ws.addEventListener('close', (event) => {
      console.log('WebSocket connection closed. Attempting to reconnect...');
      this.emit('disconnected');

      if (!this.isIntentionallyClosed && this.retryCount < this.maxRetries) {
        const delay = this.calculateRetryDelay();
        this.retryTimeout = setTimeout(() => {
          this.retryCount++;
          this.connect();
        }, delay);
      }
    });

    this.ws.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', error);
    });
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;
    if (this.retryTimeout) {
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
}
