// default.js
const { supabase } = require('../supabaseClient');
const { nanoid } = require('nanoid');
const validator = require('validator');
const { formatTimeAgo } = require('./track');

// Add this at the top of your file
const DEBUG = true;

function debugLog(...args) {
    if (DEBUG) {
        console.log('[DEBUG]', ...args);
    }
}

// Update the domain constant
const DOMAIN = process.env.DOMAIN || 'midget.pro';
const PROTOCOL = 'https';  // Required for Telegram inline buttons

// Add proper error handling and state persistence
const userStates = new Map();

function setUserState(chatId, state) {
    try {
        userStates.set(chatId.toString(), state);
        debugLog(`State set for ${chatId}:`, state);
        return state;
    } catch (error) {
        console.error('Error setting user state:', error);
        return null;
    }
}

function getUserState(chatId) {
    try {
        const state = userStates.get(chatId.toString());
        debugLog(`State get for ${chatId}:`, state);
        return state;
    } catch (error) {
        console.error('Error getting user state:', error);
        return null;
    }
}

// Update validateAndFormatUrl with logging
function validateAndFormatUrl(url) {
    debugLog('Validating URL:', url);
    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
        formattedUrl = 'https://' + formattedUrl;
    }
    const isValid = validator.isURL(formattedUrl);
    debugLog('URL validation result:', { formattedUrl, isValid });
    return isValid ? formattedUrl : null;
}

// Ensure the Telegram user exists in tg_users
async function ensureUserExists(user) {
  try {
    if (!user || !user.id) {
      console.error('Invalid user data:', user);
      return false;
    }

    // Check if user already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('tg_users')
      .select('id')
      .eq('id', user.id)
      .single();

    // If there's an error that is *not* the "no rows" error, log it
    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Error checking user:', checkError);
      return false;
    }

    // If user doesn't exist, create them
    if (!existingUser) {
      const { error: insertError } = await supabase
        .from('tg_users')
        .insert({
          id: user.id,
          username: user.username || null,
          first_name: user.first_name || null,
          last_name: user.last_name || null
        });
      if (insertError) {
        console.error('Error inserting user:', insertError);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Critical error in user management:', error);
    return false;
  }
}

// Update handleDefaultShorten with better error handling
async function handleDefaultShorten(bot, msg) {
    const chatId = msg.chat.id;
    debugLog('Starting handleDefaultShorten for chatId:', chatId);
    
    try {
        const currentState = getUserState(chatId);
        debugLog('Current state:', currentState);

        // If this is the initial Quick Shorten button press
        if (!currentState) {
            setUserState(chatId, 'WAITING_FOR_URL');
            await bot.sendMessage(chatId,
                '📝 *Send me the URL to shorten:*',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // If we're waiting for the URL and received it
        if (currentState === 'WAITING_FOR_URL') {
            // Reset state first
            setUserState(chatId, null);

            if (!msg.text) {
                throw new Error('No URL provided');
            }

            const url = msg.text.trim();
            const formattedUrl = validateAndFormatUrl(url);
            
            if (!formattedUrl) {
                await bot.sendMessage(chatId,
                    '❌ Invalid URL. Please send a valid URL (e.g. `example.com`).',
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            // Ensure user exists in tg_users
            const userExists = await ensureUserExists(msg.from);
            if (!userExists) {
                console.error('Failed to ensure user exists for Telegram ID:', msg.from.id);
                return bot.sendMessage(chatId,
                    '❌ Unable to verify your user account. Please try again.',
                    { parse_mode: 'Markdown' }
                );
            }

            // Generate short alias
            const shortAlias = nanoid(6).toLowerCase();
            const shortUrl = `${PROTOCOL}://${DOMAIN}/${shortAlias}`;

            // First, insert into main_urls using the create_main_link function
            const { data: mainUrlData, error: mainUrlError } = await supabase
                .rpc('create_main_link', {
                    p_alias: shortAlias,
                    p_original_url: formattedUrl
                });

            if (mainUrlError) {
                console.error('Error creating main URL:', mainUrlError);
                throw new Error('Failed to create main URL');
            }

            // Then, insert into tg_shortened_urls
            const { data: tgUrlData, error: tgUrlError } = await supabase
                .from('tg_shortened_urls')
                .insert({
                    user_id: msg.from.id,
                    original_url: formattedUrl,
                    short_alias: shortAlias,
                    created_at: new Date().toISOString(),
                    clicks: 0,
                    last_clicked: null
                })
                .select()
                .single();

            if (tgUrlError) {
                console.error('Error creating Telegram URL:', tgUrlError);
                throw new Error('Failed to create Telegram URL');
            }

            // Construct success message
            const response = `
✅ *URL Shortened Successfully!*

🔗 *Original URL:*
\`${formattedUrl}\`

✨ *Short URL:*
\`${shortUrl}\`

📊 Use \`/track ${shortAlias}\` to view statistics`;

            // Send message with working inline buttons
            await bot.sendMessage(chatId, response, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '🔗 Copy URL',
                            callback_data: `copy_${shortAlias}`
                        },
                        {
                            text: '📊 Track',
                            callback_data: `track_${shortAlias}`
                        }
                    ]]
                }
            });

            console.log(`URL shortened: ${shortUrl} (user: ${msg.from.id})`);
        }

    } catch (error) {
        console.error('Error in handleDefaultShorten:', error);
        setUserState(chatId, null); // Reset state on error
        
        const errorMessage = error.message.includes('duplicate_alias') 
            ? '❌ This short URL is already taken. Please try again.'
            : '❌ An error occurred. Please try again.';
            
        await bot.sendMessage(chatId, errorMessage, { parse_mode: 'Markdown' })
            .catch(console.error);
    }
}

// Add validation helper
function isValidState(state) {
    return ['WAITING_FOR_URL', null].includes(state);
}

/**
 * Handle listing user's URLs
 */
async function handleListUrls(bot, msg) {
    try {
        // Query Supabase for user's URLs, ordered by creation date
        const { data: urls, error } = await supabase
            .from('tg_shortened_urls')
            .select('*')
            .eq('user_id', msg.from.id)
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) {
            console.error('Supabase query error:', error);
            throw error;
        }

        if (!urls || urls.length === 0) {
            await bot.sendMessage(msg.chat.id,
                '🔍 You haven\'t shortened any URLs yet.\nSend me any URL to shorten it!',
                { parse_mode: 'HTML' }
            );
            return;
        }

        // Helper function to escape HTML special characters
        const escapeHTML = (text) => {
            return text
                .replace(/&/g, '&amp;')
                .replace(/<//g, '&lt;')
                .replace(/>/g, '&gt;');
        };

        // Format URLs with click statistics
        const urlList = urls.map(url => 
            `• <code>${PROTOCOL}://${DOMAIN}/${url.short_alias}</code>\n` +
            `  ↳ ${escapeHTML(url.original_url)}\n` +
            `  📊 Clicks: ${url.clicks} | Last clicked: ${
                url.last_clicked ? formatTimeAgo(new Date(url.last_clicked)) : 'Never'
            }`
        ).join('\n\n');

        await bot.sendMessage(msg.chat.id,
            '📋 <b>Your Recent URLs:</b>\n\n' + urlList,
            { 
                parse_mode: 'HTML',
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
            '❌ Failed to fetch your URLs. Please try again later.',
            { parse_mode: 'HTML' }
        );
    }
}

// Update module exports
module.exports = {
    setUserState,
    getUserState,
    validateAndFormatUrl,
    ensureUserExists,
    handleDefaultShorten,
    handleListUrls,
    isValidState // Add this new helper
};
