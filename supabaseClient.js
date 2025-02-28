require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Environment validation with debug logging
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('Checking Supabase configuration...');
console.log(`URL: ${supabaseUrl ? '✓' : '✗'}`);
console.log(`Key: ${supabaseKey ? '✓' : '✗'}`);
console.log(`Service Role Key: ${serviceRoleKey ? '✓' : '✗'}`);

if (!supabaseUrl || !supabaseKey || !serviceRoleKey) {
    throw new Error('Missing Supabase credentials in .env file');
}

const options = {
    auth: {
        autoRefreshToken: true,
        persistSession: false,
        detectSessionInUrl: false
    },
    global: {
        headers: { 'x-my-custom-header': 'telegram-url-shortener' },
    },
    db: {
        schema: 'public'
    },
    realtime: {
        timeout: 20000 // 20 seconds
    }
};

// Initialize clients with updated options
const supabase = createClient(supabaseUrl, supabaseKey, options);
const serviceRole = createClient(supabaseUrl, serviceRoleKey, options);

// Enhanced connection test function
async function testConnection() {
    try {
        console.log('Testing Supabase connection...');
        
        // Test URL table access
        const { data: urlData, error: urlError } = await serviceRole
            .from('tg_shortened_urls')
            .select('id, short_alias, clicks')
            .limit(1);

        if (urlError) {
            throw new Error(`URL table access error: ${urlError.message}`);
        }

        // Test click events table access
        const { data: clickData, error: clickError } = await serviceRole
            .from('tg_click_events')
            .select('id, url_id')
            .limit(1);

        if (clickError) {
            throw new Error(`Click events table access error: ${clickError.message}`);
        }

        console.log('✓ Supabase connection successful');
        console.log('✓ URL table accessible');
        console.log('✓ Click events table accessible');
        
        return true;
    } catch (error) {
        console.error('Connection test failed:', {
            message: error.message,
            timestamp: new Date().toISOString()
        });
        throw error;
    }
}

module.exports = { supabase, serviceRole, testConnection };