import axios from 'axios';

/**
 * Axios client for the BFF (Next.js API routes, same origin — ADR-0001).
 * The legacy Flask base URL is gone; routes live under /api/*.
 */
const api = axios.create({
  baseURL: '',
});

export default api;
