const axios = require('axios');
const logger = require('./logger');
const { Readable } = require('stream');
const { execSync, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// ffmpeg binary path (ffmpeg-static bundles a binary for the current OS)
let ffmpegPath = null;
try {
    ffmpegPath = require('ffmpeg-static');
    logger.info(`[Sender] ffmpeg-static loaded: ${ffmpegPath}`);
} catch (e) {
    logger.warn(`[Sender] ffmpeg-static not found. Voice notes will be sent as raw buffers.`);
}

const messageQueue = [];
let isProcessing = false;

/**
 * Convert any audio buffer to OGG/Opus (WhatsApp PTT format) using ffmpeg-static.
 * Returns the converted buffer, or original buffer if ffmpeg fails.
 */
async function toOggOpus(inputBuffer) {
    if (!ffmpegPath) return inputBuffer;
    return new Promise((resolve) => {
        const tmpIn = path.join(os.tmpdir(), `neriva_in_${Date.now()}.tmp`);
        const tmpOut = path.join(os.tmpdir(), `neriva_out_${Date.now()}.ogg`);
        try {
            fs.writeFileSync(tmpIn, inputBuffer);
            execSync(`"${ffmpegPath}" -y -i "${tmpIn}" -c:a libopus -b:a 32k -ar 48000 -ac 1 "${tmpOut}"`, { stdio: 'pipe' });
            const result = fs.readFileSync(tmpOut);
            resolve(result);
        } catch (e) {
            logger.warn(`[Sender_FFMPEG] Conversion failed, using raw buffer: ${e.message}`);
            resolve(inputBuffer);
        } finally {
            try { fs.unlinkSync(tmpIn); } catch (_) {}
            try { fs.unlinkSync(tmpOut); } catch (_) {}
        }
    });
}

async function sendMessage(sock, jid, text, participant = null, voiceBase64 = null) {
    if (!text || text.trim() === '') return;

    logger.debug(`[Sender_DEBUG] full text input: "${text}"`);

    // ── Voice Note Handling ─────────────────────────────
    if (voiceBase64) {
        try {
            logger.info(`[Sender_VOICE] Preparing AI voice note for ${jid}...`);
            const rawBuffer = Buffer.from(voiceBase64, 'base64');
            const oggBuffer = await toOggOpus(rawBuffer);
            messageQueue.push({
                sock, jid,
                payload: { audio: oggBuffer, ptt: true, mimetype: 'audio/ogg; codecs=opus' },
                options: participant ? { participant } : undefined
            });
            logger.info(`[Sender_VOICE] Voice note queued (${oggBuffer.length} bytes).`);
        } catch (err) {
            logger.error(`[Sender_VOICE] Failed to prepare voice note: ${err.message}. Falling back to text.`);
        }
    }

    // ── Text / Media Handling ────────────────────────────
    let mediaItems = [];
    const mediaRegex = /\[(IMAGE|VIDEO|FILE):\s*(https?:\/\/[^\]]+)\s*\]/gi;
    let match;
    while ((match = mediaRegex.exec(text)) !== null) {
        mediaItems.push({ type: match[1].toLowerCase(), url: match[2].trim() });
    }

    let cleanText = text.replace(mediaRegex, '').trim();

    if (mediaItems.length > 0) {
        for (let i = 0; i < mediaItems.length; i++) {
            const item = mediaItems[i];
            const url = item.url;
            const type = item.type;

            logger.info(`[Sender_MEDIA] Detected ${type}. Fetching buffer from: ${url}`);

            try {
                const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
                const buffer = Buffer.from(response.data);
                const ext = url.split('.').pop().toLowerCase().split('?')[0];

                const mimeMap = {
                    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'gif': 'image/gif',
                    'pdf': 'application/pdf', 'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'mp4': 'video/mp4'
                };

                const mimetype = mimeMap[ext] || (type === 'image' ? 'image/jpeg' : (type === 'video' ? 'video/mp4' : 'application/octet-stream'));

                const payload = {};
                let caption = (i === 0 && cleanText) ? cleanText : undefined;

                if (type === 'image') {
                    payload.image = buffer;
                    if (caption) payload.caption = caption;
                    payload.mimetype = mimetype;
                } else if (type === 'video') {
                    payload.video = buffer;
                    if (caption) payload.caption = caption;
                    payload.mimetype = mimetype;
                } else if (type === 'file') {
                    payload.document = buffer;
                    payload.fileName = "Neriva_File." + ext;
                    if (caption) payload.caption = caption;
                    payload.mimetype = mimetype;
                }

                logger.info(`[Sender_MEDIA] Buffer Ready: ${buffer.length} bytes | Type: ${mimetype}.`);
                messageQueue.push({ sock, jid, payload, options: participant ? { participant } : undefined });
            } catch (fetchErr) {
                logger.error(`[Sender_ERR] Failed to fetch media from ${url}: ${fetchErr.message}`);
                let fallbackCaption = (i === 0 && cleanText) ? cleanText + "\n\n(عذراً، فشل تحميل إحدى الوسائط المرفقة)" : "(عذراً، فشل تحميل إحدى الوسائط المرفقة)";
                messageQueue.push({ sock, jid, payload: { text: fallbackCaption }, options: participant ? { participant } : undefined });
            }
        }
    } else {
        // Only send a text message if voice is NOT being sent (avoid duplicate responses)
        if (!voiceBase64) {
            logger.debug(`[Sender_DEBUG] No media found, sending as text.`);
            messageQueue.push({ sock, jid, payload: { text: cleanText }, options: participant ? { participant } : undefined });
        }
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
