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

  // Always keep the latest callbacks in a ref so the WebSocketService
  // never calls a stale closure — critical for query invalidation.
  const onMessageRef = useRef(onMessage);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onErrorRef = useRef(onError);

  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  useEffect(() => { onConnectRef.current = onConnect; }, [onConnect]);
  useEffect(() => { onDisconnectRef.current = onDisconnect; }, [onDisconnect]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    if (!url) return;

    wsRef.current = new WebSocketService({
      url,
      initialDelay: initialRetryDelayMs,
      maxDelay: maxRetryDelayMs,
      maxRetries,
      // Stable wrappers that always delegate to the latest ref value.
      onMessage: (data) => onMessageRef.current?.(data),
      onOpen: () => {
        setIsConnected(true);
        onConnectRef.current?.();
      },
      onClose: () => {
        setIsConnected(false);
        onDisconnectRef.current?.();
      },
      onError: (err) => onErrorRef.current?.(err),
    });

    if (autoConnect) {
      wsRef.current.connect();
    }

    return () => {
      wsRef.current?.disconnect();
      wsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const send = useCallback((data: unknown) => {
    if (!wsRef.current?.isConnected()) {
      console.warn('WebSocket is not connected. Message will be queued.');
    }
    wsRef.current?.send(data);
  }, []);

  const connect = useCallback(() => {
    wsRef.current?.connect();
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.disconnect();
  }, []);

  return { isConnected, send, connect, disconnect };
}
