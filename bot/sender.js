const logger = require('./logger');

const messageQueue = [];
let isProcessing = false;

async function sendMessage(sock, jid, text) {
    if (!text || text.trim() === '') return;

    // Support for [IMAGE:URL], [VIDEO:URL], [FILE:URL]
    const mediaMatch = text.match(/\[(IMAGE|VIDEO|FILE):\s*(https?:\/\/[^\]]+)\s*\]/i);

    if (mediaMatch) {
        let type = mediaMatch[1].toLowerCase();
        let url = mediaMatch[2].trim();
        let cleanText = text.replace(/\[(IMAGE|VIDEO|FILE):\s*(https?:\/\/[^\]]+)\s*\]/gi, '').trim();

        // Default caption if empty
        if (!cleanText) {
            cleanText = (type === 'image' ? "صورة" : (type === 'video' ? "فيديو" : "ملف"));
        }

        const payload = {};
        if (type === 'image') {
            payload.image = { url: url };
            payload.caption = cleanText;
        } else if (type === 'video') {
            payload.video = { url: url };
            payload.caption = cleanText;
        } else if (type === 'file') {
            payload.document = { url: url };
            payload.fileName = "Document." + url.split('.').pop();
            payload.caption = cleanText;
        }

        messageQueue.push({ sock, jid, payload });
        logger.debug(`[Sender] Queued media message (${type}) for ${jid}.`);
    } else {
        messageQueue.push({ sock, jid, payload: { text } });
        logger.debug(`[Sender] Queued text message for ${jid}.`);
    }

    if (!isProcessing) processQueue();
}

async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;
    isProcessing = true;

    const { sock, jid, payload } = messageQueue.shift();

    try {
        logger.info(`[Sender] Sending to ${jid}...`);
        await sock.sendMessage(jid, payload);
        logger.info(`[Sender] ✅ Sent to ${jid}`);
    } catch (error) {
        logger.error(`[Sender] ❌ Failed to send to ${jid}: ${error.message}`);
    } finally {
        isProcessing = false;
        if (messageQueue.length > 0) {
            setTimeout(processQueue, 500);
        }
    }
}

module.exports = { sendMessage };


