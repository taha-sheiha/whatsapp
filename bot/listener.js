const axios = require('axios');
const logger = require('./logger');
const { sendMessage } = require('./sender');
const NodeCache = require('node-cache');

// Configuration
const AI_API_URL = process.env.AI_API_URL || 'https://ai.tahasheiha.workers.dev/chat';
const rateLimitCache = new NodeCache({ stdTTL: 60 });
const messageIdCache = new NodeCache({ stdTTL: 3600 });

// Per-sender conversation history (in-memory, max 10 exchanges per user)
const conversationHistory = new Map();

/**
 * Recursively extracts text from complex Baileys message objects
 */
function extractText(msg) {
    if (!msg) return "";
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
    const msgId = msg.key?.id || 'unknown';
    const sender = msg.key?.remoteJid || 'unknown';

    try {
        // STEP 1: Basic filter
        if (!msg.message) {
            logger.debug(`[SKIP] No message object. ID: ${msgId}`);
            return;
        }
        if (msg.key.fromMe) {
            logger.debug(`[SKIP] fromMe=true (our own reply). ID: ${msgId}`);
            return;
        }

        // STEP 2: Deduplication by Message ID
        if (messageIdCache.has(msgId)) {
            logger.warn(`[DEDUP] Already processed ID: ${msgId}. Skipping.`);
            return;
        }
        messageIdCache.set(msgId, true);

        // STEP 3: Extract Text
        const text = extractText(msg);
        const msgTypes = Object.keys(msg.message || {}).join(', ');
        logger.info(`[RECV] From: ${sender} | ID: ${msgId} | Types: ${msgTypes}`);

        if (!text || text.trim() === '') {
            logger.warn(`[SKIP] Empty text after extraction. Types: ${msgTypes}. ID: ${msgId}`);
            return;
        }

        // STEP 4: Rate Limiting
        const userRate = rateLimitCache.get(sender) || 0;
        if (userRate >= 10) {
            logger.warn(`[RATE_LIMIT] Blocked ${sender}. Count: ${userRate}. ID: ${msgId}`);
            return;
        }
        rateLimitCache.set(sender, userRate + 1);

        logger.info(`[PROCESS] Sending to AI | From: ${sender} | Msg: "${text.substring(0, 60)}" | ID: ${msgId}`);

        // STEP 5: Call AI API
        const targetUrl = customApiUrl || AI_API_URL;
        const chatId = `wa-${sender.split('@')[0]}`;

        // Get conversation history for this sender
        if (!conversationHistory.has(sender)) conversationHistory.set(sender, []);
        const history = conversationHistory.get(sender);

        let response;
        try {
            response = await axios.post(targetUrl, {
                question: text,
                chatId,
                history: history.slice(-20) // Send last 20 messages (10 exchanges)
            }, { timeout: 25000 });
        } catch (apiError) {
            const status = apiError.response?.status;
            const errBody = apiError.response?.data ? JSON.stringify(apiError.response.data) : apiError.message;
            logger.error(`[API_ERR] Status: ${status} | ${errBody} | ID: ${msgId}`);
            return;
        }

        // STEP 6: Validate AI Response
        const aiReply = response.data?.reply;
        const isPaused = response.data?.paused;
        const rawData = JSON.stringify(response.data).substring(0, 200);

        if (isPaused) {
            logger.warn(`[PAUSED] Session is paused on worker side. No reply sent. ID: ${msgId} | Data: ${rawData}`);
            return;
        }

        if (!aiReply || aiReply.trim() === '') {
            logger.warn(`[NO_REPLY] AI returned empty/null reply. ID: ${msgId} | Data: ${rawData}`);
            return;
        }

        // STEP 7: Update History & Send Reply
        history.push({ role: 'user', content: text });
        history.push({ role: 'assistant', content: aiReply });
        // Keep only last 20 entries (10 exchanges) to avoid memory bloat
        if (history.length > 20) history.splice(0, history.length - 20);

        logger.info(`[REPLY] Sending reply to ${sender}. History: ${history.length / 2} exchanges. ID: ${msgId}`);
        await sendMessage(sock, sender, aiReply);
        logger.info(`[DONE] ✅ Reply sent to ${sender}. ID: ${msgId}`);

    } catch (error) {
        logger.error(`[CRASH] Unhandled error for ID ${msgId}: ${error.message}`);
        if (error.stack) logger.error(error.stack);
    }
}

module.exports = { handleIncomingMessage, extractText };

