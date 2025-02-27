const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

// Import features
const customFeature = require('../features/custom');
const trackFeature = require('../features/track');
const defaultFeature = require('../features/default');
const bulkFeature = require('../features/bulk');

// Bot initialization
const bot = new TelegramBot(process.env.BOT_TOKEN);

// Webhook handler
module.exports = async (req, res) => {
    try {
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const { body } = req;
        if (!body || !body.message) {
            return res.status(400).json({ error: 'Invalid webhook body' });
        }

        const msg = body.message;
        const chatId = msg.chat.id;

        // Handle /track command
        if (msg.text?.startsWith('/track')) {
            await trackFeature.handleTrackCommand(bot, msg);
            return res.status(200).json({ ok: true });
        }

        switch(msg.text) {
            case '/start':
                await bot.sendMessage(chatId,
                    '👋 *Welcome to URL Shortener Bot!*\n\n' +
                    'Choose an option:',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['🔗 Quick Shorten', '📚 Bulk Shorten'],
                                ['🎯 Custom Alias', '📊 Track URL'],
                                ['📋 My URLs', 'ℹ️ Help']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
                break;

            // ... rest of your command handlers ...
        }

        return res.status(200).json({ ok: true });

    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};