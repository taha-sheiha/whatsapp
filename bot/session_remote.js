const axios = require('axios');
const logger = require('./logger');

// Remote Session Config (via Cloudflare Worker)
const WORKER_SESSION_URL = process.env.WORKER_SESSION_URL || 'https://ai.tahasheiha.workers.dev/bot-session';

async function getRemoteAuthState(sessionId = 'default') {
    logger.info(`Fetching remote session for ${sessionId}...`);
    const baileys = require('@whiskeysockets/baileys');
    const { proto, initCreds } = baileys;

    // 1. Fetch from Remote DB
    let remoteData = null;
    try {
        const res = await axios.get(`${WORKER_SESSION_URL}?id=${sessionId}`, { timeout: 10000 });
        remoteData = res.data.data;
        if (remoteData) {
            logger.info('Remote session loaded from Cloudflare D1 ☁️');
        } else {
            logger.info('No prior session found, starting fresh.');
        }
    } catch (e) {
        logger.error(`Failed to fetch remote session: ${e.message}`);
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
                    // Optimized key sync
                }
            }
        },
        saveCreds: async () => {
            try {
                const current = await axios.get(`${WORKER_SESSION_URL}?id=${sessionId}`, { timeout: 10000 });
                const fullData = current.data.data || { creds: {}, keys: {} };
                fullData.creds = creds;

                await axios.post(WORKER_SESSION_URL, { id: sessionId, data: fullData }, { timeout: 10000 });
                logger.info('Remote session updated in Cloudflare D1 ✅');
            } catch (e) {
                logger.error(`Failed to save remote session: ${e.message}`);
            }
        }
    };
}

module.exports = { getRemoteAuthState };
