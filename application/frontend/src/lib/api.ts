import axios from 'axios';

const getBaseUrl = () => {
  // For local development, use the environment variable.
  // In a production/container environment, this variable may not be set.
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }

  // If running in the browser, dynamically construct the URL.
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:5001`;
  }

  // Fallback for other environments (like SSR) - though less likely to be used for API calls
  // that need a dynamic IP. You might want to log a warning here if this case is hit unexpectedly.
  return 'http://localhost:5001';
};

const baseURL = getBaseUrl();
console.log('API baseURL:', baseURL);

const api = axios.create({
  baseURL,
});

export { baseURL };
export default api;