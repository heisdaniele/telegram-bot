const express = require('express');
const cors = require('cors');
const { supabase } = require('../supabaseClient');
const { trackClick } = require('../features/track');

// Add timeout middleware
const timeout = (seconds) => {
    return (req, res, next) => {
        res.setTimeout(seconds * 1000, () => {
            res.status(408).send('Request timeout');
        });
        next();
    };
};

// Add custom 404 page HTML
const notFoundPage = `
    <html>
        <head>
            <title>Link Not Found - Midget URL Shortener</title>
            <style>
                body { 
                    font-family: -apple-system, system-ui, sans-serif;
                    max-width: 600px;
                    margin: 40px auto;
                    padding: 20px;
                    text-align: center;
                    line-height: 1.6;
                    color: #333;
                }
                .error { 
                    color: #dc3545;
                    margin: 20px 0;
                    font-size: 1.2em;
                }
                .button {
                    display: inline-block;
                    padding: 12px 24px;
                    background: #0088cc;
                    color: white;
                    text-decoration: none;
                    border-radius: 6px;
                    font-weight: 500;
                    margin-top: 20px;
                }
                .button:hover {
                    background: #006699;
                }
            </style>
        </head>
        <body>
            <h1>🔍 Link Not Found</h1>
            <p class="error">This shortened URL doesn't exist.</p>
            <p>The link you're trying to access has either expired or was never created.</p>
            <a href="/" class="button">Go to Homepage</a>
            <p style="margin-top: 30px;">
                <small>Want to create your own short links? <a href="https://t.me/MidgetURLShortnerBot">Try our Telegram Bot</a></small>
            </p>
        </body>
    </html>
`;

const app = express();
app.use(cors());
app.use(express.json());
app.use(timeout(30)); // 30 second timeout

// Root route handler
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Midget URL Shortener</title>
                <style>
                    body {
                        font-family: -apple-system, system-ui, sans-serif;
                        max-width: 800px;
                        margin: 40px auto;
                        padding: 0 20px;
                        line-height: 1.6;
                        color: #333;
                    }
                    .container {
                        text-align: center;
                        padding: 2rem;
                    }
                    .button {
                        display: inline-block;
                        padding: 12px 24px;
                        background: #0088cc;
                        color: white;
                        text-decoration: none;
                        border-radius: 6px;
                        font-weight: 500;
                        transition: background 0.3s ease;
                    }
                    .button:hover {
                        background: #006699;
                    }
                    .features {
                        margin-top: 2rem;
                        text-align: left;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🔗 Midget URL Shortener</h1>
                    <p>Create and track shortened URLs with our Telegram bot.</p>
                    <a href="https://t.me/MidgetURLShortnerBot" class="button">Open in Telegram</a>
                    
                    <div class="features">
                        <h2>Features:</h2>
                        <ul>
                            <li>Quickly shorten any URL</li>
                            <li>Track clicks and analytics</li>
                            <li>Create custom aliases</li>
                            <li>Bulk URL shortening</li>
                            <li>Real-time click tracking</li>
                        </ul>
                    </div>
                </div>
            </body>
        </html>
    `);
});

// URL redirection handler with improved error handling
app.get('/:shortAlias', async (req, res, next) => {
    try {
        const { shortAlias } = req.params;
        console.log('Looking up shortAlias:', shortAlias);
        
        const { data, error } = await Promise.race([
            supabase
                .from('tg_shortened_urls')
                .select('*')
                .eq('short_alias', shortAlias)
                .single(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Database timeout')), 5000)
            )
        ]);

        // Handle Supabase specific errors
        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).send(notFoundPage);
            }
            throw error;
        }

        if (!data) {
            return res.status(404).send(notFoundPage);
        }

        // Track click asynchronously with error handling
        trackClick(req, data).catch(err => {
            console.error('Click tracking error:', err);
            // Don't block the redirect for tracking errors
        });

        // Redirect to original URL
        res.redirect(301, data.original_url);

    } catch (error) {
        console.error('URL lookup error:', error);
        next(error);
    }
});

// Add error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).send(`
        <html>
            <head>
                <title>Error - Midget URL Shortener</title>
                <style>
                    body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; text-align: center; }
                    .error { color: #dc3545; margin: 20px 0; }
                    .button { display: inline-block; padding: 10px 20px; background: #0088cc; color: white; text-decoration: none; border-radius: 4px; }
                </style>
            </head>
            <body>
                <h1>⚠️ Oops! Something went wrong</h1>
                <p class="error">The service is temporarily unavailable. Please try again later.</p>
                <a href="/" class="button">Go Back</a>
            </body>
        </html>
    `);
});

module.exports = app;