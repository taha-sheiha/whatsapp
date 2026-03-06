const logger = require('./logger');

const messageQueue = [];
let isProcessing = false;

async function sendMessage(sock, jid, text) {
    if (!text || text.trim() === '') return;

    logger.debug(`[Sender_DEBUG] full text input: "${text}"`);

    // Support for [IMAGE:URL], [VIDEO:URL], [FILE:URL]
    const mediaMatch = text.match(/\[(IMAGE|VIDEO|FILE):\s*(https?:\/\/[^\]]+)\s*\]/i);

    if (mediaMatch) {
        let type = mediaMatch[1].toLowerCase();
        let url = mediaMatch[2].trim();
        let cleanText = text.replace(/\[(IMAGE|VIDEO|FILE):\s*(https?:\/\/[^\]]+)\s*\]/gi, '').trim();

        logger.info(`[Sender_MEDIA] Found ${type} tag. URL: ${url}`);

        // Default caption if empty
        if (!cleanText) {
            cleanText = (type === 'image' ? "صورة" : (type === 'video' ? "فيديو" : "ملف"));
        }

        const payload = {};
        const ext = url.split('.').pop().toLowerCase();

        if (type === 'image') {
            payload.image = { url: url };
            payload.caption = cleanText;
            payload.mimetype = 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
        } else if (type === 'video') {
            payload.video = { url: url };
            payload.caption = cleanText;
            payload.mimetype = 'video/mp4';
        } else if (type === 'file') {
            payload.document = { url: url };
            payload.fileName = "Document." + ext;
            payload.caption = cleanText;
            // Common document mimetypes
            const mimeMap = { 'pdf': 'application/pdf', 'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
            payload.mimetype = mimeMap[ext] || 'application/octet-stream';
        }

        logger.debug(`[Sender_DEBUG] Media Payload: ${JSON.stringify(payload)}`);
        messageQueue.push({ sock, jid, payload });
    } else {
        logger.debug(`[Sender_DEBUG] No media found, sending as text.`);
        messageQueue.push({ sock, jid, payload: { text } });
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


