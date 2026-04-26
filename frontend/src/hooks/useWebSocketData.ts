import { useEffect, useRef, useState, useCallback } from 'react';

export interface LiveDataPoint {
  timestamp: string;
  co2: number;
  voc: number;
  pm25: number;
  pm10: number;
}

const MAX_BUFFER_SECONDS = 60;

export function useWebSocketData() {
  const [dataBuffer, setDataBuffer] = useState<LiveDataPoint[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  const connect = useCallback(() => {
    if (!isMounted.current) return;

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    const wsUrl =
      import.meta.env.VITE_WS_URL ||
      apiUrl.replace(/^http/, 'ws') + '/ws/live';

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isMounted.current) return;
      setIsConnected(true);
      setError(null);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!isMounted.current) return;
      try {
        const point: LiveDataPoint = JSON.parse(event.data as string);
        const cutoff = Date.now() - MAX_BUFFER_SECONDS * 1000;
        setDataBuffer(prev => {
          const updated = [...prev, point].filter(
            p => new Date(p.timestamp).getTime() >= cutoff
          );
          return updated;
        });
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!isMounted.current) return;
      setIsConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      if (!isMounted.current) return;
      setError('WebSocket connection error');
      ws.close();
    };
  }, []);

  useEffect(() => {
    isMounted.current = true;
    connect();
    return () => {
      isMounted.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { dataBuffer, isConnected, error };
}
