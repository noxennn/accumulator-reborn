// Service for analytics-related API operations
import { fetchWithAuth } from './api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface SensorStatistics {
  metric: string;
  min: number;
  max: number;
  avg: number;
  stddev: number;
  min_time: string | null;
  max_time: string | null;
}

export interface AnalyticsDataPoint {
  timestamp: string;
  co2: number | null;
  voc: number | null;
  pm25: number | null;
  pm10: number | null;
  sample_count: number;
}

export interface AnalyticsMetricReport {
  metric: string;
  min: number | null;
  max: number | null;
  avg: number | null;
  stddev: number | null;
  min_time: string | null;
  max_time: string | null;
}

export interface AnalyticsReportResponse {
  start: string;
  end: string;
  period: string;
  period_seconds: number;
  point_count: number;
  points: AnalyticsDataPoint[];
  statistics: Record<string, AnalyticsMetricReport>;
}

export const analyticsApi = {
  async getAggregatedData(start: string, end: string, period: string) {
    const url = `${API_URL}/air/sensors/aggregated?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&period=${period}`;
    const response = await fetchWithAuth(url);
    if (!response.ok) throw new Error('Failed to fetch aggregated data');
    return response.json();
  },

  async getAnalyticsReport(start: string, end: string, period: string): Promise<AnalyticsReportResponse> {
    const url = `${API_URL}/air/analytics/report?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&period=${period}`;
    const response = await fetchWithAuth(url);
    if (!response.ok) throw new Error('Failed to fetch analytics report');
    return response.json();
  },

  // Get historical sensor data for analytics with date range
  async getAnalyticsData(start: string, end: string) {
    const url = `${API_URL}/air/sensors/history?start=${start}&end=${end}`;
    
    const response = await fetchWithAuth(url);
    
    if (!response.ok) {
      throw new Error('Failed to fetch analytics data');
    }
    
    return response.json();
  },
  
  // Get statistics for a specific metric
  async getMetricStats(metricId: string, start: string, end: string): Promise<SensorStatistics> {
    const url = `${API_URL}/air/stats?metric=${metricId}&start=${start}&end=${end}`;
    
    const response = await fetchWithAuth(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch statistics for ${metricId}`);
    }
    
    return response.json();
  },
  
  // Format statistics for presentation
  formatStats(stats: SensorStatistics) {
    const formatNumber = (value: number | null | undefined, digits = 1) => (
      value === null || value === undefined || Number.isNaN(Number(value))
        ? '-'
        : Number(value).toFixed(digits)
    );

    return {
      min: formatNumber(stats.min),
      max: formatNumber(stats.max),
      avg: formatNumber(stats.avg),
      std: formatNumber(stats.stddev)
    };
  }
};