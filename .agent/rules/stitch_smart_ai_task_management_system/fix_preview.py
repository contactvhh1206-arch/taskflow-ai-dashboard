import sys

content = open('preview.html', 'r', encoding='utf-8').read()

start_str = 'Tôi có thể giúp gì cho hệ thống DUBAI hôm nay?</h2>'

s_idx = content.find(start_str)
if s_idx == -1:
    print('Start not found')
    sys.exit(1)

# Find the end of the div containing the buttons
e_idx = content.find('</div>', s_idx + len(start_str))
if e_idx == -1:
    print('End not found')
    sys.exit(1)

e_idx = e_idx + 6 # Include the </div>

replacement = """Tôi có thể giúp gì cho hệ thống DUBAI hôm nay?</h2>
                 <div className="mt-6" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
                    {[
                       'Báo cáo doanh thu hôm nay',
                       'Cơ sở nào đang trễ task?',
                       'Tình hình nhân sự',
                       'Cơ sở nào chưa Check-in?',
                       'Phân tích task trễ hạn',
                       'Công việc đang làm của phòng ban',
                       'Công việc cần làm của cơ sở',
                       'Tình trạng và số lượng nghĩ ko phép, có phép',
                       'Cơ sở nào đang cần hỗ trợ'
                    ].map((prompt, idx) => {
                       const colors = [
                          'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50',
                          'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/50',
                          'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/50',
                          'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/50',
                          'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/50',
                          'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800 hover:bg-teal-100 dark:hover:bg-teal-900/50',
                          'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/50',
                          'bg-pink-50 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400 border-pink-200 dark:border-pink-800 hover:bg-pink-100 dark:hover:bg-pink-900/50',
                          'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/50'
                       ];
                       const colorClass = colors[idx % colors.length];
                       return (
                          <button key={idx} onClick={() => setQuickPromptTrigger(prompt)} className={` + '`px-4 py-2 rounded-full font-medium text-sm border transition-colors shadow-sm hover:shadow ${colorClass}`' + `}>
                             {prompt}
                          </button>
                       );
                    })}
                 </div>"""

new_content = content[:s_idx] + replacement + content[e_idx:]
open('preview.html', 'w', encoding='utf-8').write(new_content)
print('Success')
