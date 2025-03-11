const { supabase } = require('../supabaseClient');
const validator = require('validator');

// Constants
const DOMAIN = process.env.NODE_ENV === 'production' 
    ? 'telegram-bot-six-theta.vercel.app'
    : 'localhost:3000';
const PROTOCOL = 'https';  // Always use HTTPS for production

// User state management
const userStates = new Map();
const tempUrls = new Map();

function setUserState(chatId, state) {
    userStates.set(chatId.toString(), state);
}

function getUserState(chatId) {
    return userStates.get(chatId.toString());
}

function setTempUrl(chatId, url) {
    tempUrls.set(chatId.toString(), url);
}

function getTempUrl(chatId) {
    return tempUrls.get(chatId.toString());
}

async function handleCustomStart(bot, msg) {
    if (!msg || !msg.chat) {
        console.error('Invalid message format:', msg);
        return;
    }
    
    const chatId = msg.chat.id;
    setUserState(chatId, 'WAITING_FOR_CUSTOM_URL');
    
    await bot.sendMessage(chatId,
        '🎯 *Custom URL Shortener*\n\n' +
        'Please send the URL you want to shorten:',
        { parse_mode: 'Markdown' }
    );
}

// Update the handleCustomInput function to properly handle both URL and alias steps
async function handleCustomInput(bot, msg) {
    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const state = getUserState(chatId);

    if (state === 'WAITING_FOR_CUSTOM_URL') {
        let formattedUrl = text;
        if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
            formattedUrl = 'https://' + formattedUrl;
        }

        if (!validator.isURL(formattedUrl)) {
            await bot.sendMessage(chatId,
                '❌ Please send a valid URL.\nExample: `https://example.com`',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        setTempUrl(chatId, formattedUrl);
        setUserState(chatId, 'WAITING_FOR_ALIAS');
        
        await bot.sendMessage(chatId,
            '✨ Great! Now send me your desired custom alias:\n' +
            'Example: `mylink`\n\n' +
            '• 3-20 characters\n' +
            '• Letters, numbers, and hyphens only\n' +
            '• No spaces allowed',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    if (state === 'WAITING_FOR_ALIAS') {
        const alias = text;
        
        if (!/^[a-zA-Z0-9-]{3,20}$/.test(alias)) {
            await bot.sendMessage(chatId,
                '❌ Invalid alias format.\n\n' +
                '• 3-20 characters\n' +
                '• Letters, numbers, and hyphens only\n' +
                '• No spaces allowed\n\n' +
                'Please try again:',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        try {
            const url = getTempUrl(chatId);
            if (!url) {
                throw new Error('No URL found');
            }

            // First create in main_urls using RPC function
            const { data: mainUrlData, error: mainUrlError } = await supabase
                .rpc('create_main_link', {
                    p_alias: alias,
                    p_original_url: url,
                    p_is_custom: true
                });

            if (mainUrlError) {
                if (mainUrlError.message.includes('duplicate_alias')) {
                    await bot.sendMessage(chatId,
                        '❌ This alias is already taken.\nPlease try a different one:',
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }
                throw mainUrlError;
            }

            // Then create in tg_shortened_urls
            const { error: tgUrlError } = await supabase
                .from('tg_shortened_urls')
                .insert({
                    user_id: msg.from.id,
                    original_url: url,
                    short_alias: alias,
                    created_at: new Date().toISOString(),
                    clicks: 0,
                    main_url_id: mainUrlData[0].id
                });

            if (tgUrlError) {
                // Rollback main_urls entry if tg_urls creation fails
                await supabase
                    .from('main_urls')
                    .delete()
                    .eq('id', mainUrlData[0].id);
                throw tgUrlError;
            }

            // Clear states
            setUserState(chatId, null);
            tempUrls.delete(chatId.toString());

            const shortUrl = `${PROTOCOL}://${DOMAIN}/${alias}`;
            
            await bot.sendMessage(chatId,
                `✅ *Custom URL Created Successfully!*\n\n` +
                `🔗 *Original URL:*\n\`${url}\`\n\n` +
                `✨ *Custom Short URL:*\n\`${shortUrl}\`\n\n` +
                `📊 Use \`/track ${alias}\` to view statistics`,
                {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '🔗 Copy URL',
                                callback_data: `copy_${alias}`
                            },
                            {
                                text: '📊 Track',
                                callback_data: `track_${alias}`
                            }
                        ]]
                    }
                }
            );

        } catch (error) {
            console.error('Custom alias error:', error);
            await bot.sendMessage(chatId,
                '❌ Failed to create custom URL. Please try again.',
                { parse_mode: 'Markdown' }
            );
            setUserState(chatId, null);
            tempUrls.delete(chatId.toString());
        }
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
    getUserState,
    setTempUrl,
    getTempUrl
};