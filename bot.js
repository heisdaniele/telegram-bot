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
        
        // Initialize bot
        const bot = new TelegramBot(BOT_TOKEN, { polling: true });
        console.log('🤖 Bot is running...');

        // Set webhook
        await bot.setWebHook(`${BOT_URL}`);

        // Error handling
        bot.on('polling_error', (error) => {
            console.error('Polling error:', error);
        });

        // Handle keyboard commands
        bot.on('message', async (msg) => {
            try {
                const chatId = msg.chat.id;

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
                        // Show tracking stats when button is clicked
                        await bot.answerCallbackQuery(query.id);
                        const stats = await trackFeature.getUrlStats(alias);
                        
                        // Format statistics message
                        const statsMessage = `
📊 *URL Statistics*

🔗 *Short URL:* \`${alias}\`
🔢 *Total Clicks:* ${stats.totalClicks}

📱 *Device Distribution:*
${Object.entries(stats.devices)
    .map(([device, count]) => `   • ${device}: ${count}`)
    .join('\n')}

📍 *Top Locations:*
${Object.entries(stats.locations)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([location, count]) => `   • ${location}: ${count}`)
    .join('\n')}

⏰ *Last Clicked:* ${stats.lastClicked ? new Date(stats.lastClicked).toLocaleString() : 'Never'}
🗓 *Created:* ${new Date(stats.created).toLocaleString()}`;

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
                        break;

                    case 'refresh_urls':
                        await bot.answerCallbackQuery(query.id);
                        await trackFeature.handleListUrls(bot, query.message);
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

// Start the bot
startBot();
