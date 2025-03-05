const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const defaultFeature = require('../features/default');
const customFeature = require('../features/custom');
const bulkFeature = require('../features/bulk');
const trackFeature = require('../features/track');
const { formatTimeAgo } = require('../features/track');

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

module.exports = async (req, res) => {
    // Basic request validation
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Security check
    if (!validateWebhook(req)) {
        console.error('Invalid webhook secret token');
        return res.status(403).json({ error: 'Unauthorized' });
    }

    // Declare msg at the top level of the function
    let msg;
    try {
        const update = req.body;
        
        // Validate update format
        if (!update || (!update.message && !update.callback_query)) {
            return res.status(400).json({ error: 'Invalid update format' });
        }

        // Get message from update
        msg = update.message || update.callback_query?.message;
        if (!msg?.chat?.id) {
            return res.status(400).json({ error: 'Invalid message format' });
        }

        // Rate limiting
        const userId = msg.from?.id;
        if (userId && !checkRateLimit(userId)) {
            await bot.sendMessage(msg.chat.id, 
                '⚠️ Rate limit exceeded. Please try again later.',
                { parse_mode: 'Markdown' }
            );
            return res.status(429).json({ error: 'Rate limit exceeded' });
        }

        // Log incoming update
        console.log('Received update:', {
            updateId: update.update_id,
            userId: msg.from?.id,
            chatId: msg.chat.id,
            messageType: update.message ? 'message' : 'callback_query'
        });

        // Handle different types of updates
        if (update.callback_query) {
            await handleCallbackQuery(update.callback_query, bot);
        } else if (msg.photo) {
            await handlePhoto(msg, bot);
        } else if (msg.document) {
            await handleDocument(msg, bot);
        } else {
            // Handle text messages and commands
            await handleMessage(msg, bot);
        }

        return res.status(200).json({ ok: true });

    } catch (error) {
        console.error('Webhook error:', {
            error: error.message,
            stack: error.stack,
            userId: msg?.from?.id,  // Now msg will be safely accessible here
            chatId: msg?.chat?.id
        });

        // Don't expose error details in production
        return res.status(500).json({ 
            error: process.env.NODE_ENV === 'production' 
                ? 'Internal server error' 
                : error.message 
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