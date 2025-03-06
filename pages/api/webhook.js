const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const defaultFeature = require('../../features/default');
const customFeature = require('../../features/custom');
const bulkFeature = require('../../features/bulk');
const trackFeature = require('../../features/track');
const { formatTimeAgo } = require('../../features/track');

// Update the domain constant at the top of the file
const DOMAIN = process.env.NODE_ENV === 'production' 
    ? 'midget.pro'  // Changed from telegram-bot-six-theta.vercel.app
    : 'localhost:3000';

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
    console.log('Webhook request received:', {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.url,
        headers: {
            'content-type': req.headers['content-type'],
            'x-telegram-bot-api-secret-token': req.headers['x-telegram-bot-api-secret-token']?.substring(0, 8) + '...'
        },
        body: JSON.stringify(req.body).substring(0, 200)
    });

    if (req.method !== 'POST') {
        console.error('Invalid method:', req.method);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const update = req.body;
        
        if (!update || typeof update !== 'object') {
            console.error('Invalid update format:', update);
            return res.status(400).json({ error: 'Invalid update format' });
        }

        const msg = update.message || update.callback_query?.message;
        if (!msg?.chat?.id) {
            console.error('Invalid message format:', msg);
            return res.status(400).json({ error: 'Invalid message format' });
        }

        await handleUpdate(update);
        return res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Webhook error:', {
            message: error.message,
            stack: error.stack
        });
        return res.status(500).json({ 
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
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