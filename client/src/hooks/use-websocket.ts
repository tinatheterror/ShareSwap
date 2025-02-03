import { useEffect, useRef, useState, useCallback } from 'react';
import { WebSocketService } from '@/lib/websocket-service';

interface UseWebSocketOptions {
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

export function useWebSocket({
  url,
  onMessage,
  onConnect,
  onDisconnect,
  onError,
  autoConnect = true,
  initialRetryDelayMs = 1000,
  maxRetryDelayMs = 30000,
  maxRetries = Infinity,
}: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocketService | null>(null);

  useEffect(() => {
    wsRef.current = new WebSocketService({
      url,
      initialDelay: initialRetryDelayMs,
      maxDelay: maxRetryDelayMs,
      maxRetries,
      onMessage,
      onOpen: () => {
        setIsConnected(true);
        onConnect?.();
      },
      onClose: () => {
        setIsConnected(false);
        onDisconnect?.();
      },
      onError,
    });

    if (autoConnect) {
      wsRef.current.connect();
    }

    return () => {
      wsRef.current?.disconnect();
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