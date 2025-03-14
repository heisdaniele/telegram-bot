// features/track.js
const { supabase, serviceRole } = require('../supabaseClient');
const axios = require('axios');
const { IPinfoWrapper } = require('node-ipinfo');
// or if that doesn't work, try:
// const IPinfoWrapper = require('node-ipinfo').default;

const IGNORED_PATHS = new Set(['favicon.ico', 'favicon.png', 'robots.txt']);

// Add the isIgnoredPath function definition before it's used
function isIgnoredPath(path) {
    if (!path) return false;
    return IGNORED_PATHS.has(path.toLowerCase());
}

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

        // Get location asynchronously
        const location = await getLocationInfo(ipAddress);

        // Insert into main click_events table
        const { error: mainClickError } = await supabase
            .from('click_events')
            .insert({
                url_id: urlData.main_url_id, // Use the main_url_id
                ip_address: ipAddress,
                device: device,
                location: location
            });

        if (mainClickError) {
            console.error('Error recording main click:', mainClickError);
        }

        // Also insert into tg_click_events for backward compatibility
        const { error: tgClickError } = await supabase
            .from('tg_click_events')
            .insert({
                tg_url_id: urlData.id,
                ip_address: ipAddress,
                device_type: device,
                location: location,
                user_agent: userAgent,
                created_at: new Date().toISOString()
            });

        if (tgClickError) {
            console.error('Error recording TG click:', tgClickError);
        }

        return { 
            success: true, 
            location,
            device,
            clickData: {
                ip_address: ipAddress,
                device,
                location
            }
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
        // Early return for ignored paths
        if (isIgnoredPath(shortAlias)) {
            throw new Error('IGNORED_PATH');
        }

        // First try to find the URL in main_urls
        const { data: mainUrl, error: mainUrlError } = await supabase
            .from('main_urls')
            .select('id, short_url, created_at')
            .eq('short_url', shortAlias)
            .single();

        // Then get the associated telegram URL if it exists
        const { data: tgUrl, error: tgUrlError } = await supabase
            .from('tg_shortened_urls')
            .select(`
                id,
                user_id,
                short_alias,
                created_at,
                tg_users (
                    username,
                    first_name
                )
            `)
            .eq('short_alias', shortAlias)
            .single();

        if (!mainUrl && !tgUrl) {
            throw new Error('URL_NOT_FOUND');
        }

        // Get click events from both tables
        const [mainClicks, tgClicks] = await Promise.all([
            mainUrl ? supabase
                .from('click_events')
                .select('*')
                .eq('url_id', mainUrl.id)
                .order('created_at', { ascending: false }) : { data: [] },
            tgUrl ? supabase
                .from('tg_click_events')
                .select('*')
                .eq('tg_url_id', tgUrl.id)
                .order('created_at', { ascending: false }) : { data: [] }
        ]);

        // Combine and deduplicate clicks
        const allClicks = [
            ...(mainClicks.data || []),
            ...(tgClicks.data || [])
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // Calculate stats
        const uniqueIPs = new Set(allClicks.map(click => click.ip_address));
        const stats = {
            totalClicks: allClicks.length,
            uniqueClicks: uniqueIPs.size,
            browsers: {},
            devices: {},
            locations: {},
            lastClicked: allClicks[0]?.created_at || null,
            created: mainUrl?.created_at || tgUrl?.created_at,
            recentClicks: allClicks.slice(0, 5).map(click => ({
                location: click.location,
                device: click.device || click.device_type,
                time: formatTimeAgo(new Date(click.created_at))
            }))
        };

        // Calculate distributions
        allClicks.forEach(click => {
            const device = click.device || click.device_type;
            const location = click.location || 'Unknown';
            
            stats.devices[device] = (stats.devices[device] || 0) + 1;
            stats.locations[location] = (stats.locations[location] || 0) + 1;
        });

        return stats;

    } catch (error) {
        console.error('URL lookup failed:', {
            error: error.message || error,
            shortAlias,
            timestamp: new Date().toISOString()
        });

        if (error.message === 'IGNORED_PATH') {
            return { error: 'IGNORED_PATH' };
        }
        if (error.message === 'URL_NOT_FOUND') {
            return { error: 'URL_NOT_FOUND' };
        }
        
        return { error: 'INTERNAL_ERROR' };
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
        const result = await getUrlStats(shortAlias);

        if (result.error) {
            switch (result.error) {
                case 'IGNORED_PATH':
                    return bot.sendMessage(chatId,
                        '❌ This is a system path and cannot be tracked.',
                        { parse_mode: 'Markdown' }
                    );
                case 'URL_NOT_FOUND':
                    return bot.sendMessage(chatId,
                        '❌ URL not found. Please check the alias and try again.',
                        { parse_mode: 'Markdown' }
                    );
                default:
                    throw new Error('Internal tracking error');
            }
        }

        // Format browser and device statistics
        const browserStats = Object.entries(result.browsers)
            .map(([browser, count]) => 
                `   • ${browser}: ${count} (${Math.round(count/result.totalClicks*100)}%)`
            ).join('\n');

        const deviceStats = Object.entries(result.devices)
            .map(([device, count]) => 
                `   • ${device}: ${count} (${Math.round(count/result.totalClicks*100)}%)`
            ).join('\n');

        // Build statistics message
        const statsMessage = [
            `📊 *URL Statistics for ${shortAlias}*\n`,
            '🔢 *Clicks:*',
            `   • Total: ${result.totalClicks}`,
            `   • Unique: ${result.uniqueClicks}\n`,
            '🌐 *Browsers:*',
            browserStats,
            '\n📱 *Devices:*',
            deviceStats,
            `\n⏰ *Last Clicked:* ${result.lastClicked ? formatTimeAgo(result.lastClicked) : 'Never'}`,
            `🗓 *Created:* ${formatTimeAgo(result.created)}`
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
        await bot.sendMessage(chatId,
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
    formatTimeAgo,
    isIgnoredPath  // Add this to exports
};
