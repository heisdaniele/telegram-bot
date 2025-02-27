const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

// Initialize bot without polling
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

module.exports = async (req, res) => {
    try {
        // Validate request
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const update = req.body;
        
        // Validate update format
        if (!update || !update.message || !update.message.chat || !update.message.chat.id) {
            return res.status(400).json({ 
                error: 'Invalid update format',
                required: 'message.chat.id is required'
            });
        }

        const msg = update.message;
        const chatId = msg.chat.id;

        // Log incoming message for debugging
        console.log('Received message:', {
            chatId,
            text: msg.text,
            from: msg.from
        });

        try {
            // Handle commands
            if (msg.text === '/start') {
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
            }

            return res.status(200).json({ ok: true });

        } catch (botError) {
            console.error('Bot error:', botError);
            return res.status(500).json({ 
                error: 'Bot error',
                details: botError.message
            });
        }

    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ 
            error: 'Internal server error',
            details: error.message
        });
    }
};