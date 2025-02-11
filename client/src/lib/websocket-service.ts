import { queryClient } from "./queryClient";

interface WebSocketConfig {
  url: string;
  onMessage?: (data: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  autoConnect?: boolean;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  maxRetries?: number;
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private readonly config: WebSocketConfig;
  private retryCount = 0;
  private retryTimeout: number | null = null;
  private shouldReconnect = true;
  private messageQueue: any[] = [];
  private authenticated = false;

  constructor(config: WebSocketConfig) {
    this.config = {
      initialRetryDelayMs: 1000,
      maxRetryDelayMs: 30000,
      maxRetries: Infinity,
      autoConnect: true,
      ...config,
    };

    if (this.config.autoConnect) {
      this.connect();
    }
  }

  private getRetryDelay(): number {
    return Math.min(
      this.config.initialRetryDelayMs! * Math.pow(1.5, this.retryCount),
      this.config.maxRetryDelayMs!
    );
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.config.url);
      this.shouldReconnect = true;

      this.ws.addEventListener('open', () => {
        console.log('WebSocket connected');
        this.config.onConnect?.();
      });

      this.ws.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle authentication success
          if (data.type === 'auth_success') {
            console.log('WebSocket authenticated');
            this.authenticated = true;
            this.retryCount = 0;

            // Send any queued messages
            while (this.messageQueue.length > 0) {
              const msg = this.messageQueue.shift();
              this.send(msg);
            }
          }

          this.config.onMessage?.(data);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      });

      this.ws.addEventListener('close', () => {
        this.ws = null;
        this.authenticated = false;
        this.config.onDisconnect?.();

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
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.shouldReconnect && this.retryCount < this.config.maxRetries!) {
      const delay = this.getRetryDelay();
      this.retryTimeout = window.setTimeout(() => {
        this.retryCount++;
        this.connect();
      }, delay);
    }
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) {
      // Queue message if not connected or not authenticated
      this.messageQueue.push(data);
      return;
    }

    try {
      this.ws.send(JSON.stringify(data));
    } catch (error) {
      console.error('Failed to send WebSocket message:', error);
      this.messageQueue.push(data);
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.authenticated;
  }
}