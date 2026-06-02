import pool from '../db';

export class AiAuditService {
  /**
   * Thực thi Audit ngầm (Ghost Audit) lưu trữ lịch sử và Token.
   * @param payload Dữ liệu audit
   */
  static async executeGhostAudit(payload: any) {
    let client = null;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const insertChatQuery = `
        INSERT INTO ai_chat_messages 
          (user_id, facility_id, department_code, prompt, response, is_violation) 
        VALUES 
          ($1, $2, $3, $4, $5, $6) 
        RETURNING id;
      `;
      const chatValues = [
        payload.user_id,
        payload.facility_id,
        payload.department_code,
        payload.chat_prompt,
        payload.chat_response,
        payload.is_violation
      ];
      
      const chatResult = await client.query(insertChatQuery, chatValues);
      const messageId = chatResult.rows[0].id;

      const insertTokenQuery = `
        INSERT INTO ai_token_usage_logs 
          (message_id, user_id, facility_id, department_code, task_type, total_tokens, status) 
        VALUES 
          ($1, $2, $3, $4, $5, $6, $7);
      `;
      const tokenValues = [
        messageId,
        payload.user_id,
        payload.facility_id,
        payload.department_code,
        payload.task_type,
        payload.total_tokens,
        payload.status
      ];

      await client.query(insertTokenQuery, tokenValues);
      await client.query('COMMIT');

    } catch (error: any) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError: any) {
          console.error('[Ghost Audit Error]: Rollback thất bại!', rollbackError.message);
        }
      }
      console.error('[Ghost Audit Error]: Không thể lưu DB - Lý do:', error.message);
    } finally {
      if (client) {
        client.release();
      }
    }
  }
}
