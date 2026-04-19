// Service for analytics-related API operations
import { fetchWithAuth } from './api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface SensorStatistics {
  min: number;
  max: number;
  avg: number;
  stddev: number;
}

export const analyticsApi = {
  // Get historical sensor data for analytics with date range
  async getAnalyticsData(start: string, end: string) {
    const url = `${API_URL}/api/sensors/history?start=${start}&end=${end}`;
    
    const response = await fetchWithAuth(url);
    
    if (!response.ok) {
      throw new Error('Failed to fetch analytics data');
    }
    
    return response.json();
  },
  
  // Get statistics for a specific metric
  async getMetricStats(metricId: string, start: string, end: string): Promise<SensorStatistics> {
    const url = `${API_URL}/api/stats?metric=${metricId}&start=${start}&end=${end}`;
    
    const response = await fetchWithAuth(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch statistics for ${metricId}`);
    }
    
    return response.json();
  },
  
  // Format statistics for presentation
  formatStats(stats: SensorStatistics) {
    return {
      min: Number(stats.min).toFixed(1),
      max: Number(stats.max).toFixed(1),
      avg: Number(stats.avg).toFixed(1),
      std: Number(stats.stddev).toFixed(1)
    };
  }
};