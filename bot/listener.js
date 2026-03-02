const axios = require('axios');
const logger = require('./logger');
const { sendMessage } = require('./sender');
const NodeCache = require('node-cache');

// Configuration
const AI_API_URL = process.env.AI_API_URL || 'https://ai.tahasheiha.workers.dev/chat'; // Default fallback
const rateLimitCache = new NodeCache({ stdTTL: 60 }); // 60 seconds limit
const messageIdCache = new NodeCache({ stdTTL: 3600 }); // 1 hour for message ID deduplication

/**
 * Recursively extracts text from complex Baileys message objects
 */
function extractText(msg) {
    if (!msg) return "";

    // Check direct properties
    if (typeof msg === 'string') return msg;

    const m = msg.message || msg;

    return m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentWithCaptionMessage?.message?.imageMessage?.caption ||
        m.viewOnceMessage?.message?.imageMessage?.caption ||
        m.viewOnceMessageV2?.message?.imageMessage?.caption ||
        m.viewOnceMessageV2?.message?.videoMessage?.caption ||
        m.ephemeralMessage?.message?.conversation ||
        m.ephemeralMessage?.message?.extendedTextMessage?.text ||
        m.templateButtonReplyMessage?.selectedId ||
        m.buttonsResponseMessage?.selectedButtonId ||
        "";
}

async function handleIncomingMessage(sock, msg, customApiUrl) {
    try {
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const msgId = msg.key.id;

        // 1. Deduplication by Message ID (Robust)
        if (messageIdCache.has(msgId)) {
            logger.debug(`Duplicate message ID ignored: ${msgId}`);
            return;
        }
        messageIdCache.set(msgId, true);

        // 2. Extract Text
        const text = extractText(msg);

        if (!text || text.trim() === '') {
            logger.info(`Ignored non-text or unsupported message type from ${sender}. ID: ${msgId}`);
            return;
        }

        // 3. Rate Limiting (Max 10 messages per 60s per user)
        const userRate = rateLimitCache.get(sender) || 0;
        if (userRate >= 10) {
            logger.warn(`Rate limit hit for ${sender}. Blocking message.`);
            return;
        }
        rateLimitCache.set(sender, userRate + 1);

        const timestamp = new Date(msg.messageTimestamp * 1000).toLocaleString();
        logger.info(`Processing [${timestamp}] from ${sender}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" (ID: ${msgId})`);

        // 4. Process with AI API
        const targetUrl = customApiUrl || AI_API_URL;
        try {
            const response = await axios.post(targetUrl, {
                question: text,
                chatId: `wa-${sender.split('@')[0]}`,
                history: []
            }, { timeout: 25000 });

            const aiReply = response.data.reply;
            if (aiReply && aiReply.trim() !== '') {
                await sendMessage(sock, sender, aiReply);
                logger.info(`Replied to ${sender} for ID: ${msgId}`);
            }
        } catch (apiError) {
            const status = apiError.response?.status;
            logger.error(`AI API Error for ${sender}: [${status}] ${apiError.message}`);
        }

    } catch (error) {
        logger.error(`Critical Error in listener for ID ${msg.key?.id}:`, error);
    }
}

module.exports = { handleIncomingMessage, extractText };
