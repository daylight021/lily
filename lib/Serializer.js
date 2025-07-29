const { proto, getContentType, jidDecode } = require("lily-baileys");
const { parsePhoneNumber } = require("libphonenumber-js");

const decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
        const decode = jidDecode(jid) || {};
        return (decode.user && decode.server && decode.user + "@" + decode.server) || jid;
    } else return jid;
};

const serializeMessage = async (bot, msg) => {
    if (!msg) return msg;

    if (msg.key) {
        msg.id = msg.key.id;
        msg.isBaileys = msg.id ? msg.id.startsWith("BAE5") && msg.id.length === 16 : false;
        msg.from = msg.key.remoteJid;
        msg.isGroup = msg.from.endsWith("@g.us");
        msg.sender = decodeJid(msg.key.fromMe ? bot.user.id : msg.isGroup ? msg.key.participant : msg.from);
    }

    if (msg.message) {
        msg.type = getContentType(msg.message);
        if (msg.type === "ephemeralMessage") {
            msg.message = msg.message.ephemeralMessage.message;
            msg.type = getContentType(msg.message);
        }
        if (msg.type === "viewOnceMessage") {
            msg.message = msg.message.viewOnceMessage.message;
            msg.type = getContentType(msg.message);
        }

        msg.mtype = Object.keys(msg.message)[0];
        
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
        // ========== HANDLE NORMAL TEXT ==========
        else {
            msg.text = msg.message.conversation || 
                      msg.message.extendedTextMessage?.text || 
                      msg.message.imageMessage?.caption || 
                      msg.message.videoMessage?.caption || "";
            msg.body = msg.text;
        }

        msg.mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        msg.isMedia = /imageMessage|videoMessage|stickerMessage|audioMessage|documentMessage/.test(msg.type);
        
        const quotedContent = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (quotedContent) {
            const contextInfo = msg.message.extendedTextMessage.contextInfo;
            const quotedKey = {
                id: contextInfo.stanzaId,
                remoteJid: msg.from,
                fromMe: contextInfo.participant === decodeJid(bot.user.id),
                participant: contextInfo.participant
            };
            msg.quoted = await serializeMessage(bot, { key: quotedKey, message: quotedContent });
        } else {
            msg.quoted = null;
        }
    }

    // Fungsi untuk membalas pesan
    msg.reply = (text, options = {}) => {
        return bot.sendMessage(msg.from, { text, ...options }, { quoted: msg });
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