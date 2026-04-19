// API endpoint configuration
const API_URL = 'http://localhost:8000';

// Authentication API endpoints
interface LoginCredentials {
  username: string;  // FastAPI OAuth2 form expects "username" field
  password: string;
}

interface RegisterCredentials {
  email: string;
  password: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
}

interface UserData {
  id: number;
  email: string;
}

// Auth service functions
export const authApi = {
  // Login function
  async login(credentials: { email: string, password: string }): Promise<TokenResponse> {
    const formData = new FormData();
    formData.append('username', credentials.email); // FastAPI OAuth2 expects "username"
    formData.append('password', credentials.password);

    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || 'Login failed');
    }

    const data = await response.json();
    
    // Store token in localStorage
    localStorage.setItem('access_token', data.access_token);
    
    return data;
  },

  // Register function
  async register(credentials: RegisterCredentials): Promise<UserData> {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || 'Registration failed');
    }

    return response.json();
  },

  // Get current user profile
  async getCurrentUser(): Promise<UserData | null> {
    const token = localStorage.getItem('access_token');
    
    if (!token) {
      return null;
    }

    const response = await fetch(`${API_URL}/auth/me`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token expired or invalid
        localStorage.removeItem('access_token');
        return null;
      }
      throw new Error('Failed to fetch user data');
    }

    return response.json();
  },

  // Check if user is authenticated
  isAuthenticated(): boolean {
    return !!localStorage.getItem('access_token');
  },

  // Logout function
  logout(): void {
    localStorage.removeItem('access_token');
  },

  // Get auth token
  getToken(): string | null {
    return localStorage.getItem('access_token');
  }
};

// Create a reusable fetch function with authentication
export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('access_token');
  
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Handle 401 Unauthorized errors
  if (response.status === 401) {
    localStorage.removeItem('access_token');
    window.location.href = '/login'; // Redirect to login
    throw new Error('Session expired. Please login again.');
  }

  return response;
}

// API for settings and other data
export const api = {
  async getSettings() {
    const response = await fetchWithAuth(`${API_URL}/api/settings`);
    if (!response.ok) {
      throw new Error('Failed to fetch settings');
    }
    return response.json();
  },

  async updateSettings(settings: any) {
    const response = await fetchWithAuth(`${API_URL}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settings),
    });
    
    if (!response.ok) {
      throw new Error('Failed to update settings');
    }
    
    return response.json();
  },
  
  // Add other API methods as needed
}