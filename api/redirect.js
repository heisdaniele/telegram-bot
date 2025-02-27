const express = require('express');
const { supabase } = require('../supabaseClient');
const { trackClick } = require('../features/track');

const app = express();

module.exports = async (req, res) => {
    try {
        const shortAlias = req.url.slice(1); // Remove leading slash
        
        if (!shortAlias) {
            return res.status(200).send(`
                <html>
                    <head><title>Midget URL Shortener</title></head>
                    <body>
                        <h1>🔗 Midget URL Shortener</h1>
                        <p>Use our <a href="https://t.me/MidgetURLShortnerBot">Telegram Bot</a> to create short links!</p>
                    </body>
                </html>
            `);
        }

        const { data, error } = await supabase
            .from('tg_shortened_urls')
            .select('*')
            .eq('short_alias', shortAlias)
            .single();

        if (error || !data) {
            return res.status(404).send('Link not found');
        }

        // Track click asynchronously
        trackClick(req, data).catch(console.error);

        res.redirect(301, data.original_url);

    } catch (error) {
        console.error('Redirect error:', error);
        res.status(500).send('Server error');
    }
};