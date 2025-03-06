require('dotenv').config();
const axios = require('axios');
const { testConnection } = require('../supabaseClient');

const BOT_TOKEN = process.env.BOT_TOKEN;
const DOMAIN = process.env.DOMAIN || 'midget.pro';
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || '/bot';
const WEBHOOK_URL = `https://${DOMAIN}${WEBHOOK_PATH}`;

// Add table verification function
async function verifyDatabaseTables(supabase) {
    console.log('\nVerifying database tables...');
    
    const tables = [
        'tg_users',
        'tg_shortened_urls',
        'tg_click_events'
    ];

    for (const table of tables) {
        try {
            // Just verify table existence and access
            const { data, error } = await supabase
                .from(table)
                .select('*', { count: 'exact', head: true });
            
            if (error) {
                console.error(`✗ Failed to access ${table}:`, error.message);
                throw error;
            }
            
            console.log(`✓ Table ${table} is accessible`);
        } catch (error) {
            console.error(`✗ Table verification failed for ${table}:`, error.message);
            throw error;
        }
    }
    
    console.log('✓ All database tables verified');
}

// Update the setupWebhook function
async function setupWebhook() {
    try {
        console.log('Starting webhook setup...');
        console.log('Using domain:', DOMAIN);
        console.log('Webhook URL:', WEBHOOK_URL);

        // First test Supabase connection
        console.log('\nTesting Supabase connection...');
        await testConnection();
        console.log('✓ Supabase connection verified\n');

        // Check if bot is accessible
        const getMeUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getMe`;
        const botInfo = await axios.get(getMeUrl);
        console.log('✓ Bot accessible:', botInfo.data.result.username);

        // Get current webhook info
        const infoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;
        const currentWebhook = await axios.get(infoUrl);
        console.log('\nCurrent webhook:', currentWebhook.data.result.url);

        // Delete existing webhook
        const deleteUrl = `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`;
        await axios.post(deleteUrl);
        console.log('✓ Deleted existing webhook');

        // Set new webhook with enhanced configuration
        const setUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;
        const webhookConfig = {
            url: WEBHOOK_URL,
            allowed_updates: ["message", "callback_query"],
            drop_pending_updates: true,
            max_connections: 100,
            secret_token: process.env.WEBHOOK_SECRET
        };

        console.log('\nSetting webhook with config:', JSON.stringify(webhookConfig, null, 2));

        const response = await axios.post(setUrl, webhookConfig);

        if (response.data.ok) {
            console.log('✓ Webhook set successfully to:', WEBHOOK_URL);
            
            // Verify new webhook info
            const newInfo = await axios.get(infoUrl);
            console.log('\nNew Webhook Info:', JSON.stringify(newInfo.data.result, null, 2));

            // Verify database tables
            const { supabase } = require('../supabaseClient');
            await verifyDatabaseTables(supabase);
            
            console.log('\n✓ Setup completed successfully');
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

// Add database setup verification to environment validation
function validateEnvironment() {
    const required = [
        'BOT_TOKEN',
        'SUPABASE_URL',
        'SUPABASE_KEY',
        'DOMAIN',
        'WEBHOOK_SECRET'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.error('Missing required environment variables:', missing.join(', '));
        process.exit(1);
    }

    // Validate Supabase URL format
    try {
        new URL(process.env.SUPABASE_URL);
    } catch (error) {
        console.error('Invalid SUPABASE_URL format:', error.message);
        process.exit(1);
    }
}

// Execute if running directly
if (require.main === module) {
    validateEnvironment();
    setupWebhook();
}

module.exports = { setupWebhook, validateEnvironment };