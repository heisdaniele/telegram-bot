require('dotenv').config();
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;

async function checkWebhook() {
    try {
        const infoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;
        const response = await axios.get(infoUrl);
        console.log('Webhook Status:', JSON.stringify(response.data.result, null, 2));
    } catch (error) {
        console.error('Error checking webhook:', error.message);
        process.exit(1);
    }
}

checkWebhook();