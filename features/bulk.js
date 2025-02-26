const { supabase } = require('../supabaseClient');
const { nanoid } = require('nanoid');
const validator = require('validator');

// User state management
const userStates = new Map();

function setUserState(chatId, state) {
    userStates.set(chatId, state);
}

function getUserState(chatId) {
    return userStates.get(chatId);
}

async function handleBulkShorten(bot, msg) {
    const chatId = msg.chat.id;
    const urls = msg.text.split(/\s+/).filter(url => url.length > 0);

    if (urls.length === 0) {
        return bot.sendMessage(chatId,
            '❌ *No URLs detected*\n\n' +
            'Send multiple URLs separated by spaces:',
            { parse_mode: 'Markdown' }
        );
    }

    let response = '🔗 *Shortened URLs:*\n\n';
    let successCount = 0;
    
    for (const url of urls) {
        try {
            // Format and validate URL
            let formattedUrl = url;
            if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
                formattedUrl = 'https://' + formattedUrl;
            }

            if (!validator.isURL(formattedUrl)) {
                response += `❌ Invalid URL: ${url}\n`;
                continue;
            }

            const shortAlias = nanoid(6).toLowerCase();
            const { error } = await supabase
                .from('tg_shortened_urls')
                .insert({
                    user_id: msg.from.id,
                    original_url: formattedUrl,
                    short_alias: shortAlias,
                    created_at: new Date().toISOString()
                });

            if (error) {
                response += `❌ Failed to shorten: ${url}\n`;
                continue;
            }

            response += `✅ ${url}\n➜ \`localhost:3000/${shortAlias}\`\n\n`;
            successCount++;
        } catch (error) {
            console.error('Error processing URL:', url, error);
            response += `❌ Error processing: ${url}\n`;
        }
    }

    response += `\n📊 Successfully shortened: ${successCount}/${urls.length}`;

    await bot.sendMessage(chatId, response, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
    });
}

module.exports = {
    handleBulkShorten,
    setUserState,
    getUserState
};
