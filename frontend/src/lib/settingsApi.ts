// Service for settings-related API operations
import { fetchWithAuth } from './api';
import { UserSettings } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const settingsApi = {
  // Get user settings
  async getSettings(): Promise<UserSettings> {
    const response = await fetchWithAuth(`${API_URL}/api/settings`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch settings');
    }
    
    return response.json();
  },

  // Update user settings
  async updateSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
    const response = await fetchWithAuth(`${API_URL}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settings),
    });
    
    if (!response.ok) {
      throw new Error('Failed to save settings');
    }
    
    return response.json();
  }
};