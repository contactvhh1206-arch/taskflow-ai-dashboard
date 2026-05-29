import re

with open('agent/rules/stitch_smart_ai_task_management_system/src/App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add Import
import_target = r"import React, { useState, useEffect, createContext, useContext } from 'react';"
import_replacement = r"import React, { useState, useEffect, createContext, useContext } from 'react';\nimport { fetchEventSource } from '@microsoft/fetch-event-source';"
content = content.replace(import_target, import_replacement, 1)

# 2. Replace State and useEffect
state_target = r"const \[notifications, setNotifications\] = useState\(\(\) => \{[\s\S]*?const interval = setInterval\(checkNotifications, 5000\);\n\s*return \(\) => \{[\s\S]*?clearInterval\(interval\);\n\s*\};\n\s*\}, \[\]\);"

state_replacement = r"""const [notifications, setNotifications] = useState([]);
    const unreadCount = notifications.filter(n => !n.is_read).length;

    useEffect(() => {
      if (!user) return;
      let ctrl = new AbortController();
      
      const loadNotifs = async () => {
        try {
          const res = await fetch('https://taskflow-ai-dashboard.onrender.com/api/notifications', {
            headers: { 'x-user-role': user.role, 'Authorization': `Bearer ${user.token || ''}` }
          });
          const data = await res.json();
          if (data.success && data.data) {
            setNotifications(data.data);
          }
        } catch(e) {}
      };
      
      loadNotifs();

      const connectSSE = async () => {
        try {
          await fetchEventSource('https://taskflow-ai-dashboard.onrender.com/api/notifications/stream', {
            method: 'GET',
            headers: {
              'x-user-role': user.role,
              'Authorization': `Bearer ${user.token || ''}`
            },
            signal: ctrl.signal,
            onmessage(ev) {
              try {
                if (ev.data) {
                  const newNotif = JSON.parse(ev.data);
                  setNotifications(prev => [newNotif, ...prev]);
                }
              } catch(e) {}
            },
            onerror(err) {
              ctrl.abort(); // ngắt kết nối tĩnh lặng, không spam error
            }
          });
        } catch (e) {
          // Fallback catch
        }
      };
      connectSSE();
      
      return () => ctrl.abort();
    }, [user]);
    
    const markAsRead = async (id) => {
      try {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
        await fetch(`https://taskflow-ai-dashboard.onrender.com/api/notifications/${id}/read`, {
          method: 'PUT',
          headers: { 'x-user-role': user.role, 'Authorization': `Bearer ${user.token || ''}` }
        });
      } catch (e) {}
    };"""

content = re.sub(state_target, state_replacement, content, count=1)


# 3. Replace the UI Dropdown and Button
ui_target = r"\{showNotifications && \([\s\S]*?<\/div>\s*<\/div>\s*\)\}\s*<\/div>\s*<\/div>\s*<\/header>"

ui_replacement = r"""{showNotifications && (
                  <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-[#1e1e1e] rounded-xl shadow-lg border border-outline-variant dark:border-gray-800 z-50 overflow-hidden text-left">
                    <div className="p-4 border-b border-outline-variant dark:border-gray-800 flex justify-between items-center bg-surface-container dark:bg-gray-800/50">
                      <h3 className="font-semibold text-gray-800 dark:text-gray-200">Thông báo</h3>
                    </div>
                    <div className="max-h-96 overflow-y-auto custom-scrollbar">
                      {notifications.length === 0 ? (
                        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                          <span className="material-symbols-outlined text-4xl mb-2 opacity-50">notifications_paused</span>
                          <p className="text-sm">Không có thông báo mới</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-outline-variant dark:divide-gray-800">
                          {notifications.map((notif) => (
                            <div key={notif.id} onClick={() => !notif.is_read && markAsRead(notif.id)} className={`p-4 transition-colors cursor-pointer group ${notif.is_read ? 'opacity-60' : 'bg-primary/5 dark:bg-primary/10'}`}>
                              <p className={`text-sm ${notif.is_read ? 'text-gray-600 dark:text-gray-400' : 'text-gray-900 dark:text-white font-semibold'} transition-colors`}>
                                {notif.type === 'NEW_TASK' ? '📝 Giao việc mới' : notif.type === 'NEW_COMMENT' ? '💬 Bình luận mới' : '🔔 Thông báo'}
                              </p>
                              <p className={`text-xs mt-1 leading-relaxed ${notif.is_read ? 'text-gray-500 dark:text-gray-400' : 'text-gray-700 dark:text-gray-300 font-medium'}`}>{notif.message}</p>
                              <p className="text-[10px] text-gray-400 mt-2 flex items-center gap-1">
                                <span className="material-symbols-outlined text-[10px]">schedule</span>
                                {new Date(notif.created_at).toLocaleString('vi-VN')}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>"""

content = re.sub(ui_target, ui_replacement, content, count=1)


# Fix the unread count dot
badge_target = r"\{notifications\.length > 0 && <span className=\"absolute top-1\.5 right-1\.5 w-2\.5 h-2\.5 bg-error rounded-full border-2 border-white dark:border-\[\#121212\]\"><\/span>\}"
badge_replacement = r"{unreadCount > 0 && <span className=\"absolute top-1.5 right-1.5 w-4 h-4 bg-error text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white dark:border-[#121212]\">{unreadCount > 9 ? '9+' : unreadCount}</span>}"
content = re.sub(badge_target, badge_replacement, content, count=1)


with open('agent/rules/stitch_smart_ai_task_management_system/src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("App.jsx patched for Frontend Phase 2")
