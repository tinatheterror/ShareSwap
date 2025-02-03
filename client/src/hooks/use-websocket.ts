import { useEffect, useRef, useState, useCallback } from 'react';
import { WebSocketService } from '@/lib/websocket-service';

interface UseWebSocketOptions {
  url: string;
  onMessage?: (data: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  autoConnect?: boolean;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  maxRetries?: number;
}

export function useWebSocket({
  url,
  onMessage,
  onConnect,
  onDisconnect,
  onError,
  autoConnect = true,
  initialRetryDelayMs,
  maxRetryDelayMs,
  maxRetries,
}: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocketService | null>(null);

  useEffect(() => {
    wsRef.current = new WebSocketService({
      url,
      initialRetryDelayMs,
      maxRetryDelayMs,
      maxRetries,
    });

    const ws = wsRef.current;

    ws.on('connected', () => {
      setIsConnected(true);
      onConnect?.();
    });

    ws.on('disconnected', () => {
      setIsConnected(false);
      onDisconnect?.();
    });

    ws.on('message', (data) => {
      onMessage?.(data);
    });

    ws.on('error', (error) => {
      onError?.(error);
    });

    if (autoConnect) {
      ws.connect();
    }

    return () => {
      ws.disconnect();
    };
  }, [url]);

  const send = useCallback((data: unknown) => {
    if (!wsRef.current?.isConnected()) {
      console.warn('WebSocket is not connected. Message not sent.');
      return;
    }
    wsRef.current.send(data);
  }, []);

  const connect = useCallback(() => {
    wsRef.current?.connect();
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.disconnect();
  }, []);

  return {
    isConnected,
    send,
    connect,
    disconnect,
  };
}
