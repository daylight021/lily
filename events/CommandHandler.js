const Serializer = require("../lib/Serializer");
const { getGroupMetadata } = require("../lib/CachedGroupMetadata");

// Anti-banjir global
const userSpamData = new Map();
const SPAM_LIMIT = 5;
const SPAM_COOLDOWN = 10 * 1000;

function isUserSpamming(userId) {
    if (userSpamData.has(userId)) {
        const userData = userSpamData.get(userId);
        const { count, lastCommandTime } = userData;
        if (Date.now() - lastCommandTime < SPAM_COOLDOWN) {
            if (count >= SPAM_LIMIT) {
                userData.lastCommandTime = Date.now();
                return true; 
            }
            userData.count++;
        } else {
            userData.count = 1;
            userData.lastCommandTime = Date.now();
        }
    } else {
        userSpamData.set(userId, { count: 1, lastCommandTime: Date.now() });
    }
    return false;
}

module.exports = {
  async chatUpdate(messages) {
    const msg = await Serializer.serializeMessage(this, messages.messages[0]);
    let groupMetadata = null; // Inisialisasi sebagai null

    try {
      if (!msg.message || msg.isBaileys) return;

      // Debug log untuk melihat tipe pesan dan isi text
      console.log(`[MSG_DEBUG] Type: ${msg.type}, mType: ${msg.mtype}, Text: "${msg.text}", From: ${msg.sender}`);

      const botPrefix = new RegExp("^[" + "/!#$%+£¢€¥^°=¶∆×÷π√✓©®:;?&.\\-".replace(/[|\\{}()[\]^$+*?.\-\^]/g, "\\$&") + "]");
      const isCommand = msg.text && botPrefix.test(msg.text);

      // ========== HANDLER UNTUK BUTTON RESPONSE UNO ==========
      if (msg.text && (msg.text.startsWith("Mainkan Kartu ") || msg.text.startsWith("Mainkan Wild ") || msg.text.startsWith("Mainkan +4 Wild "))) {
        console.log(`[BUTTON_HANDLER] UNO card button detected: "${msg.text}" from ${msg.sender}`);
        
        try {
          // Ambil command uno
          const unoCommand = this.commands.get('uno');
          if (unoCommand) {
            console.log(`[COMMAND] Executing uno with button response`);
            
            // Execute uno command dengan button response
            const extra = { 
              bot: this, 
              usedPrefix: '.', // Default prefix untuk uno
              participants: [], 
              groupMetadata: null, 
              args: [], // Tidak perlu args karena akan dihandle oleh logic uno.js
              command: 'uno' 
            };
            
            return await unoCommand.execute.call(this, msg, extra);
          } else {
            console.log(`[ERROR] uno command not found in commands collection`);
            return msg.reply("❌ Command uno tidak ditemukan.");
          }
        } catch (error) {
          console.error('Error handling UNO card button response:', error);
          return msg.reply("❌ Terjadi kesalahan saat memproses kartu UNO.");
        }
      }

      // ========== HANDLER UNTUK BUTTON RESPONSE YOUTUBE VIDEO ==========
      if (msg.text && msg.text.startsWith("Download ") && msg.text.match(/Download (2160p|1440p|1080p60|1080p|720p60|720p|480p|360p|240p|144p)/)) {
        console.log(`[BUTTON_HANDLER] YouTube video button detected: "${msg.text}" from ${msg.sender}`);
        
        // Cek apakah user memiliki session YouTube yang aktif
        if (global.ytSessions && global.ytSessions[msg.sender]) {
          console.log(`[SESSION] Found active ytmp4 session for ${msg.sender}: ${global.ytSessions[msg.sender].url}`);
          
          try {
            // Ambil command ytmp4
            const ytmp4Command = this.commands.get('ytmp4');
            if (ytmp4Command) {
              console.log(`[COMMAND] Executing ytmp4 with button response`);
              
              // Buat args dengan format button response
              const fakeArgs = [msg.text];
              
              // Execute ytmp4 command dengan button response
              const extra = { 
                bot: this, 
                usedPrefix: '/', // Default prefix
                participants: [], 
                groupMetadata: null, 
                args: fakeArgs, 
                command: 'ytmp4' 
              };
              
              return await ytmp4Command.execute.call(this, msg, extra);
            } else {
              console.log(`[ERROR] ytmp4 command not found in commands collection`);
              return msg.reply("❌ Command ytmp4 tidak ditemukan.");
            }
          } catch (error) {
            console.error('Error handling YouTube video button response:', error);
            return msg.reply("❌ Terjadi kesalahan saat memproses pilihan kualitas video.");
          }
        } else {
          console.log(`[SESSION] No active ytmp4 session found for ${msg.sender}`);
          console.log(`[SESSION] Available ytmp4 sessions:`, Object.keys(global.ytSessions || {}));
          return msg.reply("❌ Session expired. Silakan kirim ulang URL YouTube.");
        }
      }

      // ========== HANDLER UNTUK BUTTON RESPONSE YOUTUBE AUDIO ==========
      if (msg.text && msg.text.startsWith("Download Audio ") && msg.text.match(/Download Audio (\d+kbps)/)) {
        console.log(`[BUTTON_HANDLER] YouTube audio button detected: "${msg.text}" from ${msg.sender}`);
        
        // Cek apakah user memiliki session YouTube Audio yang aktif
        if (global.ytmp3Sessions && global.ytmp3Sessions[msg.sender]) {
          console.log(`[SESSION] Found active ytmp3 session for ${msg.sender}: ${global.ytmp3Sessions[msg.sender].url}`);
          
          try {
            // Ambil command ytmp3
            const ytmp3Command = this.commands.get('ytmp3') || this.commands.get('yta');
            if (ytmp3Command) {
              console.log(`[COMMAND] Executing ytmp3 with button response`);
              
              // Buat args dengan format button response
              const fakeArgs = [msg.text];
              
              // Execute ytmp3 command dengan button response
              const extra = { 
                bot: this, 
                usedPrefix: '/', // Default prefix
                participants: [], 
                groupMetadata: null, 
                args: fakeArgs, 
                command: 'ytmp3' 
              };
              
              return await ytmp3Command.execute.call(this, msg, extra);
            } else {
              console.log(`[ERROR] ytmp3 command not found in commands collection`);
              return msg.reply("❌ Command ytmp3 tidak ditemukan.");
            }
          } catch (error) {
            console.error('Error handling YouTube audio button response:', error);
            return msg.reply("❌ Terjadi kesalahan saat memproses pilihan kualitas audio.");
          }
        } else {
          console.log(`[SESSION] No active ytmp3 session found for ${msg.sender}`);
          console.log(`[SESSION] Available ytmp3 sessions:`, Object.keys(global.ytmp3Sessions || {}));
          return msg.reply("❌ Session expired. Silakan kirim ulang URL YouTube.");
        }
      }

      // ========== ADDITIONAL BUTTON HANDLERS ==========
      // Handler untuk button response lainnya bisa ditambahkan di sini
      if (msg.text && msg.text.startsWith("Download ") && !msg.text.match(/Download (2160p|1440p|1080p60|1080p|720p60|720p|480p|360p|240p|144p|Audio \d+kbps)/)) {
        console.log(`[BUTTON_HANDLER] Other button response detected: "${msg.text}" from ${msg.sender}`);
        // Tambahkan handler untuk button lainnya jika diperlukan
      }

      // ========== SPAM CHECK ==========
      if (isCommand) {
          if (isUserSpamming(msg.sender)) {
              if (userSpamData.get(msg.sender).count === SPAM_LIMIT) {
                  return msg.reply("⚠️ Anda mengirim perintah terlalu cepat! Mohon tunggu beberapa saat.");
              }
              return;
          }
      }

      require("./DatabaseHandler")(msg, this);
      require("./AFKHandler")(msg, this);

      let isOwner = [this.user.id.split("@")[0], process.env.owner].map((v) => v?.replace(/[^0-9]/g, "")).includes(msg.sender.split("@")[0]) || msg.key.fromMe;
      if (isOwner) userSpamData.delete(msg.sender);

      // --- Ambil metadata HANYA JIKA DIPERLUKAN ---
      if (isCommand || msg.isGroup) {
          try {
              groupMetadata = msg.isGroup ? await getGroupMetadata(msg.from, this) : null;
          } catch (e) {
              console.error(`Gagal mengambil metadata untuk grup ${msg.from}:`, e);
              // Biarkan groupMetadata tetap null jika gagal
          }
      }
      
      let participants = groupMetadata?.participants || [];
      let user = participants.find((u) => u.id == msg.sender) || {};
      let bot = participants.find((u) => u.id == Serializer.decodeJid(this.user.id)) || {};
      let isAdmin = user.admin === "admin" || user.admin === "superadmin";
      let isBotAdmin = bot.admin === "admin" || bot.admin === "superadmin";

      // ========== COMMAND PROCESSING ==========
      if (isCommand) {
        const usedPrefix = msg.text.match(botPrefix)[0];
        const args = msg.text.slice(usedPrefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        
        if (!this.commands.has(commandName)) return;
        const command = this.commands.get(commandName);

        if (command.admin && !isAdmin) return msg.reply("Perintah ini hanya untuk admin grup.");
        if (command.botAdmin && !isBotAdmin) return msg.reply("Bot harus menjadi admin untuk menjalankan perintah ini.");
        if (command.group && !msg.isGroup) return msg.reply("Perintah ini hanya bisa digunakan di dalam grup.");
        if (command.owner && !isOwner) return msg.reply("Perintah ini khusus untuk Owner Bot.");

        let extra = { bot: this, usedPrefix, participants, groupMetadata, args, command: commandName };
        try {
          await command.execute.call(this, msg, extra);
        } catch (error) {
          console.error(`Error saat menjalankan perintah '${commandName}':`, error);
          msg.reply("Terjadi kesalahan internal saat menjalankan perintah.");
        }
      }

    } finally {
      // Kirim metadata ke fungsi print (bisa null)
      require("../lib/print")(this, msg, groupMetadata);
    }
  },
};