const axios = require('axios');
const logger = require('./logger');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { sendMessage } = require('./sender');
const NodeCache = require('node-cache');
// Lazy-require to avoid circular dependency — jidMap is populated by server.js
let _jidMap = null;
function getJidMap() {
    if (!_jidMap) _jidMap = require('./server').jidMap;
    return _jidMap;
}


// Configuration
const AI_API_URL = process.env.AI_API_URL || 'https://neura-worker.tahasheiha.workers.dev/chat';
const rateLimitCache = new NodeCache({ stdTTL: 60 });
const messageIdCache = new NodeCache({ stdTTL: 3600 });



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

async function handleIncomingMessage(sock, msg, companyId, customApiUrl, sessionId) {
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

        if (sender === 'status@broadcast' || sender.includes('@broadcast') || sender === 'status' || sender.startsWith('status@')) {
            logger.debug(`[SKIP] Ignored WhatsApp Status broadcast. ID: ${msgId}`);
            return;
        }

        // STEP 2: Deduplication by Message ID
        if (messageIdCache.has(msgId)) {
            logger.warn(`[DEDUP] Already processed ID: ${msgId}. Skipping.`);
            return;
        }
        messageIdCache.set(msgId, true);

        // --- DEBUG EXPERIMENT FOR @LID ---
        if (sender.includes('@lid')) {
            logger.info(`[LID_DEBUG] Raw MSG for ${sender}: ${JSON.stringify(msg, (k,v) => (k === 'message' && typeof v === 'object' ? Object.keys(v) : v)).substring(0, 300)}`);
            logger.info(`[LID_DEBUG] MSG participant: ${msg.participant || msg.key?.participant || 'none'}`);
        }
        // ---------------------------------


        // STEP 3: Extract Text
        let text = extractText(msg);
        const msgTypes = Object.keys(msg.message || {}).join(', ');
        logger.info(`[RECV] From: ${sender} | ID: ${msgId} | Types: ${msgTypes}`);

        // Extract Media if present
        let audioBase64 = null;
        let isVoiceNote = false;
        let audioMimeType = null;
        
        let imageBase64 = null;
        let imageMimeType = null;
        
        let videoBase64 = null;
        let videoMimeType = null;
        
        let fileBase64 = null;
        let fileMimeType = null;
        let fileName = null;

        const audioMsg = msg.message?.audioMessage || msg.message?.ephemeralMessage?.message?.audioMessage;
        const imageMsg = msg.message?.imageMessage || msg.message?.ephemeralMessage?.message?.imageMessage || msg.message?.viewOnceMessage?.message?.imageMessage || msg.message?.viewOnceMessageV2?.message?.imageMessage;
        const videoMsg = msg.message?.videoMessage || msg.message?.ephemeralMessage?.message?.videoMessage || msg.message?.viewOnceMessage?.message?.videoMessage || msg.message?.viewOnceMessageV2?.message?.videoMessage;
        const documentMsg = msg.message?.documentMessage || msg.message?.ephemeralMessage?.message?.documentMessage;

        if (audioMsg) {
            try {
                logger.info(`[Audio_DL] Downloading audio message from ${sender}...`);
                const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });
                const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // 2MB
                if (buffer.length > MAX_AUDIO_BYTES) {
                    logger.warn(`[Audio_SKIP] Audio too large (${buffer.length} bytes). Skipping audio upload, replying as text.`);
                    text = text || "[رسالة صوتية طويلة جداً - تعذر معالجتها]";
                } else {
                    audioBase64 = buffer.toString('base64');
                    isVoiceNote = !!audioMsg.ptt;
                    audioMimeType = isVoiceNote ? 'audio/ogg; codecs=opus' : (audioMsg.mimetype || 'audio/ogg');
                    const voicePrompt = "العميل أرسل لك مقطع صوتي. استمع إليه وأجب عليه كأنه نص مكتوب ولا تذكر أبداً في ردك أنك استمعت إلى تسجيل صوتي أو أنك فهمت الصوت. أجب مباشرة على محتوى الرسالة وكأنها نصية.";
                    text = text ? text + "\n" + voicePrompt : voicePrompt;
                    logger.info(`[Audio_DL] Audio ready: ${buffer.length} bytes, ptt=${isVoiceNote}, mime=${audioMimeType}`);
                }
            } catch (err) {
                logger.error(`[Audio_ERR] Failed to download audio: ${err.message}`);
                text = text || "[عطل في قراءة الرسالة الصوتية]";
            }
        } else if (imageMsg) {
            try {
                logger.info(`[Image_DL] Downloading image from ${sender}...`);
                const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });
                const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
                if (buffer.length > MAX_IMAGE_BYTES) {
                    logger.warn(`[Image_SKIP] Image too large (${buffer.length} bytes). Skipping image upload.`);
                    text = text || "[صورة كبيرة جداً - تعذر معالجتها]";
                } else {
                    imageBase64 = buffer.toString('base64');
                    imageMimeType = imageMsg.mimetype || 'image/jpeg';
                    const imagePrompt = "العميل أرسل لك صورة. قم بتحليل الصورة بدقة عالية وأجب على استفسار العميل بناءً على ما يظهر فيها.";
                    text = text ? text + "\n" + imagePrompt : imagePrompt;
                    logger.info(`[Image_DL] Image ready: ${buffer.length} bytes, mime=${imageMimeType}`);
                }
            } catch (err) {
                logger.error(`[Image_ERR] Failed to download image: ${err.message}`);
                text = text || "[عطل في قراءة الصورة]";
            }
        } else if (videoMsg) {
            try {
                logger.info(`[Video_DL] Downloading video from ${sender}...`);
                const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });
                const MAX_VIDEO_BYTES = 15 * 1024 * 1024; // 15MB
                if (buffer.length > MAX_VIDEO_BYTES) {
                    logger.warn(`[Video_SKIP] Video too large (${buffer.length} bytes). Skipping video upload.`);
                    text = text || "[فيديو كبير جداً - تعذر معالجته]";
                } else {
                    videoBase64 = buffer.toString('base64');
                    videoMimeType = videoMsg.mimetype || 'video/mp4';
                    logger.info(`[Video_DL] Video ready: ${buffer.length} bytes, mime=${videoMimeType}`);
                    text = text || "[فيديو مرفق]";
                }
            } catch (err) {
                logger.error(`[Video_ERR] Failed to download video: ${err.message}`);
                text = text || "[عطل في قراءة الفيديو]";
            }
        } else if (documentMsg) {
            try {
                logger.info(`[Document_DL] Downloading document from ${sender}...`);
                const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });
                const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
                if (buffer.length > MAX_FILE_BYTES) {
                    logger.warn(`[Document_SKIP] Document too large (${buffer.length} bytes). Skipping file upload.`);
                    text = text || "[ملف كبير جداً - تعذر معالجته]";
                } else {
                    fileBase64 = buffer.toString('base64');
                    fileMimeType = documentMsg.mimetype || 'application/octet-stream';
                    fileName = documentMsg.fileName || 'document';
                    logger.info(`[Document_DL] Document ready: ${buffer.length} bytes, mime=${fileMimeType}, name=${fileName}`);
                    text = text || `[ملف مرفق: ${fileName}]`;
                }
            } catch (err) {
                logger.error(`[Document_ERR] Failed to download document: ${err.message}`);
                text = text || "[عطل في قراءة الملف]";
            }
        }

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

        // Extract real phone number if it's an @lid account
        let realPhone = sender.split('@')[0];
        if (sender.includes('@lid') && msg.key?.senderPn) {
            realPhone = msg.key.senderPn.split('@')[0];
            logger.info(`[LID_RESOLVE] Resolved @lid ${sender} to real phone: ${realPhone}`);
        }

        const pushName = msg.pushName || "";
        const userName = pushName ? `${pushName} (${realPhone})` : realPhone;

        logger.info(`[PROCESS] Sending to AI | From: ${userName} | Msg: "${text.substring(0, 60)}" | ID: ${msgId}`);

        // STEP 5: Call AI API
        const targetUrl = customApiUrl || AI_API_URL;
        const chatId = `wa-${realPhone}`;

        // Store the real JID (could be @lid) so manual replies use the correct address
        // Crucial: we map the wa-REALPHONE to the @lid sender!
        try { getJidMap().set(chatId, sender); } catch(e) { /* non-critical */ }



        let response;
        try {
            const botSecret = process.env.BOT_SECRET;
            if (!botSecret) {
                logger.warn('[SECURITY] BOT_SECRET not set in environment — using insecure fallback!');
            }
            response = await axios.post(targetUrl, {
                question: text,
                chatId,
                companyId,
                userName,
                platform: 'whatsapp',
                accountName: sessionId || "WhatsApp",
                audioInput: audioBase64,
                audioMimeType: audioMimeType || undefined,
                isVoiceNote: isVoiceNote,
                imageInput: imageBase64,
                imageMimeType: imageMimeType || undefined,
                videoInput: videoBase64,
                videoMimeType: videoMimeType || undefined,
                fileInput: fileBase64,
                fileMimeType: fileMimeType || undefined,
                fileName: fileName || undefined,
                history: [] // Worker fetches full history directly from D1 database (getChatHistory)
            }, { 
                headers: { 'Authorization': `Bearer ${process.env.BOT_SECRET || 'NERIVA_MASTER_SECRET_2024'}` },
                timeout: 90000  // 90s — media processing via Gemini needs more time
            });
        } catch (apiError) {
            const status = apiError.response?.status;
            const errBody = apiError.response?.data ? JSON.stringify(apiError.response.data) : apiError.message;
            logger.error(`[API_ERR] Status: ${status} | ${errBody} | ID: ${msgId}`);
            return;
        }

        // STEP 6: Validate AI Response
        const aiReply = response.data?.reply;
        const isPaused = response.data?.paused;
        const rawData = JSON.stringify(response.data).substring(0, 500);

        logger.info(`[AI_DEBUG] Raw AI Reply: "${aiReply}"`);

        if (isPaused) {
            logger.warn(`[PAUSED] Session is paused on worker side. No reply sent. ID: ${msgId} | Data: ${rawData}`);
            return;
        }

        if (!aiReply || aiReply.trim() === '') {
            logger.warn(`[NO_REPLY] AI returned empty/null reply. ID: ${msgId} | Data: ${rawData}`);
            return;
        }



        // Force sending AI reply back to the real phone number as a participant, bypassing @lid which drops messages
        let replyTarget = sender;
        let participantTag = null;
        if (sender.includes('@lid') && realPhone && realPhone !== sender.split('@')[0]) {
            logger.info(`[REPLY] Detected @lid. Using original sender but adding participant: ${realPhone}@s.whatsapp.net`);
            participantTag = `${realPhone}@s.whatsapp.net`;
        }

        // Append AI signature with single newline (double newline causes WhatsApp @lid silent drops)
        const botName = response.data?.botName || 'نيورا دعم فني';
        const finalReply = aiReply + `\n- ${botName}`;

        logger.info(`[REPLY] Sending reply to ${replyTarget}. ID: ${msgId}`);
        await sendMessage(sock, replyTarget, finalReply, participantTag, null);
        logger.info(`[DONE] ✅ Reply sent to ${replyTarget}. ID: ${msgId}`);

    } catch (error) {
        logger.error(`[CRASH] Unhandled error for ID ${msgId}: ${error.message}`);
        if (error.stack) logger.error(error.stack);
    }
}

module.exports = { handleIncomingMessage, extractText };



