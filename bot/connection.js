const qrcodeLib = require('qrcode');
const { getRemoteAuthState } = require('./session_remote');
const logger = require('./logger');

async function connectToWhatsApp(onMessage, onUpdate) {
    logger.info('Initializing WhatsApp connection...');
    try {
        const baileys = await import('@whiskeysockets/baileys');
        const makeWASocket = baileys.default || baileys.makeWASocket;
        const { DisconnectReason, fetchLatestBaileysVersion } = baileys;

        logger.info('Loading remote auth state...');
        const { state, saveCreds } = await getRemoteAuthState();

        logger.info('Fetching latest Baileys version...');
        const { version } = await fetchLatestBaileysVersion();
        logger.info(`Using Baileys version: ${version}`);

        const sock = makeWASocket({
            version,
            auth: state,
            logger: logger.child({ module: 'baileys' }),
            browser: ['NeuraBot', 'Chrome', '1.0.0']
        });

        sock.ev.on('creds.update', async () => {
            logger.info('Credentials updated, saving to remote storage...');
            await saveCreds();
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                logger.info('QR Code received from Baileys! Generating image...');
                if (onUpdate) {
                    try {
                        const qrImage = await qrcodeLib.toDataURL(qr);
                        logger.info('QR Image created successfully ✅');
                        onUpdate({ type: 'qr', data: qrImage });
                    } catch (qrErr) {
                        logger.error(`Error generating QR Image: ${qrErr.message}`);
                    }
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect.error?.output?.statusCode;
                const isLoggedOut = (statusCode === DisconnectReason.loggedOut || statusCode === 401);

                logger.error(`Connection closed. Status: ${statusCode}. Reason: ${lastDisconnect.error?.message || 'Unknown'}`);

                if (onUpdate) {
                    onUpdate({ type: 'status', data: 'disconnected' });
                }

                if (!isLoggedOut) {
                    logger.info('Reconnecting in 5 seconds...');
                    setTimeout(() => connectToWhatsApp(onMessage, onUpdate), 5000);
                } else {
                    logger.warn('Session is invalid or logged out. Please clear session and re-link.');
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
