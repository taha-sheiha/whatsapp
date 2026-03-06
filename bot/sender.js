const axios = require('axios');
const logger = require('./logger');

const messageQueue = [];
let isProcessing = false;

async function sendMessage(sock, jid, text) {
    if (!text || text.trim() === '') return;

    logger.debug(`[Sender_DEBUG] full text input: "${text}"`);

    const mediaMatch = text.match(/\[(IMAGE|VIDEO|FILE):\s*(https?:\/\/[^\]]+)\s*\]/i);

    if (mediaMatch) {
        let type = mediaMatch[1].toLowerCase();
        let url = mediaMatch[2].trim();
        let cleanText = text.replace(/\[(IMAGE|VIDEO|FILE):\s*(https?:\/\/[^\]]+)\s*\]/gi, '').trim();

        logger.info(`[Sender_MEDIA] Detected ${type}. Fetching buffer from: ${url}`);

        try {
            // Fetch the media as a buffer to avoid library URL upload issues
            const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
            const buffer = Buffer.from(response.data);
            const ext = url.split('.').pop().toLowerCase();

            if (!cleanText) {
                cleanText = (type === 'image' ? "صورة" : (type === 'video' ? "فيديو" : "ملف"));
            }

            const payload = {};
            if (type === 'image') {
                payload.image = buffer;
                payload.caption = cleanText;
                payload.mimetype = 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
            } else if (type === 'video') {
                payload.video = buffer;
                payload.caption = cleanText;
                payload.mimetype = 'video/mp4';
            } else if (type === 'file') {
                payload.document = buffer;
                payload.fileName = "Document." + ext;
                payload.caption = cleanText;
                const mimeMap = { 'pdf': 'application/pdf', 'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
                payload.mimetype = mimeMap[ext] || 'application/octet-stream';
            }

            logger.debug(`[Sender_DEBUG] Media Buffer Ready (${buffer.length} bytes). Queuing.`);
            messageQueue.push({ sock, jid, payload });
        } catch (fetchErr) {
            logger.error(`[Sender_ERR] Failed to fetch media from ${url}: ${fetchErr.message}`);
            // Fallback to text if media fails
            messageQueue.push({ sock, jid, payload: { text: `${cleanText}\n\n(عذراً، فشل تحميل الوسائط المرفقة)` } });
        }
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


