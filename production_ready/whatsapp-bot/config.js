const config = {
    // Neura AI Settings
    ai: {
        apiUrl: 'https://ai.tahasheiha.workers.dev/chat',
        sessionUrl: 'https://ai.tahasheiha.workers.dev/bot-session',
        sessionId: 'neura-wa-01'
    },

    // WhatsApp Settings (Baileys)
    whatsapp: {
        enabled: true,
        botName: 'NeuraBot',
        autoReply: true
    },

    // 🚀 Future Integrations!
    facebook: {
        enabled: false,
        pageId: '',
        accessToken: ''
    },
    instagram: {
        enabled: false,
        businessAccountId: '',
        accessToken: ''
    }
};

module.exports = config;
