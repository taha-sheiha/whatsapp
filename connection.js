const qrcodeLib = require('qrcode');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

async function connectToWhatsApp(onMessage, onUpdate, companyId, sessionId = 'neura-v3') {
    try {
        const baileys = await import('@whiskeysockets/baileys');
        const makeWASocket = baileys.default || baileys.makeWASocket;
        const { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } = baileys;

        const sessionDir = path.join(__dirname, 'sessions', `${companyId}-${sessionId}`);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            logger: logger.child({ module: 'baileys', level: 'silent' }),
            browser: ['NeuraBot', 'Chrome', '1.0.0'],
            printQRInTerminal: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                logger.info(`[${sessionId}] QR Code received.`);
                if (onUpdate) {
                    try {
                        const qrImage = await qrcodeLib.toDataURL(qr);
                        onUpdate({ type: 'qr', data: qrImage, session: sessionId });
                    } catch (qrErr) {
                        logger.error(`[${sessionId}] Error generating QR:`, qrErr);
                    }
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const isLoggedOut = (statusCode === DisconnectReason.loggedOut || statusCode === 401);

                logger.error(`[${sessionId}] Connection closed. Status: ${statusCode}`);
                if (onUpdate) onUpdate({ type: 'status', data: 'disconnected', session: sessionId });

                const delay = isLoggedOut ? 15000 : 5000;
                logger.info(`[${sessionId}] Reconnecting in ${delay / 1000}s...`);
                setTimeout(() => connectToWhatsApp(onMessage, onUpdate, companyId, sessionId), delay);

            } else if (connection === 'open') {
                logger.info(`[${sessionId}] Connection established ✅`);
                if (onUpdate) onUpdate({ type: 'status', data: 'connected', session: sessionId });
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify' && type !== 'append') return;
            for (const msg of messages) {
                onMessage(sock, msg, sessionId).catch(err => {
                    logger.error(`[${sessionId}] Error processing message ${msg.key?.id}:`, err);
                });
            }
        });

        return sock;
    } catch (err) {
        logger.error(`[${sessionId}] Error in connectToWhatsApp: ${err.message || err}`);
        if (err.stack) logger.error(err.stack);
        throw err;
    }
}

module.exports = { connectToWhatsApp };
