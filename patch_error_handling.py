import re

filepath = 'server.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# The old catch block we want to replace
old_catch = """  } catch (err) {
    console.error("Lỗi POST Comment:", err);
    res.status(500).json({ error: 'Lỗi thêm bình luận: ' + err.message });
  }
});"""

# The new robust catch block
new_catch = """  } catch (error) {
    if (error.code === '23503') {
        console.warn(`[API Comment] Cố gắng bình luận vào Task không tồn tại: task_id=${req.params.id}`);
        return res.status(404).json({ 
            success: false, 
            message: 'Task này không còn tồn tại hoặc đã bị xóa. Vui lòng làm mới trang.' 
        });
    }

    console.error('[API Comment] Lỗi 500:', error);
    return res.status(500).json({ 
        success: false, 
        message: 'Lỗi máy chủ nội bộ. Vui lòng thử lại sau.' 
    });
  }
});"""

new_content = content.replace(old_catch, new_catch)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(new_content)

print("server.js updated with robust error handling.")
