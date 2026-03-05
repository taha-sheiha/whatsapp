const express = require('express');
const { connectToWhatsApp } = require('./connection');
const { handleIncomingMessage } = require('./listener');
const logger = require('./logger');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

let currentQR = null;
let currentPairingCode = null;
let botStatus = 'disconnected';
let waSock = null;

async function startServer() {
    logger.info('Starting Render Server for WhatsApp Bot...');

    // Start Express immediately so Render doesn't kill the process due to timeout
    app.use(express.json());
    app.listen(PORT, () => {
        logger.info(`Server is running on port ${PORT} 🚀`);
    });

    // Web Routes
    app.get('/', (req, res) => {
        const html = `
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Neura Bot Control</title>
                <style>
                    body { font-family: 'Cairo', sans-serif; background: #0f172a; color: white; text-align: center; padding: 20px; margin: 0; }
                    .card { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); padding: 40px 20px; border-radius: 30px; border: 1px solid rgba(255,255,255,0.1); display: inline-block; max-width: 500px; width: 90%; margin-top: 50px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
                    .status { font-weight: bold; margin: 20px 0; padding: 15px 25px; border-radius: 15px; display: inline-block; font-size: 1.1rem; }
                    .connected { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
                    .disconnected { background: rgba(220, 38, 38, 0.2); color: #f87171; border: 1px solid rgba(220, 38, 38, 0.3); }
                    img { background: white; padding: 15px; border-radius: 20px; margin-top: 25px; box-shadow: 0 0 30px rgba(56, 189, 248, 0.3); width: 250px; height: 250px; }
                    h1 { color: #38bdf8; font-size: 2rem; margin-bottom: 10px; }
                    p { color: #94a3b8; line-height: 1.6; }
                    .loader { border: 4px solid #f3f3f3; border-top: 4px solid #38bdf8; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite; margin: 20px auto; }
                    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    .code-box { background: #334155; padding: 15px; border-radius: 10px; font-size: 2rem; letter-spacing: 5px; font-family: monospace; display: inline-block; margin-top: 10px; }
                </style>
                <script>
                    const currentStatus = '${botStatus}';
                    if (currentStatus !== 'connected' && !${!!currentPairingCode}) {
                        setInterval(() => location.reload(), 15000);
                    }

                    function logout() {
                        if(confirm('هل أنت متأكد من رغبتك في مسح الجلسة والبدء من جديد؟')) {
                            fetch('/api/logout', { method: 'POST' })
                                .then(() => location.reload());
                        }
                    }

                    function resetPairing() {
                        fetch('/api/reset-pairing', { method: 'POST' })
                            .then(() => location.reload());
                    }

                    function requestPairingCode() {
                        const phone = document.getElementById('phoneInput').value;
                        if(!phone) return alert('برجاء إدخال رقم الهاتف مع مفتاح الدولة');
                        
                        const btn = document.getElementById('pairBtn');
                        btn.innerText = 'جاري الطلب...';
                        btn.disabled = true;

                        fetch('/api/pairing-code', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ phone })
                        }).then(r => r.json()).then(res => {
                            if(res.error) {
                                alert(res.error);
                                btn.innerText = 'طلب كود الربط';
                                btn.disabled = false;
                            } else {
                                location.reload();
                            }
                        }).catch(e => {
                            alert('حدث خطأ في الاتصال بالسيرفر');
                            btn.innerText = 'طلب كود الربط';
                            btn.disabled = false;
                        });
                    }
                </script>
            </head>
            <body>
                <div class="card">
                    <h1>Neura Bot Online 🌐</h1>
                    <p>منصة التحكم السحابية - Neriva</p>
                    
                    <div class="status ${botStatus === 'connected' ? 'connected' : 'disconnected'}">
                        ${botStatus === 'connected' ? 'الحالة: متصل بنجاح ✅' : 'الحالة: في انتظار الربط... ⏳'}
                    </div>

                    ${botStatus === 'connected' ? `
                        <div style="margin-top:20px;">
                            <p style="color: #4ade80;">البوت شغال دلوقتي وبيرد على الرسايل تلقائياً.</p>
                            <div style="font-size: 4rem;">🤖</div>
                            <button onclick="logout()" style="margin-top: 30px; padding: 10px 20px; background: transparent; border: 1px solid #f87171; border-radius: 5px; color: #f87171; cursor: pointer;">تسجيل الخروج (Logout)</button>
                        </div>
                    ` : currentPairingCode ? `
                        <div style="margin-top:20px;">
                            <p>أدخل هذا الكود في واتساب للربط:</p>
                            <div class="code-box">${currentPairingCode}</div>
                            <p style="font-size: 0.9em; color:#94a3b8; margin-top: 15px;">افتح واتساب > الأجهزة المرتبطة > ربط جهاز > الربط برقم هاتف بدلاً من ذلك</p>
                            <div style="margin-top: 25px;">
                                <button onclick="location.reload()" style="padding: 10px 20px; background: transparent; border: 1px solid #38bdf8; border-radius: 5px; color: #38bdf8; cursor: pointer; margin-left: 10px;">تحديث الحالة</button>
                                <button onclick="resetPairing()" style="padding: 10px 20px; background: transparent; border: 1px solid #f87171; border-radius: 5px; color: #f87171; cursor: pointer;">رجوع للخلف</button>
                            </div>
                        </div>
                    ` : currentQR ? `
                        <div style="margin-top:20px;">
                            <p>امسح الكود أو استخدم الربط برقم الهاتف (أفضل للسيرفرات):</p>
                            <img src="${currentQR}" alt="QR Code">
                            <br>
                            <button onclick="logout()" style="margin-top: 15px; padding: 10px 20px; background: transparent; border: 1px solid #f87171; border-radius: 5px; color: #f87171; cursor: pointer; font-size: 0.8rem;">مسح الجلسة تماماً (Reset)</button>
                            
                            <hr style="border-color: rgba(255,255,255,0.1); margin: 25px 0;">
                            
                            <input type="text" id="phoneInput" placeholder="رقمك بالصيغة الدولية (مثال: 2010...)" style="padding: 12px; width: 80%; border-radius: 8px; border: 1px solid #475569; background: #1e293b; color: white; margin-bottom: 10px; text-align: center; font-size: 1.1rem; direction: ltr;">
                            <br>
                            <button id="pairBtn" onclick="requestPairingCode()" style="padding: 12px 25px; background: #38bdf8; border: none; border-radius: 8px; color: #0f172a; cursor: pointer; font-weight: bold; font-size: 1.1rem; width: 85%;">طلب كود الربط</button>
                        </div>
                    ` : `
                        <div class="loader"></div>
                        <p>جاري توليد بيئة الربط، لحظات من فضلك...</p>
                    `}
                </div>
            </body>
            </html>
        `;
        res.send(html);
    });

    app.post('/api/pairing-code', async (req, res) => {
        const phone = req.body.phone;
        if (!phone) return res.status(400).json({ error: 'برجاء إدخال رقم الهاتف' });
        if (!waSock) return res.status(400).json({ error: 'السيرفر ما زال يتهيأ، جرب كمان ١٠ ثواني' });

        try {
            const cleanPhone = phone.replace(/[^0-9]/g, '');
            const code = await waSock.requestPairingCode(cleanPhone);
            currentPairingCode = code;
            logger.info(`Pairing code generated for ${cleanPhone}: ${code}`);
            res.json({ code });
        } catch (err) {
            logger.error('Error requesting pairing code:', err);
            res.status(500).json({ error: 'فشل في طلب الكود، تأكد من الرقم واكتبه بصيغة صحيحة (مثال 2010...)' });
        }
    });

    app.post('/api/reset-pairing', (req, res) => {
        currentPairingCode = null;
        res.json({ success: true });
    });

    app.post('/api/logout', async (req, res) => {
        try {
            logger.warn('Manual logout requested via Web UI');
            // We just send an empty payload to the worker to effectively "clear" it for this ID
            await axios.post(WORKER_SESSION_URL,
                JSON.stringify({ id: 'neura-v3', data: { creds: null, keys: {} } }),
                { headers: { 'Content-Type': 'application/json' } }
            );
            currentPairingCode = null;
            currentQR = null;
            botStatus = 'disconnected';
            res.json({ success: true });
            // The bot will naturally reconnect and find the "empty" session in ~5 seconds
        } catch (err) {
            res.status(500).json({ error: 'فشل في مسح الجلسة' });
        }
    });

    app.get('/ping', (req, res) => {
        res.send('pong');
    });

    // Start WhatsApp Bot in the background
    try {
        waSock = await connectToWhatsApp(
            handleIncomingMessage,
            (update) => {
                if (update.type === 'qr') {
                    currentQR = update.data;
                    botStatus = 'disconnected';
                } else if (update.type === 'status') {
                    botStatus = update.data;
                    if (update.data === 'connected') currentQR = null;
                }
            }
        );
    } catch (botErr) {
        logger.error(`WhatsApp Bot Initialization Failure: ${botErr.message || botErr}`);
        if (botErr.stack) logger.error(botErr.stack);
    }
}

startServer().catch(err => {
    logger.error('Unhandled Server Error:', err.message || err);
    if (err.stack) logger.error(err.stack);
});


