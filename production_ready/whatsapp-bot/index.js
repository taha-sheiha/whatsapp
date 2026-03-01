const { connectToWhatsApp } = require('./whatsapp/connection');
const { handleMessage } = require('./whatsapp/listener');
const logger = require('./whatsapp/logger');

async function startBot() {
    logger.info('Starting CountaNeura WhatsApp Bot... 🚀');

    try {
        await connectToWhatsApp(handleMessage);
    } catch (error) {
        logger.error('Failed to start the bot:', error);
        process.exit(1);
    }
}

// Global Error Handlers
process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

startBot();
