import logger from './logger.js';

const messageQueue = [];
let isProcessing = false;

export async function sendMessage(sock, jid, text) {
    if (!text || text.trim() === '') return;

    messageQueue.push({ sock, jid, text });
    await processQueue();
}

async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;
    isProcessing = true;

    const { sock, jid, text } = messageQueue.shift();

    try {
        await sock.sendMessage(jid, { text });
        logger.info(`Message sent to ${jid}`);
    } catch (error) {
        logger.error(`Failed to send message to ${jid}:`, error);
    }

    isProcessing = false;
    processQueue();
}
