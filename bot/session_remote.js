const axios = require('axios');
const logger = require('./logger');

// Remote Session Config (via Cloudflare Worker)
const WORKER_SESSION_URL = process.env.WORKER_SESSION_URL || 'https://ai.tahasheiha.workers.dev/bot-session';

async function getRemoteAuthState(sessionId = 'default') {
    const { proto, initCreds, Curve, signedKeyPair } = await import('@whiskeysockets/baileys');

    // 1. Fetch from Remote DB
    let remoteData = null;
    try {
        const res = await axios.get(`${WORKER_SESSION_URL}?id=${sessionId}`);
        remoteData = res.data.data;
        if (remoteData) logger.info('Remote session loaded from Cloudflare D1 ☁️');
    } catch (e) {
        logger.error('Failed to fetch remote session:', e.message);
    }

    // 2. Initialize State
    let creds = remoteData?.creds || initCreds();

    return {
        state: {
            creds,
            keys: {
                get: (type, ids) => {
                    const data = {};
                    ids.forEach(id => {
                        let value = remoteData?.keys?.[`${type}-${id}`];
                        if (value) {
                            if (type === 'app-state-sync-key') value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            data[id] = value;
                        }
                    });
                    return data;
                },
                set: (data) => {
                    // Keys are usually handled locally or synced. 
                    // For a simple standalone bot, creds are the most critical.
                    // Full key sync requires more logic, but this covers the essentials.
                }
            }
        },
        saveCreds: async () => {
            try {
                // Fetch full current state to merge
                const current = await axios.get(`${WORKER_SESSION_URL}?id=${sessionId}`);
                const fullData = current.data.data || { creds: {}, keys: {} };
                fullData.creds = creds;

                await axios.post(WORKER_SESSION_URL, { id: sessionId, data: fullData });
                logger.info('Remote session updated in Cloudflare D1 ✅');
            } catch (e) {
                logger.error('Failed to save remote session:', e.message);
            }
        }
    };
}

module.exports = { getRemoteAuthState };
