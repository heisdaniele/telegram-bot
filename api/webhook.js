const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const defaultFeature = require('../features/default');
const customFeature = require('../features/custom');
const bulkFeature = require('../features/bulk');
const trackFeature = require('../features/track');
const { formatTimeAgo } = require('../features/track');

const handleUpdate = async (update) => {
    try {
        const msg = update.message || update.callback_query?.message;
        const chatId = msg.chat.id;
        
        // Add error handling for favicon.png and other common bot probes
        if (msg.text && (
            msg.text.includes('favicon.png') || 
            msg.text.includes('robots.txt') ||
            msg.text.includes('.well-known')
        )) {
            await bot.sendMessage(chatId, '⚠️ Invalid URL format. Please send a valid URL to shorten.');
            return;
        }

        if (update.callback_query) {
            await bot.answerCallbackQuery(update.callback_query.id);
            // Handle callback query
            // ...existing callback handling code...
        } else if (msg.text) {
            // Handle text messages
            try {
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
                    // ... other message handling ...
                }
            } catch (error) {
                console.error('Error in message handling:', error);
                await bot.sendMessage(chatId, '⚠️ An error occurred while processing your request. Please try again.');
            }
        }
    } catch (error) {
        console.error('Error handling update:', error);
        // Send a generic error message to user
        if (msg?.chat?.id) {
            await bot.sendMessage(msg.chat.id, '⚠️ Sorry, something went wrong. Please try again later.');
        }
        throw error;
    }
};

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