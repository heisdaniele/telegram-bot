const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const defaultFeature = require('../features/default');
const customFeature = require('../features/custom');
const bulkFeature = require('../features/bulk');
const trackFeature = require('../features/track');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

// URL validation helper
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

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

        console.log(`Processing message: ${text} from chat ${chatId}`);
        console.log(`Current state: ${defaultFeature.getUserState(chatId)}`);

        // Handle states
        const userState = defaultFeature.getUserState(chatId);
        
        if (userState === 'WAITING_FOR_URL') {
            if (!isValidUrl(text)) {
                await bot.sendMessage(chatId, 
                    '❌ Please send a valid URL.\nExample: `https://example.com`',
                    { parse_mode: 'Markdown' }
                );
                return res.status(200).json({ ok: true });
            }
            try {
                await defaultFeature.handleDefaultShorten(bot, msg);
                defaultFeature.setUserState(chatId, null);
                return res.status(200).json({ ok: true });
            } catch (error) {
                await bot.sendMessage(chatId, '❌ Failed to shorten URL');
                defaultFeature.setUserState(chatId, null);
                return res.status(200).json({ ok: true });
            }
        }

        // Handle commands and keyboard buttons
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
                defaultFeature.setUserState(chatId, 'WAITING_FOR_URL');
                await bot.sendMessage(chatId,
                    '📝 *Send me the URL to shorten:*\nExample: `https://example.com`',
                    { parse_mode: 'Markdown' }
                );
                break;

            case '📚 Bulk Shorten':
                defaultFeature.setUserState(chatId, 'WAITING_FOR_BULK');
                await bot.sendMessage(chatId,
                    '*Send me multiple URLs* (one per line)\n\n' +
                    'Example:\n' +
                    '`https://example1.com`\n' +
                    '`https://example2.com`',
                    { parse_mode: 'Markdown' }
                );
                break;

            case '🎯 Custom Alias':
                await customFeature.handleCustomStart(bot, chatId);
                break;

            case '📊 Track URL':
                await bot.sendMessage(chatId,
                    '*URL Tracking*\n\n' +
                    'Send `/track` followed by the alias to see stats\n' +
                    'Example: `/track mylink`',
                    { parse_mode: 'Markdown' }
                );
                break;

            case '📋 My URLs':
                await defaultFeature.handleListUrls(bot, msg);
                break;

            case 'ℹ️ Help':
                await bot.sendMessage(chatId,
                    '*Available Commands*\n\n' +
                    '🔗 `Quick Shorten` - Simple URL shortening\n' +
                    '📚 `Bulk Shorten` - Multiple URLs at once\n' +
                    '🎯 `Custom Alias` - Choose your own alias\n' +
                    '📊 `/track` - View URL statistics\n' +
                    '📋 `/urls` - List your shortened URLs',
                    { parse_mode: 'Markdown' }
                );
                break;

            default:
                if (text.startsWith('/track ')) {
                    const alias = text.split(' ')[1];
                    await trackFeature.handleTrackCommand(bot, msg, alias);
                } else if (text.startsWith('/urls')) {
                    // Handle /urls command
                    await defaultFeature.handleListUrls(bot, msg);
                } else if (customFeature.getUserState(chatId)) {
                    await customFeature.handleCustomInput(bot, msg);
                    return res.status(200).json({ ok: true });
                } else if (text.startsWith('/custom')) {
                    await customFeature.handleCustomAlias(bot, msg);
                } else {
                    await bot.sendMessage(chatId,
                        '❓ Please use the keyboard buttons or commands.\nType /start to see available options.',
                        { parse_mode: 'Markdown' }
                    );
                }
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