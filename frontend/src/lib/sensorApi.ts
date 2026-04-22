// Service for sensor-related API operations
import { fetchWithAuth } from './api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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
  async getHistoricalData(start?: string, end?: string) {
    let url = `${API_URL}/air/sensors/history`;
    
    // Add date range parameters if provided
    if (start && end) {
      url += `?start=${start}&end=${end}`;
    }
    
    const response = await fetchWithAuth(url);
    
    if (!response.ok) {
      throw new Error('Failed to fetch historical sensor data');
    }
    
    return response.json();
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
  }
};