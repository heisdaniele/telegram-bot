const { supabase } = require('../supabaseClient');
const validator = require('validator');

// Constants
const DOMAIN = process.env.NODE_ENV === 'production' 
    ? 'telegram-bot-six-theta.vercel.app'
    : 'localhost:3000';
const PROTOCOL = 'https';  // Always use HTTPS for production

// User state management
const userStates = new Map();

function setUserState(chatId, state) {
    userStates.set(chatId, state);
}

function getUserState(chatId) {
    return userStates.get(chatId);
}

async function handleCustomStart(bot, chatId) {
    setUserState(chatId, { step: 'waiting_for_url' });
    await bot.sendMessage(chatId,
        '🎯 *Custom URL Shortener*\n\n' +
        'Please send the URL you want to shorten:',
        { parse_mode: 'Markdown' }
    );
}

async function handleCustomInput(bot, msg) {
    const chatId = msg.chat.id;
    const userState = getUserState(chatId);
    
    if (!userState) return;

    try {
        switch (userState.step) {
            case 'waiting_for_url':
                let formattedUrl = msg.text.trim();
                if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
                    formattedUrl = 'https://' + formattedUrl;
                }

                if (!validator.isURL(formattedUrl)) {
                    return bot.sendMessage(chatId,
                        '❌ Invalid URL format. Please send a valid URL:',
                        { parse_mode: 'Markdown' }
                    );
                }

                setUserState(chatId, { 
                    step: 'waiting_for_alias',
                    url: formattedUrl 
                });

                await bot.sendMessage(chatId,
                    '✅ URL received!\n\n' +
                    'Now, please send your desired custom alias.\n' +
                    'It should only contain letters, numbers, hyphens, and underscores.',
                    { parse_mode: 'Markdown' }
                );
                break;

            case 'waiting_for_alias':
                const customAlias = msg.text.trim();
                
                if (!/^[a-zA-Z0-9-_]+$/.test(customAlias)) {
                    return bot.sendMessage(chatId,
                        '❌ Invalid alias format.\n' +
                        'Please use only letters, numbers, hyphens, and underscores:',
                        { parse_mode: 'Markdown' }
                    );
                }

                // Check if alias is available
                const { data: existing } = await supabase
                    .from('tg_shortened_urls')
                    .select('id')
                    .eq('short_alias', customAlias)
                    .single();

                if (existing) {
                    return bot.sendMessage(chatId,
                        '❌ This custom alias is already taken!\n' +
                        'Please choose a different alias:',
                        { parse_mode: 'Markdown' }
                    );
                }

                // Create the shortened URL with new schema fields
                const { error } = await supabase
                    .from('tg_shortened_urls')
                    .insert({
                        user_id: msg.from.id,
                        original_url: userState.url,
                        short_alias: customAlias,
                        created_at: new Date().toISOString(),
                        clicks: 0, // Initialize clicks counter
                        last_clicked: null // Initialize last_clicked timestamp
                    });

                if (error) {
                    throw new Error('Failed to save custom URL');
                }

                // Clear user state
                userStates.delete(chatId);

                // Send success message
                const displayUrl = `${DOMAIN}/${customAlias}`;
                const response = `
✅ *Custom URL Created Successfully!*

🔗 *Original URL:*
\`${userState.url}\`

✨ *Custom Short URL:*
\`${displayUrl}\`

📊 Use \`/track ${customAlias}\` to view statistics`;

                await bot.sendMessage(chatId, response, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '🔗 Copy URL',
                                callback_data: `copy_${customAlias}`
                            },
                            {
                                text: '📊 Track',
                                callback_data: `track_${customAlias}`
                            }
                        ]]
                    }
                });
                break;
        }
    } catch (error) {
        console.error('Error in handleCustomInput:', error);
        userStates.delete(chatId); // Clear state on error
        await bot.sendMessage(chatId,
            '❌ An error occurred. Please try again with /custom',
            { parse_mode: 'Markdown' }
        );
    }
}

async function handleCustomAlias(bot, msg) {
    const chatId = msg.chat.id;
    
    if (msg.text === '/custom') {
        return handleCustomStart(bot, chatId);
    }

    // If user is in the custom URL flow, handle their input
    if (userStates.has(chatId)) {
        return handleCustomInput(bot, msg);
    }

    // Otherwise, handle as command with arguments
    const parts = msg.text.split(' ');

    // Validate command format
    if (parts.length !== 3) {
        return bot.sendMessage(chatId, 
            '❌ *Usage:* `/custom <url> <custom-alias>`\n' +
            'Example: `/custom example.com my-link`',
            { parse_mode: 'Markdown' }
        );
    }

    const [_, url, customAlias] = parts;

    // Validate and format URL
    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
        formattedUrl = 'https://' + formattedUrl;
    }

    if (!validator.isURL(formattedUrl)) {
        return bot.sendMessage(chatId,
            '❌ Please provide a valid URL',
            { parse_mode: 'Markdown' }
        );
    }

    // Validate custom alias
    if (!/^[a-zA-Z0-9-_]+$/.test(customAlias)) {
        return bot.sendMessage(chatId,
            '❌ Custom alias can only contain letters, numbers, hyphens, and underscores',
            { parse_mode: 'Markdown' }
        );
    }

    // Check if alias is available
    const { data: existing } = await supabase
        .from('tg_shortened_urls')
        .select('id')
        .eq('short_alias', customAlias)
        .single();

    if (existing) {
        return bot.sendMessage(chatId,
            '❌ This custom alias is already taken!',
            { parse_mode: 'Markdown' }
        );
    }

    // Insert into database
    const { data, error } = await supabase
        .from('tg_shortened_urls')
        .insert({
            user_id: msg.from.id,
            original_url: formattedUrl,
            short_alias: customAlias,
            created_at: new Date().toISOString(),
            clicks: 0, // Initialize clicks counter
            last_clicked: null // Initialize last_clicked timestamp
        })
        .select()
        .single();

    if (error) {
        console.error('Database error:', error);
        throw new Error('Failed to save custom URL');
    }

    // Construct success message
    const shortUrl = `${PROTOCOL}://${DOMAIN}/${customAlias}`;
    const displayUrl = `${DOMAIN}/${customAlias}`;

    const response = `
✅ *Custom URL Created Successfully!*

🔗 *Original URL:*
\`${formattedUrl}\`

✨ *Custom Short URL:*
\`${displayUrl}\`

📊 Use \`/track ${customAlias}\` to view statistics`;

    // Send success message with inline buttons
    await bot.sendMessage(chatId, response, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: {
            inline_keyboard: [[
                {
                    text: '🔗 Copy URL',
                    callback_data: `copy_${customAlias}`
                },
                {
                    text: '📊 Track',
                    callback_data: `track_${customAlias}`
                }
            ]]
        }
    });

    console.log(`Custom URL created: ${displayUrl} (user: ${msg.from.id})`);
}

module.exports = { 
    handleCustomStart,
    handleCustomAlias,
    handleCustomInput,
    setUserState,
    getUserState
};