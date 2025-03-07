require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const checkEnv = () => {
    const required = [
        'BOT_TOKEN',
        'SUPABASE_URL',
        'SUPABASE_ANON_KEY',
        'WEBHOOK_SECRET'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length) {
        console.error('❌ Missing environment variables:', missing.join(', '));
        process.exit(1);
    }

    console.log('✅ All required environment variables are present');
};

const checkDatabase = async () => {
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY
    );

    try {
        // Check if main_url_id column exists
        const { data, error } = await supabase
            .from('tg_shortened_urls')
            .select('main_url_id')
            .limit(1);

        if (error) {
            console.error('❌ Database schema needs update:', error.message);
            process.exit(1);
        }

        console.log('✅ Database schema is up to date');
    } catch (error) {
        console.error('❌ Database connection error:', error.message);
        process.exit(1);
    }
};

const main = async () => {
    checkEnv();
    await checkDatabase();
};

main().catch(console.error);