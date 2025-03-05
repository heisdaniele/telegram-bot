require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Validate environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing Supabase credentials in .env file');
}

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Test database connection
async function testConnection() {
    try {
        const { data, error } = await supabase.from('urls').select('count', { count: 'exact' });
        if (error) throw error;
        console.log('✓ Successfully connected to Supabase');
    } catch (error) {
        console.error('Failed to connect to Supabase:', error.message);
        throw error;
    }
}

module.exports = { supabase, testConnection };