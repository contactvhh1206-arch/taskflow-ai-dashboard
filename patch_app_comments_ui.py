import re

filepath = 'agent/rules/stitch_smart_ai_task_management_system/src/App.jsx'
with open(filepath, 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Kanban forum icon
old_forum = """<span className="material-symbols-outlined text-[16px]">forum</span>
                <span className="text-xs">0</span>"""
new_forum = """<span className="material-symbols-outlined text-[16px]">forum</span>
                <span className="text-xs">{task.comment_count || 0}</span>"""
text = text.replace(old_forum, new_forum)

# 2. UI modification
old_ui = """                    {selectedTaskComments.map(c => (
                      <div key={c.id} className={`flex gap-3 ${c.user_id === user.id ? 'flex-row-reverse' : ''}`}>
                        <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold shrink-0">
                          {c.author_name ? c.author_name.substring(0, 2).toUpperCase() : 'U'}
                        </div>
                        <div className={`bg-surface-container dark:bg-[#2a2a2a] p-3 rounded-2xl text-sm dark:text-gray-200 ${c.user_id === user.id ? 'rounded-tr-none bg-primary/10 border border-primary/20' : 'rounded-tl-none border border-outline-variant dark:border-gray-800'}`}>
                          <span className="text-primary font-bold text-[11px] block mb-1">{c.author_name}</span> 
                          {c.content}
                          <span className="text-[9px] text-gray-500 block mt-1">{new Date(c.created_at).toLocaleString('vi-VN')}</span>
                        </div>
                      </div>
                    ))}"""
new_ui = """                    {selectedTaskComments.map(c => (
                      <div key={c.id} className={`flex gap-3 ${c.user_id === user.id ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${c.user_id === user.id ? 'bg-orange-500 text-white' : 'bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                          {c.user_name ? c.user_name.substring(0, 1).toUpperCase() : 'U'}
                        </div>
                        <div className={`p-3 rounded-2xl text-sm dark:text-gray-200 max-w-[85%] ${c.user_id === user.id ? 'bg-orange-100 text-orange-900 dark:bg-orange-900/30 dark:text-orange-100 rounded-tr-none border border-orange-200 dark:border-orange-800/50' : 'bg-gray-100 text-gray-800 dark:bg-[#2a2a2a] rounded-tl-none border border-outline-variant dark:border-gray-800'}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-[11px]">{c.user_name || 'Người dùng ẩn danh'}</span>
                            {c.user_role && <span className="text-[9px] bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded-full text-gray-700 dark:text-gray-300">{c.user_role}</span>}
                          </div>
                          <div className="break-words leading-relaxed text-[13px]">{c.content}</div>
                          <span className="text-[9px] opacity-60 block mt-1 text-right">
                            {new Date(c.created_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }).replace(', ', ' - ')}
                          </span>
                        </div>
                      </div>
                    ))}"""
text = text.replace(old_ui, new_ui)

# 3. Handle submit state update
old_state = "setTasks(tasks.map(t => t.id === selectedTask.id ? { ...t, comments_count: parseInt(t.comments_count || 0) + 1, latest_comment: chatInput, latest_comment_user_id: user.id } : t));"
new_state = "setTasks(tasks.map(t => t.id === selectedTask.id ? { ...t, comment_count: parseInt(t.comment_count || t.comments_count || 0) + 1, comments_count: parseInt(t.comment_count || t.comments_count || 0) + 1, latest_comment: chatInput, latest_comment_user_id: user.id } : t));"
text = text.replace(old_state, new_state)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(text)

print("App.jsx patched successfully.")
