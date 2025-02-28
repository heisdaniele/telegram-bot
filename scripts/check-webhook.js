require('dotenv').config();
const axios = require('axios');
const { supabase } = require('../supabaseClient');

const BOT_TOKEN = process.env.BOT_TOKEN;

async function checkDatabaseStatus() {
    console.log('\nChecking database status...');
    
    const tables = ['tg_shortened_urls', 'tg_click_events'];
    for (const table of tables) {
        try {
            const { count, error } = await supabase
                .from(table)
                .select('*', { 
                    count: 'exact',
                    head: true 
                });

            if (error) {
                console.error(`✗ ${table}: ${error.message}`);
            } else {
                console.log(`✓ ${table}: ${count || 0} rows`);
            }
        } catch (error) {
            console.error(`✗ Error checking ${table}:`, error.message);
        }
    }
}

async function checkWebhookStatus() {
    console.log('\nChecking webhook status...');
    
    try {
        const infoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;
        const response = await axios.get(infoUrl);
        const webhook = response.data.result;

        console.log('\nWebhook Configuration:');
        console.log(`URL: ${webhook.url || 'Not set'}`);
        console.log(`Has Custom Certificate: ${webhook.has_custom_certificate}`);
        console.log(`Pending Updates: ${webhook.pending_update_count}`);
        console.log(`Max Connections: ${webhook.max_connections || 'Default'}`);
        
        if (webhook.last_error_date) {
            const errorDate = new Date(webhook.last_error_date * 1000);
            console.log(`\n⚠️ Last Error: ${webhook.last_error_message}`);
            console.log(`Error Time: ${errorDate.toISOString()}`);
        }

        return webhook.url ? true : false;
    } catch (error) {
        console.error('Error checking webhook:', {
            message: error.message,
            response: error.response?.data,
            timestamp: new Date().toISOString()
        });
        return false;
    }
}

async function main() {
    try {
        // Validate environment
        if (!BOT_TOKEN) {
            throw new Error('BOT_TOKEN environment variable is not set');
        }

        // Check webhook status
        const webhookActive = await checkWebhookStatus();
        
        // Check database status
        await checkDatabaseStatus();

        if (!webhookActive) {
            console.log('\n⚠️ Webhook is not set. Run setup-webhook.js to configure it.');
            process.exit(1);
        }

    } catch (error) {
        console.error('\n✗ Check failed:', error.message);
        process.exit(1);
    }
}

// Execute if running directly
if (require.main === module) {
    main();
}

module.exports = { checkWebhookStatus, checkDatabaseStatus };