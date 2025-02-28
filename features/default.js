// default.js
const { supabase } = require('../supabaseClient');
const { nanoid } = require('nanoid');
const validator = require('validator');

// Update the domain constant
const DOMAIN = process.env.NODE_ENV === 'production' 
    ? 'telegram-bot-six-theta.vercel.app'
    : 'localhost:3000';
const PROTOCOL = 'https';  // Required for Telegram inline buttons

// User state management (optional)
const userStates = new Map();
function setUserState(chatId, state) {
  userStates.set(chatId.toString(), state);
  console.log(`State set for ${chatId}: ${state}`);
}
function getUserState(chatId) {
  return userStates.get(chatId.toString());
}

// Validate and format URL
function validateAndFormatUrl(url) {
  let formattedUrl = url.trim();
  if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
    formattedUrl = 'https://' + formattedUrl;
  }
  return validator.isURL(formattedUrl) ? formattedUrl : null;
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

// Handle default “shorten” command in Telegram
async function handleDefaultShorten(bot, msg) {
  const chatId = msg.chat.id;

  try {
    // 1. Extract the URL from the message text
    let url = '';
    const parts = msg.text.split(' ');

    // If user typed `/shorten something`
    if (parts[0] === '/shorten') {
      if (parts.length < 2) {
        return bot.sendMessage(chatId,
          '❌ *Usage:* `/shorten <url>`\nExample: `/shorten example.com`',
          { parse_mode: 'Markdown' }
        );
      }
      url = parts.slice(1).join(' '); // everything after /shorten
    } else {
      // If user just typed the URL without /shorten
      url = msg.text;
    }

    // 2. Validate + format URL
    const formattedUrl = validateAndFormatUrl(url);
    if (!formattedUrl) {
      return bot.sendMessage(chatId,
        '❌ Invalid URL. Please send a valid URL (e.g. `example.com`).',
        { parse_mode: 'Markdown' }
      );
    }

    // 3. Ensure user exists in tg_users
    const userExists = await ensureUserExists(msg.from);
    if (!userExists) {
      console.error('Failed to ensure user exists for Telegram ID:', msg.from.id);
      return bot.sendMessage(chatId,
        '❌ Unable to verify your user account. Please try again.',
        { parse_mode: 'Markdown' }
      );
    }

    // 4. Generate short alias with proper URL formatting
    const shortAlias = nanoid(6).toLowerCase();
    const shortUrl = `${PROTOCOL}://${DOMAIN}/${shortAlias}`;
    const displayUrl = `${DOMAIN}/${shortAlias}`;  // For display purposes

    // 5. Insert into database with new schema
    const { data, error: insertError } = await supabase
      .from('tg_shortened_urls')
      .insert({
        user_id: msg.from.id,
        original_url: formattedUrl,
        short_alias: shortAlias,
        created_at: new Date().toISOString(),
        clicks: 0, // Initialize clicks counter
        last_clicked: null // Initialize last_clicked timestamp
      })
      .select()
      .single();

    if (insertError) {
      console.error('Database insertion error:', insertError);
      throw new Error('Failed to save URL');
    }

    // 6. Construct success message
    const response = `
✅ *URL Shortened Successfully!*

🔗 *Original URL:*
\`${formattedUrl}\`

✨ *Short URL:*
\`${displayUrl}\`

📊 Use \`/track ${shortAlias}\` to view statistics`;

    // 7. Send message with working inline buttons
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

    console.log(`URL shortened: ${displayUrl} (user: ${msg.from.id})`);

  } catch (error) {
    console.error('Error in handleDefaultShorten:', error);
    await bot.sendMessage(chatId,
      '❌ Failed to shorten URL. Please try again.',
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handle listing user's URLs
 */
async function handleListUrls(bot, msg) {
    try {
        const chatId = msg.chat.id;

        // Get user's URLs with updated schema
        const { data: urls, error } = await supabase
            .from('tg_shortened_urls')
            .select(`
                *,
                tg_click_events (
                    count
                )
            `)
            .eq('user_id', chatId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching URLs:', error);
            throw error;
        }

        if (!urls || urls.length === 0) {
            await bot.sendMessage(chatId,
                '❌ You haven\'t created any short URLs yet.\n' +
                'Use the *Quick Shorten* button to create one!',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Format URLs list with inline buttons and updated click stats
        const message = '*Your Shortened URLs:*\n\n' +
            urls.map((url, index) => {
                const displayUrl = `${PROTOCOL}://${DOMAIN}/${url.short_alias}`;
                return `${index + 1}. \`${displayUrl}\`\n` +
                    `   📊 Clicks: ${url.clicks || 0}\n` +
                    `   ⏰ Last Click: ${url.last_clicked ? formatTimeAgo(url.last_clicked) : 'Never'}\n` +
                    `   🔗 Original: ${url.original_url.substring(0, 50)}${url.original_url.length > 50 ? '...' : ''}\n`;
            }).join('\n');

        // Create inline keyboard with track buttons
        const keyboard = urls.map(url => ([{
            text: `📊 Track ${url.short_alias}`,
            callback_data: `track_${url.short_alias}`
        }]));

        // Add refresh button at the bottom
        keyboard.push([{
            text: '🔄 Refresh List',
            callback_data: 'refresh_urls'
        }]);

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: keyboard
            }
        });

    } catch (error) {
        console.error('Error handling list URLs:', error);
        await bot.sendMessage(msg.chat.id,
            '❌ Failed to fetch your URLs. Please try again.',
            { parse_mode: 'Markdown' }
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
    handleListUrls  // Add this to exports
};
