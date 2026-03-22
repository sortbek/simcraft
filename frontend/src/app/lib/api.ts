// API URL detection: desktop app uses a fixed local server port
// Use 127.0.0.1 (not localhost) to match the backend bind address and avoid
// IPv6 resolution issues on Windows where localhost may resolve to ::1
export const API_URL =
  typeof window !== "undefined" && window.electronAPI
    ? "http://127.0.0.1:17384"
    : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000");
