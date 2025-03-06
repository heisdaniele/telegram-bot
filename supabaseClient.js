require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Validate environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Add detailed error logging
if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Environment variables status:', {
        SUPABASE_URL: !!SUPABASE_URL,
        SUPABASE_KEY: !!SUPABASE_KEY,
        NODE_ENV: process.env.NODE_ENV
    });
    throw new Error('Missing Supabase credentials in environment');
}

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: false
    }
});

// Enhanced connection test
async function testConnection() {
    try {
        console.log('Testing Supabase connection...');
        // Test with tg_users table instead of urls
        const { data, error } = await supabase
            .from('tg_users')
            .select('*', { count: 'exact', head: true });

        if (error) {
            throw error;
        }

        return true;
    } catch (error) {
        console.error('Supabase connection error:', error);
        throw error;
    }
}

module.exports = { supabase, testConnection };