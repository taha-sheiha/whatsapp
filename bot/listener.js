const axios = require('axios');
const logger = require('./logger');
const { sendMessage } = require('./sender');
const NodeCache = require('node-cache');

// Configuration
const AI_API_URL = process.env.AI_API_URL || 'https://ai.tahasheiha.workers.dev/chat'; // Default fallback
const rateLimitCache = new NodeCache({ stdTTL: 60 }); // 60 seconds limit
const messageCache = new NodeCache({ stdTTL: 10 }); // 10 seconds duplicate prevention

async function handleIncomingMessage(sock, msg, customApiUrl) {
    try {
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption || "";

        if (!text || text.trim() === '') return;

        // 1. Spam Prevention (Duplicate check)
        const msgHash = `${sender}:${text}`;
        if (messageCache.has(msgHash)) {
            logger.info(`Duplicate message ignored from ${sender}`);
            return;
        }
        messageCache.set(msgHash, true);

        // 2. Rate Limiting (Max 5 messages per 60s per user)
        const userRate = rateLimitCache.get(sender) || 0;
        if (userRate >= 5) {
            logger.warn(`Rate limit hit for ${sender}`);
            return;
        }
        rateLimitCache.set(sender, userRate + 1);

        const timestamp = new Date(msg.messageTimestamp * 1000).toLocaleString();
        logger.info(`Incoming [${timestamp}] from ${sender}: ${text}`);

        // 3. Process with AI API
        const targetUrl = customApiUrl || AI_API_URL;
        try {
            const response = await axios.post(targetUrl, {
                question: text,
                chatId: `wa-${sender.split('@')[0]}`,
                history: []
            }, { timeout: 15000 });

            const aiReply = response.data.reply;
            if (aiReply && aiReply.trim() !== '') {
                await sendMessage(sock, sender, aiReply);
            }
        } catch (apiError) {
            const status = apiError.response?.status;
            const errorData = apiError.response?.data;
            const errorMsg = typeof errorData === 'object' ? JSON.stringify(errorData) : (errorData || apiError.message);
            logger.error(`AI API Error for ${sender}: [${status}] ${errorMsg}`);
        }

    } catch (error) {
        logger.error('Critical Error in listener:', error);
    }
}

module.exports = { handleIncomingMessage };
