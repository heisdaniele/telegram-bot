// features/track.js
const { supabase, serviceRole } = require('../supabaseClient');
const axios = require('axios');
const { IPinfoWrapper } = require('node-ipinfo');
// or if that doesn't work, try:
// const IPinfoWrapper = require('node-ipinfo').default;

const ipinfo = new IPinfoWrapper(process.env.IPINFO_TOKEN);

// Cache for IP locations to reduce API calls
const locationCache = new Map();

async function getLocationInfo(ip) {
    // Check cache first
    if (locationCache.has(ip)) {
        console.log('Location found in cache:', ip);
        return locationCache.get(ip);
    }

    const IPINFO_TOKEN = process.env.IPINFO_TOKEN;
    
    try {
        const cleanIp = ip.trim().split(':')[0];
        
        if (cleanIp === '::1' || cleanIp === '127.0.0.1') {
            return 'Local Development';
        }

        const ipinfoUrl = `https://ipinfo.io/${cleanIp}/json`;
        const ipinfoResponse = await axios.get(ipinfoUrl, {
            headers: {
                'Authorization': `Bearer ${IPINFO_TOKEN}`,
                'Accept': 'application/json'
            },
            timeout: 3000 // Reduced timeout
        });

        if (ipinfoResponse.data) {
            const { city, region, country } = ipinfoResponse.data;
            const location = [city, region, country]
                .filter(Boolean)
                .join(', ') || 'Unknown';
            
            // Cache the result
            locationCache.set(ip, location);
            return location;
        }
    } catch (error) {
        console.error('IPInfo Error:', {
            ip,
            error: error.message,
            response: error.response?.data
        });
    }
    
    return 'Unknown';
}

async function trackClick(req, urlData) {
    try {
        const ipAddress = (
            req.headers['x-forwarded-for']?.split(',')[0] || 
            req.headers['x-real-ip'] || 
            req.connection.remoteAddress
        )?.replace('::ffff:', '') || 'Unknown';

        const userAgent = req.headers['user-agent'];
        const device = getDeviceType(userAgent);
        const browser = getBrowserInfo(userAgent);

        // Get location asynchronously
        const locationPromise = getLocationInfo(ipAddress);

        // Wait for location info with timeout
        const location = await Promise.race([
            locationPromise,
            new Promise(resolve => setTimeout(() => resolve('Unknown'), 3000))
        ]);

        // Insert click event - now includes user_id
        const clickData = {
            url_id: urlData.id,
            user_id: urlData.user_id, // Add user_id from urlData
            ip_address: ipAddress,
            user_agent: userAgent,
            device_type: device, // Changed from 'device' to 'device_type' to match schema
            location: location,
            created_at: new Date().toISOString()
        };

        // Insert into tg_click_events
        // No need to manually update clicks/last_clicked as trigger handles it
        const { error: clickError } = await serviceRole
            .from('tg_click_events')
            .insert(clickData);

        if (clickError) {
            throw clickError;
        }

        return { 
            success: true, 
            location,
            device,
            browser,
            clickData 
        };

    } catch (error) {
        console.error('Track click error:', error);
        return { success: false, error: error.message };
    }
}

// Helper function to determine device type
function getDeviceType(userAgent) {
    if (!userAgent) return 'Unknown';
    
    userAgent = userAgent.toLowerCase();
    
    if (userAgent.match(/mobile|android|iphone|ipad|ipod|webos|blackberry/i)) {
        return 'Mobile';
    } else if (userAgent.match(/tablet|ipad/i)) {
        return 'Tablet';
    } else if (userAgent.match(/bot|crawler|spider|crawling/i)) {
        return 'Bot';
    } else {
        return 'Desktop';
    }
}

function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    const intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60
    };

    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        if (interval >= 1) {
            return interval === 1 ? `1 ${unit} ago` : `${interval} ${unit}s ago`;
        }
    }

    return 'Just now';
}

async function getUrlStats(shortAlias) {
    try {
        // Get URL data
        const { data: urlData, error: urlError } = await serviceRole
            .from('tg_shortened_urls')
            .select(`
                *,
                tg_users (
                    username,
                    first_name
                )
            `)
            .eq('short_alias', shortAlias)
            .single();

        if (urlError) {
            console.error('URL lookup error:', urlError);
            throw urlError;
        }

        // Get click events
        const { data: clickEvents, error: clickError } = await serviceRole
            .from('tg_click_events')
            .select('*')
            .eq('url_id', urlData.id)
            .order('created_at', { ascending: false });

        if (clickError) {
            console.error('Click events lookup error:', clickError);
            throw clickError;
        }

        // Calculate stats
        const uniqueIPs = new Set(clickEvents.map(click => click.ip_address));
        
        const stats = {
            totalClicks: urlData.clicks, // Use the clicks from shortened_urls
            uniqueClicks: uniqueIPs.size,
            browsers: {},
            devices: {},
            locations: {},
            lastClicked: urlData.last_clicked, // Use last_clicked from shortened_urls
            created: urlData.created_at,
            recentClicks: clickEvents.slice(0, 5).map(click => ({
                location: click.location,
                device: click.device_type,
                browser: getBrowserInfo(click.user_agent),
                time: formatTimeAgo(click.created_at)
            }))
        };

        // Calculate distributions
        clickEvents.forEach(click => {
            const browser = getBrowserInfo(click.user_agent);
            stats.browsers[browser] = (stats.browsers[browser] || 0) + 1;
            stats.devices[click.device_type] = (stats.devices[click.device_type] || 0) + 1;
            stats.locations[click.location] = (stats.locations[click.location] || 0) + 1;
        });

        return stats;

    } catch (error) {
        console.error('Error getting URL stats:', error);
        throw error;
    }
}

// Helper function to get browser info
function getBrowserInfo(userAgent) {
    if (!userAgent) return 'Unknown';
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Safari')) return 'Safari';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Edge')) return 'Edge';
    if (userAgent.includes('Opera')) return 'Opera';
    return 'Other';
}

async function handleTrackCommand(bot, msg) {
    const chatId = msg.chat.id;
    const parts = msg.text.split(' ');

    if (parts.length !== 2) {
        return bot.sendMessage(chatId,
            '❌ *Usage:* `/track <short-alias>`\n' +
            'Example: `/track my-link`',
            { parse_mode: 'Markdown' }
        );
    }

    try {
        const shortAlias = parts[1];
        const stats = await getUrlStats(shortAlias);

        // Format browser and device statistics
        const browserStats = Object.entries(stats.browsers)
            .map(([browser, count]) => 
                `   • ${browser}: ${count} (${Math.round(count/stats.totalClicks*100)}%)`
            ).join('\n');

        const deviceStats = Object.entries(stats.devices)
            .map(([device, count]) => 
                `   • ${device}: ${count} (${Math.round(count/stats.totalClicks*100)}%)`
            ).join('\n');

        // Build statistics message
        const statsMessage = [
            `📊 *URL Statistics for ${shortAlias}*\n`,
            '🔢 *Clicks:*',
            `   • Total: ${stats.totalClicks}`,
            `   • Unique: ${stats.uniqueClicks}\n`,
            '🌐 *Browsers:*',
            browserStats,
            '\n📱 *Devices:*',
            deviceStats,
            `\n⏰ *Last Clicked:* ${stats.lastClicked ? formatTimeAgo(stats.lastClicked) : 'Never'}`,
            `🗓 *Created:* ${formatTimeAgo(stats.created)}`
        ].join('\n');

        await bot.sendMessage(msg.chat.id, statsMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: '🔄 Refresh Stats',
                        callback_data: `track_${shortAlias}`
                    }
                ]]
            }
        });

    } catch (error) {
        console.error('Track command error:', error);
        await bot.sendMessage(msg.chat.id,
            '❌ Failed to get URL statistics. Please try again.',
            { parse_mode: 'Markdown' }
        );
    }
}

async function handleListUrls(bot, msg) {
    try {
        const chatId = msg.chat.id;

        // Get user's URLs with click counts
        const { data: urls, error } = await serviceRole
            .from('tg_shortened_urls')
            .select('*')
            .eq('user_id', msg.from.id)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching URLs:', error);
            throw error;
        }

        if (!urls || urls.length === 0) {
            await bot.sendMessage(chatId,
                '❌ *No URLs found*\n\n' +
                'You haven\'t shortened any URLs yet.',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Format URLs list - now using clicks from shortened_urls table
        const urlsList = urls.map((url, index) => {
            return `${index + 1}. \`${process.env.DOMAIN}/${url.short_alias}\`\n` +
                   `   • Original: ${url.original_url.substring(0, 50)}${url.original_url.length > 50 ? '...' : ''}\n` +
                   `   • Clicks: ${url.clicks}\n` +
                   `   • Created: ${formatTimeAgo(url.created_at)}`;
        }).join('\n\n');

        await bot.sendMessage(chatId,
            `📋 *Your Shortened URLs*\n\n${urlsList}`,
            {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '🔄 Refresh List',
                            callback_data: 'refresh_urls'
                        }
                    ]]
                }
            }
        );

    } catch (error) {
        console.error('List URLs error:', error);
        await bot.sendMessage(msg.chat.id,
            '❌ Failed to fetch your URLs. Please try again.',
            { parse_mode: 'Markdown' }
        );
    }
}

// Clear location cache periodically (every hour)
setInterval(() => {
    console.log('Clearing location cache...');
    locationCache.clear();
}, 3600000);

// Add to exports
module.exports = {
    trackClick,
    getUrlStats,
    handleTrackCommand,
    handleListUrls,
    formatTimeAgo  // Add this line
};
