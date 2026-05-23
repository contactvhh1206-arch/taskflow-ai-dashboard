import React, { useState, useEffect, useRef } from 'react';

const HIGH_LEVEL_ROLES = ['SUPER_ADMIN', 'VICE_PRESIDENT', 'GENERAL_MANAGER', 'ADMIN'];

const SYSTEM_ROLES = [
  { value: 'FACILITY_MANAGER', label: 'Quản lý cơ sở' },
  { value: 'DEPARTMENT_HEAD', label: 'Bộ phận Marketing' },
  { value: 'FINANCE_DEPT', label: 'Bộ phận Tài chính - Kế toán' },
  { value: 'GENERAL_MANAGER', label: 'Tổng quản lý chuỗi' },
  { value: 'VICE_PRESIDENT', label: 'Phó tổng' },
  { value: 'SUPER_ADMIN', label: 'Sếp tổng' },
  { value: 'ADMIN', label: 'Admin Hệ thống' }
];

export default function AdminConfigPanel({ showToast, tasks, setTasks, setTaskComments, user }) {
      const [users, setUsers] = useState([]);
      const [facilities, setFacilities] = useState([]);
      const [activeTab, setActiveTab] = useState('facilities');

      const [editingUser, setEditingUser] = useState(null);
      const [editUserName, setEditUserName] = useState('');
      const [editUserRole, setEditUserRole] = useState('');
      const [editUserFacility, setEditUserFacility] = useState('');
      const [editUserPassword, setEditUserPassword] = useState('');

      const [newFacName, setNewFacName] = useState('');
      const [newFacAddress, setNewFacAddress] = useState('');
      const [newFacPic, setNewFacPic] = useState('');
      const [isAddingFac, setIsAddingFac] = useState(false);

      const [newUsername, setNewUsername] = useState('');
      const [newPassword, setNewPassword] = useState('');
      const [newName, setNewName] = useState('');
      const [newRole, setNewRole] = useState('FACILITY_MANAGER');
      const [newFacilityId, setNewFacilityId] = useState('Cơ sở 1');
      const [newFinanceFacilities, setNewFinanceFacilities] = useState(['ALL']);

      const [editingFac, setEditingFac] = useState(null);
      const [editFacName, setEditFacName] = useState('');
      const [editFacAddress, setEditFacAddress] = useState('');
      const [editFacPic, setEditFacPic] = useState('');
      const [isUpdatingFac, setIsUpdatingFac] = useState(false);
      const [editFinanceFacilities, setEditFinanceFacilities] = useState(['ALL']);

      const [deletingFac, setDeletingFac] = useState(null);
      const [deletingUser, setDeletingUser] = useState(null);

      const [showResetModal, setShowResetModal] = useState(false);
      const [resetConfirmText, setResetConfirmText] = useState('');
      const [resetPassword, setResetPassword] = useState('');
      const [isResetting, setIsResetting] = useState(false);
      const isProduction = false;

      const handleResetSystem = () => {
         if (isProduction) return;
         if (resetConfirmText !== 'CONFIRM RESET SYSTEM') return;
         if (btoa(resetPassword) !== user.password && resetPassword !== user.password) {
            if (showToast) showToast('❌ Mật khẩu Admin không chính xác!');
            return;
         }
         
         setIsResetting(true);
         setTimeout(() => {
            try {
               // 1. Backup system configurations
               const users = JSON.parse(localStorage.getItem('taskflow_users') || '[]');
               const auth = localStorage.getItem('taskflow_auth');
               const aiConfig = localStorage.getItem('taskflow_ai_config');
               const sysPrompts = localStorage.getItem('taskflow_system_prompts');
               const kpiConfig = localStorage.getItem('taskflow_facility_kpis');

               // 2. NUCLEAR OPTION: Purge State & Cache
               localStorage.clear();
               sessionStorage.clear();
               
               // Purge Service Workers (Mock API interceptors)
               if ('serviceWorker' in navigator) {
                  navigator.serviceWorker.getRegistrations().then(function(registrations) {
                     for (let registration of registrations) {
                        registration.unregister();
                     }
                  });
               }
               
               // Purge Browser Cache API
               if ('caches' in window) {
                  caches.keys().then(function(names) {
                     for (let name of names) caches.delete(name);
                  });
               }
               
               // 3. Seed exact 6 standard facilities
               const seedFacilities = [
                  { id: 'f_db41', name: 'DB41', address: '', pic: '' },
                  { id: 'f_dbace', name: 'DBACE', address: '', pic: '' },
                  { id: 'f_dbpq', name: 'DBPQ', address: '', pic: '' },
                  { id: 'f_dbpa', name: 'DBPA', address: '', pic: '' },
                  { id: 'f_dbpav', name: 'DBPAV', address: '', pic: '' },
                  { id: 'f_dbpak', name: 'DBPAK', address: '', pic: '' }
               ];
               localStorage.setItem('taskflow_facilities', JSON.stringify(seedFacilities));

               // 4. Restore Users & clear their mapped facilities
               const updatedUsers = users.map(u => {
                  if (u.role === 'FACILITY_MANAGER' || (typeof u.facility_id === 'string' && u.facility_id !== 'ALL')) {
                     return { ...u, facility_id: '' };
                  }
                  return u;
               });
               localStorage.setItem('taskflow_users', JSON.stringify(updatedUsers));
               
               // 5. Restore configs
               if (auth) localStorage.setItem('taskflow_auth', auth);
               if (aiConfig) localStorage.setItem('taskflow_ai_config', aiConfig);
               if (sysPrompts) localStorage.setItem('taskflow_system_prompts', sysPrompts);
               if (kpiConfig) localStorage.setItem('taskflow_facility_kpis', kpiConfig);
               
               // 6. Transaction Commit
               console.log("[DB] TRUNCATE Tasks committed. Status 200 OK.");
               window.location.reload(true); // force reload from server
            } catch (error) {
               console.error("[DB] Lỗi Transaction:", error);
               setIsResetting(false);
               if (typeof showToast === 'function') showToast('❌ Reset thất bại (HTTP 500). Lỗi ghi xuống Backend!');
            }
         }, 2500);
      };

      useEffect(() => {
        setUsers(JSON.parse(localStorage.getItem('taskflow_users') || '[]'));
        setFacilities(JSON.parse(localStorage.getItem('taskflow_facilities') || '[]'));
      }, []);

      const saveUsers = (newUsers) => {
        setUsers(newUsers);
        localStorage.setItem('taskflow_users', JSON.stringify(newUsers));
      };

      const saveFacilities = (newFacs) => {
        setFacilities(newFacs);
        localStorage.setItem('taskflow_facilities', JSON.stringify(newFacs));
      };

      const handleAddFacility = (e) => {
        e.preventDefault();
        if (!newFacName) return;
        setIsAddingFac(true);

        setTimeout(() => {
          const newId = 'f' + Date.now();
          const selectedUser = users.find(u => u.username === newFacPic);
          const picName = selectedUser ? selectedUser.name : newFacPic;

          const newFacs = [...facilities, { id: newId, name: newFacName, address: newFacAddress, pic: picName }];
          saveFacilities(newFacs);

          if (newFacPic) {
            const updatedUsers = users.map(u => u.username === newFacPic ? { ...u, facility_id: newFacName } : u);
            saveUsers(updatedUsers);
          }

          setNewFacName(''); setNewFacAddress(''); setNewFacPic('');
          setIsAddingFac(false);
          if (showToast) showToast(`Thêm cơ sở ${newFacName} thành công!`);
        }, 800);
      };

      const handleAddUser = (e) => {
        e.preventDefault();
        if (!newUsername || !newPassword || !newName) return;
        if (users.find(u => u.username === newUsername)) {
          alert('Tài khoản đã tồn tại!');
          return;
        }
        const newUser = {
          id: 'u' + Date.now(),
          username: newUsername,
          password: btoa(newPassword),
          name: newName,
          role: newRole,
          facility_id: ['FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(newRole) ? newFinanceFacilities : HIGH_LEVEL_ROLES.includes(newRole) ? 'ALL' : newFacilityId,
          isActive: true
        };
        const newUsers = [...users, newUser];
        saveUsers(newUsers);
        setNewUsername(''); setNewPassword(''); setNewName('');
      };

      const openEditModal = (fac) => {
        setEditingFac(fac);
        setEditFacName(fac.name);
        setEditFacAddress(fac.address || '');
        const picUser = users.find(u => u.name === fac.pic);
        setEditFacPic(picUser ? picUser.username : '');
      };

      const handleUpdateFacility = (e) => {
        e.preventDefault();
        setIsUpdatingFac(true);
        setTimeout(() => {
          const oldPicName = editingFac.pic;
          const selectedUser = users.find(u => u.username === editFacPic);
          const newPicName = selectedUser ? selectedUser.name : '';

          const updatedFacs = facilities.map(f => f.id === editingFac.id ? { ...f, name: editFacName, address: editFacAddress, pic: newPicName } : f);
          saveFacilities(updatedFacs);

          let updatedUsers = [...users];
          const oldPicUser = users.find(u => u.name === oldPicName);
          if (oldPicUser && oldPicUser.username !== editFacPic) {
            updatedUsers = updatedUsers.map(u => u.username === oldPicUser.username ? { ...u, facility_id: 'Cơ sở 1' } : u);
          }
          if (editFacPic) {
            updatedUsers = updatedUsers.map(u => u.username === editFacPic ? { ...u, facility_id: editFacName } : u);
          }
          saveUsers(updatedUsers);

          setIsUpdatingFac(false);
          setEditingFac(null);
          if (showToast) showToast(`Cập nhật cơ sở ${editFacName} thành công!`);
        }, 800);
      };

      const handleDeleteFacility = () => {
        if (!deletingFac) return;
        const openTasks = tasks?.filter(t => t.facility === deletingFac.name && t.status !== 'done' && t.status !== 'revoked') || [];
        if (openTasks.length > 0) {
          if (showToast) showToast(`❌ Lỗi: Cơ sở đang có ${openTasks.length} công việc chưa hoàn thành! Không thể xóa.`);
          setDeletingFac(null);
          return;
        }
        const updatedFacs = facilities.map(f => f.id === deletingFac.id ? { ...f, is_deleted: true } : f);
        saveFacilities(updatedFacs);
        setDeletingFac(null);
        if (showToast) showToast(`Đã xóa cơ sở ${deletingFac.name}`);
      };

      const handleDeleteUser = () => {
        if (!deletingUser) return;
        if (deletingUser.id === user.id) {
           if (showToast) showToast('❌ Lỗi 403 Forbidden: Không thể tự xóa chính mình!');
           setDeletingUser(null);
           return;
        }

        // 1. Cascade Delete Tasks
        if (setTasks) {
          setTasks(prev => prev.filter(t => t.pic !== deletingUser.username && t.pic !== deletingUser.name));
        }

        // 2. Cascade Delete Comments (Chat Logs)
        if (setTaskComments) {
          setTaskComments(prev => {
            const newComments = {};
            Object.keys(prev).forEach(taskId => {
              newComments[taskId] = prev[taskId].filter(c => c.sender !== deletingUser.name && c.sender !== deletingUser.username);
            });
            return newComments;
          });
        }

        // 3. Xóa các bản ghi Check_in (nếu có)
        try {
           const checkins = JSON.parse(localStorage.getItem('taskflow_checkins') || '[]');
           const newCheckins = checkins.filter(c => c.username !== deletingUser.username && c.userId !== deletingUser.id);
           localStorage.setItem('taskflow_checkins', JSON.stringify(newCheckins));
        } catch(e) {}

        // 4. Hard Delete User
        const updatedUsers = users.filter(u => u.id !== deletingUser.id);
        saveUsers(updatedUsers);

        setDeletingUser(null);
        if (showToast) showToast(`Đã dọn dẹp sạch sẽ tài khoản ${deletingUser.username} và toàn bộ dữ liệu liên quan`);
      };

      const handleUpdateUser = (e) => {
        e.preventDefault();
        if (!editingUser) return;

        if (editingUser.id === user.id && editUserRole !== user.role && (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN')) {
          if (showToast) showToast('❌ Lỗi: Bạn không thể tự thay đổi quyền của chính mình!');
          return;
        }

        const updatedUsers = users.map(u => {
          if (u.id === editingUser.id) {
            return {
              ...u,
              name: editUserName,
              role: editUserRole,
              facility_id: ['FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(editUserRole) ? editFinanceFacilities : HIGH_LEVEL_ROLES.includes(editUserRole) ? 'ALL' : editUserFacility,
              password: editUserPassword ? btoa(editUserPassword) : u.password
            };
          }
          return u;
        });
        saveUsers(updatedUsers);
        setEditingUser(null);
        if (showToast) showToast(`Cập nhật thành công tài khoản ${editingUser.username}`);
      };

      const toggleUserActive = (userId) => {
        if (userId === user.id) {
           if (showToast) showToast('❌ Lỗi 403 Forbidden: Không thể tự khóa chính mình!');
           return;
        }
        const newUsers = users.map(u => u.id === userId ? { ...u, isActive: !u.isActive } : u);
        saveUsers(newUsers);
      };

      return (
        <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-sm border border-outline-variant dark:border-gray-800 animate-fade-in flex flex-col h-[75vh]">
          <div className="p-4 border-b border-outline-variant dark:border-gray-800 bg-gradient-to-r from-primary/10 to-transparent flex gap-4">
            <button onClick={() => setActiveTab('facilities')} className={`px-4 py-2 rounded-lg font-bold transition-all ${activeTab === 'facilities' ? 'bg-primary text-white shadow-md' : 'text-gray-500 hover:bg-surface-variant dark:hover:bg-gray-800'}`}>Quản lý Cơ sở</button>
            <button onClick={() => setActiveTab('users')} className={`px-4 py-2 rounded-lg font-bold transition-all ${activeTab === 'users' ? 'bg-primary text-white shadow-md' : 'text-gray-500 hover:bg-surface-variant dark:hover:bg-gray-800'}`}>Quản lý Tài khoản</button>
            {user.role === 'ADMIN' && (
               <button onClick={() => setActiveTab('maintenance')} className={`px-4 py-2 rounded-lg font-bold transition-all ${activeTab === 'maintenance' ? 'bg-error text-white shadow-md' : 'text-error hover:bg-error/10 border border-transparent dark:hover:bg-red-900/20'}`}>Cấu hình Nâng cao / Bảo trì</button>
            )}
          </div>
          <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
            {activeTab === 'facilities' ? (
              <div className="space-y-6">
                <div className="bg-surface-container-low dark:bg-[#252525] p-5 rounded-xl border border-outline-variant dark:border-gray-700">
                  <h3 className="font-bold mb-4 dark:text-white flex items-center gap-2"><span className="material-symbols-outlined text-primary">add_circle</span> Thêm cơ sở mới</h3>
                  <form onSubmit={handleAddFacility} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Tên cơ sở *</label>
                      <input required type="text" value={newFacName} onChange={e => setNewFacName(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-primary dark:text-white transition-colors" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Địa chỉ</label>
                      <input type="text" value={newFacAddress} onChange={e => setNewFacAddress(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-primary dark:text-white transition-colors" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Quản lý phụ trách (PIC)</label>
                      <select value={newFacPic} onChange={e => setNewFacPic(e.target.value)} className="w-full pl-3 pr-8 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-primary dark:text-white transition-colors text-ellipsis overflow-hidden whitespace-nowrap">
                        <option value="">-- Chưa phân công --</option>
                        {users.filter(u => u.role === 'FACILITY_MANAGER').map(u => (
                          <option key={u.id} value={u.username}>{u.name} ({u.username})</option>
                        ))}
                      </select>
                    </div>
                    <button type="submit" disabled={isAddingFac} className="bg-primary hover:bg-primary/90 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-bold text-sm shadow-md shadow-primary/20 flex justify-center items-center h-[38px] gap-2 transition-all">
                      {isAddingFac ? <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> : <span className="material-symbols-outlined text-[18px]">save</span>} Lưu
                    </button>
                  </form>
                </div>
                <div>
                  <h3 className="font-bold mb-3 dark:text-white flex items-center gap-2"><span className="material-symbols-outlined text-secondary">corporate_fare</span> Danh sách Cơ sở ({facilities.filter(f => !f.is_deleted).length})</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {facilities.filter(f => !f.is_deleted).map(f => (
                      <div key={f.id} className="p-4 rounded-xl border border-outline-variant dark:border-gray-700 bg-white dark:bg-[#1a1a1a] flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow relative group">
                        <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEditModal(f)} className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"><span className="material-symbols-outlined text-[16px]">edit</span></button>
                          <button onClick={() => setDeletingFac(f)} className="w-8 h-8 rounded-full bg-error-container/50 dark:bg-error-container/20 text-error flex items-center justify-center hover:bg-error-container dark:hover:bg-error-container/40 transition-colors"><span className="material-symbols-outlined text-[16px]">delete</span></button>
                        </div>
                        <div className="flex justify-between items-start pr-16">
                          <span className="font-bold text-primary dark:text-blue-400">{f.name}</span>
                          <span className="text-[10px] bg-gray-100 dark:bg-[#252525] border border-gray-200 dark:border-gray-700 px-1.5 py-0.5 rounded text-gray-500 font-mono">{f.id}</span>
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2"><span className="material-symbols-outlined text-[14px]">location_on</span> {f.address || 'Chưa cập nhật'}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2"><span className="material-symbols-outlined text-[14px]">person</span> {f.pic || 'Chưa có PIC'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : activeTab === 'users' ? (
              <div className="space-y-6">
                <div className="bg-surface-container-low dark:bg-[#252525] p-5 rounded-xl border border-outline-variant dark:border-gray-700">
                  <h3 className="font-bold mb-4 dark:text-white flex items-center gap-2"><span className="material-symbols-outlined text-primary">person_add</span> Thêm Tài khoản mới</h3>
                  <form onSubmit={handleAddUser} className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Username *</label>
                      <input required type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-primary dark:text-white transition-colors" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Password *</label>
                      <input required type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-primary dark:text-white transition-colors" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Họ tên *</label>
                      <input required type="text" value={newName} onChange={e => setNewName(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-primary dark:text-white transition-colors" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Vai trò</label>
                      <select
                        value={newRole}
                        onChange={e => {
                          setNewRole(e.target.value);
                          if (HIGH_LEVEL_ROLES.includes(e.target.value)) setNewFacilityId('ALL');
                        }}
                        className="w-full pl-3 pr-8 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-primary dark:text-white transition-colors text-ellipsis overflow-hidden whitespace-nowrap"
                      >
                        {SYSTEM_ROLES.map(role => (
                          <option key={role.value} value={role.value}>{role.label}</option>
                        ))}
                      </select>
                    </div>
                    {['FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(newRole) ? (
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Phân quyền cơ sở (RLS)</label>
                        <div className="flex flex-wrap gap-x-4 gap-y-2 border border-gray-300 dark:border-gray-600 rounded-lg p-2 max-h-[80px] overflow-y-auto custom-scrollbar">
                          <label className="flex items-center gap-1.5 text-xs font-medium dark:text-white cursor-pointer select-none">
                            <input type="checkbox" className="accent-primary w-3.5 h-3.5" checked={newFinanceFacilities.includes('ALL')} onChange={e => {
                              if (e.target.checked) setNewFinanceFacilities(['ALL']);
                              else setNewFinanceFacilities([]);
                            }} />
                            [Tất cả]
                          </label>
                          {facilities.map(f => (
                            <label key={f.id} className="flex items-center gap-1.5 text-xs font-medium dark:text-white cursor-pointer select-none">
                              <input type="checkbox" className="accent-primary w-3.5 h-3.5" checked={newFinanceFacilities.includes('ALL') || newFinanceFacilities.includes(f.name)} onChange={e => {
                                if (e.target.checked) {
                                  const arr = newFinanceFacilities.filter(x => x !== 'ALL');
                                  setNewFinanceFacilities([...arr, f.name]);
                                } else {
                                  setNewFinanceFacilities(newFinanceFacilities.filter(x => x !== 'ALL' && x !== f.name));
                                }
                              }} />
                              {f.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Cơ sở</label>
                        <select disabled={HIGH_LEVEL_ROLES.includes(newRole)} value={HIGH_LEVEL_ROLES.includes(newRole) ? 'ALL' : newFacilityId} onChange={e => setNewFacilityId(e.target.value)} className="w-full pl-3 pr-8 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-primary dark:text-white transition-colors disabled:opacity-50 text-ellipsis overflow-hidden whitespace-nowrap">
                          <option value="ALL">ALL</option>
                          {facilities.length === 0 ? <option value="Cơ sở 1">Cơ sở 1</option> : facilities.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
                        </select>
                      </div>
                    )}
                    <button type="submit" className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg font-bold text-sm shadow-md shadow-primary/20 flex justify-center items-center h-[38px] gap-2 transition-all">
                      <span className="material-symbols-outlined text-[18px]">add</span> Thêm
                    </button>
                  </form>
                </div>
                <div>
                  <h3 className="font-bold mb-3 dark:text-white flex items-center gap-2"><span className="material-symbols-outlined text-secondary">manage_accounts</span> Danh sách Tài khoản Hệ thống ({users?.filter(u => u && !u.is_deleted)?.length || 0})</h3>
                  <div className="overflow-x-auto rounded-xl border border-outline-variant dark:border-gray-700">
                    <ErrorBoundary>
                      <table className="w-full text-sm text-left">
                        <thead className="text-xs text-gray-500 uppercase bg-surface-container-low dark:bg-gray-800 border-b border-outline-variant dark:border-gray-700">
                          <tr>
                            <th className="px-5 py-3">Tài khoản</th>
                            <th className="px-5 py-3">Tên & Vai trò</th>
                            <th className="px-5 py-3">Cơ sở</th>
                            <th className="px-5 py-3">Trạng thái</th>
                            <th className="px-5 py-3 text-right">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody>
                          {users?.filter(u => u && !u.is_deleted)?.map(u => (
                            <tr key={u.id} className="border-b last:border-b-0 border-outline-variant dark:border-gray-700 bg-white dark:bg-[#1a1a1a] hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                              <td className="px-5 py-4 font-mono text-gray-600 dark:text-gray-300 font-medium">{u?.username}</td>
                              <td className="px-5 py-4">
                                <div className="font-bold text-gray-800 dark:text-white">{u?.name}</div>
                                <div className="text-[10px] bg-primary/10 text-primary border border-primary/20 w-fit px-2 py-0.5 rounded mt-1 font-bold inline-flex items-center gap-1">
                                  {SYSTEM_ROLES.find(r => r.value === u?.role)?.label || u?.role}
                                </div>
                              </td>
                              <td className="px-5 py-4"><span className="font-medium text-xs dark:text-gray-300">{Array.isArray(u?.facility_id) ? u.facility_id.join(', ') : u?.facility_id}</span></td>
                              <td className="px-5 py-4">
                                {u?.isActive ? <span className="bg-success/10 text-success border border-success/20 px-2.5 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-success"></span>Hoạt động</span> : <span className="bg-error/10 text-error border border-error/20 px-2.5 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-error"></span>Đã Khóa</span>}
                              </td>
                              <td className="px-5 py-4 text-right">
                                  <div className="flex items-center justify-end gap-2 ml-auto">
                                    <button onClick={() => toggleUserActive(u.id)} disabled={u.id === user.id} className={`px-4 py-2 rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-1 border ${u.isActive ? 'bg-error-container text-error border-error/30 hover:bg-red-200 dark:bg-red-900/20 dark:border-red-800/30 dark:hover:bg-red-900/40' : 'bg-success/10 text-success border-success/30 hover:bg-green-200 dark:bg-green-900/20 dark:border-green-800/30 dark:hover:bg-green-900/40'} ${u.id === user.id ? 'opacity-30 cursor-not-allowed' : ''}`}>
                                      {u.isActive ? <><span className="material-symbols-outlined text-[14px]">lock</span> Khóa</> : <><span className="material-symbols-outlined text-[14px]">lock_open</span> Mở khóa</>}
                                    </button>
                                    <button onClick={() => {
                                      setEditingUser(u);
                                      setEditUserName(u.name);
                                      setEditUserRole(u.role);
                                      setEditUserFacility(u.facility_id);
                                      setEditFinanceFacilities(Array.isArray(u.facility_id) ? u.facility_id : [u.facility_id || 'ALL']);
                                      setEditUserPassword('');
                                    }} className="px-3 py-2 rounded-lg text-xs font-bold shadow-sm transition-all flex items-center justify-center border bg-blue-100 text-blue-600 border-blue-300 hover:bg-blue-200 dark:bg-blue-900/20 dark:border-blue-800/30 dark:hover:bg-blue-900/40">
                                      <span className="material-symbols-outlined text-[16px]">edit</span>
                                    </button>
                                    <button onClick={() => setDeletingUser(u)} disabled={u.id === user.id} className={`px-3 py-2 rounded-lg text-xs font-bold shadow-sm transition-all flex items-center justify-center border bg-error/10 text-error border-error/30 hover:bg-error-container dark:bg-red-900/20 dark:border-red-800/30 dark:hover:bg-red-900/40 ${u.id === user.id ? 'opacity-30 cursor-not-allowed' : ''}`}>
                                      <span className="material-symbols-outlined text-[16px]">delete</span>
                                    </button>
                                  </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ErrorBoundary>
                  </div>
                </div>
              </div>
            ) : activeTab === 'maintenance' && user.role === 'ADMIN' ? (
              <div className="space-y-6">
                <div className="bg-surface-container-low dark:bg-[#252525] p-5 rounded-xl border border-outline-variant dark:border-gray-700">
                  <h3 className="font-bold mb-4 dark:text-white flex items-center gap-2"><span className="material-symbols-outlined text-error">warning</span> Go-live Reset (Dọn dẹp hệ thống)</h3>
                  <div className="p-4 bg-error/10 border border-error/20 rounded-xl mb-4">
                    <p className="text-sm text-error font-medium mb-2">Tính năng này sẽ xóa toàn bộ dữ liệu kiểm thử (Mock Data) bao gồm:</p>
                    <ul className="list-disc pl-5 text-sm text-error/80 mb-4 space-y-1">
                      <li>Khôi phục về 6 cơ sở vận hành chuẩn</li>
                      <li>Toàn bộ Tài khoản được giữ nguyên (Cần mapping lại PIC)</li>
                      <li>Toàn bộ Công việc (Tasks) & Bình luận bị xóa sạch</li>
                      <li>Toàn bộ Chat Logs và Điểm danh bị xóa sạch</li>
                    </ul>
                    {isProduction ? (
                      <button disabled className="px-6 py-2.5 rounded-lg font-bold border border-error text-error opacity-50 cursor-not-allowed flex items-center gap-2 bg-transparent"><span className="material-symbols-outlined text-[20px]">lock</span> Tính năng bị khóa trên môi trường Production</button>
                    ) : (
                      <button onClick={() => { setResetConfirmText(''); setResetPassword(''); setShowResetModal(true); }} className="px-6 py-2.5 rounded-lg font-bold border-2 border-error text-error hover:bg-error hover:text-white transition-all flex items-center gap-2 bg-transparent"><span className="material-symbols-outlined text-[20px]">delete_forever</span> Kích hoạt Go-live Reset</button>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Reset System Modal */}
          {showResetModal && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
              <div className="bg-surface-container dark:bg-[#1e1e1e] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in border border-error/50">
                {isResetting ? (
                   <div className="p-10 flex flex-col items-center justify-center text-center">
                      <span className="material-symbols-outlined text-error text-5xl animate-spin mb-4">progress_activity</span>
                      <h3 className="text-xl font-bold dark:text-white mb-2">Hệ thống đang thiết lập lại dữ liệu gốc...</h3>
                      <p className="text-sm text-gray-500">Vui lòng không đóng trình duyệt!</p>
                   </div>
                ) : (
                   <>
                      <div className="p-5 border-b border-error/20 bg-error/10 flex justify-between items-center">
                        <h3 className="font-bold text-lg text-error flex items-center gap-2"><span className="material-symbols-outlined">warning</span> CẢNH BÁO NGUY HIỂM</h3>
                        <button onClick={() => setShowResetModal(false)} className="text-error hover:text-red-700 transition-colors"><span className="material-symbols-outlined">close</span></button>
                      </div>
                      <div className="p-6 space-y-5">
                        <p className="text-sm text-gray-700 dark:text-gray-300">Hành động này sẽ xóa sạch toàn bộ Công việc, Bình luận. Hệ thống sẽ tự động khôi phục danh sách 6 cơ sở vận hành chuẩn. Bạn có chắc chắn? Vui lòng nhập <strong>CONFIRM RESET SYSTEM</strong> và điền mật khẩu Admin để thực hiện.</p>
                        <div>
                           <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mã xác nhận</label>
                           <input type="text" placeholder="CONFIRM RESET SYSTEM" value={resetConfirmText} onChange={e => setResetConfirmText(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-error dark:text-white transition-colors" />
                        </div>
                        <div>
                           <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mật khẩu Admin</label>
                           <input type="password" placeholder="Nhập mật khẩu..." value={resetPassword} onChange={e => setResetPassword(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-error dark:text-white transition-colors" />
                        </div>
                        <div className="flex gap-3 pt-2">
                           <button onClick={() => setShowResetModal(false)} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300 transition-colors">Hủy</button>
                           <button disabled={resetConfirmText !== 'CONFIRM RESET SYSTEM' || !resetPassword} onClick={handleResetSystem} className="flex-1 py-2.5 bg-error hover:bg-error/90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold shadow-md shadow-error/20 transition-all flex items-center justify-center gap-2">
                              <span className="material-symbols-outlined text-[18px]">delete_forever</span> Xác nhận xóa hoàn toàn
                           </button>
                        </div>
                      </div>
                   </>
                )}
              </div>
            </div>
          )}

          {/* Edit Modal */}
          {editingFac && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-surface-container dark:bg-[#1e1e1e] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in border border-outline-variant dark:border-gray-700">
                <div className="p-5 border-b border-outline-variant dark:border-gray-700 flex justify-between items-center bg-surface-container-low dark:bg-[#252525]">
                  <h3 className="font-bold text-lg dark:text-white flex items-center gap-2"><span className="material-symbols-outlined text-primary">edit_square</span> Cập nhật Cơ sở</h3>
                  <button onClick={() => setEditingFac(null)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white transition-colors"><span className="material-symbols-outlined">close</span></button>
                </div>
                <form onSubmit={handleUpdateFacility} className="p-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tên cơ sở *</label>
                    <input required type="text" value={editFacName} onChange={e => setEditFacName(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-primary dark:text-white transition-colors" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Địa chỉ</label>
                    <input type="text" value={editFacAddress} onChange={e => setEditFacAddress(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-primary dark:text-white transition-colors" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quản lý phụ trách (PIC)</label>
                    <select value={editFacPic} onChange={e => setEditFacPic(e.target.value)} className="w-full pl-3 pr-8 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-primary dark:text-white transition-colors text-ellipsis overflow-hidden whitespace-nowrap">
                      <option value="">-- Chưa phân công --</option>
                      {users.filter(u => u.role === 'FACILITY_MANAGER').map(u => (
                        <option key={u.id} value={u.username}>{u.name} ({u.username})</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant dark:border-gray-700">
                    <button type="button" onClick={() => setEditingFac(null)} className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300 transition-colors">Hủy</button>
                    <button type="submit" disabled={isUpdatingFac} className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold shadow-md shadow-primary/20 flex items-center gap-2 transition-all">
                      {isUpdatingFac ? <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> : <span className="material-symbols-outlined text-[18px]">check_circle</span>} Cập nhật
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Delete Modal */}
          {deletingFac && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-surface-container dark:bg-[#1e1e1e] rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in border border-outline-variant dark:border-gray-700 p-6 text-center">
                <div className="w-16 h-16 bg-error/10 text-error rounded-full flex items-center justify-center mx-auto mb-4"><span className="material-symbols-outlined text-4xl">warning</span></div>
                <h3 className="text-xl font-bold dark:text-white mb-2">Xác nhận xóa cơ sở?</h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">Bạn có chắc chắn muốn xóa cơ sở <strong>{deletingFac.name}</strong> không? Hành động này không thể hoàn tác.</p>
                <div className="flex gap-3">
                  <button onClick={() => setDeletingFac(null)} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300 transition-colors">Hủy</button>
                  <button onClick={handleDeleteFacility} className="flex-1 py-2.5 bg-error hover:bg-error/90 text-white rounded-xl text-sm font-bold shadow-md shadow-error/20 transition-colors">Xác nhận</button>
                </div>
              </div>
            </div>
          )}

          {/* Delete User Modal */}
          {deletingUser && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-surface-container dark:bg-[#1e1e1e] rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in border border-outline-variant dark:border-gray-700 p-6 text-center">
                <div className="w-16 h-16 bg-error/10 text-error rounded-full flex items-center justify-center mx-auto mb-4"><span className="material-symbols-outlined text-4xl">person_remove</span></div>
                <h3 className="text-xl font-bold dark:text-white mb-2">Xóa tài khoản?</h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">Bạn có chắc chắn muốn xóa tài khoản này? TOÀN BỘ dữ liệu công việc, bình luận liên quan đến tài khoản này cũng sẽ bị xóa sạch khỏi hệ thống.</p>
                <div className="flex gap-3">
                  <button onClick={() => setDeletingUser(null)} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300 transition-colors">Hủy</button>
                  <button onClick={handleDeleteUser} className="flex-1 py-2.5 bg-error hover:bg-error/90 text-white rounded-xl text-sm font-bold shadow-md shadow-error/20 transition-colors">Xác nhận</button>
                </div>
              </div>
            </div>
          )}
          {/* Edit User Modal */}
          {editingUser && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-surface-container dark:bg-[#1e1e1e] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in border border-outline-variant dark:border-gray-700">
                <div className="p-5 border-b border-outline-variant dark:border-gray-700 flex justify-between items-center bg-surface-container-low dark:bg-[#252525]">
                  <h3 className="font-bold text-lg dark:text-white flex items-center gap-2"><span className="material-symbols-outlined text-primary">manage_accounts</span> Cập nhật Tài khoản</h3>
                  <button onClick={() => setEditingUser(null)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white transition-colors"><span className="material-symbols-outlined">close</span></button>
                </div>
                <form onSubmit={handleUpdateUser} className="p-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tài khoản (Username)</label>
                    <input disabled type="text" value={editingUser.username} className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-500 border border-gray-300 dark:border-gray-700 rounded-lg text-sm outline-none cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Họ tên *</label>
                    <input required type="text" value={editUserName} onChange={e => setEditUserName(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-primary dark:text-white transition-colors" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mật khẩu mới</label>
                    <input type="password" placeholder="Bỏ trống nếu không muốn đổi" value={editUserPassword} onChange={e => setEditUserPassword(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-primary dark:text-white transition-colors" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Vai trò</label>
                      <select
                        value={editUserRole}
                        onChange={e => {
                          setEditUserRole(e.target.value);
                          if (HIGH_LEVEL_ROLES.includes(e.target.value)) setEditUserFacility('ALL');
                        }}
                        disabled={editingUser.username === 'admin'}
                        className="w-full pl-3 pr-8 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-primary dark:text-white transition-colors text-ellipsis overflow-hidden whitespace-nowrap"
                      >
                        {SYSTEM_ROLES.map(role => (
                          <option key={role.value} value={role.value}>{role.label}</option>
                        ))}
                      </select>
                    </div>
                    {['FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(editUserRole) ? (
                      <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phân quyền cơ sở (RLS)</label>
                        <div className="flex flex-wrap gap-x-4 gap-y-2 border border-gray-300 dark:border-gray-600 rounded-lg p-3 max-h-[100px] overflow-y-auto custom-scrollbar">
                          <label className="flex items-center gap-1.5 text-sm font-medium dark:text-white cursor-pointer select-none">
                            <input type="checkbox" className="accent-primary w-4 h-4" checked={editFinanceFacilities.includes('ALL')} onChange={e => {
                              if (e.target.checked) setEditFinanceFacilities(['ALL']);
                              else setEditFinanceFacilities([]);
                            }} disabled={editingUser.username === 'admin'} />
                            [Tất cả cơ sở]
                          </label>
                          {facilities.map(f => (
                            <label key={f.id} className="flex items-center gap-1.5 text-sm font-medium dark:text-white cursor-pointer select-none">
                              <input type="checkbox" className="accent-primary w-4 h-4" checked={editFinanceFacilities.includes('ALL') || editFinanceFacilities.includes(f.name)} onChange={e => {
                                if (e.target.checked) {
                                  const arr = editFinanceFacilities.filter(x => x !== 'ALL');
                                  setEditFinanceFacilities([...arr, f.name]);
                                } else {
                                  setEditFinanceFacilities(editFinanceFacilities.filter(x => x !== 'ALL' && x !== f.name));
                                }
                              }} disabled={editingUser.username === 'admin'} />
                              {f.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cơ sở phụ trách</label>
                        <select
                          value={HIGH_LEVEL_ROLES.includes(editUserRole) ? 'ALL' : editUserFacility}
                          onChange={e => setEditUserFacility(e.target.value)}
                          disabled={HIGH_LEVEL_ROLES.includes(editUserRole) || editingUser.username === 'admin'}
                          className="w-full pl-3 pr-8 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-600 rounded-lg text-sm outline-none focus:border-primary dark:text-white transition-colors disabled:opacity-50 text-ellipsis overflow-hidden whitespace-nowrap"
                        >
                          <option value="ALL">ALL</option>
                          <option value="HQ">HQ</option>
                          <option value="Cơ sở 1">Cơ sở 1</option>
                          <option value="Cơ sở 2">Cơ sở 2</option>
                          {facilities.map(f => (
                            <option key={f.id} value={f.name}>{f.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant dark:border-gray-700">
                    <button type="button" onClick={() => setEditingUser(null)} className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300 transition-colors">Hủy</button>
                    <button type="submit" className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold shadow-md shadow-primary/20 flex items-center gap-2 transition-all">
                      <span className="material-symbols-outlined text-[18px]">save</span> Cập nhật
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      );
    }
