const qrcodeLib = require('qrcode');
const logger = require('./logger');
const { getRemoteAuthState } = require('./session_remote');

async function connectToWhatsApp(onMessage, onUpdate, companyId, sessionId = 'neura-v3') {
    try {
        const baileys = await import('@whiskeysockets/baileys');
        const makeWASocket = baileys.default || baileys.makeWASocket;
        const { DisconnectReason, fetchLatestBaileysVersion, Browsers } = baileys;

        const { state, saveCreds } = await getRemoteAuthState(companyId, sessionId);
        
        let { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({ 
            version: [2, 3000, 1015901307], 
            isLatest: false 
        }));
        
        logger.info(`[${sessionId}] Starting WhatsApp with version [${version.join('.')}] (Latest: ${isLatest})`);

        const sock = makeWASocket({
            version,
            auth: state,
            logger: logger.child({ module: 'baileys', level: 'silent' }),
            browser: Browsers.macOS('Desktop'),
            printQRInTerminal: false,
            markOnlineOnConnect: false
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
                const reason = lastDisconnect?.error?.message || 'Unknown reason';
                const isLoggedOut = (statusCode === DisconnectReason.loggedOut || statusCode === 401);
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                logger.error(`[${sessionId}] Connection closed. Status: ${statusCode}, Reason: ${reason}`);
                if (onUpdate) onUpdate({ type: 'status', data: isLoggedOut ? 'disconnected' : 'reconnecting', session: sessionId });

                if (shouldReconnect) {
                    const delay = statusCode === DisconnectReason.restartRequired ? 1000 : 5000;
                    logger.info(`[${sessionId}] Reconnecting automatically in ${delay / 1000}s...`);
                    setTimeout(() => connectToWhatsApp(onMessage, onUpdate, companyId, sessionId), delay);
                } else {
                    logger.warn(`[${sessionId}] Session logged out. Manual intervention required.`);
                }

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
