const TelegramBot = require('node-telegram-bot-api');
const { supabase } = require('../supabaseClient');
require('dotenv').config();

// Initialize bot without polling
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

// Handler for serverless environment
module.exports = async (req, res) => {
    try {
        // Validate request
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const update = req.body;
        console.log('Received update:', JSON.stringify(update, null, 2));

        if (!update || !update.message) {
            return res.status(400).json({ error: 'Invalid update format' });
        }

        const msg = update.message;
        const chatId = msg.chat.id;

        // Handle commands
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

            case 'ℹ️ Help':
                await bot.sendMessage(chatId,
                    '*Available Commands:*\n\n' +
                    '🔗 Quick Shorten - Simple URL shortening\n' +
                    '📚 Bulk Shorten - Multiple URLs at once\n' +
                    '🎯 Custom Alias - Choose your own alias\n' +
                    '📊 /track - View URL statistics\n' +
                    '📋 /urls - List your shortened URLs',
                    { parse_mode: 'Markdown' }
                );
                break;

            default:
                await bot.sendMessage(chatId, 'Please use the keyboard buttons or commands.');
        }

        return res.status(200).json({ ok: true });

    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ 
            error: 'Internal server error',
            details: error.message
        });
    }
};