require('dotenv').config();

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

checkEnv();