const logger = require('./logger');

const messageQueue = [];
let isProcessing = false;

async function sendMessage(sock, jid, text) {
    if (!text || text.trim() === '') return;
    messageQueue.push({ sock, jid, text });
    logger.debug(`[Sender] Queued message for ${jid}. Queue size: ${messageQueue.length}`);
    if (!isProcessing) processQueue();
}

async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;
    isProcessing = true;

    const { sock, jid, text } = messageQueue.shift();

    try {
        logger.info(`[Sender] Sending to ${jid}...`);
        await sock.sendMessage(jid, { text });
        logger.info(`[Sender] ✅ Sent to ${jid}`);
    } catch (error) {
        logger.error(`[Sender] ❌ Failed to send to ${jid}: ${error.message}`);
    } finally {
        // CRITICAL: Always release the lock, even on error
        isProcessing = false;
        if (messageQueue.length > 0) {
            // Small delay to avoid hammering WA servers
            setTimeout(processQueue, 500);
        }
    }
}

module.exports = { sendMessage };
