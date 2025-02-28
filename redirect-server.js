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

// URL redirection endpoint
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

        // Track click with better error handling
        try {
            await trackClick(req, data);
        } catch (trackError) {
            console.error('Click tracking failed:', trackError);
            // Continue with redirect even if tracking fails
        }

        // Redirect to original URL
        res.redirect(301, data.original_url);

    } catch (error) {
        console.error('Redirect error:', error);
        res.status(500).send('Server error');
    }
});

app.listen(PORT, () => {
    console.log(`🔄 Redirect server running at http://localhost:${PORT}`);
});