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
    console.log('Webhook request received:', {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.url,
        secret: req.headers['x-telegram-bot-api-secret-token']?.substring(0, 8) + '...',
    });

    if (req.method !== 'POST') {
        console.log('Invalid method:', req.method);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Validate webhook secret
    const token = req.headers['x-telegram-bot-api-secret-token'];
    if (token !== process.env.WEBHOOK_SECRET) {
        console.error('Invalid webhook secret');
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        const update = req.body;
        console.log('Update received:', {
            updateId: update.update_id,
            messageId: update.message?.message_id,
            chatId: update.message?.chat?.id,
            text: update.message?.text
        });

        // Process the update
        const msg = update.message || update.callback_query?.message;
        if (!msg?.chat?.id) {
            console.error('Invalid message format');
            return res.status(400).json({ error: 'Invalid message format' });
        }

        // Handle the message using your bot instance
        await handleUpdate(update);
        
        return res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ error: 'Internal server error' });
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