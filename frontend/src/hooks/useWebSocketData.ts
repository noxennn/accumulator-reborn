import { useEffect, useRef, useState, useCallback } from 'react';
import { sensorApi } from '../lib/sensorApi';

export interface ThresholdStatus {
  co2: 'green' | 'yellow' | 'red';
  voc: 'green' | 'yellow' | 'red';
  pm25: 'green' | 'yellow' | 'red';
  pm10: 'green' | 'yellow' | 'red';
}

export interface LiveDataPoint {
  timestamp: string;
  co2: number;
  voc: number;
  pm25: number;
  pm10: number;
  threshold_status?: ThresholdStatus;
}

export interface LogEntry {
  type: 'log';
  timestamp: string;
  message: string;
}

export interface InvalidEntry {
  type: 'invalid';
  timestamp: string;
  field: string;
  value: number;
  reason: string;
  co2: number;
  voc: number;
  pm25: number;
  pm10: number;
}

export interface DeviceEventEntry {
  type: 'event';
  timestamp: string;
  event_type: string;
  source?: string;
  reason?: string;
  payload?: unknown;
}

export interface ArduinoStatus {
  is_connected: boolean;
  first_connected: string | null;
  last_disconnected: string | null;
}

const MAX_RENDER_POINTS = 50;

export function useWebSocketData() {
  const [dataBuffer, setDataBuffer] = useState<LiveDataPoint[]>([]);
  const [logsBuffer, setLogsBuffer] = useState<LogEntry[]>([]);
  const [invalidBuffer, setInvalidBuffer] = useState<InvalidEntry[]>([]);
  const [eventBuffer, setEventBuffer] = useState<DeviceEventEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [arduinoStatus, setArduinoStatus] = useState<ArduinoStatus>({
    is_connected: false,
    first_connected: null,
    last_disconnected: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);
  const isHydratedRef = useRef(false);
  const seenTimestampsRef = useRef<Set<string>>(new Set());

  const hydrateInitialData = useCallback(async () => {
    if (isHydratedRef.current || !isMounted.current) return;
    try {
      const initial = await sensorApi.getHistoricalData(undefined, undefined, {
        limit: MAX_RENDER_POINTS,
        chronological: true,
      });
      if (!isMounted.current) return;

      const unique: LiveDataPoint[] = [];
      const seen = new Set<string>();
      for (const item of initial as LiveDataPoint[]) {
        if (!item?.timestamp || seen.has(item.timestamp)) continue;
        seen.add(item.timestamp);
        unique.push(item);
      }

      setDataBuffer(unique.slice(-MAX_RENDER_POINTS));
      seenTimestampsRef.current = new Set(unique.slice(-MAX_RENDER_POINTS).map(p => p.timestamp));
      isHydratedRef.current = true;
    } catch {
      if (!isMounted.current) return;
      setError(prev => prev ?? 'Initial history load failed');
    }
  }, []);

  const connect = useCallback(() => {
    if (!isMounted.current) return;

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    const baseWsUrl =
      import.meta.env.VITE_WS_URL ||
      apiUrl.replace(/^http/, 'ws') + '/ws/live';

    // Attach auth token so the backend can resolve per-user thresholds for colour coding.
    const token = localStorage.getItem('access_token');
    const wsUrl = token ? `${baseWsUrl}?token=${encodeURIComponent(token)}` : baseWsUrl;

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
        const msg = JSON.parse(event.data as string);
        if (msg.type === 'log') {
          setLogsBuffer(prev => [...prev, msg as LogEntry].slice(-MAX_RENDER_POINTS));
        } else if (msg.type === 'invalid') {
          setInvalidBuffer(prev => [...prev, msg as InvalidEntry].slice(-MAX_RENDER_POINTS));
        } else if (msg.type === 'event') {
          setEventBuffer(prev => [...prev, msg as DeviceEventEntry].slice(-MAX_RENDER_POINTS));
        } else if (msg.type === 'arduino_status') {
          setArduinoStatus({
            is_connected: msg.is_connected,
            first_connected: msg.first_connected ?? null,
            last_disconnected: msg.last_disconnected ?? null,
          });
        } else {
          // type === 'data' or legacy (no type)
          const point = msg as LiveDataPoint;
          if (seenTimestampsRef.current.has(point.timestamp)) return;
          seenTimestampsRef.current.add(point.timestamp);
          setDataBuffer(prev => {
            const updated = [...prev, point];
            if (updated.length <= MAX_RENDER_POINTS) return updated;
            const trimmed = updated.slice(-MAX_RENDER_POINTS);
            seenTimestampsRef.current = new Set(trimmed.map(p => p.timestamp));
            return trimmed;
          });
        }
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
    hydrateInitialData();
    connect();
    return () => {
      isMounted.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect, hydrateInitialData]);

  return { dataBuffer, logsBuffer, invalidBuffer, eventBuffer, isConnected, error, arduinoStatus };
}
