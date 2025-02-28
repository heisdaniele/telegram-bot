require('dotenv').config();
const axios = require('axios');
const { testConnection } = require('../supabaseClient');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://telegram-bot-six-theta.vercel.app/webhook';

async function setupWebhook() {
    try {
        // First test Supabase connection
        console.log('Testing Supabase connection...');
        await testConnection();
        console.log('✓ Supabase connection verified\n');

        // Check if bot is accessible
        const getMeUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getMe`;
        const botInfo = await axios.get(getMeUrl);
        console.log('✓ Bot accessible:', botInfo.data.result.username);

        // Delete existing webhook
        const deleteUrl = `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`;
        await axios.post(deleteUrl);
        console.log('✓ Deleted existing webhook');

        // Set new webhook with enhanced configuration
        const setUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;
        const response = await axios.post(setUrl, {
            url: WEBHOOK_URL,
            allowed_updates: ["message", "callback_query"],
            drop_pending_updates: true,
            max_connections: 100,
            secret_token: process.env.WEBHOOK_SECRET || undefined
        });

        if (response.data.ok) {
            console.log('✓ Webhook set successfully to:', WEBHOOK_URL);
            
            // Get and display webhook info
            const infoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;
            const info = await axios.get(infoUrl);
            console.log('\nWebhook Info:', JSON.stringify(info.data.result, null, 2));

            // Verify database tables
            console.log('\nVerifying database tables...');
            const { supabase } = require('../supabaseClient');
            
            const tables = ['tg_shortened_urls', 'tg_click_events'];
            for (const table of tables) {
                const { data, error } = await supabase
                    .from(table)
                    .select('*', { count: 'exact', head: true });
                
                if (error) {
                    console.error(`✗ Failed to access ${table}:`, error.message);
                } else {
                    console.log(`✓ Table ${table} is accessible`);
                    console.log(`  Total rows: ${data.count || 0}`);
                }
            }
        } else {
            console.error('✗ Failed to set webhook:', response.data);
            process.exit(1);
        }
    } catch (error) {
        console.error('✗ Setup failed:', {
            message: error.message,
            response: error.response?.data,
            timestamp: new Date().toISOString()
        });
        process.exit(1);
    }
}

// Add environment validation
function validateEnvironment() {
    const required = [
        'BOT_TOKEN',
        'SUPABASE_URL',
        'SUPABASE_KEY',
        'SUPABASE_SERVICE_ROLE_KEY'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.error('Missing required environment variables:', missing.join(', '));
        process.exit(1);
    }
}

// Execute if running directly
if (require.main === module) {
    validateEnvironment();
    setupWebhook();
}

module.exports = { setupWebhook, validateEnvironment };