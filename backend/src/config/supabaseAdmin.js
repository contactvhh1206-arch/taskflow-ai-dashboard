/**
 * Supabase Storage Admin Helper — dùng REST API thuần, không cần @supabase/supabase-js
 * Dùng service_role key để bypass RLS hoàn toàn
 */
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ipmghlsjkuxsftymsvzz.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
    console.warn('[supabaseAdmin] SUPABASE_SERVICE_ROLE_KEY chưa được cấu hình!');
}

/**
 * Upload file buffer lên Supabase Storage bucket
 * @param {string} bucket - Tên bucket (vd: 'attachments')
 * @param {string} fileName - Tên file đích trong bucket
 * @param {Buffer} buffer - Nội dung file
 * @param {string} contentType - MIME type
 * @returns {{ publicUrl: string }}
 */
async function uploadToStorage(bucket, fileName, buffer, contentType) {
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${bucket}/${fileName}`;
    const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
            'Content-Type': contentType,
            'x-upsert': 'false'
        },
        body: buffer
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Supabase Storage upload thất bại (${res.status}): ${errText}`);
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${fileName}`;
    return { publicUrl };
}

module.exports = { uploadToStorage };

