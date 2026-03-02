const qrcodeLib = require('qrcode');
const { getRemoteAuthState } = require('./session_remote');
const logger = require('./logger');

async function connectToWhatsApp(onMessage, onUpdate) {
    try {
        const baileys = await import('@whiskeysockets/baileys');
        const makeWASocket = baileys.default || baileys.makeWASocket;
        const { DisconnectReason, fetchLatestBaileysVersion } = baileys;

        const { state, saveCreds } = await getRemoteAuthState();
        const { version } = await fetchLatestBaileysVersion();

        let usePairingCode = false;

        const sock = makeWASocket({
            version,
            auth: state,
            logger: logger.child({ module: 'baileys', level: 'silent' }), // reduce noise
            browser: ['NeuraBot', 'Chrome', '1.0.0'],
            printQRInTerminal: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                logger.info('QR Code received. Try scanning, or wait for Pairing Code fallback.');
                if (onUpdate) {
                    try {
                        const qrImage = await qrcodeLib.toDataURL(qr);
                        onUpdate({ type: 'qr', data: qrImage });
                    } catch (qrErr) {
                        logger.error('Error generating QR Image:', qrErr);
                    }
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect.error?.output?.statusCode;
                const isLoggedOut = (statusCode === DisconnectReason.loggedOut || statusCode === 401);

                logger.error(`Connection closed. Status: ${statusCode}. Reason:`, lastDisconnect.error);

                if (onUpdate) {
                    onUpdate({ type: 'status', data: 'disconnected' });
                }

                if (onUpdate) {
                    onUpdate({ type: 'status', data: 'disconnected' });
                }

                const delay = isLoggedOut ? 10000 : 5000;
                logger.info(`Reconnecting in ${delay / 1000} seconds...`);
                setTimeout(() => connectToWhatsApp(onMessage, onUpdate), delay);

                if (isLoggedOut) {
                    logger.warn('Session is invalid or logged out. Waiting for re-link.');
                }
            } else if (connection === 'open') {
                logger.info('WhatsApp connection established successfully! ✅');
                if (onUpdate) {
                    onUpdate({ type: 'status', data: 'connected' });
                }
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type === 'notify') {
                for (const msg of messages) {
                    await onMessage(sock, msg);
                }
            }
        });

        return sock;
    } catch (err) {
        logger.error(`Error in connectToWhatsApp setup: ${err.message || err}`);
        if (err.stack) logger.error(err.stack);
        throw err;
    }
}

module.exports = { connectToWhatsApp };
