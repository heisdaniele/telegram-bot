require('dotenv').config();
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = 'https://telegram-bot-six-theta.vercel.app/webhook';

async function setupWebhook() {
    try {
        // First check if bot is accessible
        const getMeUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getMe`;
        const botInfo = await axios.get(getMeUrl);
        console.log('✓ Bot accessible:', botInfo.data.result.username);

        // Delete existing webhook
        const deleteUrl = `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`;
        await axios.post(deleteUrl);
        console.log('✓ Deleted existing webhook');

        // Set new webhook
        const setUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;
        const response = await axios.post(setUrl, {
            url: WEBHOOK_URL,
            allowed_updates: ["message", "callback_query"],
            drop_pending_updates: true
        });

        if (response.data.ok) {
            console.log('✓ Webhook set successfully to:', WEBHOOK_URL);
            // Get webhook info
            const infoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;
            const info = await axios.get(infoUrl);
            console.log('\nWebhook Info:', JSON.stringify(info.data.result, null, 2));
        } else {
            console.error('✗ Failed to set webhook:', response.data);
        }
    } catch (error) {
        console.error('✗ Error:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
        process.exit(1);
    }
}

setupWebhook();