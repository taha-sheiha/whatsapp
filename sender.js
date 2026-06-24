const axios = require('axios');
const logger = require('./logger');
const { Readable } = require('stream');
const { execSync, spawn, exec } = require('child_process');
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

// [CONCURRENCY FIX]: Per-JID queue map instead of a single global queue.
// Before: ALL messages for ALL customers shared one queue — customer #10 waited 4.5s for #1-9 to finish.
// After: each JID gets its own independent queue — all customers are served in parallel.
const jidQueues = new Map();   // jid → { queue: [], processing: bool }

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
            // Non-blocking conversion using exec
            exec(`"${ffmpegPath}" -y -f s16le -ar 24000 -ac 1 -i "${tmpIn}" -c:a libopus -b:a 32k -ar 48000 -ac 1 "${tmpOut}"`, (error) => {
                if (error) {
                    logger.warn(`[Sender_FFMPEG] Conversion failed, using raw buffer: ${error.message}`);
                    resolve(inputBuffer);
                } else {
                    try {
                        const result = fs.readFileSync(tmpOut);
                        resolve(result);
                    } catch (readErr) {
                        logger.error(`[Sender_FFMPEG] Failed to read converted audio: ${readErr.message}`);
                        resolve(inputBuffer);
                    }
                }
                // Cleanup files inside the callback
                try { fs.unlinkSync(tmpIn); } catch (_) {}
                try { fs.unlinkSync(tmpOut); } catch (_) {}
            });
        } catch (e) {
            logger.warn(`[Sender_FFMPEG] File setup failed, using raw buffer: ${e.message}`);
            try { fs.unlinkSync(tmpIn); } catch (_) {}
            try { fs.unlinkSync(tmpOut); } catch (_) {}
            resolve(inputBuffer);
        }
    });
}

async function sendMessage(sock, jid, text, participant = null, voiceBase64 = null) {
    if (!text || text.trim() === '') return;

    logger.debug(`[Sender_DEBUG] full text input: "${text}"`);

    // ── Initialise per-JID queue (always first) ──────────────────────────────
    if (!jidQueues.has(jid)) {
        jidQueues.set(jid, { queue: [], processing: false });
    }
    const jidState = jidQueues.get(jid);

    // ── Voice Note Handling ──────────────────────────────────────────────────
    if (voiceBase64) {
        try {
            logger.info(`[Sender_VOICE] Preparing AI voice note for ${jid}...`);
            const rawBuffer = Buffer.from(voiceBase64, 'base64');
            const oggBuffer = await toOggOpus(rawBuffer);
            jidState.queue.push({
                sock, jid,
                payload: { audio: oggBuffer, ptt: true, mimetype: 'audio/ogg; codecs=opus' },
                options: participant ? { participant } : undefined
            });
            logger.info(`[Sender_VOICE] Voice note queued (${oggBuffer.length} bytes).`);
        } catch (err) {
            logger.error(`[Sender_VOICE] Failed to prepare voice note: ${err.message}. Falling back to text.`);
        }
    }

    // ── Text / Media Handling ────────────────────────────────────────────────
    const mediaRegex = /\[(IMAGE|VIDEO|FILE):\s*(https?:\/\/[^\]]+)\s*\]/gi;
    const mediaItems = [];
    let match;
    while ((match = mediaRegex.exec(text)) !== null) {
        mediaItems.push({ type: match[1].toLowerCase(), url: match[2].trim() });
    }
    const cleanText = text.replace(mediaRegex, '').trim();

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
                    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
                    'webp': 'image/webp', 'gif': 'image/gif',
                    'pdf': 'application/pdf',
                    'doc': 'application/msword',
                    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'xls': 'application/vnd.ms-excel',
                    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'mp4': 'video/mp4'
                };

                const mimetype = mimeMap[ext] || (
                    type === 'image' ? 'image/jpeg' :
                    type === 'video' ? 'video/mp4' :
                    'application/octet-stream'
                );

                const payload = {};
                const caption = (i === 0 && cleanText) ? cleanText : undefined;

                if (type === 'image') {
                    payload.image = buffer;
                    if (caption) payload.caption = caption;
                    payload.mimetype = mimetype;
                } else if (type === 'video') {
                    payload.video = buffer;
                    if (caption) payload.caption = caption;
                    payload.mimetype = mimetype;
                } else {
                    // file / document
                    payload.document = buffer;
                    payload.fileName = `Neriva_File.${ext}`;
                    if (caption) payload.caption = caption;
                    payload.mimetype = mimetype;
                }

                logger.info(`[Sender_MEDIA] Buffer Ready: ${buffer.length} bytes | Type: ${mimetype}.`);
                jidState.queue.push({ sock, jid, payload, options: participant ? { participant } : undefined });

            } catch (fetchErr) {
                logger.error(`[Sender_ERR] Failed to fetch media from ${url}: ${fetchErr.message}`);
                const fallbackCaption = (i === 0 && cleanText)
                    ? `${cleanText}\n\n(عذراً، فشل تحميل إحدى الوسائط المرفقة)`
                    : '(عذراً، فشل تحميل إحدى الوسائط المرفقة)';
                jidState.queue.push({ sock, jid, payload: { text: fallbackCaption }, options: participant ? { participant } : undefined });
            }
        }
    } else {
        // Text-only — skip if we already sent a voice note (no duplicate)
        if (!voiceBase64) {
            logger.debug(`[Sender_DEBUG] No media found, sending as text.`);
            jidState.queue.push({ sock, jid, payload: { text: cleanText }, options: participant ? { participant } : undefined });
        }
    }

    if (!jidState.processing) processJidQueue(jid);
}

// [ANTI-BAN FIX]: A session-scoped lock map to ensure we never burst multiple socket messages
// in the exact same millisecond per account, while allowing different companies to send in parallel.
const sessionSendLocks = new Map(); // "companyId:sessionId" -> Promise

// Process queue for a specific JID — independent from all other JIDs
async function processJidQueue(jid) {
    const jidState = jidQueues.get(jid);
    if (!jidState || jidState.processing || jidState.queue.length === 0) return;
    jidState.processing = true;

    const { sock, payload, options } = jidState.queue.shift();

    const sessionKey = `${sock.companyId || 'global'}:${sock.sessionId || 'default'}`;
    if (!sessionSendLocks.has(sessionKey)) {
        sessionSendLocks.set(sessionKey, Promise.resolve());
    }
    const currentSessionLock = sessionSendLocks.get(sessionKey);

    let releaseLock = null;
    try {
        // --- ANTI-BAN THROTTLE START ---
        // Wait for our turn for this specific session so we don't spam WhatsApp anti-spam bans
        await currentSessionLock;
        
        sessionSendLocks.set(sessionKey, new Promise(resolve => { releaseLock = resolve; }));

        // Simulate human behavior: send "typing..." indicator
        try { await sock.sendPresenceUpdate('composing', jid); } catch (e) {}
        
        // Random human-like delay between 200ms and 400ms
        const delay = Math.floor(Math.random() * 200) + 200;
        await new Promise(r => setTimeout(r, delay));
        // --- ANTI-BAN THROTTLE END ---

        logger.info(`[Sender] Sending to ${jid}${options?.participant ? ` (participant: ${options.participant})` : ''}...`);
        const sentMsg = await sock.sendMessage(jid, payload, options);
        logger.info(`[Sender] ✅ Sent to ${jid}`);

        try {
            const { recentMessagesCache } = require('./connection');
            if (sentMsg && sentMsg.key?.id && recentMessagesCache) {
                recentMessagesCache.set(sentMsg.key.id, sentMsg);
            }
        } catch (cacheErr) {
            logger.error(`[Sender] Failed to cache sent message: ${cacheErr.message}`);
        }

    } catch (error) {
        logger.error(`[Sender] ❌ Failed to send to ${jid}: ${error.message}`);
    } finally {
        // Always release the session lock — even on failure — to prevent permanent deadlock
        if (releaseLock) releaseLock();

        jidState.processing = false;
        if (jidState.queue.length > 0) {
            setTimeout(() => processJidQueue(jid), 300); // 300ms between msgs to same person (anti-spam)
        } else {
            // Clean up empty queues to prevent memory accumulation
            jidQueues.delete(jid);
        }
    }
}

module.exports = { sendMessage };
