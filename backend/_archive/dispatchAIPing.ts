import { z } from 'zod';
import { PoolClient } from 'pg';
import pool from './db';
import redis from './redisClient'; 

const pingTaskSchema = z.object({
  taskId: z.string().uuid("taskId must be a valid UUID"),
  message: z.string().min(1, "Message cannot be empty").max(1000, "Message too long")
});

const ALL_ACCESS_ROLES = [
  'SUPER_ADMIN', 
  'VICE_PRESIDENT', 
  'FINANCE_DEPT', 
  'DEPARTMENT_HEAD', 
  'ADMIN'
];

type UserContext = {
  id: string;
  role: 'SUPER_ADMIN' | 'VICE_PRESIDENT' | 'FINANCE_DEPT' | 'DEPARTMENT_HEAD' | 'ADMIN' | 'FACILITY_MANAGER' | 'USER' | string;
  facilityId: string;
};

interface ToolCallState {
  retries: number;
}

const MAX_RETRIES = 3;
const COOLDOWN_SECONDS = 3600; // 1 hour

export async function dispatchAIPing(
  aiArgumentsRaw: string,
  user: UserContext,
  state: ToolCallState
): Promise<string> {
  let parsedArgs;

  try {
    const rawObj = JSON.parse(aiArgumentsRaw);
    parsedArgs = pingTaskSchema.parse(rawObj);
  } catch (error) {
    if (state.retries >= MAX_RETRIES) {
      return JSON.stringify({ error: 'TOOL_CALL_FAILED: MAX_RETRIES_EXCEEDED' });
    }
    state.retries += 1;
    return JSON.stringify({
      error: "Invalid arguments format",
      details: error instanceof Error ? error.message : String(error),
      instruction: "Please fix taskId (must be UUID) or message, then retry."
    });
  }

  const { taskId, message } = parsedArgs;
  const cooldownKey = `ai_ping_cooldown:${taskId}`;

  try {
    const isOnCooldown = await redis.get(cooldownKey);
    if (isOnCooldown) {
      return JSON.stringify({
        error: "SPAM_PREVENTION: Task is currently on cooldown.",
        instruction: "Do not ping this task again right now. Move on to other tasks."
      });
    }
  } catch (redisError) {
    console.error("Redis Cooldown Check Failed", redisError);
  }

  let client: PoolClient | null = null;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    let insertCommentQuery = `
      INSERT INTO task_comments (task_id, comment, is_ai, created_by)
      SELECT id, $2, true, $3 
      FROM tasks 
      WHERE id = $1
    `;
    
    const queryValues: any[] = [taskId, message, 'AI_AGENT'];
    
    if (!ALL_ACCESS_ROLES.includes(user.role)) {
      insertCommentQuery += ` AND facility_id = $4`;
      queryValues.push(user.facilityId);
    }
    
    insertCommentQuery += ` RETURNING id`;

    const commentResult = await client.query(insertCommentQuery, queryValues);

    if (commentResult.rowCount === 0) {
      throw new Error("NOT_FOUND_OR_FORBIDDEN: Task does not exist or you lack facility permissions to ping this task.");
    }

    const insertLogQuery = `
      INSERT INTO ai_ping_logs (task_id, payload, status, triggered_by)
      VALUES ($1, $2, 'SUCCESS', $3)
    `;
    await client.query(insertLogQuery, [taskId, message, user.id]);

    await client.query('COMMIT');

    try {
      await redis.setex(cooldownKey, COOLDOWN_SECONDS, 'LOCKED');
    } catch (redisError) {
      console.error("Redis Cooldown Set Failed", redisError);
    }

    return JSON.stringify({
      success: true,
      message: "Task successfully pinged and logged.",
      comment_id: commentResult.rows[0].id
    });

  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    
    return JSON.stringify({
      error: "TRANSACTION_FAILED",
      reason: error instanceof Error ? error.message : "Unknown database constraint or timeout",
      instruction: "Do not throw this error to the user. Inform them gracefully via stream."
    });
  } finally {
    if (client) {
      client.release();
    }
  }
}
