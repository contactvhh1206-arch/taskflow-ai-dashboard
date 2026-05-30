const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

const target = `    // 1. Láº¤Y USER_ID AN TOÃ€N VÃ€ CHáº¶N NGAY Náº¾U Rá»–NG (NguyÃªn nhÃ¢n gá»‘c gÃ¢y sáº­p)
    let realUserId = null;
    try {
        if (req.user && req.user.id) {
            realUserId = req.user.id;
        } else {
            const roleHeader = req.headers['x-user-role'];
            if (roleHeader) {
                const roleRes = await pool.query('SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = $1 LIMIT 1', [roleHeader]);
                if (roleRes.rows.length > 0) realUserId = roleRes.rows[0].id;
            }
        }
        
        if (!realUserId) {
            const fallbackRes = await pool.query('SELECT id FROM users ORDER BY id ASC LIMIT 1');
            if (fallbackRes.rows.length > 0) realUserId = fallbackRes.rows[0].id;
        }
    } catch (parseErr) {
        console.error("Lá»—i parse user an toÃ n:", parseErr);
    }

    // [QUAN TRá»ŒNG NHáº¤T]: TRáº M GÃ C CHá» NG Sáº¬P DB
    if (!realUserId) {
        return res.status(403).json({ error: 'KhÃ´ng thá»ƒ xÃ¡c Ä‘á»‹nh danh tÃ­nh. Vui lÃ²ng Ä‘Äƒng nháº­p láº¡i!' });
    }`;

const replacement = `    // 1. LẤY USER_ID TỪ TOKEN, KHÔNG CHÂM CHƯỚC
    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: '401 Unauthorized: Không thể xác định danh tính. Vui lòng đăng nhập lại!' });
    }
    const realUserId = req.user.id;`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync('server.js', content, 'utf8');
    console.log("Success");
} else {
    console.log("Failed: Target string not found.");
}
