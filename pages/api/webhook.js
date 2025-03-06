const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const defaultFeature = require('../../features/default');
const customFeature = require('../../features/custom');
const bulkFeature = require('../../features/bulk');
const trackFeature = require('../../features/track');
const { formatTimeAgo } = require('../../features/track');

const BOT_TOKEN = process.env.BOT_TOKEN;
const DOMAIN = process.env.DOMAIN || 'midget.pro';
const WEBHOOK_PATH = '/bot';  // Changed from /api/webhook to match your working URL
const WEBHOOK_URL = `https://${DOMAIN}${WEBHOOK_PATH}`;

// Initialize bot with proper configuration
const bot = new TelegramBot(BOT_TOKEN, {
    polling: false,
    webhookReply: true
});

// Add webhook setup function
async function setupWebhook() {
    try {
        const webhookInfo = await bot.getWebhookInfo();
        console.log('Current webhook info:', webhookInfo);

        // Only update if webhook URL doesn't match or settings need updating
        if (webhookInfo.url !== WEBHOOK_URL || 
            webhookInfo.max_connections !== 100 ||
            !webhookInfo.allowed_updates?.includes('message')) {
            
            await bot.deleteWebhook();
            console.log('✓ Existing webhook deleted');

            await bot.setWebHook(WEBHOOK_URL, {
                max_connections: 100,
                allowed_updates: ['message', 'callback_query'],
                secret_token: process.env.WEBHOOK_SECRET,
                drop_pending_updates: true
            });
            console.log('✓ New webhook set:', {
                url: WEBHOOK_URL,
                maxConnections: 100,
                allowedUpdates: ['message', 'callback_query']
            });

            // Verify the new webhook
            const newWebhookInfo = await bot.getWebhookInfo();
            console.log('✓ Updated webhook info:', newWebhookInfo);
        } else {
            console.log('✓ Webhook already properly configured');
        }
    } catch (error) {
        console.error('Webhook setup error:', error);
        throw error;
    }
}

// Call setupWebhook on cold start
setupWebhook().catch(console.error);

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

const handleUpdate = async (update) => {
    try {
        const msg = update.message || update.callback_query?.message;
        const chatId = msg.chat.id;
        
        if (update.callback_query) {
            const data = update.callback_query.data;
            if (data.startsWith('track_')) {
                await trackFeature.handleTrackCommand(bot, msg, data.split('_')[1]);
            } else if (data === 'refresh_urls') {
                await defaultFeature.handleListUrls(bot, msg);
            }
            await bot.answerCallbackQuery(update.callback_query.id);
        } else if (msg.text) {
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
                case '📋 My URLs':
                    await defaultFeature.handleListUrls(bot, msg);
                    break;
                case '🔗 Quick Shorten':
                    await bot.sendMessage(msg.chat.id,
                        'Send me any URL to shorten it!',
                        { parse_mode: 'Markdown' }
                    );
                    defaultFeature.setUserState(msg.chat.id, 'WAITING_FOR_URL');
                    break;
                default:
                    if (defaultFeature.getUserState(msg.chat.id) === 'WAITING_FOR_URL') {
                        await defaultFeature.handleDefaultShorten(bot, msg);
                        defaultFeature.setUserState(msg.chat.id, null);
                    }
                    break;
            }
        }
    } catch (error) {
        console.error('Error handling update:', error);
        throw error;
    }
};

export default async function handler(req, res) {
    console.log('Webhook received:', {
        method: req.method,
        path: req.url,
        timestamp: new Date().toISOString()
    });

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Validate webhook secret
    const token = req.headers['x-telegram-bot-api-secret-token'];
    if (!token || token !== process.env.WEBHOOK_SECRET) {
        console.error('Invalid webhook secret');
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        const update = req.body;
        
        if (!update || typeof update !== 'object') {
            console.error('Invalid update format:', update);
            return res.status(400).json({ error: 'Invalid update format' });
        }

        await handleUpdate(update);
        return res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Webhook error:', {
            message: error.message,
            stack: error.stack
        });
        // Always return 200 to Telegram even on errors
        return res.status(200).json({ ok: true });
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