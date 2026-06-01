/**
 * AI Prompt Context Injection Service
 * Đảm nhận nhiệm vụ tiêm thời gian thực và các ngữ cảnh sống (Live Context) vào System Prompt
 * Giúp AI (LLM) không bị ảo giác về thời gian khi sử dụng Tool Calling.
 */

export const generateSystemContextPrompt = (basePrompt: string): string => {
  // Lấy thời gian thực theo chuẩn múi giờ Asia/Ho_Chi_Minh
  const now = new Date();
  
  // Định dạng ngày tháng, ví dụ: "Thứ Hai, Ngày 01/06/2026, 21:49 PM"
  const formatter = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const formattedTime = formatter.format(now);
  
  // Tạo chuỗi tiêm ngữ cảnh thời gian
  const timeContextInjection = `
---
[HỆ THỐNG - NGỮ CẢNH THỜI GIAN THỰC]
Hôm nay là: ${formattedTime} (Múi giờ: +07:00, Asia/Ho_Chi_Minh).
Hãy dùng thông tin này để tính toán ngày tháng chính xác (Định dạng YYYY-MM-DD) khi người dùng hỏi về 'hôm nay', 'hôm qua', 'ngày mai' hoặc các mốc thời gian tương đối. Tuyệt đối không tự suy diễn ngày tháng dựa trên dữ liệu huấn luyện (Training Cutoff) của bạn.
---
`;

  // Gắn Context Injection vào Base Prompt
  return `${basePrompt}\n${timeContextInjection}`;
};
