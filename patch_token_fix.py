import re

with open('server.js', 'r', encoding='utf-8') as f:
    text = f.read()

# Fix the INSERT statement to remove 'feature'
old_insert1 = """INSERT INTO ai_token_usage_logs (user_id, feature, prompt_tokens, completion_tokens, total_tokens)
                VALUES ($1, 'CHAT_ADVISOR', $2, $3, $4)"""
new_insert1 = """INSERT INTO ai_token_usage_logs (user_id, prompt_tokens, completion_tokens, total_tokens)
                VALUES ($1, $2, $3, $4)"""

old_insert2 = """INSERT INTO ai_token_usage_logs (user_id, feature, prompt_tokens, completion_tokens, total_tokens)
                VALUES ($1, 'CHAT_ADVISOR_EST', $2, $3, $4)"""
new_insert2 = """INSERT INTO ai_token_usage_logs (user_id, prompt_tokens, completion_tokens, total_tokens)
                VALUES ($1, $2, $3, $4)"""

text = text.replace(old_insert1, new_insert1)
text = text.replace(old_insert2, new_insert2)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Fixed token logging schema error.")
