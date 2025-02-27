const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

// Initialize bot with webhook mode
const bot = new TelegramBot(process.env.BOT_TOKEN, { webHook: true });

// Import features
const customFeature = require('../features/custom');
const trackFeature = require('../features/track');
const defaultFeature = require('../features/default');
const bulkFeature = require('../features/bulk');

// Export webhook handler
module.exports = async (req, res) => {
    try {
        // Verify request method
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const { body } = req;
        
        // Verify webhook data
        if (!body || !body.message) {
            return res.status(400).json({ error: 'Invalid webhook data' });
        }

        const msg = body.message;
        const chatId = msg.chat.id;

        // Handle /track command
        if (msg.text?.startsWith('/track')) {
            await trackFeature.handleTrackCommand(bot, msg);
            return res.status(200).json({ ok: true });
        }

        // Handle commands and keyboard inputs
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

            case '🔗 Quick Shorten':
                defaultFeature.setUserState(chatId, 'WAITING_FOR_URL');
                await bot.sendMessage(chatId, 
                    '📝 *Send me the URL to shorten:*',
                    { parse_mode: 'Markdown' }
                );
                break;

            case '📚 Bulk Shorten':
                bulkFeature.setUserState(chatId, 'WAITING_FOR_URLS');
                await bot.sendMessage(chatId,
                    '📝 *Send me multiple URLs* (one per line):',
                    { parse_mode: 'Markdown' }
                );
                break;

            case '🎯 Custom Alias':
                customFeature.setUserState(chatId, 'WAITING_FOR_CUSTOM_URL');
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
                // Handle URL shortening states
                if (defaultFeature.getUserState(chatId) === 'WAITING_FOR_URL') {
                    defaultFeature.setUserState(chatId, null);
                    await defaultFeature.handleDefaultShorten(bot, msg);
                }
                // Handle bulk URL states
                else if (bulkFeature.getUserState(chatId) === 'WAITING_FOR_URLS') {
                    bulkFeature.setUserState(chatId, null);
                    await bulkFeature.handleBulkShorten(bot, msg);
                }
                // Handle custom URL states
                else if (customFeature.getUserState(chatId)) {
                    await customFeature.handleCustomInput(bot, msg);
                }
        }

        return res.status(200).json({ ok: true });

    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};