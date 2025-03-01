const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const defaultFeature = require('../features/default');
const customFeature = require('../features/custom');
const bulkFeature = require('../features/bulk');
const trackFeature = require('../features/track');
const { formatTimeAgo } = require('../features/track');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

// URL validation helper
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
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

        // Handle states and URL detection
        const userState = defaultFeature.getUserState(chatId);
        const isUrl = text && text.match(/^https?:\/\//i);
        
        if (userState === 'WAITING_FOR_URL' && !customFeature.getUserState(chatId)) {
            let formattedUrl = text;

            // Validate URL
            if (!isValidUrl(formattedUrl)) {
                await bot.sendMessage(chatId, 
                    '❌ Please send a valid URL.\nExample: `https://example.com`',
                    { parse_mode: 'Markdown' }
                );
                return res.status(200).json({ ok: true });
            }

            try {
                // Update msg.text with formatted URL
                msg.text = formattedUrl;
                await defaultFeature.handleDefaultShorten(bot, msg);
                defaultFeature.setUserState(chatId, null); // Reset state
                return res.status(200).json({ ok: true });
            } catch (error) {
                console.error('URL shortening error:', error);
                await bot.sendMessage(chatId, 
                    '❌ Failed to shorten URL. Please try again.',
                    { parse_mode: 'Markdown' }
                );
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
                customFeature.setUserState(chatId, { step: 'waiting_for_url' });
                await bot.sendMessage(chatId,
                    '🎯 *Custom URL Creation*\n\n' +
                    'Let\'s create your custom short URL!\n\n' +
                    '1️⃣ First, send me the URL you want to shorten\n' +
                    '2️⃣ Then, I\'ll ask for your custom alias\n\n' +
                    'Please send the URL now:',
                    { parse_mode: 'Markdown' }
                );
                break;

            case '📊 Track URL':
                await bot.sendMessage(chatId,
                    '*URL Tracking*\n\n' +
                    'Send `/track` followed by the alias to see stats\n' +
                    'Example: `/track mylink`\n\n' +
                    'Stats include:\n' +
                    '• Total clicks\n' +
                    '• Unique visitors\n' +
                    '• Device types\n' +
                    '• Locations\n' +
                    '• Recent activity',
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
                if (customFeature.getUserState(chatId)) {
                    await customFeature.handleCustomInput(bot, msg);
                } else if (text.startsWith('/track ')) {
                    try {
                        const alias = text.split(' ')[1];
                        if (!alias) {
                            await bot.sendMessage(chatId,
                                '❌ Please provide an alias.\nExample: `/track mylink`',
                                { parse_mode: 'Markdown' }
                            );
                            return res.status(200).json({ ok: true });
                        }

                        
                        // Get URL stats with error handling
                        const stats = await trackFeature.getUrlStats(alias);
                        if (!stats) {
                            await bot.sendMessage(chatId,
                                '❌ URL not found. Please check the alias and try again.',
                                { parse_mode: 'Markdown' }
                            );
                            return res.status(200).json({ ok: true });
                        }

                        // Format statistics safely
                        const statsMessage = await formatStatsMessage(stats);
                        
                        await bot.sendMessage(chatId, statsMessage, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [[
                                    {
                                        text: '🔄 Refresh Stats',
                                        callback_data: `track_${alias}`
                                    }
                                ]]
                            }
                        });
                    } catch (error) {
                        console.error('Track command error:', {
                            error: error.message,
                            alias,
                            chatId
                        });
                        await bot.sendMessage(chatId,
                            '❌ Failed to fetch statistics. Please try again later.',
                            { parse_mode: 'Markdown' }
                        );
                    }
                } else if (text.startsWith('/urls')) {
                    await defaultFeature.handleListUrls(bot, msg);
                } else if (text.startsWith('/custom')) {
                    customFeature.setUserState(chatId, { step: 'waiting_for_url' });
                    await customFeature.handleCustomStart(bot, chatId);
                } else {
                    await bot.sendMessage(chatId,
                        '❓ Please use the keyboard buttons or commands.\nType /start to see available options.',
                        { parse_mode: 'Markdown' }
                    );
                }
        }

        return res.status(200).json({ ok: true });

    } catch (error) {
        console.error('Webhook error:', {
            error: error.message,
            stack: error.stack,
            userId: msg?.from?.id,
            chatId: msg?.chat?.id
        });
        return res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

// Add this helper function at the bottom of the file
async function formatStatsMessage(stats) {
    // Format browser statistics
    const browserStats = Object.entries(stats.browsers)
        .map(([browser, count]) => 
            `   • ${browser}: ${count} (${Math.round(count/stats.totalClicks*100)}%)`
        ).join('\n');

    // Format device statistics
    const deviceStats = Object.entries(stats.devices)
        .map(([device, count]) => 
            `   • ${device}: ${count} (${Math.round(count/stats.totalClicks*100)}%)`
        ).join('\n');

    // Format recent clicks
    const recentClicksStats = stats.recentClicks
        .map(click => `   • ${click.location} - ${click.device} - ${click.time}`)
        .join('\n');

    // Build complete statistics message
    return [
        '📊 *URL Statistics*\n',
        '🔢 *Clicks:*',
        `   • Total: ${stats.totalClicks}`,
        `   • Unique: ${stats.uniqueClicks}\n`,
        '🌐 *Browsers:*',
        browserStats,
        '\n📱 *Devices:*',
        deviceStats,
        '\n📍 *Recent Clicks:*',
        recentClicksStats,
        '\n⏰ *Last Clicked:*',
        `   ${stats.lastClicked ? formatTimeAgo(stats.lastClicked) : 'Never'}`,
        '🗓 *Created:*',
        `   ${formatTimeAgo(stats.created)}`
    ].join('\n');
}