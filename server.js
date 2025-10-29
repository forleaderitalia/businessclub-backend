// ===== SERVER.JS - Backend Sicuro per Assistente AI =====
// Questo server protegge la tua API key e gestisce le chiamate a Claude

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// ===== MIDDLEWARE =====
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true
}));
app.use(express.json());

// Rate Limiting per prevenire abusi
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minuti
    max: 100, // Max 100 richieste per IP
    message: 'Troppe richieste, riprova tra qualche minuto'
});

app.use('/api/', limiter);

// ===== CONFIGURAZIONE =====
const CONFIG = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_API_URL: 'https://api.anthropic.com/v1/messages',
    MODEL: process.env.AI_MODEL || 'claude-sonnet-4-20250514',
    MAX_TOKENS: parseInt(process.env.MAX_TOKENS) || 1024,
    PORT: process.env.PORT || 3000
};

// Validazione configurazione
if (!CONFIG.ANTHROPIC_API_KEY) {
    console.error('❌ ERRORE: ANTHROPIC_API_KEY non configurata nel file .env');
    process.exit(1);
}

// ===== UTILITY FUNCTIONS =====

// Sanitizza input utente
function sanitizeInput(text) {
    if (typeof text !== 'string') return '';
    return text.trim().slice(0, 4000); // Max 4000 caratteri
}

// Valida messaggio
function validateMessages(messages) {
    if (!Array.isArray(messages)) {
        throw new Error('Messages deve essere un array');
    }
    
    if (messages.length === 0) {
        throw new Error('Messages non può essere vuoto');
    }
    
    if (messages.length > 50) {
        throw new Error('Troppe messaggi nella conversazione');
    }
    
    for (const msg of messages) {
        if (!msg.role || !msg.content) {
            throw new Error('Formato messaggio non valido');
        }
        if (!['user', 'assistant'].includes(msg.role)) {
            throw new Error('Role non valido');
        }
    }
    
    return true;
}

// Log delle metriche
function logMetrics(req, responseTime, success) {
    console.log({
        timestamp: new Date().toISOString(),
        ip: req.ip,
        success,
        responseTime: `${responseTime}ms`,
        messagesCount: req.body.messages?.length || 0
    });
}

// ===== API ENDPOINTS =====

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        model: CONFIG.MODEL
    });
});

// Endpoint principale per chat
app.post('/api/chat', async (req, res) => {
    const startTime = Date.now();
    
    try {
        // Validazione input
        const { messages, systemPrompt } = req.body;
        
        if (!messages) {
            return res.status(400).json({
                error: 'Parametro messages mancante'
            });
        }
        
        validateMessages(messages);
        
        // Sanitizza tutti i messaggi
        const sanitizedMessages = messages.map(msg => ({
            role: msg.role,
            content: sanitizeInput(msg.content)
        }));
        
        // Prepara richiesta per Anthropic
        const requestBody = {
            model: CONFIG.MODEL,
            max_tokens: CONFIG.MAX_TOKENS,
            messages: sanitizedMessages
        };
        
        // Aggiungi system prompt se fornito
        if (systemPrompt) {
            requestBody.system = sanitizeInput(systemPrompt);
        }
        
        // Chiamata API Anthropic
        const response = await fetch(CONFIG.ANTHROPIC_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CONFIG.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${response.status} - ${JSON.stringify(errorData)}`);
        }
        
        const data = await response.json();
        
        // Log successo
        const responseTime = Date.now() - startTime;
        logMetrics(req, responseTime, true);
        
        // Ritorna risposta
        res.json({
            success: true,
            message: data.content[0].text,
            usage: data.usage,
            model: data.model
        });
        
    } catch (error) {
        console.error('❌ Errore:', error.message);
        
        const responseTime = Date.now() - startTime;
        logMetrics(req, responseTime, false);
        
        // Gestione errori
        if (error.message.includes('API Error: 401')) {
            return res.status(500).json({
                error: 'Errore di autenticazione con il servizio AI'
            });
        }
        
        if (error.message.includes('API Error: 429')) {
            return res.status(429).json({
                error: 'Troppi richieste al servizio AI. Riprova tra poco.'
            });
        }
        
        res.status(500).json({
            error: 'Errore del server. Riprova tra poco.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Endpoint per feedback (opzionale)
app.post('/api/feedback', (req, res) => {
    const { messageId, rating, comment } = req.body;
    
    // Qui puoi salvare il feedback in un database
    console.log('📊 Feedback ricevuto:', { messageId, rating, comment });
    
    res.json({ success: true });
});

// ===== ERROR HANDLING =====
app.use((err, req, res, next) => {
    console.error('❌ Errore non gestito:', err);
    res.status(500).json({
        error: 'Errore interno del server'
    });
});

// ===== START SERVER =====
app.listen(CONFIG.PORT, () => {
    console.log('🚀 Server avviato con successo!');
    console.log(`📡 Porta: ${CONFIG.PORT}`);
    console.log(`🤖 Modello: ${CONFIG.MODEL}`);
    console.log(`🔐 API Key configurata: ${CONFIG.ANTHROPIC_API_KEY ? '✅' : '❌'}`);
    console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log('\n💡 Pronto per ricevere richieste!\n');
});

// Gestione shutdown graceful
process.on('SIGTERM', () => {
    console.log('👋 Shutdown richiesto, chiudo il server...');
    process.exit(0);
});
