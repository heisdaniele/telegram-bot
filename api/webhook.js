const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

module.exports = async (req, res) => {
    try {
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const update = req.body;
        console.log('Received update:', JSON.stringify(update, null, 2));

        if (!update || !update.message || !update.message.chat) {
            return res.status(400).json({ error: 'Invalid update format' });
        }

        const msg = update.message;
        const chatId = msg.chat.id;
        const text = msg.text;

        // Handle both commands and keyboard buttons
        switch(text) {
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

            case '🔗 Quick Shorten':
                await bot.sendMessage(chatId,
                    '📝 *Send me the URL to shorten:*',
                    { parse_mode: 'Markdown' }
                );
                break;

            case '📚 Bulk Shorten':
                await bot.sendMessage(chatId,
                    '📝 *Send me multiple URLs* (one per line):',
                    { parse_mode: 'Markdown' }
                );
                break;

            case '🎯 Custom Alias':
                await bot.sendMessage(chatId,
                    '📝 *Send me the URL and your desired alias*\n' +
                    'Format: `URL ALIAS`\n' +
                    'Example: `https://example.com mylink`',
                    { parse_mode: 'Markdown' }
                );
                break;

            case '📊 Track URL':
                await bot.sendMessage(chatId,
                    '*URL Tracking*\n\n' +
                    'Send the command `/track` followed by the alias to see stats:\n' +
                    'Example: `/track mylink`',
                    { parse_mode: 'Markdown' }
                );
                break;

            case '📋 My URLs':
                await bot.sendMessage(chatId,
                    'Use `/urls` command to see your shortened URLs.',
                    { parse_mode: 'Markdown' }
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
                // Handle URL inputs here
                await bot.sendMessage(chatId,
                    'Please use the keyboard buttons or commands.',
                    { parse_mode: 'Markdown' }
                );
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