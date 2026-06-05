import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://taskflow-ai-dashboard.onrender.com';

const axiosClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Interceptor tự động nhúng Token
axiosClient.interceptors.request.use((config) => {
    const token = localStorage.getItem('taskflow_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    
    // GÀI BỌ TRUY VẾT KHẨN CẤP ĐỂ TÌM THỦ PHẠM GỌI /tasks
    if (config.url && config.url.includes('/api/tasks')) {
      console.warn('[TRACE-DDoS] Lệnh gọi API Tasks được kích hoạt từ:');
      console.trace(); // TỬ HUYỆT BÓC TRẦN CALL STACK! SẼ BIẾT ĐÍCH XÁC FILE NÀO GỌI!
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
