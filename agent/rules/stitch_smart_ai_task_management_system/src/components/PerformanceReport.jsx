import React, { useMemo } from 'react';

export default function PerformanceReport({ user, tasks, globalFacilityFilter }) {
  const deptId = user?.department_id || (user?.username === 'marketing' ? 'MARKETING' : (user?.role === 'FINANCE_DEPT' ? 'FINANCE' : 'MARKETING'));

  // Filter tasks based on the user's department
  const filteredTasks = useMemo(() => {
    let list = tasks;
    
    // For department heads, filter by their department tag unless they are looking at "ALL" tasks in their department
    if (['DEPARTMENT_HEAD', 'FINANCE_DEPT'].includes(user?.role)) {
       list = list.filter(t => t.department_tag === deptId);
    }

    // Apply global facility filter if not "ALL" and if it's a specific facility
    if (globalFacilityFilter !== 'ALL' && globalFacilityFilter !== deptId) {
      list = list.filter(t => t.facilityId === globalFacilityFilter || t.facility === globalFacilityFilter);
    }
    return list;
  }, [tasks, user, deptId, globalFacilityFilter]);

  const stats = useMemo(() => {
    const total = filteredTasks.length;
    const done = filteredTasks.filter(t => t.status === 'done').length;
    const progress = filteredTasks.filter(t => t.status === 'progress' || t.status === 'reviewing').length;
    const pending = filteredTasks.filter(t => t.status === 'pending').length;
    
    const today = new Date();
    today.setHours(0,0,0,0);
    const overdue = filteredTasks.filter(t => {
      if (t.status === 'done' || t.status === 'revoked') return false;
      if (!t.deadline) return false;
      const dl = new Date(t.deadline.split('/').reverse().join('-'));
      return dl < today;
    }).length;

    return { total, done, progress, pending, overdue };
  }, [filteredTasks]);

  // Aggregate by person
  const topPerformers = useMemo(() => {
    const map = {};
    filteredTasks.forEach(t => {
      const pic = t.pic || 'Chưa giao';
      if (!map[pic]) map[pic] = { name: pic, done: 0, total: 0 };
      map[pic].total++;
      if (t.status === 'done') map[pic].done++;
    });
    return Object.values(map)
      .filter(p => p.name !== 'Chưa giao')
      .sort((a, b) => b.done - a.done)
      .slice(0, 5);
  }, [filteredTasks]);

  // Aggregate by facility
  const facilityStats = useMemo(() => {
    const map = {};
    filteredTasks.forEach(t => {
      const fac = t.facility || 'Chưa rõ';
      if (!map[fac]) map[fac] = { name: fac, count: 0, done: 0 };
      map[fac].count++;
      if (t.status === 'done') map[fac].done++;
    });
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [filteredTasks]);

  return (
    <div className="flex flex-col h-full w-full max-w-6xl mx-auto py-2 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-on-surface dark:text-white">Báo cáo hiệu suất</h2>
          <p className="text-sm text-on-surface-variant dark:text-gray-400 mt-1">Phân tích tiến độ và năng suất công việc</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-panel p-5 rounded-2xl border border-outline-variant dark:border-gray-700 bg-white dark:bg-[#1e1e1e]">
          <div className="flex items-center gap-3 mb-2">
            <span className="material-symbols-outlined text-blue-500">assignment</span>
            <h3 className="font-medium text-gray-500 dark:text-gray-400">Tổng công việc</h3>
          </div>
          <p className="text-3xl font-black text-gray-800 dark:text-white">{stats.total}</p>
        </div>
        <div className="glass-panel p-5 rounded-2xl border border-outline-variant dark:border-gray-700 bg-white dark:bg-[#1e1e1e]">
          <div className="flex items-center gap-3 mb-2">
            <span className="material-symbols-outlined text-green-500">check_circle</span>
            <h3 className="font-medium text-gray-500 dark:text-gray-400">Hoàn thành</h3>
          </div>
          <p className="text-3xl font-black text-green-600 dark:text-green-400">{stats.done}</p>
          <p className="text-xs text-gray-400 mt-1">{stats.total > 0 ? Math.round(stats.done/stats.total*100) : 0}% tỷ lệ hoàn thành</p>
        </div>
        <div className="glass-panel p-5 rounded-2xl border border-outline-variant dark:border-gray-700 bg-white dark:bg-[#1e1e1e]">
          <div className="flex items-center gap-3 mb-2">
            <span className="material-symbols-outlined text-orange-500">pending</span>
            <h3 className="font-medium text-gray-500 dark:text-gray-400">Đang xử lý</h3>
          </div>
          <p className="text-3xl font-black text-orange-600 dark:text-orange-400">{stats.progress}</p>
        </div>
        <div className="glass-panel p-5 rounded-2xl border border-outline-variant dark:border-gray-700 bg-white dark:bg-[#1e1e1e]">
          <div className="flex items-center gap-3 mb-2">
            <span className="material-symbols-outlined text-red-500">warning</span>
            <h3 className="font-medium text-gray-500 dark:text-gray-400">Trễ hạn</h3>
          </div>
          <p className="text-3xl font-black text-red-600 dark:text-red-400">{stats.overdue}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel p-6 rounded-2xl border border-outline-variant dark:border-gray-700 bg-white dark:bg-[#1e1e1e]">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-6">Top Nhân viên Xuất sắc</h3>
          {topPerformers.length === 0 ? (
            <p className="text-sm text-gray-500 italic">Chưa có dữ liệu</p>
          ) : (
            <div className="space-y-4">
              {topPerformers.map((p, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium text-gray-800 dark:text-white">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-sm">
                      <span className="text-green-600 font-bold">{p.done}</span>
                      <span className="text-gray-400 mx-1">/</span>
                      <span className="text-gray-500">{p.total}</span>
                    </div>
                    <div className="w-24 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${(p.done / p.total) * 100}%` }}></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass-panel p-6 rounded-2xl border border-outline-variant dark:border-gray-700 bg-white dark:bg-[#1e1e1e]">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-6">Khối lượng theo Cơ sở</h3>
          {facilityStats.length === 0 ? (
            <p className="text-sm text-gray-500 italic">Chưa có dữ liệu</p>
          ) : (
            <div className="space-y-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
              {facilityStats.map((f, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-gray-700 dark:text-gray-300 truncate pr-4">{f.name}</span>
                    <span className="text-gray-500">{f.count} CV</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden flex">
                    <div className="h-full bg-green-500" style={{ width: `${(f.done / Math.max(1, f.count)) * 100}%` }}></div>
                    <div className="h-full bg-blue-500 opacity-30" style={{ width: `${((f.count - f.done) / Math.max(1, f.count)) * 100}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
