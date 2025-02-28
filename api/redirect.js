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
                    <head>
                        <title>Midget URL Shortener</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    </head>
                    <body>
                        <h1>🔗 Midget URL Shortener</h1>
                        <p>Use our <a href="https://t.me/MidgetURLShortnerBot">Telegram Bot</a> to create short links!</p>
                    </body>
                </html>
            `);
        }

        // Updated query to match new schema
        const { data, error } = await supabase
            .from('tg_shortened_urls')
            .select(`
                id,
                user_id,
                original_url,
                short_alias,
                clicks,
                last_clicked
            `)
            .eq('short_alias', shortAlias)
            .single();

        if (error || !data) {
            console.error('URL lookup failed:', {
                error,
                shortAlias,
                timestamp: new Date().toISOString()
            });
            return res.status(404).send('Link not found');
        }

        // Track click with enhanced error handling
        try {
            const trackResult = await trackClick(req, data);
            if (!trackResult.success) {
                console.error('Click tracking failed:', {
                    error: trackResult.error,
                    shortAlias,
                    urlId: data.id,
                    userId: data.user_id
                });
            }
        } catch (trackError) {
            console.error('Click tracking error:', {
                error: trackError,
                shortAlias,
                urlId: data.id,
                userId: data.user_id,
                stack: trackError.stack
            });
            // Continue with redirect even if tracking fails
        }

        // Redirect to original URL
        res.redirect(301, data.original_url);

    } catch (error) {
        console.error('Redirect error:', {
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        res.status(500).send('Server error');
    }
};