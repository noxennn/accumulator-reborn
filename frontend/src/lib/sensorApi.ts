// Service for sensor-related API operations
import { fetchWithAuth } from './api';
import { addHours } from 'date-fns';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Helper function to convert dates to Turkish time (UTC+3)
export const convertToTurkishTime = (date: Date): string => {
  // Add 3 hours to convert to Turkish time (UTC+3)
  const turkishDate = addHours(date, 3);
  return turkishDate.toISOString();
};

export const sensorApi = {
  // Get current sensor data
  async getCurrentData() {
    const response = await fetchWithAuth(`${API_URL}/api/sensors/current`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch current sensor data');
    }
    
    return response.json();
  },

  // Get historical sensor data with optional date range
  async getHistoricalData(start?: string, end?: string) {
    let url = `${API_URL}/api/sensors/history`;
    
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
    let url = `${API_URL}/api/stats?metric=${metricId}`;
    
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