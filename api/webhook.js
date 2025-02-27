const TelegramBot = require('node-telegram-bot-api');require('dotenv').config();const bot = new TelegramBot(process.env.BOT_TOKEN);module.exports = async (req, res) => {    try {        if (req.method !== 'POST') {            return res.status(405).json({ error: 'Method not allowed' });        }        const { body } = req;                if (!body || !body.message) {            return res.status(400).json({ error: 'Invalid webhook data' });        }        await bot.handleUpdate(body);        return res.status(200).json({ ok: true });    } catch (error) {        console.error('Webhook error:', error);        return res.status(500).json({ error: 'Internal server error' });    }};