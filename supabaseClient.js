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

// Regular client for authenticated operations
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
    },
    global: {
        headers: {
            'x-my-custom-header': 'telegram-bot'
        }
    }
});

// Service role client for admin operations
const serviceRole = createClient(supabaseUrl, serviceRoleKey);

// Set auth to use service role
supabase.auth.setSession({
    access_token: supabaseKey,
    refresh_token: supabaseKey
});

async function testConnection() {
    try {
        console.log('Testing Supabase connection...');
        const { data, error } = await supabase
            .from('tg_shortened_urls')
            .select('id')
            .limit(1);

        if (error) {
            throw new Error(`Database error: ${error.message}`);
        }
        console.log('✓ Supabase connection successful');
        return true;
    } catch (error) {
        console.error('Connection failed:', error.message);
        throw error;
    }
}

module.exports = { supabase, serviceRole, testConnection };