require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { supabase, testConnection } = require('./supabaseClient');
const { nanoid } = require('nanoid');
const { formatTimeAgo } = require('./features/track');

// Load feature modules
const bulkFeature = require('./features/bulk');
const customFeature = require('./features/custom');
const trackFeature = require('./features/track');
const defaultFeature = require('./features/default');

// Environment validation
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN is missing in .env file');
}

const BOT_URL = process.env.NODE_ENV === 'production' 
    ? `https://${process.env.DOMAIN}/api/webhook`  // Note the /api prefix
    : 'http://localhost:3000/api/webhook';

// Bot initialization
async function startBot() {
    try {
        // Test database connection before starting
        await testConnection();
        
        // Initialize bot without polling in production
        const bot = new TelegramBot(BOT_TOKEN, {
            polling: process.env.NODE_ENV !== 'production'
        });
        console.log('🤖 Bot is running...');

        // Update the webhook configuration
        if (process.env.NODE_ENV === 'production') {
            const webhookUrl = process.env.WEBHOOK_URL;  // Use WEBHOOK_URL directly
            const webhookOptions = {
                max_connections: 100,
                allowed_updates: ['message', 'callback_query'],
                secret_token: process.env.WEBHOOK_SECRET,
                drop_pending_updates: true
            };
            
            try {
                // Clear any existing webhook
                await bot.deleteWebhook();
                console.log('✓ Existing webhook deleted');

                // Set new webhook
                await bot.setWebHook(webhookUrl, webhookOptions);
                console.log('✓ New webhook set:', webhookUrl);

                // Verify webhook info
                const webhookInfo = await bot.getWebhookInfo();
                console.log('✓ Webhook verification:', {
                    url: webhookInfo.url,
                    pending_update_count: webhookInfo.pending_update_count,
                    max_connections: webhookInfo.max_connections,
                    last_error_date: webhookInfo.last_error_date,
                    last_error_message: webhookInfo.last_error_message
                });

                if (webhookInfo.url !== webhookUrl) {
                    throw new Error(`Webhook URL mismatch. Expected: ${webhookUrl}, Got: ${webhookInfo.url}`);
                }
            } catch (error) {
                console.error('Webhook setup error:', error);
                throw error;
            }
        }

        // Error handling
        bot.on('polling_error', (error) => {
            console.error('Polling error:', error);
        });

        // Handle URL shortening
        async function handleUrlShortening(msg) {
            const chatId = msg.chat.id;
            const url = msg.text;

            if (!isValidUrl(url)) {
                await bot.sendMessage(chatId,
                    '❌ Please send a valid URL.',
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            try {
                // Your URL shortening logic here
                const shortUrl = await defaultFeature.handleDefaultShorten(bot, msg);
                defaultFeature.setUserState(chatId, null);
            } catch (error) {
                console.error('URL shortening error:', error);
                await bot.sendMessage(chatId,
                    '❌ Failed to shorten URL. Please try again.',
                    { parse_mode: 'Markdown' }
                );
            }
        }

        // Handle keyboard commands
        bot.on('message', async (msg) => {
            try {
                const chatId = msg.chat.id;
                const text = msg.text || '';  // Ensure text is not undefined

                // Log incoming message for debugging
                console.log('Received message:', {
                    chatId,
                    text,
                    type: msg.entities?.[0]?.type
                });

                // Handle states
                const userState = defaultFeature.getUserState(chatId);
                if (userState === 'WAITING_FOR_URL') {
                    await handleUrlShortening(msg);
                    return;
                }

                // Handle /track and /urls commands
                if (text.startsWith('/track')) {
                    await trackFeature.handleTrackCommand(bot, msg);
                    return;
                }

                // Make command matching more robust
                switch(text.toLowerCase()) {
                    case '/start':
                        console.log('Handling /start command');
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
                        ).catch(error => {
                            console.error('Error sending start message:', error);
                            throw error;
                        });
                        break;

                    case '📊 Track URL':
                        await bot.sendMessage(chatId,
                            '*URL Tracking*\n\n' +
                            'Send the alias of the URL you want to track:\n' +
                            'Example: `/track your-alias`',
                            { parse_mode: 'Markdown' }
                        );
                        break;

                    case '📋 My URLs':
                        try {
                            await defaultFeature.handleListUrls(bot, msg);
                        } catch (error) {
                            console.error('List URLs error:', error);
                            await bot.sendMessage(msg.chat.id,
                                '❌ Failed to fetch your URLs.\n' +
                                'Please try again later.',
                                { parse_mode: 'Markdown' }
                            );
                        }
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
                            '*Bulk URL Shortener*\n\n' +
                            'Send multiple URLs separated by spaces:',
                            { parse_mode: 'Markdown' }
                        );
                        break;

                    case '🎯 Custom Alias':
                        await customFeature.handleCustomStart(bot, chatId);
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
            } catch (error) {
                console.error('Error handling message:', error);
                await bot.sendMessage(msg.chat.id,
                    '❌ An error occurred. Please try again.',
                    { parse_mode: 'Markdown' }
                );
            }
        });

        // Handle callback queries (for inline buttons)
        bot.on('callback_query', async (query) => {
            try {
                const [action, alias] = query.data.split('_');

                switch (action) {
                    case 'copy':
                        await bot.answerCallbackQuery(query.id, {
                            text: '📋 URL copied to clipboard!'
                        });
                        break;
                    
                    case 'track':
                        try {
                            await bot.answerCallbackQuery(query.id);
                            const stats = await trackFeature.getUrlStats(alias);
                            
                            // Format browser statistics
                            const browserStats = formatStatistics('browsers', stats.browsers);

                            // Format device statistics
                            const deviceStats = formatStatistics('devices', stats.devices);

                            // Format recent clicks
                            const recentClicksStats = stats.recentClicks
                                .map(click => `   • ${click.location} - ${click.device} - ${click.time}`)
                                .join('\n');

                            // Build complete statistics message
                            const statsMessage = [
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

                            await bot.sendMessage(query.message.chat.id, statsMessage, {
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
                            console.error('Track stats error:', error);
                            await bot.answerCallbackQuery(query.id, {
                                text: '❌ Failed to fetch statistics',
                                show_alert: true
                            });
                        }
                        break;

                    case 'refresh_urls':
                        try {
                            await bot.answerCallbackQuery(query.id);
                            await defaultFeature.handleListUrls(bot, query.message);
                        } catch (error) {
                            console.error('Refresh URLs error:', error);
                            await bot.answerCallbackQuery(query.id, {
                                text: '❌ Failed to refresh URLs',
                                show_alert: true
                            });
                        }
                        break;
                }
            } catch (error) {
                console.error('Callback query error:', error);
                await bot.answerCallbackQuery(query.id, {
                    text: '❌ An error occurred while fetching statistics',
                    show_alert: true
                });
            }
        });

        console.log('🤖 Bot started successfully!');

    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

// Helper function to validate URLs
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// Helper function to format statistics
const formatStatistics = (type, stats) => {
    return Object.entries(stats)
        .map(([key, count]) => {
            const percentage = Math.round((count / stats.totalClicks) * 100);
            return `   • ${key}: ${count} (${percentage}%)`;
        })
        .join('\n');
};

// Start the bot
startBot();
