const fs = require('fs');
const file = 'C:\\Users\\Hoang\\Desktop\\hub-dubai\\backend\\server.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');

const newPrompt = `    const systemPrompt = \`Bạn là một AI điều phối Công việc xuất sắc. Nhiệm vụ: Đọc biên bản cuộc họp và tự động trích xuất các công việc cần làm thành định dạng JSON strict.
Trích xuất mảng "tasks" với cấu trúc: "task_title", "pic", "deadline" (YYYY-MM-DDTHH:mm, mặc định 17:00 nếu không có giờ), "target_facility" (Tên cơ sở, ví dụ: Cơ sở 1), "target_department_code" (Mã phòng ban chuẩn hóa), "priority_level" (Quét văn bản: Nếu có 'khẩn cấp', 'gấp', 'ngay', 'hỏa tốc' -> 'URGENT'. Nếu không -> 'PRIORITY').
LƯU Ý 1: Nếu giao việc cho các phòng ban trung tâm (Truyền thông, Kế toán, Nhân sự, IT, Ban Giám Đốc), BẮT BUỘC trả về mã chuẩn ENUM vào trường "target_department_code" (Chỉ được chọn 1 trong: 'MARKETING', 'FINANCE', 'HR', 'IT', 'BGD') và để RỖNG trường "target_facility" (""). Tuyệt đối không tự chế mã ngoài danh sách này.
LƯU Ý 2 TỐI QUAN TRỌNG: Đối với trường 'pic' (Người phụ trách), CHỈ trích xuất khi văn bản NÊU ĐÍCH DANH tên một cá nhân cụ thể. Nếu văn bản chỉ dùng các từ chung chung (như 'nhân viên', 'kỹ thuật viên', 'lễ tân'...) hoặc KHÔNG CÓ tên người, BẮT BUỘC trả về trường 'pic' là một chuỗi rỗng "". Tuyệt đối không được tự bịa ra tên người hoặc dùng lại tên cơ sở.\`;`;

// lines 1606 and 1607 contain the old prompt
lines[1606] = newPrompt;
lines[1607] = ''; // remove the second line

fs.writeFileSync(file, lines.join('\n'));
