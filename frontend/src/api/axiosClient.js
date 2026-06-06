import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://taskflow-ai-dashboard.onrender.com';

const axiosClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Cache trượt thời gian (Sliding Window) để chống DDoS ở Frontend
const taskApiRateLimiter = {
    timestamps: []
};

// Interceptor tự động nhúng Token và Rate Limiter
axiosClient.interceptors.request.use((config) => {
    const token = localStorage.getItem('taskflow_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    
    // RÀO CHẮN BĂNG THÔNG CHO ENDPOINT /tasks
    if (config.url && config.url.includes('/api/tasks')) {
        const now = Date.now();
        // Lọc để chỉ giữ lại các mốc thời gian trong vòng 1 giây qua (1000ms)
        taskApiRateLimiter.timestamps = taskApiRateLimiter.timestamps.filter(ts => now - ts < 1000);
        
        // Ngưỡng cứng: 3 requests / giây
        if (taskApiRateLimiter.timestamps.length >= 3) {
            console.warn('[Network Shield] DDoS Protection: Đã chặn Request tới /api/tasks (Vượt ngưỡng 3 requests/giây)');
            // Ném lỗi CancelError để hủy Request ngay từ trong kén, không cho gửi đi
            throw new axios.Cancel('DDoS Protection: Bị chặn bởi Frontend Network Shield');
        }
        
        // Đẩy thời điểm request hợp lệ vào mảng
        taskApiRateLimiter.timestamps.push(now);
    }
    
    return config;
});

// Interceptor xử lý lỗi 401 tập trung
axiosClient.interceptors.response.use(
    (response) => response.data,
    (error) => {
        if (error.response && error.response.status === 401) {
            localStorage.removeItem('taskflow_token');
            localStorage.removeItem('token');
            localStorage.removeItem('taskflow_auth');
            window.location.href = '/login'; // Force logout
        }
        return Promise.reject(error);
    }
);

export default axiosClient;
