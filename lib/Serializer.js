const { proto, getContentType, jidDecode } = require("lily-baileys");
const { parsePhoneNumber } = require("libphonenumber-js");

const decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
        const decode = jidDecode(jid) || {};
        return (decode.user && decode.server && decode.user + "@" + decode.server) || jid;
    } else return jid;
};

// Fungsi untuk mengekstrak pesan view once
const extractViewOnceMessage = (message) => {
    if (!message) return { viewOnceType: null, viewOnceMessage: null };
    
    // Urutan pengecekan yang lebih andal
    if (message.viewOnceMessageV2) {
        return { viewOnceType: 'viewOnceMessageV2', viewOnceMessage: message.viewOnceMessageV2.message };
    }
    if (message.viewOnceMessage) {
        return { viewOnceType: 'viewOnceMessage', viewOnceMessage: message.viewOnceMessage.message };
    }
    // Fallback jika flag ada di dalam media message
    if (message.imageMessage?.viewOnce || message.videoMessage?.viewOnce) {
        return { viewOnceType: getContentType(message), viewOnceMessage: message };
    }
    
    return { viewOnceType: null, viewOnceMessage: null };
};

const serializeMessage = async (bot, msg) => {
    if (!msg) return msg;

    let M = proto.WebMessageInfo;

    if (msg.key) {
        msg.id = msg.key.id;
        msg.isBaileys = msg.id ? msg.id.startsWith("BAE5") && msg.id.length === 16 : false;
        msg.from = msg.key.remoteJid;
        msg.isGroup = msg.from ? msg.from.endsWith("@g.us") : false;
        msg.sender = decodeJid(msg.key.fromMe ? bot.user.id : msg.isGroup ? msg.key.participant : msg.from);
    }

    if (msg.message) {
        let originalMessage = msg.message;
        
        // Buka lapisan luar terlebih dahulu
        if (originalMessage.ephemeralMessage) {
            originalMessage = originalMessage.ephemeralMessage.message;
        }
        
        // Handle documentWithCaptionMessage (media yang dikirim sebagai dokumen)
        if (originalMessage.documentWithCaptionMessage) {
            originalMessage = originalMessage.documentWithCaptionMessage.message;
        }
        
        // Extract view once message
        const { viewOnceMessage } = extractViewOnceMessage(originalMessage);
        msg.isViewOnce = !!viewOnceMessage;
        
        const finalMessage = viewOnceMessage || originalMessage;
        msg.type = getContentType(finalMessage);
        msg.mtype = Object.keys(finalMessage)[0];
        msg.msg = finalMessage[msg.type] === undefined ? finalMessage : finalMessage[msg.type];
        
        // ========== HANDLE BUTTON RESPONSE ==========
        if (msg.type === "buttonsResponseMessage" || msg.mtype === "buttonsResponseMessage") {
            msg.text = msg.message.buttonsResponseMessage?.selectedDisplayText || 
                      msg.message.buttonsResponseMessage?.selectedButtonId || "";
            msg.body = msg.text;
            console.log(`[BUTTON] Response detected: "${msg.text}"`);
        }
        // ========== HANDLE LIST RESPONSE ==========
        else if (msg.type === "listResponseMessage" || msg.mtype === "listResponseMessage") {
            msg.text = msg.message.listResponseMessage?.singleSelectReply?.selectedRowId || 
                      msg.message.listResponseMessage?.title || "";
            msg.body = msg.text;
            console.log(`[LIST] Response detected: "${msg.text}"`);
        }
        // ========== HANDLE TEMPLATE BUTTON RESPONSE ==========
        else if (msg.type === "templateButtonReplyMessage" || msg.mtype === "templateButtonReplyMessage") {
            msg.text = msg.message.templateButtonReplyMessage?.selectedDisplayText || 
                      msg.message.templateButtonReplyMessage?.selectedId || "";
            msg.body = msg.text;
            console.log(`[TEMPLATE] Button response detected: "${msg.text}"`);
        }
        // ========== HANDLE TEXT MESSAGES ==========
        else {
            // Perbaikan logika untuk menangani semua jenis teks
            if (msg.type === 'conversation') {
                msg.text = msg.msg; // Untuk 'conversation', teks ada di msg langsung
            } else {
                msg.text = msg.msg?.text || msg.msg?.caption || 
                          msg.message.conversation || 
                          msg.message.extendedTextMessage?.text || 
                          msg.message.imageMessage?.caption || 
                          msg.message.videoMessage?.caption || "";
            }
            msg.body = msg.text;
        }

        msg.mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        msg.isMedia = /imageMessage|videoMessage|stickerMessage|audioMessage|documentMessage/.test(msg.type);
        
        // ========== ENHANCED QUOTED MESSAGE HANDLING ==========
        // Logika untuk pesan yang di-reply (DIPERBAIKI)
        let quotedContent = null;
        let contextInfo = null;
        
        // Cari contextInfo dari berbagai sumber
        if (msg.message?.extendedTextMessage?.contextInfo) {
            contextInfo = msg.message.extendedTextMessage.contextInfo;
            quotedContent = contextInfo.quotedMessage;
        } else if (msg.msg?.contextInfo) {
            contextInfo = msg.msg.contextInfo;
            quotedContent = contextInfo.quotedMessage;
        }
        
        if (quotedContent && contextInfo) {
            const participant = decodeJid(contextInfo.participant);
            const quotedKey = {
                id: contextInfo.stanzaId,
                remoteJid: msg.from,
                fromMe: participant === decodeJid(bot.user.id),
                participant: participant
            };
            
            console.log(`[QUOTED_DEBUG] Found quoted message with ID: ${contextInfo.stanzaId}`);
            
            const quotedMsgInfo = M.fromObject({
                key: quotedKey,
                message: quotedContent,
            });
            
            msg.quoted = await serializeMessage(bot, quotedMsgInfo);
            msg.quoted.raw = quotedMsgInfo;
            
            // Tambahan untuk debugging
            msg.quotedMsg = msg.quoted; // Alias untuk kompatibilitas
        } else {
            msg.quoted = null;
            msg.quotedMsg = null;
        }
    }

    // Fungsi untuk membalas pesan
    msg.reply = (text, options = {}) => {
        const textToSend = typeof text === 'string' ? text : require('util').inspect(text);
        return bot.sendMessage(msg.from, { text: textToSend, ...options }, { quoted: msg });
    };

    msg.react = async (emoji) => {
        try {
            const reactionMessage = {
                react: {
                    text: emoji,
                    key: msg.key,
                },
            };
            return await bot.sendMessage(msg.from, reactionMessage);
        } catch (e) {
            console.error("Gagal mengirim reaksi:", e);
        }
    };

    return msg;
};

module.exports = {
    serializeMessage,
    decodeJid,
};