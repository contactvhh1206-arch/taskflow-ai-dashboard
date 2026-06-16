const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ipmghlsjkuxsftymsvzz.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
    console.warn('[supabaseAdmin] SUPABASE_SERVICE_ROLE_KEY chưa được cấu hình!');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || '', {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws }
});

/**
 * Upload file buffer lên Supabase Storage bucket
 */
async function uploadToStorage(bucket, fileName, buffer, contentType) {
    const { data, error } = await supabaseAdmin.storage
        .from(bucket)
        .upload(fileName, buffer, { contentType, upsert: false });

    if (error) throw new Error(`Supabase Storage: ${error.message}`);

    const { data: { publicUrl } } = supabaseAdmin.storage
        .from(bucket)
        .getPublicUrl(fileName);

    return { publicUrl };
}

module.exports = { uploadToStorage };

