const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Validate environment variables
const requiredEnvVars = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    BOT_TOKEN: process.env.BOT_TOKEN
};

const missingVars = Object.entries(requiredEnvVars)
    .filter(([key, value]) => !value)
    .map(([key]) => key);

if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    }
);

const defaultFeature = require('../features/default');
const customFeature = require('../features/custom');
const bulkFeature = require('../features/bulk');
const trackFeature = require('../features/track');
const { formatTimeAgo } = require('../features/track');

async function handleUpdate(update) {
    try {
        const msg = update.message || update.callback_query?.message;
        if (!msg || !msg.chat) {
            console.error('Invalid message format:', update);
            return;
        }

        const chatId = msg.chat.id;
        const text = msg.text || '';

        // Debug logging
        console.log('Received message:', {
            chatId,
            text,
            type: msg.entities?.[0]?.type
        });

        // Handle /start command first
        if (text === '/start') {
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
            return;
        }

        // Handle keyboard commands and URL inputs
        switch(text) {
            case '🔗 Quick Shorten':
                defaultFeature.setUserState(chatId, 'WAITING_FOR_URL');
                await bot.sendMessage(chatId,
                    '📝 *Send me the URL to shorten:*',
                    { parse_mode: 'Markdown' }
                );
                break;

            case '📋 My URLs':
                await defaultFeature.handleListUrls(bot, msg);
                break;

            case '📚 Bulk Shorten':
                await bulkFeature.handleBulkStart(bot, msg);
                break;

            case '🎯 Custom Alias':
                await customFeature.handleCustomStart(bot, msg);
                break;

            case '📊 Track URL':
                await bot.sendMessage(chatId,
                    '*URL Tracking*\n\n' +
                    'Send the alias of the URL you want to track:\n' +
                    'Example: `/track your-alias`',
                    { parse_mode: 'Markdown' }
                );
                break;

            case 'ℹ️ Help':
                await bot.sendMessage(chatId,
                    '*Available Commands:*\n\n' +
                    '🔗 Quick Shorten - Simple URL shortening\n' +
                    '📚 Bulk Shorten - Multiple URLs at once\n' +
                    '🎯 Custom Alias - Choose your own alias\n' +
                    '📊 Track URL - View URL statistics\n' +
                    '📋 My URLs - List your shortened URLs',
                    { parse_mode: 'Markdown' }
                );
                break;

            default:
                // Handle URL input if we're waiting for it
                const userState = defaultFeature.getUserState(chatId);
                if (userState === 'WAITING_FOR_URL') {
                    await defaultFeature.handleDefaultShorten(bot, msg);
                } else if (text.startsWith('/track ')) {
                    await trackFeature.handleTrackCommand(bot, msg);
                }
                break;
        }

    } catch (error) {
        console.error('Error in handleUpdate:', error);
        if (msg?.chat?.id) {
            await bot.sendMessage(msg.chat.id,
                '❌ An error occurred. Please try again.',
                { parse_mode: 'Markdown' }
            ).catch(console.error);
        }
    }
}

// Update constants at the top of the file
const BOT_DOMAIN = process.env.DOMAIN || 'midget.pro';
const WEBHOOK_PATH = '/api/webhook';
const WEBHOOK_URL = `https://${BOT_DOMAIN}${WEBHOOK_PATH}`;

// Initialize bot properly
const bot = new TelegramBot(process.env.BOT_TOKEN, {
    polling: false,
    baseApiUrl: 'https://api.telegram.org',
    webhookReply: true // Enable direct reply to Telegram
});

// Ensure webhook is properly set on cold start
async function ensureWebhook() {
    try {
        const webhookInfo = await bot.getWebhookInfo();
        if (webhookInfo.url !== WEBHOOK_URL) {
            await bot.setWebHook(WEBHOOK_URL, {
                max_connections: 100,
                allowed_updates: ['message', 'callback_query'],
                secret_token: process.env.WEBHOOK_SECRET
            });
            console.log('✓ Webhook set:', WEBHOOK_URL);
        }
    } catch (error) {
        console.error('Webhook setup error:', error);
    }
}

// Call ensureWebhook when the handler is initialized
ensureWebhook().catch(console.error);

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
    console.log('Webhook request received:', {
        timestamp: new Date().toISOString(),
        path: req.url,
        headers: {
            'content-type': req.headers['content-type'],
            'x-telegram-bot-api-secret-token': req.headers['x-telegram-bot-api-secret-token']?.substring(0, 8) + '...'
        }
    });

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Validate webhook secret
    if (!validateWebhook(req)) {
        console.error('Invalid webhook secret');
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        const update = req.body;
        await handleUpdate(update);
        return res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(200).json({ ok: true }); // Always return 200 to Telegram
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
        // First check main_urls table
        const { data: mainUrl, error: mainError } = await supabase
            .from('main_urls')
            .select('*')
            .eq('short_url', alias)
            .single();

        if (mainError && mainError.code !== 'PGRST116') {
            throw mainError;
        }

        if (mainUrl) {
            return mainUrl;
        }

        // If not found in main_urls, check tg_shortened_urls
        const { data: tgUrl, error: tgError } = await supabase
            .from('tg_shortened_urls')
            .select('*')
            .eq('short_alias', alias)
            .single();

        if (tgError && tgError.code !== 'PGRST116') {
            throw tgError;
        }

        return tgUrl;
    } catch (error) {
        console.error('URL lookup error:', {
            error,
            alias,
            timestamp: new Date().toISOString()
        });
        return null;
    }
}