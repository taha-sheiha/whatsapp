const axios = require('axios');
const logger = require('./logger');

// Remote Session Config (via Cloudflare Worker)
const WORKER_SESSION_URL = process.env.WORKER_SESSION_URL || 'https://ai.tahasheiha.workers.dev/bot-session';

async function getRemoteAuthState(sessionId = 'default') {
    const { proto, initAuthCreds, BufferJSON } = await import('@whiskeysockets/baileys');

    // 1. Fetch from Remote DB
    let remoteData = null;
    try {
        const res = await axios.get(`${WORKER_SESSION_URL}?id=${sessionId}`, {
            transformResponse: [data => data] // Keep as raw string
        });
        const parsed = JSON.parse(res.data, BufferJSON.reviver);
        remoteData = parsed.data;
        if (remoteData) logger.info('Remote session loaded from Cloudflare D1 ☁️');
    } catch (e) {
        logger.error('Failed to fetch remote session:', e.message);
    }

    // 2. Initialize State
    let creds = remoteData?.creds || initAuthCreds();

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
                    // Specific key saving could be added here if needed
                }
            }
        },
        saveCreds: async () => {
            try {
                // Fetch full current state to merge
                const currentRes = await axios.get(`${WORKER_SESSION_URL}?id=${sessionId}`, {
                    transformResponse: [data => data]
                });
                const currentParsed = JSON.parse(currentRes.data || '{}', BufferJSON.reviver);
                const fullData = currentParsed.data || { creds: {}, keys: {} };
                fullData.creds = creds;

                const payload = JSON.stringify({ id: sessionId, data: fullData }, BufferJSON.replacer);

                await axios.post(WORKER_SESSION_URL, payload, {
                    headers: { 'Content-Type': 'application/json' }
                });
                logger.info('Remote session updated in Cloudflare D1 ✅');
            } catch (e) {
                logger.error('Failed to save remote session:', e.message);
            }
        }
    };
}

module.exports = { getRemoteAuthState };
