// features/track.js
const { supabase, serviceRole } = require('../supabaseClient');
const axios = require('axios');

async function trackClick(req, urlData) {
    try {
        // Extract IP and device information
        const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'] || '';
        const deviceType = /mobile/i.test(userAgent) ? 'Mobile' : 'Desktop';

        // Get user_id using service role client
        const { data: urlWithUser, error: urlError } = await serviceRole
            .from('tg_shortened_urls')
            .select('user_id')
            .eq('id', urlData.id)
            .single();

        if (urlError) {
            console.error('Error fetching user_id:', urlError);
            return;
        }

        // Get location from ipinfo.io
        let location = 'Unknown';
        try {
            const ipinfoToken = process.env.IPINFO_TOKEN;
            if (ipinfoToken && ipAddress) {
                let ip = ipAddress.split(',')[0].trim().split(':')[0];
                if (ip === '::1' || ip === '127.0.0.1') {
                    location = 'Localhost';
                } else {
                    const response = await axios.get(`https://ipinfo.io/${ip}/json?token=${ipinfoToken}`);
                    if (response?.data) {
                        const { city, region, country } = response.data;
                        location = [city, region, country].filter(Boolean).join(', ');
                    }
                }
            }
        } catch (error) {
            console.error('Location lookup error:', error.message);
        }

        // Record click event using service role client
        const { error: insertError } = await serviceRole
            .from('tg_click_events')
            .insert({
                url_id: urlData.id,
                user_id: urlWithUser.user_id,
                location,
                device_type: deviceType,
                ip_address: ipAddress,
                user_agent: userAgent,
                created_at: new Date().toISOString()
            });

        if (insertError) {
            console.error('Click event insert error:', insertError);
            return;
        }

        // Update click count using service role client
        const { error: updateError } = await serviceRole
            .from('tg_shortened_urls')
            .update({ 
                clicks: (urlData.clicks || 0) + 1,
                last_clicked: new Date().toISOString()
            })
            .eq('id', urlData.id);

        if (updateError) {
            console.error('Click count update error:', updateError);
        }

    } catch (error) {
        console.error('Click tracking error:', error);
    }
}

function formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    
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
            return `${interval} ${unit}${interval === 1 ? '' : 's'} ago`;
        }
    }
    
    return 'just now';
}

async function getUrlStats(shortAlias) {
    try {
        // Get URL data with user_id
        const { data: urlData, error: urlError } = await serviceRole  // Changed to serviceRole
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

        console.log('URL Data:', urlData); // Debug log

        // Get click events with serviceRole
        const { data: clickData, error: clickError } = await serviceRole  // Changed to serviceRole
            .from('tg_click_events')
            .select('*')
            .eq('url_id', urlData.id)
            .order('created_at', { ascending: false });

        if (clickError) {
            console.error('Click events lookup error:', clickError);
            throw clickError;
        }

        console.log('Click Data:', clickData); // Debug log

        // Calculate unique clicks by IP
        const uniqueIPs = new Set(clickData.map(click => click.ip_address));
        const uniqueBrowsers = new Set(clickData.map(click => click.user_agent));

        // Format stats with browser info
        const stats = {
            totalClicks: clickData.length,
            uniqueClicks: uniqueIPs.size,
            browsers: {},
            devices: {},
            locations: {},
            lastClicked: clickData[0]?.created_at,
            created: urlData.created_at,
            recentClicks: clickData.slice(0, 5).map(click => ({
                location: click.location,
                device: click.device_type,
                browser: getBrowserInfo(click.user_agent),
                time: formatTimeAgo(click.created_at)
            }))
        };

        // Calculate distributions
        clickData.forEach(click => {
            const browser = getBrowserInfo(click.user_agent);
            stats.browsers[browser] = (stats.browsers[browser] || 0) + 1;
            stats.devices[click.device_type] = (stats.devices[click.device_type] || 0) + 1;
            stats.locations[click.location] = (stats.locations[click.location] || 0) + 1;
        });

        console.log('Processed Stats:', stats); // Debug log

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

        // Format statistics message
        const statsMessage = `
📊 *URL Statistics for ${shortAlias}*

🔢 *Clicks:*
   • Total: ${stats.totalClicks}
   • Unique: ${stats.uniqueClicks}

🌐 *Browsers:*
${Object.entries(stats.browsers)
    .map(([browser, count]) => `   • ${browser}: ${count} (${Math.round(count/stats.totalClicks*100)}%)`)
    .join('\n')}

📱 *Devices:*
${Object.entries(stats.devices)
    .map(([device, count]) => `   • ${device}: ${count} (${Math.round(count/stats.totalClicks*100)}%)`)
    .join('\n')}

📍 *Top Locations:*
${Object.entries(stats.locations)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([location, count]) => `   • ${location}: ${count} (${Math.round(count/stats.totalClicks*100)}%)`)
    .join('\n')}

🕒 *Recent Clicks:*
${stats.recentClicks
    .map(click => `   • ${click.location} • ${click.browser} • ${click.device} • ${click.time}`)
    .join('\n')}

⏰ *Last Clicked:* ${stats.lastClicked ? formatTimeAgo(stats.lastClicked) : 'Never'}
🗓 *Created:* ${formatTimeAgo(stats.created)}`;

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

        // Get user's URLs
        const { data: urls, error } = await serviceRole
            .from('tg_shortened_urls')
            .select(`
                *,
                tg_click_events (count)
            `)
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

        // Format URLs list
        const urlsList = urls.map((url, index) => {
            const clicks = url.tg_click_events?.length || 0;
            return `${index + 1}. \`${process.env.DOMAIN}/${url.short_alias}\`\n` +
                   `   • Original: ${url.original_url.substring(0, 50)}${url.original_url.length > 50 ? '...' : ''}\n` +
                   `   • Clicks: ${clicks}\n` +
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

// Add to exports
module.exports = {
    trackClick,
    getUrlStats,
    handleTrackCommand,
    handleListUrls
};
