import React, { useState, useRef, useEffect } from 'react';

// Cố định chiều cao toàn cục cho Board, grid 3 cột
export function GlobalKanbanBoard({ children }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch h-[calc(100vh-160px)]">
      {children}
    </div>
  );
}

// Cột Kanban tiêu chuẩn, tích hợp sẵn Lazy Loading và Scroll độc lập
export function GlobalKanbanColumn({ title, status, tasks, setSelectedTask, onOpenCreateModal, onQuickAdd, onDropTask, taskComments }) {
  const columnTasks = tasks.filter(t => t.status === status);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const inputRef = useRef(null);

  const sortedColumnTasks = [...columnTasks].sort((a, b) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const getPriority = (task) => {
      if (!task.deadline) return 4;
      const taskDate = task.deadline.slice(0, 10);
      if (taskDate < todayStr) return 1;
      if (taskDate === todayStr) return 2;
      return 3;
    };
    const pA = getPriority(a);
    const pB = getPriority(b);
    if (pA !== pB) return pA - pB;
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    return 0;
  });

  useEffect(() => {
    if (showQuickAdd && inputRef.current) inputRef.current.focus();
  }, [showQuickAdd]);

  const handleQuickSubmit = () => {
    if (quickTitle.trim()) {
      onQuickAdd({ title: quickTitle.trim(), status, desc: '' });
      setQuickTitle('');
      setShowQuickAdd(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleQuickSubmit();
    else if (e.key === 'Escape') { setShowQuickAdd(false); setQuickTitle(''); }
  };

  const getDeadlineBadge = (deadline) => {
    if (!deadline) return null;
    const taskDate = deadline.slice(0, 10);
    const todayStr = new Date().toISOString().split('T')[0];
    if (taskDate < todayStr) return <span className="bg-error/10 text-error px-2 py-0.5 rounded text-[10px] font-bold border border-error/20">Đã trễ</span>;
    if (taskDate === todayStr) return <span className="bg-orange-500/10 text-orange-600 px-2 py-0.5 rounded text-[10px] font-bold border border-orange-500/20">Sắp trễ</span>;
    return null;
  };

  return (
    <div
      className="flex flex-col bg-surface-container dark:bg-[#1a1a1a] rounded-xl border border-outline-variant dark:border-gray-800/50 p-4 h-full global-kanban-column"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const taskId = e.dataTransfer.getData('taskId');
        if (taskId && onDropTask) onDropTask(parseInt(taskId), status);
      }}
    >
      {/* Header Ghim Cố Định */}
      <div className="flex justify-between items-center mb-4 shrink-0">
        <h3 className="font-semibold text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
          {title} <span className="bg-white dark:bg-gray-800 border border-outline-variant dark:border-gray-700 text-gray-500 px-2 py-0.5 rounded-full text-xs">{columnTasks.length}</span>
        </h3>
      </div>

      {/* Vùng Cuộn Độc Lập chứa Thẻ Task */}
      <div className="flex flex-col gap-3 overflow-y-auto custom-scrollbar flex-1 pb-2 pr-1">
        {sortedColumnTasks.map(task => (
          <div
            key={task.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('taskId', task.id.toString())}
            onClick={() => setSelectedTask(task)}
            className="bg-white dark:bg-[#252525] p-3 rounded-lg shadow-sm border border-outline-variant dark:border-gray-700 hover:shadow-md transition-shadow cursor-pointer group shrink-0"
          >
            <div className="flex justify-between items-start mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary dark:text-blue-400 bg-primary/10 dark:bg-primary/20 px-2 py-1 rounded-md">{task.facility}</span>
              <div className="flex items-center gap-1">
                {getDeadlineBadge(task.deadline)}
                {task.aiPinged && <span className="material-symbols-outlined text-secondary text-[16px] animate-pulse" title="AI đã nhắc việc">notifications_active</span>}
                {task.urgent && <span className="material-symbols-outlined text-error text-[16px]" title="Khẩn cấp">error</span>}
              </div>
            </div>
            <h4 className="text-sm font-semibold text-on-surface dark:text-gray-100 mb-2 leading-snug">{task.title}</h4>
            <div className="flex items-center justify-between mt-4 border-t border-outline-variant dark:border-gray-700/50 pt-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-300" title={task.pic || 'Chưa có PIC'}>
                  {task.pic ? task.pic.split(' ').map(n => n[0]).join('').slice(0, 2) : '?'}
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">{task.pic || 'Chưa giao'}</span>
              </div>
              <div className="flex items-center gap-1 text-gray-400 hover:text-secondary transition-colors" title="Thảo luận (Task-Chat)">
                <span className="material-symbols-outlined text-[16px]">forum</span>
                <span className="text-xs">{(taskComments && taskComments[task.id] && taskComments[task.id].length) || 0}</span>
              </div>
            </div>
          </div>
        ))}

        {columnTasks.length === 0 && !showQuickAdd && <div className="text-center p-4 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg text-gray-400 text-xs mt-2 shrink-0">Trống</div>}

        {showQuickAdd && status === 'todo' && (
          <div className="bg-white dark:bg-[#252525] p-3 rounded-lg shadow-sm border border-primary dark:border-blue-500 mt-2 shrink-0">
            <input ref={inputRef} type="text" value={quickTitle} onChange={e => setQuickTitle(e.target.value)} onKeyDown={handleKeyDown} onBlur={() => quickTitle.trim() ? handleQuickSubmit() : setShowQuickAdd(false)} placeholder="Nhập tiêu đề (Enter để lưu)..." className="w-full text-sm outline-none bg-transparent dark:text-white" />
          </div>
        )}

      </div>

      {/* Footer Ghim Cố Định */}
      {status === 'todo' && (
        <div className="mt-2 shrink-0 pt-3 border-t border-outline-variant dark:border-gray-800/50">
          {!showQuickAdd && (
            <div className="flex gap-2">
              <button onClick={() => setShowQuickAdd(true)} className="flex-1 py-2 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-dashed border-gray-300 dark:border-gray-700" title="Quick Add">
                <span className="material-symbols-outlined text-[18px]">bolt</span>
              </button>
              <button onClick={() => onOpenCreateModal(status)} className="flex-[3] py-2 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-dashed border-gray-300 dark:border-gray-700">
                <span className="material-symbols-outlined text-[18px] mr-1">add</span> Thêm
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
