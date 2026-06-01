import { z } from 'zod';
import { PoolClient } from 'pg'; 
import pool from './db'; 

const getFinancialReportSchema = z.object({
  facilityId: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(50).default(20), 
});

type UserContext = {
  id: string;
  role: 'ADMIN' | 'FACILITY_MANAGER' | 'USER';
  facilityId: string;
};

const MAX_RETRIES = 3;

interface ToolCallState {
  retries: number;
}

function mapRowsToCSV(rows: any[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]).join(',');
  const csvRows = rows.map(row => 
    Object.values(row).map(value => {
      if (value === null || value === undefined) return '""';
      return `"${String(value).replace(/"/g, '""')}"`;
    }).join(',')
  );
  return [headers, ...csvRows].join('\n');
}

export async function dispatchGetFinancialReport(
  aiArgumentsRaw: string,
  user: UserContext,
  state: ToolCallState
): Promise<string> {
  let parsedArgs;

  try {
    const rawObj = JSON.parse(aiArgumentsRaw);
    parsedArgs = getFinancialReportSchema.parse(rawObj);
  } catch (error) {
    if (state.retries >= MAX_RETRIES) {
      throw new Error('TOOL_CALL_FAILED: MAX_RETRIES_EXCEEDED');
    }
    state.retries += 1;
    return JSON.stringify({
      error: "Invalid schema or JSON parsing failed",
      details: error instanceof Error ? error.message : String(error),
      instruction: "facilityId is REQUIRED. If missing, ask the user for the specific facility ID."
    });
  }

  let targetFacilityId = parsedArgs.facilityId;

  if (user.role === 'FACILITY_MANAGER') {
    targetFacilityId = user.facilityId; 
  } else if (user.role !== 'ADMIN') {
    throw new Error('FORBIDDEN: Insufficient permissions');
  }

  let client: PoolClient | null = null;
  try {
    client = await pool.connect();

    const offset = (parsedArgs.page - 1) * parsedArgs.limit;
    
    const queryText = `
      SELECT id, amount, transaction_date, status, reference_code
      FROM financial_reports
      WHERE facility_id = $1
        AND transaction_date >= $2
        AND transaction_date <= $3
      ORDER BY transaction_date DESC
      LIMIT $4 OFFSET $5
    `;

    const queryValues = [
      targetFacilityId,
      parsedArgs.startDate,
      parsedArgs.endDate,
      parsedArgs.limit,
      offset
    ];

    const result = await client.query(queryText, queryValues);
    const csvData = mapRowsToCSV(result.rows);

    return JSON.stringify({
      data: csvData,
      meta: {
        format: 'csv',
        page: parsedArgs.page,
        limit: parsedArgs.limit,
        returned_count: result.rowCount,
        truncated: result.rowCount === parsedArgs.limit
      }
    });

  } catch (dbError) {
    throw new Error(`DATABASE_ERROR: ${dbError instanceof Error ? dbError.message : 'Query failed'}`);
  } finally {
    if (client) {
      client.release();
    }
  }
}
