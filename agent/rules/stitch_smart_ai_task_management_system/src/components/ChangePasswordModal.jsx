import React, { useState } from 'react';

export default function ChangePasswordModal({ user, onClose, onSuccess }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const newErrors = {};
    if (!currentPassword) newErrors.current = 'Vui lòng nhập mật khẩu hiện tại';
    if (!newPassword) newErrors.new = 'Vui lòng nhập mật khẩu mới';
    if (newPassword && newPassword.length < 6) newErrors.new = 'Mật khẩu mới phải có ít nhất 6 ký tự';
    if (newPassword !== confirmPassword) newErrors.confirm = 'Xác nhận mật khẩu không khớp';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setIsLoading(true);

    try {
      const token = JSON.parse(localStorage.getItem('taskflow_auth') || '{}').token;
      let effectiveUsername = user.username;
      if (!effectiveUsername) {
        if (user.role === 'SUPER_ADMIN') effectiveUsername = 'admin';
        else if (user.role === 'FACILITY_MANAGER') effectiveUsername = 'manager1';
        else if (user.role === 'ADMIN') effectiveUsername = 'sysadmin';
        else effectiveUsername = user.email || user.name;
      }

      const response = await fetch('https://taskflow-ai-dashboard.onrender.com/api/users/change-password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-user-role': user.role,
          'x-facility-id': localStorage.getItem('facility_id') || user.facility_id || 'ALL'
        },
        body: JSON.stringify({
          username: effectiveUsername,
          currentPassword,
          newPassword
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        setErrors({ current: data.error || 'Lỗi khi đổi mật khẩu' });
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
      if (window.showToast) window.showToast('Đổi mật khẩu thành công! Vui lòng đăng nhập lại.', 'success');
      onSuccess();
    } catch (error) {
      console.error("Lỗi đổi mật khẩu:", error);
      setErrors({ current: 'Không thể kết nối đến máy chủ.' });
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in px-4">
      <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-gray-100 dark:border-gray-800 animate-slide-up">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-[#252525]">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">lock_reset</span> Đổi mật khẩu
          </h3>
          <button onClick={onClose} disabled={isLoading} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Mật khẩu hiện tại</label>
            <input 
              type="password" 
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={isLoading}
              className={`w-full px-4 py-2.5 rounded-xl border ${errors.current ? 'border-error bg-error/5 focus:border-error focus:ring-error/20' : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] focus:border-primary focus:ring-primary/20'} outline-none transition-all dark:text-white`}
              placeholder="Nhập mật khẩu hiện tại"
            />
            {errors.current && <p className="text-error text-xs mt-1.5">{errors.current}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Mật khẩu mới</label>
            <input 
              type="password" 
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={isLoading}
              className={`w-full px-4 py-2.5 rounded-xl border ${errors.new ? 'border-error bg-error/5 focus:border-error focus:ring-error/20' : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] focus:border-primary focus:ring-primary/20'} outline-none transition-all dark:text-white`}
              placeholder="Nhập mật khẩu mới"
            />
            {errors.new && <p className="text-error text-xs mt-1.5">{errors.new}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Xác nhận mật khẩu mới</label>
            <input 
              type="password" 
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading}
              className={`w-full px-4 py-2.5 rounded-xl border ${errors.confirm ? 'border-error bg-error/5 focus:border-error focus:ring-error/20' : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] focus:border-primary focus:ring-primary/20'} outline-none transition-all dark:text-white`}
              placeholder="Nhập lại mật khẩu mới"
            />
            {errors.confirm && <p className="text-error text-xs mt-1.5">{errors.confirm}</p>}
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <button 
              type="button" 
              onClick={onClose}
              disabled={isLoading}
              className="px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors"
            >
              Hủy
            </button>
            <button 
              type="submit"
              disabled={isLoading}
              className="px-5 py-2.5 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-xl transition-all shadow-md shadow-primary/20 flex items-center justify-center min-w-[120px]"
            >
              {isLoading ? <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span> : 'Xác nhận đổi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
