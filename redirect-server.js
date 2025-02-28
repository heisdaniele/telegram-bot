require('dotenv').config();
const express = require('express');
const { supabase } = require('./supabaseClient');
const cors = require('cors');
const { trackClick } = require('./features/track');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Add detailed logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
});

// Health check endpoint
app.get('/health', (_, res) => {
    res.status(200).json({ status: 'ok' });
});

// URL redirection endpoint with enhanced tracking
app.get('/:shortAlias', async (req, res) => {
    try {
        const { shortAlias } = req.params;
        console.log('Looking up shortAlias:', shortAlias);
        
        // Query updated to match new schema
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
        console.error('Redirect server error:', {
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        res.status(500).send('Server error');
    }
});

app.listen(PORT, () => {
    console.log(`🔄 Redirect server running at http://localhost:${PORT}`);
});