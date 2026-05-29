import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove notification block from POST /comments
comments_notif_start = "    // 3. [NOTIFICATIONS TRIGGER] (An toàn tuyệt đối)\n    try {\n        if (typeof sendRealtimeNotification === 'function') {\n            const taskInfo = await pool.query('SELECT pic_id, title FROM tasks WHERE id = $1', [id]);\n            if (taskInfo.rows.length > 0) {\n                const tInfo = taskInfo.rows[0];\n                if (tInfo.pic_id && parseInt(tInfo.pic_id) !== parseInt(realUserId)) {\n                    sendRealtimeNotification(tInfo.pic_id, 'NEW_COMMENT', `Có bình luận mới trong công việc: \"${tInfo.title}\"`, id, realUserId);\n                }\n            }\n        }\n    } catch (err) { console.error(\"Notification comment err:\", err); }"

# 2. Remove notification block from POST /tasks
tasks_notif_start = "    \n      if (pic_id && pic_id !== req.user.id) {\n          sendRealtimeNotification(pic_id, 'NEW_TASK', `Bạn vừa được giao một công việc mới: \"${title}\"`, newTask.id, req.user.id);\n      }"

new_content = content.replace(comments_notif_start, "")
new_content = new_content.replace(tasks_notif_start, "")

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(new_content)
    
print("Successfully removed notification blocks.")
