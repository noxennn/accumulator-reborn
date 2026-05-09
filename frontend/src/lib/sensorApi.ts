// Service for sensor-related API operations
import { fetchWithAuth } from './api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface HistoryQueryOptions {
  limit?: number;
  chronological?: boolean;
}

export interface WatchSeriesPoint {
  bucket_start: string;
  log_count: number;
  invalid_count: number;
  restart_warning_count: number;
  invalid_by_field: {
    co2: number;
    voc: number;
    pm25: number;
    pm10: number;
    missing: number;
    other: number;
  };
}

export interface WatchPeriodSeries {
  granularity: string;
  points: WatchSeriesPoint[];
}

export interface WatchPeriodSeriesResponse {
  day: WatchPeriodSeries;
  week: WatchPeriodSeries;
  month: WatchPeriodSeries;
}

export const sensorApi = {
  // Get current sensor data
  async getCurrentData() {
    const response = await fetchWithAuth(`${API_URL}/air/sensors/current`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch current sensor data');
    }
    
    return response.json();
  },

  // Get historical sensor data with optional date range
  async getHistoricalData(start?: string, end?: string, options?: HistoryQueryOptions) {
    let url = `${API_URL}/air/sensors/history`;

    const params = new URLSearchParams();
    if (start && end) {
      params.set('start', start);
      params.set('end', end);
    }
    if (options?.limit) {
      params.set('limit', String(options.limit));
    }
    if (typeof options?.chronological === 'boolean') {
      params.set('chronological', String(options.chronological));
    }
    const qs = params.toString();
    if (qs) {
      url += `?${qs}`;
    }
    
    const response = await fetchWithAuth(url);
    
    if (!response.ok) {
      throw new Error('Failed to fetch historical sensor data');
    }
    
    return response.json();
  },

  // Get intervals where sensor values exceeded user thresholds
  async getExceededIntervals(start: string, end: string) {
    const url = `${API_URL}/air/sensors/exceeded-intervals?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    const response = await fetchWithAuth(url);
    if (!response.ok) {
      throw new Error('Failed to fetch exceeded intervals');
    }
    return response.json() as Promise<Array<{
      metric: string;
      start: string;
      end: string;
      threshold: number;
      max_value: number;
      avg_value: number;
      duration_minutes: number;
    }>>;
  },

  // Get statistics for a specific sensor metric
  async getSensorStats(metricId: string, start?: string, end?: string) {
    let url = `${API_URL}/air/stats?metric=${metricId}`;
    
    // Add date range parameters if provided
    if (start && end) {
      url += `&start=${start}&end=${end}`;
    }
    
    const response = await fetchWithAuth(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch stats for ${metricId}`);
    }
    
    return response.json();
  },

  async getWatchPeriodSeries(): Promise<WatchPeriodSeriesResponse> {
    const response = await fetchWithAuth(`${API_URL}/air/watch/period-series`);
    if (!response.ok) {
      throw new Error('Failed to fetch watch period series');
    }
    return response.json();
  }
};