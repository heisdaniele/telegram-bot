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
        const { data, error } = await supabase.from('urls').select('count', { count: 'exact' });
        if (error) throw error;
        console.log('✓ Successfully connected to Supabase');
        return true;
    } catch (error) {
        console.error('Supabase connection error:', {
            message: error.message,
            code: error.code,
            details: error.details
        });
        throw error;
    }
}

module.exports = { supabase, testConnection };