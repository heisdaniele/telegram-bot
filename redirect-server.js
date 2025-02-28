require('dotenv').config();
const express = require('express');
const { supabase } = require('./supabaseClient');
const cors = require('cors');
const { trackClick } = require('./features/track');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Add request logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    const method = req.method;
    const url = req.url;
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress?.replace('::ffff:', '');
    const userAgent = req.headers['user-agent'];

    console.log(`
Request Details [${timestamp}]:
- Method: ${method}
- URL: ${url}
- IP: ${ip}
- User-Agent: ${userAgent}
- Headers: ${JSON.stringify(req.headers, null, 2)}
    `);
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

        if (error) {
            console.error('Database error:', error);
            return res.status(500).send('Database error occurred');
        }

        if (!data) {
            console.log('URL not found:', shortAlias);
            return res.status(404).send('Link not found');
        }

        // Track click with detailed error handling
        try {
            await trackClick(req, data);
            console.log('Click tracked successfully for:', shortAlias);
        } catch (trackError) {
            console.error('Click tracking failed:', trackError);
            // Continue with redirect even if tracking fails
        }

        console.log('Redirecting to:', data.original_url);
        res.redirect(301, data.original_url);

    } catch (error) {
        console.error('Redirect server error:', error);
        res.status(500).send('Server error occurred');
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    res.status(500).send('An unexpected error occurred');
});

app.listen(PORT, () => {
    console.log(`🔄 Redirect server running at http://localhost:${PORT}`);
});