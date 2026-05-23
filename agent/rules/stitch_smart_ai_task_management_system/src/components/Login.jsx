import React, { useState, useContext } from 'react';
import { AuthContext } from '../App.jsx';

export default function Login() {
  const { login } = useContext(AuthContext);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('https://taskflow-ai-dashboard.onrender.com/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          localStorage.setItem('facility_id', data.user.facility_id || 'ALL');
          login(data.user, data.token);
          return;
        } else {
          throw new Error(data.error || 'Lỗi đăng nhập');
        }
      } else {
        throw new Error('Backend down, fallback to local');
      }
    } catch (err) {
      // Check localStorage first
      const trimmedUser = username.trim();
      const trimmedPass = password.trim();
      
      try {
        const users = JSON.parse(localStorage.getItem('taskflow_users') || '[]');
        const foundUser = users.find(u => u.username.trim() === trimmedUser && (u.password === trimmedPass || u.password === btoa(trimmedPass)));
        
        if (foundUser) {
          if (foundUser.isActive === false) {
            setError('Tài khoản này đã bị khóa!');
            return;
          }
          let facId = foundUser.facility_id;
          if (!facId) {
            facId = foundUser.role === 'FACILITY_MANAGER' ? (foundUser.name || foundUser.username) : 'ALL';
          }
          localStorage.setItem('facility_id', facId);
          login(foundUser, 'mock-token-' + foundUser.username);
          return;
        }
      } catch (e) {
        console.error("Local storage auth error:", e);
      }

      // Hardcoded fallback
      if (trimmedUser === 'admin' && trimmedPass === 'admin123') {
        localStorage.setItem('facility_id', 'ALL');
        login({ name: 'Sếp Tổng', role: 'SUPER_ADMIN', facility_id: 'ALL' }, 'mock-admin');
      } else if (trimmedUser === 'manager1' && trimmedPass === 'manager123') {
        localStorage.setItem('facility_id', 'Cơ sở 1');
        login({ name: 'Quản lý Cơ sở 1', role: 'FACILITY_MANAGER', facility_id: 'Cơ sở 1' }, 'mock-manager');
      } else if (trimmedUser === 'sysadmin' && trimmedPass === 'admin123') {
        localStorage.setItem('facility_id', 'ALL');
        login({ name: 'Quản trị viên Hệ thống (IT)', role: 'ADMIN', facility_id: 'ALL' }, 'mock-sysadmin');
      } else {
        setError('Tài khoản hoặc mật khẩu không chính xác.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-container dark:bg-[#121212] relative overflow-hidden transition-colors w-full">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-3xl mix-blend-multiply animate-pulse"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/20 rounded-full blur-3xl mix-blend-multiply animate-pulse delay-1000"></div>

      <div className="glass-panel w-full max-w-md p-8 rounded-2xl shadow-2xl relative z-10 dark:bg-[#1e1e1e]/80">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary mx-auto flex items-center justify-center text-white shadow-lg shadow-primary/30 mb-4 transform rotate-3 hover:rotate-0 transition-transform">
            <span className="material-symbols-outlined text-3xl">hub</span>
          </div>
          <h1 className="text-2xl font-display font-bold text-on-surface dark:text-white">TaskFlow AI</h1>
          <p className="text-sm text-on-surface-variant dark:text-gray-400 mt-1">Hệ thống Điều phối Công việc Toàn chuỗi</p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-error-container text-on-error-container text-sm font-medium flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">error</span>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-on-surface dark:text-gray-300 mb-1.5">Tài khoản</label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">person</span>
              <input
                type="text"
                required
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-[#2a2a2a] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all dark:text-white"
                placeholder="admin"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-on-surface dark:text-gray-300 mb-1.5">Mật khẩu</label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">lock</span>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-[#2a2a2a] border border-outline-variant dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all dark:text-white"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-2.5 rounded-xl transition-all shadow-md shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
            ) : (
              <>
                Đăng nhập
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </>
            )}
          </button>
        </form>

      </div>
    </div>
  );
}

