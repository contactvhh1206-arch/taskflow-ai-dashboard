import re

schema_file = 'agent/rules/stitch_smart_ai_task_management_system/server/schema.sql'
with open(schema_file, 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update tasks table
old_tasks = """CREATE TABLE tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'todo', -- todo, in_progress, review, done
    urgency BOOLEAN DEFAULT FALSE,
    deadline TIMESTAMP,
    pic_id INT REFERENCES users(id), -- Người phụ trách (Person In Charge)
    facility_id INT REFERENCES facilities(id) NOT NULL, -- Task thuộc cơ sở nào
    created_by INT REFERENCES users(id),
    created_by_role VARCHAR(50), -- 'CEO', 'VCEO', 'MANAGER', etc.
    priority_level VARCHAR(50) DEFAULT 'PRIORITY', -- 'URGENT', 'PRIORITY'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);"""
new_tasks = """CREATE TABLE tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'todo', -- todo, in_progress, review, done
    urgency BOOLEAN DEFAULT FALSE,
    deadline TIMESTAMP,
    pic_id INT REFERENCES users(id), -- Người phụ trách (Person In Charge)
    facility_id INT REFERENCES facilities(id) NOT NULL, -- Task thuộc cơ sở nào
    created_by INT REFERENCES users(id),
    created_by_role VARCHAR(50), -- 'CEO', 'VCEO', 'MANAGER', etc.
    priority_level VARCHAR(50) DEFAULT 'PRIORITY', -- 'URGENT', 'PRIORITY'
    department_code VARCHAR(50),
    priority_stars INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);"""
if old_tasks in text:
    text = text.replace(old_tasks, new_tasks)
else:
    print("WARNING: Could not replace tasks table")

# 2. Update ai_ping_logs table
old_ai_ping = """CREATE TABLE ai_ping_logs (
    id SERIAL PRIMARY KEY,
    task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
    pic_id INT REFERENCES users(id),
    message TEXT NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_read BOOLEAN DEFAULT FALSE
);"""
new_ai_ping = """CREATE TABLE ai_ping_logs (
    id SERIAL PRIMARY KEY,
    task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
    message TEXT,
    pinged_at TIMESTAMP DEFAULT NOW()
);"""
if old_ai_ping in text:
    text = text.replace(old_ai_ping, new_ai_ping)
else:
    print("WARNING: Could not replace ai_ping_logs table")

# 3. Add Indexes at the end
indexes = """

-- Performance Indexes
CREATE INDEX idx_tasks_dept ON tasks(department_code);
CREATE INDEX idx_reports_date ON daily_financial_reports(created_at);
"""
if "CREATE INDEX idx_tasks_dept" not in text:
    text += indexes

with open(schema_file, 'w', encoding='utf-8') as f:
    f.write(text)

print("schema.sql updated")
