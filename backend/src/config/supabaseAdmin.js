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

/**
 * Liệt kê toàn bộ file ở gốc bucket (phân trang, vì Supabase trả tối đa 1000 file mỗi lần)
 */
async function listAllFiles(bucket) {
    const PAGE_SIZE = 1000;
    const files = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabaseAdmin.storage
            .from(bucket)
            .list('', { limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } });

        if (error) throw new Error(`Supabase Storage: ${error.message}`);
        files.push(...data.filter(f => f.id)); // id null = thư mục, bỏ qua
        if (data.length < PAGE_SIZE) break;
    }
    return files;
}

/**
 * Xóa danh sách file khỏi bucket, trả về số file thực sự đã xóa
 */
async function removeFromStorage(bucket, fileNames) {
    const BATCH_SIZE = 100;
    let deleted = 0;
    for (let i = 0; i < fileNames.length; i += BATCH_SIZE) {
        const { data, error } = await supabaseAdmin.storage
            .from(bucket)
            .remove(fileNames.slice(i, i + BATCH_SIZE));

        if (error) throw new Error(`Supabase Storage: ${error.message}`);
        deleted += (data || []).length;
    }
    return deleted;
}

module.exports = { uploadToStorage, listAllFiles, removeFromStorage };

