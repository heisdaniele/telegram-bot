require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { supabase, testConnection } = require('./supabaseClient');
const { nanoid } = require('nanoid');

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
  ? `https://telegram-bot-six-theta.vercel.app/webhook`
  : 'http://localhost:3000/webhook';

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

        // Set webhook only in production
        if (process.env.NODE_ENV === 'production') {
            await bot.setWebHook(BOT_URL);
            console.log('✓ Webhook set to:', BOT_URL);
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
                const text = msg.text;

                // Handle states
                const userState = defaultFeature.getUserState(chatId);
                if (userState === 'WAITING_FOR_URL') {
                    await handleUrlShortening(msg);
                    return;
                }

                // Handle /track and /urls commands
                if (msg.text?.startsWith('/track')) {
                    await trackFeature.handleTrackCommand(bot, msg);
                    return;
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

                    case '📊 Track URL':
                        await bot.sendMessage(chatId,
                            '*URL Tracking*\n\n' +
                            'Send the alias of the URL you want to track:\n' +
                            'Example: `/track your-alias`',
                            { parse_mode: 'Markdown' }
                        );
                        break;

                    case '📋 My URLs':
                        await trackFeature.handleListUrls(bot, msg);
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
                        customFeature.setUserState(chatId, { 
                            step: 'waiting_for_url',
                            type: 'custom'  // Add this to differentiate from quick shorten
                        });
                        await bot.sendMessage(chatId,
                            '🎯 *Custom URL Shortener*\n\n' +
                            '1️⃣ First, send me the URL you want to shorten\n' +
                            '2️⃣ Then, I\'ll ask for your custom alias\n\n' +
                            'Please send the URL now:',
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
                        const customState = customFeature.getUserState(chatId);
                        if (customState && customState.step) {
                            await customFeature.handleCustomInput(bot, msg);
                        } else if (defaultFeature.getUserState(chatId) === 'WAITING_FOR_URL') {
                            defaultFeature.setUserState(chatId, null);
                            await defaultFeature.handleDefaultShorten(bot, msg);
                        } else if (bulkFeature.getUserState(chatId) === 'WAITING_FOR_URLS') {
                            bulkFeature.setUserState(chatId, null);
                            await bulkFeature.handleBulkShorten(bot, msg);
                        }
                        break;
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
                            
                            const statsMessage = await formatStatsMessage(stats);

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
                        await bot.answerCallbackQuery(query.id);
                        await trackFeature.handleListUrls(bot, query.message);
                        break;

                    default:
                        await bot.answerCallbackQuery(query.id, {
                            text: '❌ Unknown action',
                            show_alert: true
                        });
                }
            } catch (error) {
                console.error('Callback query error:', error);
                await bot.answerCallbackQuery(query.id, {
                    text: '❌ An error occurred',
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
