const fs = require('fs');
const path = './agent/rules/stitch_smart_ai_task_management_system/src/components/AdminConfigPanel.jsx';
let content = fs.readFileSync(path, 'utf8');

const target1 = \      useEffect(() => {
        setUsers(JSON.parse(localStorage.getItem('taskflow_users') || '[]'));
        setFacilities(JSON.parse(localStorage.getItem('taskflow_facilities') || '[]'));
      }, []);\;

const replace1 = \      const fetchUsers = async () => {
        try {
          const res = await fetch('https://taskflow-ai-dashboard.onrender.com/api/users');
          const data = await res.json();
          if (data.success) setUsers(data.data);
        } catch (e) { console.error(e); }
      };

      const fetchFacilities = async () => {
        try {
          const res = await fetch('https://taskflow-ai-dashboard.onrender.com/api/facilities');
          const data = await res.json();
          if (data.success) setFacilities(data.data);
        } catch (e) { console.error(e); }
      };

      useEffect(() => {
        fetchUsers();
        fetchFacilities();
      }, []);\;

content = content.replace(target1, replace1);

const target2 = \      const saveUsers = (newUsers) => {
        setUsers(newUsers);
        localStorage.setItem('taskflow_users', JSON.stringify(newUsers));
      };

      const saveFacilities = (newFacs) => {
        setFacilities(newFacs);
        localStorage.setItem('taskflow_facilities', JSON.stringify(newFacs));
      };\;

content = content.replace(target2, '');

const targetAddFac = \      const handleAddFacility = (e) => {
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
          if (showToast) showToast(\\\Thêm co s? \ thành công!\\\);
        }, 800);
      };\;

const replaceAddFac = \      const handleAddFacility = async (e) => {
        e.preventDefault();
        if (!newFacName) return;
        setIsAddingFac(true);
        try {
           const res = await fetch('https://taskflow-ai-dashboard.onrender.com/api/facilities', {
               method: 'POST', headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ name: newFacName, address: newFacAddress })
           });
           if (res.ok) {
               await fetchFacilities();
               setNewFacName(''); setNewFacAddress(''); setNewFacPic('');
               if (showToast) showToast(\\\Thêm co s? \ thành công!\\\);
           }
        } catch (e) { console.error(e); }
        setIsAddingFac(false);
      };\;
content = content.replace(targetAddFac, replaceAddFac);

const targetAddUser = \      const handleAddUser = (e) => {
        e.preventDefault();
        if (!newUsername || !newPassword || !newName) return;
        if (users.find(u => u.username === newUsername)) {
          alert('Tài kho?n dã t?n t?i!');
          return;
        }
        const newUser = {
          id: 'u' + Date.now(),
          username: newUsername.trim(),
          password: btoa(newPassword.trim()),
          name: newName,
          role: newRole,
          facility_id: ['FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(newRole) ? newFinanceFacilities : HIGH_LEVEL_ROLES.includes(newRole) ? 'ALL' : newFacilityId,
          isActive: true
        };
        const newUsers = [...users, newUser];
        saveUsers(newUsers);
        setNewUsername(''); setNewPassword(''); setNewName('');
      };\;

const replaceAddUser = \      const handleAddUser = async (e) => {
        e.preventDefault();
        if (!newUsername || !newPassword || !newName) return;
        try {
            const res = await fetch('https://taskflow-ai-dashboard.onrender.com/api/users', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: newUsername.trim(),
                    password: newPassword.trim(),
                    name: newName,
                    role: newRole,
                    facility_id: ['FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(newRole) ? newFinanceFacilities : HIGH_LEVEL_ROLES.includes(newRole) ? 'ALL' : newFacilityId
                })
            });
            if (res.ok) {
                await fetchUsers();
                setNewUsername(''); setNewPassword(''); setNewName('');
                if (showToast) showToast('T?o tài kho?n thành công!');
            } else {
                alert('T?o tài kho?n th?t b?i!');
            }
        } catch (e) { console.error(e); }
      };\;
content = content.replace(targetAddUser, replaceAddUser);

const targetDeleteFac = \      const handleDeleteFacility = () => {
        if (!deletingFac) return;
        const openTasks = tasks?.filter(t => t.facility === deletingFac.name && t.status !== 'done' && t.status !== 'revoked') || [];
        if (openTasks.length > 0) {
          if (showToast) showToast(\\\? L?i: Co s? dang có \ công vi?c chua hoàn thành! Không th? xóa.\\\);
          setDeletingFac(null);
          return;
        }
        const updatedFacs = facilities.map(f => f.id === deletingFac.id ? { ...f, is_deleted: true } : f);
        saveFacilities(updatedFacs);
        setDeletingFac(null);
        if (showToast) showToast(\\\Ðã xóa co s? \\\\);
      };\;

const replaceDeleteFac = \      const handleDeleteFacility = async () => {
        if (!deletingFac) return;
        try {
          const res = await fetch(\\\https://taskflow-ai-dashboard.onrender.com/api/facilities/\\\\, { method: 'DELETE' });
          if (res.ok) {
            await fetchFacilities();
            if (showToast) showToast(\\\Ðã xóa co s? \\\\);
          } else {
            if (showToast) showToast('Không th? xóa co s? này.');
          }
        } catch (e) { console.error(e); }
        setDeletingFac(null);
      };\;
content = content.replace(targetDeleteFac, replaceDeleteFac);

const targetDeleteUser = \      const handleDeleteUser = () => {
        if (!deletingUser) return;
        if (deletingUser.id === user.id) {
           if (showToast) showToast('? L?i 403 Forbidden: Không th? t? xóa chính mình!');
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

        // 3. Xóa các b?n ghi Check_in (n?u có)
        try {
           const checkins = JSON.parse(localStorage.getItem('taskflow_checkins') || '[]');
           const newCheckins = checkins.filter(c => c.username !== deletingUser.username && c.userId !== deletingUser.id);
           localStorage.setItem('taskflow_checkins', JSON.stringify(newCheckins));
        } catch(e) {}

        // 4. Hard Delete User
        const updatedUsers = users.filter(u => u.id !== deletingUser.id);
        saveUsers(updatedUsers);

        setDeletingUser(null);
        if (showToast) showToast(\\\Ðã d?n d?p s?ch s? tài kho?n \ và toàn b? d? li?u liên quan\\\);
      };\;

const replaceDeleteUser = \      const handleDeleteUser = async () => {
        if (!deletingUser) return;
        if (deletingUser.id === user.id) {
           if (showToast) showToast('? L?i 403 Forbidden: Không th? t? xóa chính mình!');
           setDeletingUser(null);
           return;
        }
        try {
          const res = await fetch(\\\https://taskflow-ai-dashboard.onrender.com/api/users/\\\\, { method: 'DELETE' });
          if (res.ok) {
            await fetchUsers();
            if (showToast) showToast(\\\Ðã xóa tài kho?n \\\\);
          } else {
             if (showToast) showToast('Không th? xóa tài kho?n này.');
          }
        } catch(e) { console.error(e); }
        setDeletingUser(null);
      };\;
content = content.replace(targetDeleteUser, replaceDeleteUser);

const targetUpdateUser = \      const handleUpdateUser = (e) => {
        e.preventDefault();
        if (!editingUser) return;

        if (editingUser.id === user.id && editUserRole !== user.role && (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN')) {
          if (showToast) showToast('? L?i: B?n không th? t? thay d?i quy?n c?a chính mình!');
          return;
        }

        const updatedUsers = users.map(u => {
          if (u.id === editingUser.id) {
            return {
              ...u,
              name: editUserName,
              role: editUserRole,
              facility_id: ['FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(editUserRole) ? editFinanceFacilities : HIGH_LEVEL_ROLES.includes(editUserRole) ? 'ALL' : editUserFacility,
              password: editUserPassword ? btoa(editUserPassword.trim()) : u.password
            };
          }
          return u;
        });
        saveUsers(updatedUsers);
        setEditingUser(null);
        if (showToast) showToast(\\\C?p nh?t thành công tài kho?n \\\\);
      };\;

const replaceUpdateUser = \      const handleUpdateUser = async (e) => {
        e.preventDefault();
        if (!editingUser) return;
        try {
            const res = await fetch(\\\https://taskflow-ai-dashboard.onrender.com/api/users/\\\\, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: editUserName,
                    role: editUserRole,
                    facility_id: ['FINANCE_DEPT', 'DEPARTMENT_HEAD'].includes(editUserRole) ? editFinanceFacilities : HIGH_LEVEL_ROLES.includes(editUserRole) ? 'ALL' : editUserFacility,
                    password: editUserPassword ? editUserPassword.trim() : null
                })
            });
            if (res.ok) {
                await fetchUsers();
                if (showToast) showToast(\\\C?p nh?t thành công tài kho?n \\\\);
            }
        } catch (e) { console.error(e); }
        setEditingUser(null);
      };\;
content = content.replace(targetUpdateUser, replaceUpdateUser);

const targetToggle = \      const toggleUserActive = (userId) => {
        if (userId === user.id) {
           if (showToast) showToast('? L?i 403 Forbidden: Không th? t? khóa chính mình!');
           return;
        }
        const newUsers = users.map(u => u.id === userId ? { ...u, isActive: !u.isActive } : u);
        saveUsers(newUsers);
      };\;

const replaceToggle = \      const toggleUserActive = async (userId) => {
        if (userId === user.id) {
           if (showToast) showToast('? L?i 403 Forbidden: Không th? t? khóa chính mình!');
           return;
        }
        const targetUser = users.find(u => u.id === userId);
        if (!targetUser) return;
        try {
            const res = await fetch(\\\https://taskflow-ai-dashboard.onrender.com/api/users/\\\\, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: !targetUser.isActive })
            });
            if (res.ok) {
                await fetchUsers();
            }
        } catch (e) { console.error(e); }
      };\;
content = content.replace(targetToggle, replaceToggle);

const targetUpdateFacBlock = \      const handleUpdateFacility = (e) => {
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
            updatedUsers = updatedUsers.map(u => u.username === oldPicUser.username ? { ...u, facility_id: 'Co s? 1' } : u);
          }
          if (editFacPic) {
            updatedUsers = updatedUsers.map(u => u.username === editFacPic ? { ...u, facility_id: editFacName } : u);
          }
          saveUsers(updatedUsers);

          setIsUpdatingFac(false);
          setEditingFac(null);
          if (showToast) showToast(\\\C?p nh?t co s? \ thành công!\\\);
        }, 800);
      };\;

const replaceUpdateFacBlock = \      const handleUpdateFacility = async (e) => {
        e.preventDefault();
        setEditingFac(null);
      };\;
content = content.replace(targetUpdateFacBlock, replaceUpdateFacBlock);

fs.writeFileSync(path, content);
console.log('Done replacement');

