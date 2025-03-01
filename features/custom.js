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
        '🎯 *Custom URL Creation*\n\n' +
        'Let\'s create your custom short URL!\n\n' +
        '1️⃣ First, send me the URL you want to shorten\n' +
        '2️⃣ Then, I\'ll ask for your custom alias\n\n' +
        'Please send the URL now:',
        { parse_mode: 'Markdown' }
    );
}

// Update the handleCustomInput function in custom.js

async function handleCustomInput(bot, msg) {
    const chatId = msg.chat.id;
    const userState = getUserState(chatId);
    
    if (!userState || !userState.step) return;

    try {
        switch (userState.step) {
            case 'waiting_for_url':
                let formattedUrl = msg.text.trim();
                
                // Add protocol if missing
                if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
                    formattedUrl = 'https://' + formattedUrl;
                }

                // Validate URL
                if (!validator.isURL(formattedUrl)) {
                    await bot.sendMessage(chatId,
                        '❌ Invalid URL format.\n\n' +
                        'Please send a valid URL (e.g., `https://example.com`):',
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }

                // Move to alias step
                setUserState(chatId, { 
                    step: 'waiting_for_alias',
                    url: formattedUrl,
                    type: 'custom'
                });

                await bot.sendMessage(chatId,
                    '✅ URL received\n\n' +
                    'Enter your custom alias\\:\n' +
                    '• Use letters, numbers, \\- and \\_\n' +
                    'Example: `mylink123`',
                    { 
                        parse_mode: 'MarkdownV2',
                        disable_web_page_preview: true 
                    }
                );
                break;

            case 'waiting_for_alias':
                const customAlias = msg.text.trim().toLowerCase();
                
                // Validate alias format
                if (!customAlias || !/^[a-zA-Z0-9-_]+$/.test(customAlias)) {
                    await bot.sendMessage(chatId,
                        '❌ Invalid alias format.\n\n' +
                        'Please use only:\n' +
                        '• Letters (a-z, A-Z)\n' +
                        '• Numbers (0-9)\n' +
                        '• Hyphens (-) and underscores (_)',
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }

                // Check if alias is already taken
                const { data: existing } = await supabase
                    .from('tg_shortened_urls')
                    .select('id')
                    .eq('short_alias', customAlias)
                    .single();

                if (existing) {
                    await bot.sendMessage(chatId,
                        '❌ This alias is already taken!\n' +
                        'Please choose a different alias:',
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }

                // Create shortened URL with custom alias
                const { error } = await supabase
                    .from('tg_shortened_urls')
                    .insert({
                        user_id: msg.from.id,
                        original_url: userState.url,
                        short_alias: customAlias,
                        created_at: new Date().toISOString()
                    });

                if (error) throw error;

                // Clear state and send success message
                setUserState(chatId, null);
                await bot.sendMessage(chatId,
                    '✅ *URL shortened successfully!*\n\n' +
                    `🔗 Your custom URL: \`${process.env.DOMAIN}/${customAlias}\``,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                {
                                    text: '📊 View Stats',
                                    callback_data: `track_${customAlias}`
                                }
                            ]]
                        }
                    }
                );
                break;
        }
    } catch (error) {
        console.error('Custom URL error:', error);
        setUserState(chatId, null);
        await bot.sendMessage(chatId,
            '❌ An error occurred. Please try again.',
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