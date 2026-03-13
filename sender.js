const axios = require('axios');
const logger = require('./logger');

const messageQueue = [];
let isProcessing = false;

async function sendMessage(sock, jid, text, participant = null) {
    if (!text || text.trim() === '') return;

    logger.debug(`[Sender_DEBUG] full text input: "${text}"`);

    const mediaMatch = text.match(/\[(IMAGE|VIDEO|FILE):\s*(https?:\/\/[^\]]+)\s*\]/i);

    if (mediaMatch) {
        let type = mediaMatch[1].toLowerCase();
        let url = mediaMatch[2].trim();
        let cleanText = text.replace(/\[(IMAGE|VIDEO|FILE):\s*(https?:\/\/[^\]]+)\s*\]/gi, '').trim();

        logger.info(`[Sender_MEDIA] Detected ${type}. Fetching buffer from: ${url}`);

        try {
            const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
            const buffer = Buffer.from(response.data);
            const ext = url.split('.').pop().toLowerCase().split('?')[0]; // Clean extension

            if (!cleanText) {
                cleanText = (type === 'image' ? "صورة" : (type === 'video' ? "فيديو" : "ملف"));
            }

            const payload = {};
            // Precise mimetypes are crucial for Baileys
            const mimeMap = {
                'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'gif': 'image/gif',
                'pdf': 'application/pdf', 'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'mp4': 'video/mp4'
            };

            const mimetype = mimeMap[ext] || (type === 'image' ? 'image/jpeg' : (type === 'video' ? 'video/mp4' : 'application/octet-stream'));

            if (type === 'image') {
                payload.image = buffer;
                payload.caption = cleanText;
                payload.mimetype = mimetype;
            } else if (type === 'video') {
                payload.video = buffer;
                payload.caption = cleanText;
                payload.mimetype = mimetype;
            } else if (type === 'file') {
                payload.document = buffer;
                payload.fileName = "Neriva_File." + ext;
                payload.caption = cleanText;
                payload.mimetype = mimetype;
            }

            logger.info(`[Sender_MEDIA] Buffer Ready: ${buffer.length} bytes | Type: ${mimetype}.`);
            messageQueue.push({ sock, jid, payload, options: participant ? { participant } : undefined });
        } catch (fetchErr) {
            logger.error(`[Sender_ERR] Failed to fetch media from ${url}: ${fetchErr.message}`);
            // Fallback to text if media fails
            messageQueue.push({ sock, jid, payload: { text: `${cleanText}\n\n(عذراً، فشل تحميل الوسائط المرفقة)` }, options: participant ? { participant } : undefined });
        }
    } else {
        logger.debug(`[Sender_DEBUG] No media found, sending as text.`);
        messageQueue.push({ sock, jid, payload: { text }, options: participant ? { participant } : undefined });
    }

    if (!isProcessing) processQueue();
}

async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;
    isProcessing = true;

    const { sock, jid, payload, options } = messageQueue.shift();

    try {
        logger.info(`[Sender] Sending to ${jid}${options?.participant ? ` (participant: ${options.participant})` : ''}...`);
        await sock.sendMessage(jid, payload, options);
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


