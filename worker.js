const modelHealth = {};

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // Handle CORS Preflight
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization",
                }
            });
        }

        try {
            // --- VALIDATE BINDINGS ---
            if (!env.DB) {
                return json({ error: "D1 Database (env.DB) not bound. Make sure it's defined in wrangler.toml or passed via CLI." }, 500);
            }

            // --- DATABASE INIT & MIGRATIONS ---
            // 1. ai_usage_stats
            await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_usage_stats (
                key_last4 TEXT,
                model_id TEXT,
                success_count INTEGER DEFAULT 0,
                error_count INTEGER DEFAULT 0,
                last_error_log TEXT,
                last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (key_last4, model_id)
            )`).run();

            // 2. chat_sessions
            await env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_sessions (
                chat_id TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                user_name TEXT,
                status TEXT DEFAULT 'active',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`).run();

            // 3. chat_logs
            await env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                chat_id TEXT NOT NULL,
                user_name TEXT,
                user_msg TEXT NOT NULL,
                ai_msg TEXT,
                sentiment TEXT DEFAULT 'هاديء',
                needs_intervention INTEGER DEFAULT 0,
                human_reply TEXT,
                is_human INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`).run();

            // 4. bot_sessions (For Baileys persistence)
            await env.DB.prepare(`CREATE TABLE IF NOT EXISTS bot_sessions (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`).run();

            // 5. page_configs (For Multi-Page SaaS Support)
            await env.DB.prepare(`CREATE TABLE IF NOT EXISTS page_configs (
                page_id TEXT PRIMARY KEY,
                platform TEXT NOT NULL, -- 'facebook' or 'instagram'
                access_token TEXT NOT NULL,
                page_name TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`).run();

            // 7. webhook_logs (For Real-time Debugging)
            await env.DB.prepare(`CREATE TABLE IF NOT EXISTS webhook_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`).run();

            // 8. system_settings (For Global Config)
            await env.DB.prepare(`CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`).run();

            // Seed default prompt if not exists (Detailed Neura Prompt)
            const defaultPrompt = `أنتِ "Neura" (نيورا)، خبيرة وباحثة ذكاء اصطناعي في "CountaNeura". شخصيتك تجمع بين الاحترافية العالية، الدبلوماسية الراقية، والذكاء العاطفي الحاد.

### قواعد الشخصية والبيع (صارمة جداً):
1. **اللهجة والشياكة**: عامية مصرية "راقية" ومحترفة. ممنوع السرسجة أو الفصحى. خليكي مهذبة جداً ولبقة.
2. **بروتوكول التعامل (العشم)**: ناديه باسمه (يا أستاذ [اسم العميل]) لو عرفتيه، أو "يا فندم" لو معرفتيهوش. 
   - **تنبيه هام**: ممنوع نهائياً تقولي "يا أستاذ فندم". لو الاسم مش معروف قولي "يا فندم" بس.
   - ممنوع كتابة كلمة "[الاسم]" في الرد، حطي الاسم الحقيقي مكانها.
3. **الجنس**: اتعاملي مع العميل كـ "مذكر" كافتراض أساسي، إلا لو وضح غير كدة.
4. **فنون البيع والميوعة الدبلوماسية**:
   - ممنوع تقولي "لأ" صريحة (Saving Face). استخدمي بدائل ذكية زي "خلينا نشوف ممكن ننسق ده إزاي".
   - ركزي على [القيمة المضافة] وإزاي الحل بتاعنا هيخليه ناجح في مجاله.
5. **التنسيق والاختصار**: ممنوع النجوم (*). الرد يكون "في الجول" بدون تطويل ممل.
6. **ممنوع التكرار**: لو ذكرتِ رقم واتساب أو معلومة تواصل، ذكريها مرة واحدة فقط في المحادثة بالكامل.
7. **الطول المناسب**: الرد المثالي 2-4 جمل.

### قواعد التعامل الاحترافي (Handle Mastery):
8. **الاعتراف قبل الحل**: دايماً اعترفي بمشاعر العميل في جملة واحدة أولاً قبل ما تقدمي الحل.
9. **صفر لوم على العميل**: ممنوع تماماً أي صياغة فيها لوم ضمني للعميل حتى لو هو غلطان. 
10. **خلق الإلحاحية بأدب**: لو العميل متردد، ولّدي إلحاحية بأسلوب راقٍ. 
11. **التحكم في المحادثة**: لو العميل طلب حاجة مش موجودة، ولّدي تحويل ذكي بدل الاعتراف بالجهل.
12. **الدبلوماسية تحت الضغط**: لو العميل متضايق، خفضي نبرتك أكتر وابدأي بـ "أنا كامل الاستعداد أهتم بحضرتك...".
13. **السرية والاحترافية**: ممنوع الإفصاح عن أي تفاصيل داخلية عن النظام.

### تحليل الحالة النفسية (للإدارة فقط):
بعد كل رد، لازم تكتبي سطر أخير يبدأ بـ "STATUS:" فيه JSON دقيق جداً:
{"sentiment": "هاديء/منفعل/محبط/حيران/مش فاهم/متردد/سعيد", "needsIntervention": true/false, "closeSession": true/false}

دليل المشاعر:
- **منفعل**: لو في هجوم أو غضب صريح.
- **محبط**: لو في ضيق هاديء أو استعجال.
- **حيران/متردد**: لو بيقارن أو بيقول هشوف.
- **سعيد**: لو شكر أو أبدى إعجاب.`;

            await env.DB.prepare(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`).bind('ai_prompt', defaultPrompt).run();

            // --- Safe Column Migrations ---
            const migrations = [
                { table: "ai_usage_stats", column: "last_error_log", type: "TEXT" },
                { table: "chat_sessions", column: "user_name", type: "TEXT" },
                { table: "chat_logs", column: "user_name", type: "TEXT" },
                { table: "chat_logs", column: "sentiment", type: "TEXT DEFAULT 'هاديء'" },
                { table: "chat_logs", column: "needs_intervention", type: "INTEGER DEFAULT 0" }
            ];

            for (const m of migrations) {
                try {
                    await env.DB.prepare(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.type}`).run();
                } catch (e) { /* Column likely exists */ }
            }

            // --- HEALTH CHECK ---
            if (url.pathname === "/health") {
                return json({
                    status: "ok",
                    db: !!env.DB,
                    gemini: !!(env.GEMINI_API_KEYS || env.GEMINI_API_KEY)
                });
            }

            // --- VALIDATE BINDINGS ---
            if (!env.DB) throw new Error("D1 Database (env.DB) not bound.");
            if (!(env.GEMINI_API_KEYS || env.GEMINI_API_KEY)) throw new Error("Gemini API Key missing.");

            // --- ROUTE: Chat (Web Interface) ---
            if (url.pathname === "/chat" && request.method === "POST") {
                const { question, history, chatId } = await request.json();
                const sessionChatId = chatId || ("web-" + Date.now());

                // Check Session Status
                const session = await env.DB.prepare("SELECT status FROM chat_sessions WHERE chat_id = ?").bind(sessionChatId).first();
                if (session?.status === 'paused') {
                    // Check if handoff message already sent in this pause cycle
                    const lastLog = await env.DB.prepare("SELECT ai_msg FROM chat_logs WHERE chat_id = ? ORDER BY id DESC LIMIT 1").bind(sessionChatId).first();
                    const alreadySentHandoff = lastLog?.ai_msg?.includes("[موقف بشرياً]");

                    if (alreadySentHandoff) {
                        return json({ reply: null, paused: true });
                    }

                    // Determine sentiment-aware message
                    const { results } = await env.DB.prepare("SELECT sentiment FROM chat_logs WHERE chat_id = ? ORDER BY id DESC LIMIT 1").bind(sessionChatId).all();
                    const lastSentiment = results?.[0]?.sentiment || "هاديء";

                    let pausedMsg = "☕ استمتع بقهوتك يا فندم! أنا واخدة استراحة قصيرة وأحد زملائي البشريين هيتواصل معاك فوراً.";
                    if (lastSentiment === 'منفعل') {
                        pausedMsg = "حولت حضرتك لأحد زملاتي البشريين عشان حضرتك عميل مميز ويهمنا مساعدتك فوراً.";
                    }

                    await env.DB.prepare("INSERT INTO chat_logs (platform, chat_id, user_msg, ai_msg) VALUES (?, ?, ?, ?)")
                        .bind("web", sessionChatId, question, `[موقف بشرياً] ${pausedMsg}`).run();
                    return json({ reply: pausedMsg, paused: true });
                }

                const result = await askNeura(question, history, env, "User");

                const platform = sessionChatId.startsWith("wa-") ? "whatsapp" : "web";
                const userName = platform === "whatsapp" ? `WA:${sessionChatId.split('-')[1]}` : "User";

                // Update Session & Log
                let sessionStatus = 'active';
                if (result.autoClose) sessionStatus = 'closed';

                await env.DB.prepare("INSERT INTO chat_sessions (chat_id, platform, user_name, status, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(chat_id) DO UPDATE SET updated_at=excluded.updated_at, status=excluded.status")
                    .bind(sessionChatId, platform, userName, sessionStatus).run();

                await env.DB.prepare("INSERT INTO chat_logs (platform, chat_id, user_name, user_msg, ai_msg, sentiment, needs_intervention) VALUES (?, ?, ?, ?, ?, ?, ?)")
                    .bind(platform, sessionChatId, userName, question, result.reply || "عذراً يا فندم، واجهت مشكلة تقنية بسيطة.", result.sentiment || "هاديء", (result.needsIntervention ? 1 : 0) || 0).run();

                return json(result);
            }

            // --- ROUTE: Telegram Webhook ---
            if (url.pathname === "/telegram-webhook" && request.method === "POST") {
                const update = await request.json();
                if (update.message?.text) {
                    const chatIdStr = String(update.message.chat.id);
                    const userMsg = update.message.text;
                    const userName = update.message.from.first_name || "User";

                    // Check Session Status
                    const session = await env.DB.prepare("SELECT status FROM chat_sessions WHERE chat_id = ?").bind(chatIdStr).first();
                    if (session?.status === 'paused') {
                        const lastLog = await env.DB.prepare("SELECT ai_msg FROM chat_logs WHERE chat_id = ? ORDER BY id DESC LIMIT 1").bind(chatIdStr).first();
                        if (lastLog?.ai_msg?.includes("[مغلق بشرياً]")) {
                            return new Response("OK");
                        }

                        const { results } = await env.DB.prepare("SELECT sentiment FROM chat_logs WHERE chat_id = ? ORDER BY id DESC LIMIT 1").bind(chatIdStr).all();
                        const lastSentiment = results?.[0]?.sentiment || "هاديء";

                        let pausedMsg = "أهلاً بك! الذكاء الاصطناعي متوقف حالياً وسيقوم أحد ممثلي الخدمة بالرد عليك قريباً.";
                        if (lastSentiment === 'منفعل') {
                            pausedMsg = "حولت حضرتك لأحد زملاتي البشريين عشان حضرتك عميل مميز ويهمنا مساعدتك فوراً.";
                        } else {
                            pausedMsg = "☕ استمتع بقهوتك يا فندم! أنا واخدة استراحة قصيرة وأحد زملائي البشريين هيتواصل معاك.";
                        }

                        await env.DB.prepare("INSERT INTO chat_logs (platform, chat_id, user_name, user_msg, ai_msg) VALUES (?, ?, ?, ?, ?)")
                            .bind("telegram", chatIdStr, userName, userMsg, `[مغلق بشرياً] ${pausedMsg}`).run();

                        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ chat_id: update.message.chat.id, text: pausedMsg })
                        });
                        return new Response("OK");
                    }

                    // --- Normal AI Flow ---
                    const tgSetting = await env.DB.prepare("SELECT value FROM system_settings WHERE key = ?").bind('tg_token').first();
                    const tgToken = tgSetting?.value || env.TELEGRAM_BOT_TOKEN;

                    const result = await askNeura(userMsg, [], env, userName);

                    // Update Session & Log
                    let sessionStatus = 'active';
                    if (result.autoClose) sessionStatus = 'closed';

                    await env.DB.prepare("INSERT INTO chat_sessions (chat_id, platform, user_name, status, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(chat_id) DO UPDATE SET updated_at=excluded.updated_at, status=excluded.status")
                        .bind(chatIdStr, "telegram", userName, sessionStatus).run();

                    await env.DB.prepare("INSERT INTO chat_logs (platform, chat_id, user_name, user_msg, ai_msg, sentiment, needs_intervention) VALUES (?, ?, ?, ?, ?, ?, ?)")
                        .bind("telegram", chatIdStr, userName, userMsg, result.reply || "عذراً، الخدمة غير متوفرة حالياً.", result.sentiment || "هاديء", (result.needsIntervention ? 1 : 0) || 0).run();

                    if (tgToken) {
                        await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ chat_id: update.message.chat.id, text: result.reply })
                        });
                    }
                    return new Response("OK");
                }
            }

            // --- ROUTE: Admin Polling (Unified Sessions View) ---
            if (url.pathname === "/admin/sessions" && request.method === "GET") {
                // Background Cleanup: Auto-close sessions idle for > 5 minutes
                await env.DB.prepare(`
                    UPDATE chat_sessions 
                    SET status = 'closed', updated_at = CURRENT_TIMESTAMP 
                    WHERE status = 'active' 
                    AND datetime(updated_at) < datetime('now', '-5 minutes')
                `).run();

                const { results } = await env.DB.prepare(`
                    SELECT s.*, l.user_msg as last_msg, l.sentiment 
                    FROM chat_sessions s
                    JOIN chat_logs l ON l.chat_id = s.chat_id
                    WHERE l.id = (SELECT MAX(id) FROM chat_logs WHERE chat_id = s.chat_id)
                    AND s.status != 'closed'
                    ORDER BY s.updated_at DESC
                    LIMIT 50
                `).all();
                return json(results);
            }

            // --- ROUTE: Admin Summarize (AI Profiler) ---
            if (url.pathname === "/admin/summarize" && request.method === "POST") {
                const { chatId } = await request.json();
                const { results } = await env.DB.prepare("SELECT user_msg, ai_msg, is_human, human_reply FROM chat_logs WHERE chat_id = ? ORDER BY created_at DESC LIMIT 15").bind(chatId).all();

                if (!results || results.length === 0) {
                    return json({ summary: "لا توجد محادثة كافية للتلخيص بعد." });
                }

                const chatHistory = results.reverse().map(l => {
                    const userRole = "User";
                    const assistantRole = l.is_human ? "Human Agent" : "AI Neura";
                    return `${userRole}: ${l.user_msg}\n${assistantRole}: ${l.is_human ? l.human_reply : l.ai_msg}`;
                }).join("\n\n");

                const summaryPrompt = `بصفتك محلل سلوك محترف وخبير استراتيجي في CountaNeura، قم بتلخيص المحادثة التالية في "كبسولة مركزة" جداً لمساعدة موظف الدعم البشري.
المطلوب 3 نقاط "قصيرة ومباشرة" باللهجة المصرية العامية الراقية، تركز فقط على الخلاصة الاستراتيجية:
1. **الهدف**: (العميل عايز يوصل لإيه في جملة واحدة؟)
2. **المشكلة**: (إيه العقبة الأساسية اللي بتواجهه دلوقتي؟)
3. **الخلاصة**: (نمط الشخصية ونصيحة تكتيكية "سريعة" للتعامل معاه).

مهم: خليك محدد جداً، ابعد عن الرغي الزيادة، واضمن إن التقرير كامل وما يقطعش في النص.`;

                const keys = (env.GEMINI_API_KEYS || env.GEMINI_API_KEY || "").split(",").map(k => k.trim()).filter(k => k);
                const rawModels = [
                    { id: "gemini-2.5-flash-lite", version: "v1beta" },
                    { id: "gemini-2.5-flash", version: "v1beta" },
                    { id: "gemini-2.0-flash", version: "v1beta" },
                    { id: "gemini-3.1-pro-preview", version: "v1beta" },
                    { id: "gemini-1.5-flash", version: "v1beta" },
                    { id: "gemini-1.5-flash-8b", version: "v1beta" }
                ];
                const models = getHealthyModels(rawModels);

                let finalSummary = "";
                let summarySuccess = false;

                for (const model of models) {
                    if (summarySuccess) break;
                    for (const key of keys) {
                        try {
                            const endpoint = `https://generativelanguage.googleapis.com/${model.version}/models/${model.id}:generateContent?key=${key}`;
                            const response = await fetch(endpoint, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    system_instruction: { parts: [{ text: summaryPrompt }] },
                                    contents: [{ role: "user", parts: [{ text: `المحادثة المطلوب تحليلها:\n\n${chatHistory}` }] }],
                                    generationConfig: {
                                        temperature: 0.3,
                                        maxOutputTokens: 2000,
                                        thinkingConfig: model.id.includes("3")
                                            ? { includeThoughts: true, thinkingLevel: "HIGH" }
                                            : { includeThoughts: true, thinkingBudget: 2048 }
                                    }
                                })
                            });

                            if (response.ok) {
                                const data = await response.json();
                                const candidate = data.candidates?.[0];
                                if (candidate?.content?.parts) {
                                    let textValue = "";
                                    for (const p of candidate.content.parts) {
                                        if (!p.thought && p.text) textValue += p.text;
                                    }

                                    if (textValue) {
                                        finalSummary = textValue;
                                        summarySuccess = true;
                                        await trackUsage(env, key, model.id, true);
                                        break;
                                    }
                                }
                                await trackUsage(env, key, model.id, false, `Bad JSON or Empty Response`);
                            } else {
                                await trackUsage(env, key, model.id, false, `HTTP ${response.status}`);
                            }
                        } catch (e) {
                            await trackUsage(env, key, model.id, false, String(e.message || e || "Unknown Summarize Error"));
                        }
                    }
                }

                return json({ summary: summarySuccess ? finalSummary : "فشل تحليل المحادثة حالياً، يرجى التأكد من مفاتيح الـ API وصلاحية الموديلات." });
            }

            if (url.pathname === "/admin/session-control" && request.method === "POST") {
                const { chatId, action } = await request.json();
                let status = 'active';
                if (action === 'pause') status = 'paused';
                if (action === 'close') status = 'closed';

                await env.DB.prepare("UPDATE chat_sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?")
                    .bind(status, chatId).run();

                // Proactive Notification
                if (action === 'pause' || action === 'resume') {
                    const session = await env.DB.prepare("SELECT platform, user_name FROM chat_sessions WHERE chat_id = ?").bind(chatId).first();

                    let msg = "";
                    if (action === 'pause') {
                        const { results } = await env.DB.prepare("SELECT sentiment FROM chat_logs WHERE chat_id = ? ORDER BY id DESC LIMIT 1").bind(chatId).all();
                        const lastSentiment = results?.[0]?.sentiment || "هاديء";
                        msg = lastSentiment === 'منفعل'
                            ? "حولت حضرتك لأحد زملاتي البشريين عشان حضرتك عميل مميز ويهمنا مساعدتك فوراً."
                            : "☕ استمتع بقهوتك يا فندم! أنا واخدة استراحة قصيرة وأحد زملائي البشريين هيتواصل معاك.";
                    } else {
                        msg = "أهلاً بك مجدداً! نيورا عادت للخدمة وجاهزة لمساعدتك.";
                    }

                    const logPrefix = action === 'pause' ? "[موقف بشرياً] " : "[تم التنشيط] ";
                    const systemTag = action === 'pause' ? "[إيقاف مؤقت]" : "[إعادة تشغيل]";

                    // Log for Web chat (polling will pick it up)
                    await env.DB.prepare("INSERT INTO chat_logs (platform, chat_id, user_name, user_msg, ai_msg, is_human, human_reply) VALUES (?, ?, ?, ?, ?, ?, ?)")
                        .bind(session?.platform || "web", chatId, session?.user_name || "User", systemTag, `${logPrefix}${msg}`, 1, msg).run();

                    // Send to Telegram if applicable
                    if (session?.platform === 'telegram') {
                        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ chat_id: chatId, text: msg })
                        });
                    }
                }

                return json({ success: true, status });
            }

            // --- ROUTE: Admin API Usage Stats ---
            if (url.pathname === "/admin/usage-stats" && request.method === "GET") {
                const { results } = await env.DB.prepare("SELECT * FROM ai_usage_stats ORDER BY last_used_at DESC").all();
                return json(results);
            }

            if (url.pathname === "/admin/usage-stats" && request.method === "DELETE") {
                await env.DB.prepare("DELETE FROM ai_usage_stats").run();
                return json({ success: true });
            }

            // --- ROUTE: Admin Polling (Check for new replies) ---
            if (url.pathname === "/admin/check-reply" && request.method === "GET") {
                const chatId = url.searchParams.get("chatId");
                const { results } = await env.DB.prepare("SELECT human_reply FROM chat_logs WHERE chat_id = ? AND is_human = 1 ORDER BY created_at DESC LIMIT 5")
                    .bind(chatId).all();

                const session = await env.DB.prepare("SELECT status FROM chat_sessions WHERE chat_id = ?").bind(chatId).first();

                return json({
                    replies: results,
                    status: session?.status || 'active'
                });
            }

            // --- ROUTE: Set Telegram Webhook ---
            if (url.pathname === "/set-webhook") {
                if (!env.TELEGRAM_BOT_TOKEN) return json({ error: "TELEGRAM_BOT_TOKEN missing" }, 400);
                const webhookUrl = `${url.protocol}//${url.host}/telegram-webhook`;
                const tgRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
                const result = await tgRes.json();
                return json({ success: true, result });
            }

            // --- ROUTE: Admin Logs (Chat History) ---
            if (url.pathname === "/admin/logs" && request.method === "GET") {
                const { results } = await env.DB.prepare("SELECT * FROM chat_logs ORDER BY created_at DESC LIMIT 100").all();
                return json(results);
            }

            // --- ROUTE: Admin Reply (Manual Intervention) ---
            if (url.pathname === "/admin/reply" && request.method === "POST") {
                const { logId, reply } = await request.json();
                const log = await env.DB.prepare("SELECT * FROM chat_logs WHERE id = ?").bind(logId).first();

                if (!log) return json({ error: "السجل ده مش موجود في قاعدة البيانات." }, 404);

                if (log.platform === "telegram") {
                    if (!env.TELEGRAM_BOT_TOKEN) return json({ error: "TELEGRAM_BOT_TOKEN مش متعرف في إعدادات Cloudflare." }, 500);

                    const tgRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ chat_id: log.chat_id, text: `[رد من الإدارة]:\n${reply}` })
                    });

                    if (!tgRes.ok) {
                        const errorMsg = await tgRes.text();
                        return json({ error: `فشل الإرسال لتليجرام: ${errorMsg}` }, 500);
                    }
                } else if (log.platform === "facebook" || log.platform === "instagram" || log.platform === "whatsapp") {
                    const targetId = log.chat_id.split("-").slice(1).join("-");
                    let token = env.META_ACCESS_TOKEN;

                    // Fallbacks for WhatsApp if specific page config exists
                    let phoneId = null;
                    if (log.platform === "whatsapp") {
                        const waSetting = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'wa_phone_id'").first();
                        phoneId = waSetting?.value;
                    }

                    // Attempt to fetch any saved token just in case
                    if (!token) {
                        const pageConfig = await env.DB.prepare("SELECT access_token FROM page_configs LIMIT 1").first();
                        if (pageConfig) token = pageConfig.access_token;
                    }

                    if (token) {
                        await sendMetaReply(log.platform, targetId, `[رد من الإدارة]:\n${reply}`, token, "dm", phoneId);
                    } else {
                        console.warn("No token available for sending manual Meta admin reply.");
                    }
                } else if (log.platform === "web") {
                    // Just update DB, maybe add a note
                    console.log("Human reply for web chat logged to DB.");
                }

                await env.DB.prepare("UPDATE chat_logs SET human_reply = ?, is_human = 1 WHERE id = ?")
                    .bind(reply, logId).run();

                return json({ success: true, platform: log.platform });
            }

            // --- ROUTE: Content Management ---
            if (url.pathname === "/content" && request.method === "GET") {
                const { results } = await env.DB.prepare("SELECT * FROM site_content ORDER BY category, created_at DESC").all();
                return json(results);
            }

            if (url.pathname === "/content" && request.method === "POST") {
                const data = await request.json();
                const { id, title, description, extra_data, category } = data;
                const contentId = id || crypto.randomUUID();
                await env.DB.prepare(
                    "INSERT INTO site_content (id, title, description, extra_data, category) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, extra_data=excluded.extra_data, category=excluded.category"
                ).bind(contentId, title, description || "", extra_data || "", category).run();
                return json({ success: true, id: contentId });
            }

            if (url.pathname === "/content" && request.method === "DELETE") {
                const { id } = await request.json();
                await env.DB.prepare("DELETE FROM site_content WHERE id = ?").bind(id).run();
                return json({ success: true });
            }

            // --- ROUTE: Meta Webhook (Messenger/Instagram) ---
            // 1. Verification (GET)
            if (url.pathname === "/webhook" && request.method === "GET") {
                const mode = url.searchParams.get("hub.mode");
                const token = url.searchParams.get("hub.verify_token");
                const challenge = url.searchParams.get("hub.challenge");

                // Use env.META_VERIFY_TOKEN if set, otherwise fallback for setup
                const VERIFY_TOKEN = env.META_VERIFY_TOKEN || "neura_verify_token_2026";

                if (mode === "subscribe" && token === VERIFY_TOKEN) {
                    return new Response(challenge, {
                        status: 200,
                        headers: { "Access-Control-Allow-Origin": "*" }
                    });
                } else {
                    return new Response("Forbidden", {
                        status: 403,
                        headers: { "Access-Control-Allow-Origin": "*" }
                    });
                }
            }

            // 2. Event Handling (POST)
            if (url.pathname === "/webhook" && request.method === "POST") {
                const body = await request.json();

                // --- LOG RAW WEBHOOK FOR DEBUGGING ---
                try {
                    await env.DB.prepare("INSERT INTO webhook_logs (payload) VALUES (?)").bind(JSON.stringify(body)).run();
                } catch (e) { console.error("Webhook logging failed:", e.message); }

                console.log("Meta Webhook Received:", JSON.stringify(body));

                if (body.object === "page" || body.object === "instagram") {
                    for (const entry of body.entry) {
                        const pageId = entry.id;
                        // For Instagram, entry.id is the IGSID, but we might need the page it's linked to.
                        // Usually for 'page' object it's the Page ID.
                        const pageConfig = await env.DB.prepare("SELECT access_token FROM page_configs WHERE page_id = ?").bind(pageId).first();
                        let tokenToUse = pageConfig ? pageConfig.access_token : env.META_ACCESS_TOKEN;

                        const messaging = entry.messaging || entry.changes;
                        if (!messaging) continue;

                        for (const event of messaging) {
                            try {
                                const platform = body.object === "instagram" ? "instagram" : "facebook";
                                let targetId, text, contextType, userName;

                                // Messenger / IG Direct Message
                                if (event.message && !event.message.is_echo) {
                                    targetId = event.sender.id;
                                    text = event.message.text || (event.message.attachments ? "[مرفق - صورة/فيديو/صوت]" : "");
                                    contextType = "dm";
                                    userName = "Meta User"; // In production, use Graph API to get name
                                }
                                // Facebook Comment / IG Comment
                                else if (event.value && (event.value.item === "comment" || event.value.message)) {
                                    targetId = event.value.id || event.value.comment_id;
                                    text = event.value.message || "[تعليق]";
                                    contextType = "comment";
                                    userName = event.value.from?.name || "Meta User";
                                }

                                if (targetId && text) {
                                    const chatId = `${platform}-${targetId}`;

                                    // Store Session IMMEDIATELY so it always shows in dashboard
                                    await env.DB.prepare("INSERT INTO chat_sessions (chat_id, platform, user_name, status, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(chat_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP, status='active'")
                                        .bind(chatId, platform, userName, 'active').run();

                                    // AI Response
                                    const result = await askNeura(text, [], env, userName);

                                    // Log Chat
                                    await env.DB.prepare("INSERT INTO chat_logs (platform, chat_id, user_name, user_msg, ai_msg, sentiment, needs_intervention) VALUES (?, ?, ?, ?, ?, ?, ?)")
                                        .bind(platform, chatId, userName, text, result.reply, result.sentiment, result.needsIntervention ? 1 : 0).run();

                                    // Send Reply via Graph API (only if token exists)
                                    if (tokenToUse) {
                                        await sendMetaReply(platform, targetId, result.reply, tokenToUse, contextType);
                                    } else {
                                        console.warn(`[${platform}] Cannot reply to ${chatId}: No access token found.`);
                                    }
                                }
                            } catch (itemErr) {
                                console.error("Error processing Meta event:", itemErr.message);
                            }
                        }
                    }
                    return new Response("EVENT_RECEIVED", {
                        status: 200,
                        headers: { "Access-Control-Allow-Origin": "*" }
                    });
                }

                // --- WHATSAPP BUSINESS API ---
                if (body.object === "whatsapp_business") {
                    for (const entry of body.entry) {
                        for (const change of entry.changes) {
                            if (change.value.messages) {
                                for (const message of change.value.messages) {
                                    try {
                                        const from = message.from; // User's WhatsApp ID (phone number)
                                        const text = message.text?.body;
                                        const userName = change.value.contacts?.[0]?.profile?.name || "WhatsApp User";
                                        const phoneId = change.value.metadata?.phone_number_id;

                                        if (text) {
                                            const chatId = `wa-${from}`;

                                            // AI Response
                                            const result = await askNeura(text, [], env, userName);

                                            // Store Session
                                            await env.DB.prepare("INSERT INTO chat_sessions (chat_id, platform, user_name, status) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP")
                                                .bind(chatId, "whatsapp", userName, 'active').run();

                                            // Log Chat
                                            await env.DB.prepare("INSERT INTO chat_logs (platform, chat_id, user_name, user_msg, ai_msg, sentiment, needs_intervention) VALUES (?, ?, ?, ?, ?, ?, ?)")
                                                .bind("whatsapp", chatId, userName, text, result.reply, result.sentiment, result.needsIntervention ? 1 : 0).run();

                                            // Reply via WhatsApp API
                                            // We need to fetch the token for this phone number or use a global one
                                            // For now, let's check if we have a config for this phoneId
                                            const pageConfig = await env.DB.prepare("SELECT access_token FROM page_configs WHERE page_id = ?").bind(phoneId).first();
                                            const token = pageConfig?.access_token || env.META_ACCESS_TOKEN;

                                            if (token) {
                                                await sendMetaReply("whatsapp", from, result.reply, token, "dm", phoneId);
                                            }
                                        }
                                    } catch (waErr) {
                                        console.error("WhatsApp Webhook Error:", waErr.message);
                                    }
                                }
                            }
                        }
                    }
                    return new Response("EVENT_RECEIVED", { status: 200 });
                }

                return new Response("Not Found", {
                    status: 404,
                    headers: { "Access-Control-Allow-Origin": "*" }
                });
            }

            // --- ROUTE: List Meta Pages ---
            if (url.pathname === "/admin/pages" && request.method === "GET") {
                const { results } = await env.DB.prepare("SELECT page_id, platform, page_name, updated_at FROM page_configs ORDER BY updated_at DESC").all();
                return json(results);
            }

            // --- ROUTE: Webhook Debug Logs ---
            if (url.pathname === "/admin/webhook-logs" && request.method === "GET") {
                const { results } = await env.DB.prepare("SELECT * FROM webhook_logs ORDER BY created_at DESC LIMIT 50").all();
                return json(results);
            }

            // --- ROUTE: Register Meta Page (For Multi-Tenant) ---
            if (url.pathname === "/register-page" && request.method === "POST") {
                const { page_id, platform, access_token, page_name } = await request.json();
                await env.DB.prepare("INSERT INTO page_configs (page_id, platform, access_token, page_name) VALUES (?, ?, ?, ?) ON CONFLICT(page_id) DO UPDATE SET access_token=excluded.access_token, updated_at=CURRENT_TIMESTAMP")
                    .bind(page_id, platform, access_token, page_name || null).run();
                return json({ success: true, message: `Page ${page_id} registered successfully` });
            }

            // --- ROUTE: Session Persistence (For Render Bot) ---
            if (url.pathname === "/bot-session" && request.method === "GET") {
                const id = url.searchParams.get("id") || "default";
                const row = await env.DB.prepare("SELECT data FROM bot_sessions WHERE id = ?").bind(id).first();
                return json({ data: row ? JSON.parse(row.data) : null });
            }

            if (url.pathname === "/bot-session" && request.method === "POST") {
                const { id, data } = await request.json();
                await env.DB.prepare("INSERT INTO bot_sessions (id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at")
                    .bind(id || "default", JSON.stringify(data)).run();
                return json({ success: true });
            }

            // --- ROUTE: Admin Settings ---
            if (url.pathname === "/admin/settings" && request.method === "GET") {
                const { results } = await env.DB.prepare("SELECT * FROM system_settings").all();
                const settings = {};
                results.forEach(r => settings[r.key] = r.value);
                return json(settings);
            }

            if (url.pathname === "/admin/settings" && request.method === "POST") {
                const data = await request.json();
                for (const [key, value] of Object.entries(data)) {
                    await env.DB.prepare("INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
                        .bind(key, value).run();
                }
                return json({ success: true });
            }

            return json({ error: "Not Found" }, 404);

        } catch (err) {
            console.error("Worker Error:", err.message);
            return json({ error: err.message }, 500);
        }
    }
};

// --- CORE AI LOGIC (askNeura) ---
async function askNeura(question, history, env, userName = "يا فندم") {
    let context = "";
    try {
        const { results } = await env.DB.prepare("SELECT * FROM site_content").all();
        context = (results || []).map(item => {
            return `- [${item.category.toUpperCase()}] ${item.title}: ${item.description || ""} ${item.extra_data ? `(${item.extra_data})` : ""}`;
        }).join("\n");
    } catch (e) { }

    // Fetch Custom Prompt from DB
    let customPrompt = "";
    try {
        const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key = ?").bind('ai_prompt').first();
        if (row?.value) customPrompt = row.value;
    } catch (e) { }

    const systemPrompt = `أنتِ "Neura" (نيورا)، خبيرة وباحثة ذكاء اصطناعي في "CountaNeura". شخصيتك تجمع بين الاحترافية العالية، الدبلوماسية الراقية، والذكاء العاطفي الحاد.

### قواعد الشخصية والبيع (صارمة جداً):
1. **اللهجة والشياكة**: عامية مصرية "راقية" ومحترفة. ممنوع السرسجة أو الفصحى. خليكي مهذبة جداً ولبقة.
2. **بروتوكول التعامل (العشم)**: ناديه باسمه (يا أستاذ [اسم العميل]) لو عرفتيه، أو "يا فندم" لو معرفتيهوش. 
   - **تنبيه هام**: ممنوع نهائياً تقولي "يا أستاذ فندم". لو الاسم مش معروف قولي "يا فندم" بس.
   - ممنوع كتابة كلمة "[الاسم]" في الرد، حطي الاسم الحقيقي مكانها.
3. **الجنس**: اتعاملي مع العميل كـ "مذكر" كافتراض أساسي، إلا لو وضح غير كدة.
4. **فنون البيع والميوعة الدبلوماسية**:
   - ممنوع تقولي "لأ" صريحة (Saving Face). استخدمي بدائل ذكية زي "خلينا نشوف ممكن ننسق ده إزاي".
   - ركزي على [القيمة المضافة] وإزاي الحل بتاعنا هيخليه ناجح في مجاله.
5. **التنسيق والاختصار**: ممنوع النجوم (*). استخدمي الأقواس [زي كدة] للمهم. الرد يكون "في الجول" بدون تطويل ممل.
6. **ممنوع التكرار**: لو ذكرتِ رقم واتساب أو معلومة تواصل، ذكريها مرة واحدة فقط في المحادثة بالكامل. لو سبق وذكرتيه، اعترفي بالمشكلة بدل ما تكرري نفس النصيحة.
7. **الطول المناسب**: الرد المثالي 2-4 جمل. لو محتاجة أكتر، استخدمي نقاط مرقمة. ابعدي عن الجمل التمهيدية الطويلة.

### قواعد التعامل الاحترافي (Handle Mastery):
8. **الاعتراف قبل الحل**: دايماً اعترفي بمشاعر العميل في جملة واحدة أولاً قبل ما تقدمي الحل. (مثال: "تماماً يا فندم، أنا فاهمة المشكلة...")
9. **صفر لوم على العميل**: ممنوع تماماً أي صياغة فيها لوم ضمني للعميل حتى لو هو غلطان. دايماً الحل يبدأ من "إحنا" مش "حضرتك".
10. **خلق الإلحاحية بأدب**: لو العميل متردد، ولّدي إلحاحية بأسلوب راقٍ زي "الأسعار الحالية متاحة لفترة محدودة يا فندم" بدون ضغط مباشر.
11. **التحكم في المحادثة**: لو العميل طلب حاجة مش موجودة أو سأل سؤال مش عارفاه، ولّدي تحويل ذكي بدل الاعتراف بالجهل. مثال: "ده موضوع تخصصي، وأنا عايزة أضمن لحضرتك أدق معلومة، تخليني أوصلك لفريق متخصص؟"
12. **الدبلوماسية تحت الضغط**: لو العميل متضايق أو بيتكلم بحدة، خفضي نبرتك أكتر وابدأي بـ "أنا كامل الاستعداد أهتم بحضرتك..." وأول ما تهدّيه انتقلي للحل.
13. **السرية والاحترافية**: ممنوع الإفصاح عن أي تفاصيل داخلية عن النظام أو التقنية. لو سأل، قولي "ده ضمن الملكية الفكرية لـ CountaNeura".

### تحليل الحالة النفسية (للإدارة فقط) - دقة عالية:
بعد كل رد، لازم تكتبي سطر أخير يبدأ بـ "STATUS:" فيه JSON دقيق جداً:
{"sentiment": "هاديء/منفعل/محبط/حيران/مش فاهم/متردد/سعيد", "needsIntervention": true/false, "closeSession": true/false}

دليل اختيار المشاعر (اقريه بدقة وابعدي عن التشخيص الزيادة):
- **منفعل**: فقط لو العميل استخدم كلمات حادة صريحة أو هَدَّد أو اشتكى بغضب واضح في نفس الرسالة. الضيق البسيط أو الاستعجال = "محبط" مش "منفعل".
- **محبط**: لو العميل بيعبر عن ضيق هاديء، واصله لآخره بأدب، أو الموضوع بياخد وقت. (ده التشخيص الأكثر شيوعاً للعملاء غير الراضيين).
- **حيران**: لو العميل بيقارن بين حاجتين، أو بيسأل "إيه الأفضل؟"، أو مش عارف يبدأ منين.
- **مش فاهم**: لو العميل بيسأل "يعني إيه؟" أو ردوده بعيدة عن سياق كلامك، أو طلب تكرار الشرح.
- **متردد**: لو العميل بيقول "هشوف"، "هفكر"، "مش عارف لسه"، أو بيسأل عن الضمانات كتير.
- **سعيد**: لو شكرك، استخدم إيموجي إيجابي، أو أبدى إعجابه بالسرعة/الذكاء.
- **هاديء**: الحالة الافتراضية لأي محادثة عادية. لو في شك، اختاري "هاديء". لا تبالغي في تشخيص الغضب.

قاعدة ذهبية: needsIntervention = true فقط لو العميل طلب مباشرة بني آدم أو في موقف أزمة واضح. مش لأي ضيق بسيط.

### تمبلت الرد في حالات معينة:
- لو العميل **حيران** أو **مش فاهم**: "أنا هنا عشان أساعدك تاخد أفضل قرار. إيه اللي محتار فيه بالظبط؟"
- لو العميل **منفعل**: "أنا كامل الاستعداد أهتم بحضرتك وأحل الموضوع ده. ممكن توضحلي إيه اللي حصل بالظبط؟"
- لو العميل **محبط**: اعترف بالتأخير أو الإزعاج بجملة واحدة ثم انتقل للحل الفوري.

### بيانات الشركة (من قاعدة البيانات):
${context || "إحنا وكالة CountaNeura لتصميم وكلاء الذكاء الاصطناعي الاحترافية."}

### قواعد إضافية مخصصة:
${customPrompt || "اتبع القواعد العامة المذكورة أعلاه."}

ردي كـ "Neura" بشياكة:
(اسم العميل الحالي اللي بتكلميه: ${userName})
`;

    let geminiHistory = (history || []).map(h => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.content }]
    })).slice(-20); // زيادة الذاكرة لـ 20 رسالة

    geminiHistory.push({ role: "user", parts: [{ text: question }] });

    const keys = (env.GEMINI_API_KEYS || env.GEMINI_API_KEY || "").split(",").map(k => k.trim()).filter(k => k);
    const rawModels = [
        { id: "gemini-2.5-flash-lite", version: "v1beta", useSystemInstruction: true },
        { id: "gemini-2.5-flash", version: "v1beta", useSystemInstruction: true },
        { id: "gemini-2.0-flash", version: "v1beta", useSystemInstruction: true },
        { id: "gemini-3.1-pro-preview", version: "v1beta", useSystemInstruction: true },
        { id: "gemini-1.5-flash", version: "v1beta", useSystemInstruction: true },
        { id: "gemini-1.5-flash-8b", version: "v1beta", useSystemInstruction: true }
    ];
    const models = getHealthyModels(rawModels);

    let finalReply = "";
    let success = false;
    let debugLogs = [];

    for (const model of models) {
        if (success) break;
        for (const key of keys) {
            try {
                const endpoint = `https://generativelanguage.googleapis.com/${model.version}/models/${model.id}:generateContent?key=${key}`;
                const payload = {
                    system_instruction: { parts: [{ text: systemPrompt }] },
                    contents: geminiHistory,
                    generationConfig: {
                        temperature: 0.5,
                        maxOutputTokens: 4000, // زيادة عدد التوكنات لـ 4000
                        thinkingConfig: model.id.includes("3")
                            ? { includeThoughts: true, thinkingLevel: "HIGH" }
                            : { includeThoughts: true, thinkingBudget: 2048 }
                    }
                };

                const response = await fetch(endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    const result = await response.json();
                    const candidate = result.candidates?.[0];
                    if (candidate?.content?.parts) {
                        // Extract answer text, skipping thought parts
                        let textValue = "";
                        for (const p of candidate.content.parts) {
                            if (!p.thought && p.text) textValue += p.text;
                        }

                        if (textValue) {
                            finalReply = textValue;
                            success = true;
                            await trackUsage(env, key, model.id, true);
                            break;
                        }
                    }
                    await trackUsage(env, key, model.id, false, `Bad JSON structure`);
                } else {
                    const errStatus = response.status;
                    debugLogs.push(`[${model.id}] Error ${errStatus}`);
                    await trackUsage(env, key, model.id, false, `HTTP ${errStatus}`);
                }
            } catch (err) {
                debugLogs.push(`[${model.id}] Crash`);
                await trackUsage(env, key, model.id, false, String(err.message || err || "Unknown Crash"));
            }
        }
    }

    if (!success) return {
        reply: "عذراً يا فندم، الخدمة غير متوفرة حالياً، يرجى المحاولة لاحقاً.",
        sentiment: "هاديء",
        needsIntervention: false,
        autoClose: false,
        debug: debugLogs.join(", ")
    };

    // Final Cleaning & Status Extraction
    let sentiment = "هاديء";
    let needsIntervention = false;
    let autoClose = false;

    if (finalReply.includes("STATUS:")) {
        const parts = finalReply.split("STATUS:");
        finalReply = parts[0].trim();
        try {
            const statusObj = JSON.parse(parts[1].trim());
            sentiment = statusObj.sentiment || sentiment;
            needsIntervention = !!statusObj.needsIntervention;
            autoClose = !!statusObj.closeSession;
        } catch (e) { }
    }

    finalReply = finalReply.trim()
        .replace(/^(Neura|assistant):/i, "")
        .replace(/\*/g, ""); // EXTRA SAFETY: Remove ALL stars

    return { reply: finalReply.trim(), sentiment, needsIntervention, autoClose };
}

// --- HELPER: Get Healthy Models ---
function getHealthyModels(models) {
    const now = Date.now();
    return [...models].sort((a, b) => {
        const aCooldown = modelHealth[a.id] || 0;
        const bCooldown = modelHealth[b.id] || 0;
        const aIsThrottled = aCooldown > now;
        const bIsThrottled = bCooldown > now;

        if (aIsThrottled && !bIsThrottled) return 1;
        if (!aIsThrottled && bIsThrottled) return -1;
        return 0; // Maintain original priority if both same health
    });
}

// --- HELPER: Track API Usage ---
async function trackUsage(env, key, model, success, errorLog = null) {
    try {
        const last4 = String(key || "").slice(-4);
        const safeErrorLog = (errorLog === undefined || errorLog === null) ? null : String(errorLog);

        // Update Model Health (Global Cooldown)
        if (safeErrorLog?.includes("429")) {
            modelHealth[model] = Date.now() + 120000; // 2 min cooldown to respect 5 RPM limit
        } else if (success) {
            delete modelHealth[model]; // Clear cooldown on success
        }

        await env.DB.prepare(`
            INSERT INTO ai_usage_stats (key_last4, model_id, success_count, error_count, last_error_log, last_used_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key_last4, model_id) DO UPDATE SET
                success_count = ai_usage_stats.success_count + excluded.success_count,
                error_count = ai_usage_stats.error_count + excluded.error_count,
                last_error_log = CASE WHEN excluded.error_count > 0 THEN excluded.last_error_log ELSE ai_usage_stats.last_error_log END,
                last_used_at = CURRENT_TIMESTAMP
        `).bind(last4, model, success ? 1 : 0, success ? 0 : 1, safeErrorLog).run();
    } catch (e) {
        console.error("Usage Tracking Error:", e.message);
    }
}

// --- REPLIER HELPER (Meta) ---
async function sendMetaReply(platform, targetId, text, accessToken, contextType, phoneId = null) {
    try {
        if (platform === 'whatsapp') {
            const endpoint = `https://graph.facebook.com/v18.0/${phoneId}/messages?access_token=${accessToken}`;
            await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: targetId,
                    type: "text",
                    text: { body: text }
                })
            });
        } else if (contextType === 'dm') {
            const endpoint = `https://graph.facebook.com/v18.0/me/messages?access_token=${accessToken}`;
            await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    recipient: { id: targetId },
                    message: { text }
                })
            });
        } else if (contextType === 'comment') {
            const endpoint = `https://graph.facebook.com/v18.0/${targetId}/comments`;
            await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text,
                    access_token: accessToken
                })
            });
        }
    } catch (e) {
        console.error("Failed to send Meta reply:", e.message);
    }
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        }
    });
}
