const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Validate environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('Missing Supabase credentials:', {
        url: !!process.env.SUPABASE_URL,
        key: !!process.env.SUPABASE_KEY
    });
    throw new Error('Missing required Supabase environment variables');
}

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
    {
        auth: {
            persistSession: false
        }
    }
);

const defaultFeature = require('../features/default');
const customFeature = require('../features/custom');
const bulkFeature = require('../features/bulk');
const trackFeature = require('../features/track');
const { formatTimeAgo } = require('../features/track');

const handleUpdate = async (update) => {
    try {
        const msg = update.message || update.callback_query?.message;
        const chatId = msg.chat.id;
        const text = msg.text || '';  // Ensure text is not undefined

        // Log incoming message for debugging
        console.log('Received message:', {
            chatId,
            text,
            type: msg?.entities?.[0]?.type
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

            case '📊 track url':
                await bot.sendMessage(chatId,
                    '*URL Tracking*\n\n' +
                    'Send the alias of the URL you want to track:\n' +
                    'Example: `/track your-alias`',
                    { parse_mode: 'Markdown' }
                );
                break;

            case '📋 my urls':
                try {
                    await defaultFeature.handleListUrls(bot, msg);
                } catch (error) {
                    console.error('List URLs error:', error);
                    await bot.sendMessage(chatId,
                        '❌ Failed to fetch your URLs.\n' +
                        'Please try again later.',
                        { parse_mode: 'Markdown' }
                    );
                }
                break;

            case '🔗 quick shorten':
                defaultFeature.setUserState(chatId, 'WAITING_FOR_URL');
                await bot.sendMessage(chatId, 
                    '📝 *Send me the URL to shorten:*',
                    { parse_mode: 'Markdown' }
                );
                break;

            case '📚 bulk shorten':
                bulkFeature.setUserState(chatId, 'WAITING_FOR_URLS');
                await bot.sendMessage(chatId,
                    '*Bulk URL Shortener*\n\n' +
                    'Send multiple URLs separated by spaces:',
                    { parse_mode: 'Markdown' }
                );
                break;

            case '🎯 custom alias':
                await customFeature.handleCustomStart(bot, chatId);
                break;

            case 'ℹ️ help':
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
                if (userState === 'WAITING_FOR_URL') {
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
        console.error('Error in handleUpdate:', error);
        if (msg?.chat?.id) {
            await bot.sendMessage(msg.chat.id, 
                '❌ An error occurred. Please try again.',
                { parse_mode: 'Markdown' }
            );
        }
    }
};

// Add this helper function for URL shortening
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

// Initialize bot without polling since we're using webhooks
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

// Add security middleware
const validateWebhook = (req) => {
  const token = req.headers['x-telegram-bot-api-secret-token'];
  return token === process.env.WEBHOOK_SECRET;
};

// Rate limiting setup (in-memory for demo, use Redis in production)
const rateLimit = new Map();
const RATE_LIMIT = 30; // requests per minute
const RATE_WINDOW = 60 * 1000; // 1 minute

const checkRateLimit = (userId) => {
  const now = Date.now();
  const userRate = rateLimit.get(userId) || { count: 0, timestamp: now };
  
  if (now - userRate.timestamp > RATE_WINDOW) {
    userRate.count = 1;
    userRate.timestamp = now;
  } else if (userRate.count >= RATE_LIMIT) {
    return false;
  } else {
    userRate.count++;
  }
  
  rateLimit.set(userId, userRate);
  return true;
};

// URL validation helper
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    console.log('Webhook request received:', {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.url,
        headers: {
            'content-type': req.headers['content-type'],
            'x-telegram-bot-api-secret-token': req.headers['x-telegram-bot-api-secret-token']?.substring(0, 8) + '...'
        },
        body: JSON.stringify(req.body).substring(0, 200) + '...'
    });

    // Validate webhook secret
    const token = req.headers['x-telegram-bot-api-secret-token'];
    if (!token || token !== process.env.WEBHOOK_SECRET) {
        console.error('Invalid webhook secret');
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        const update = req.body;
        
        // Enhanced validation for update object
        if (!update || typeof update !== 'object') {
            console.error('Invalid update format:', update);
            return res.status(400).json({ error: 'Invalid update format' });
        }

        // Validate required fields
        const msg = update.message || update.callback_query?.message;
        if (!msg?.chat?.id || !msg?.from?.id) {
            console.error('Missing required fields:', {
                chatId: msg?.chat?.id,
                fromId: msg?.from?.id
            });
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Process the update
        await handleUpdate(update);
        
        return res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

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

async function performUrlLookup(alias) {
    try {
        const { data, error } = await supabase
            .from('urls')
            .select('*')
            .eq('alias', alias)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                // No results found
                return null;
            }
            throw error;
        }

        return data;
    } catch (error) {
        console.error('Supabase lookup error:', {
            error,
            alias,
            timestamp: new Date().toISOString()
        });
        return null;
    }
}