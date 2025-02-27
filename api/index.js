const express = require('express');
const cors = require('cors');
const { supabase } = require('../supabaseClient');
const { trackClick } = require('../features/track');

const app = express();
app.use(cors());
app.use(express.json());

// Root route handler
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Midget URL Shortener</title>
                <style>
                    body { font-family: -apple-system, system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }
                    .container { text-align: center; }
                    .button { display: inline-block; padding: 12px 24px; background: #0088cc; color: white; text-decoration: none; border-radius: 6px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🔗 Midget URL Shortener</h1>
                    <p>Create and track shortened URLs with our Telegram bot.</p>
                    <a href="https://t.me/midget_url_bot" class="button">Open in Telegram</a>
                </div>
            </body>
        </html>
    `);
});

// URL redirection handler
app.get('/:shortAlias', async (req, res) => {
    try {
        const { shortAlias } = req.params;
        console.log('Looking up shortAlias:', shortAlias);
        
        const { data, error } = await supabase
            .from('tg_shortened_urls')
            .select('*')
            .eq('short_alias', shortAlias)
            .single();

        if (error || !data) {
            console.error('URL lookup failed:', error);
            return res.status(404).send('Link not found');
        }

        // Track click asynchronously
        trackClick(req, data).catch(console.error);

        // Redirect to original URL
        res.redirect(301, data.original_url);

    } catch (error) {
        console.error('Redirect error:', error);
        res.status(500).send('Server error');
    }
});

module.exports = app;