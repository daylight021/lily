const Serializer = require("../lib/Serializer");
const { getGroupMetadata } = require("../lib/CachedGroupMetadata");
const similarity = require('similarity'); // Tambahkan dependency untuk family100

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

// ========== FAMILY100 HELPER FUNCTIONS ==========
const threshold = 0.72; // Nilai similarity untuk jawaban yang hampir benar

async function handleFamily100Answer(msg, bot) {
  try {
    // Cek apakah ada game family100 yang aktif di grup ini
    if (!bot.game || !bot.game.family100 || !bot.game.family100[msg.from]) {
      return false; // Tidak ada game aktif
    }

    const gameSession = bot.game.family100[msg.from];
    if (!gameSession || !gameSession.jawaban) return false;

    const userAnswer = msg.body.toLowerCase().replace(/[^\w\s\-]+/g, '').trim();
    const isSurrender = /^((me)?nyerah|surr?ender)$/i.test(msg.body);

    if (isSurrender) {
      // Handle surrender
      const family100Command = bot.commands.get('family100');
      if (family100Command) {
        await family100Command.endGame(bot, msg.from, 'surrender');
      }
      return true;
    }

    // Cek apakah jawaban exact match
    let answerIndex = gameSession.jawaban.findIndex(jawaban => 
      jawaban.toLowerCase().replace(/[^\w\s\-]+/g, '') === userAnswer
    );

    // Jika tidak exact match, cek similarity
    if (answerIndex < 0) {
      const similarities = gameSession.jawaban.map(jawaban => 
        similarity(jawaban.toLowerCase().replace(/[^\w\s\-]+/g, ''), userAnswer)
      );
      const maxSimilarity = Math.max(...similarities);
      
      if (maxSimilarity >= threshold) {
        answerIndex = similarities.indexOf(maxSimilarity);
        // Kirim feedback "hampir benar"
        await bot.sendMessage(msg.from, {
          text: `💡 Hampir benar! Coba lagi dengan kata yang lebih tepat!`
        });
      }
      
      if (answerIndex < 0 || gameSession.terjawab[answerIndex]) {
        return false; // Jawaban salah atau sudah terjawab
      }
    }

    // Jika jawaban sudah terjawab sebelumnya
    if (gameSession.terjawab[answerIndex]) {
      await bot.sendMessage(msg.from, {
        text: `❌ Jawaban "${gameSession.jawaban[answerIndex]}" sudah dijawab oleh @${gameSession.answeredBy[answerIndex].split('@')[0]}!`,
        mentions: [gameSession.answeredBy[answerIndex]]
      });
      return true;
    }

    // Jawaban benar!
    gameSession.terjawab[answerIndex] = true;
    gameSession.answeredBy[answerIndex] = msg.sender;
    gameSession.correctAnswers++;

    // Update skor session
    if (!gameSession.sessionScores[msg.sender]) {
      gameSession.sessionScores[msg.sender] = 0;
    }
    gameSession.sessionScores[msg.sender] += 1000; // 1000 poin per jawaban

    // Reset timeout karena ada aktivitas
    if (gameSession.timeout) {
      clearTimeout(gameSession.timeout);
      gameSession.timeout = setTimeout(() => {
        const family100Command = bot.commands.get('family100');
        if (family100Command) {
          family100Command.endGame(bot, msg.from, 'timeout');
        }
      }, 120000);
    }

    // Cek apakah sudah semua terjawab
    const isComplete = gameSession.terjawab.every(Boolean);
    
    // Show current status
    let statusText = `🎯 *FAMILY 100* ${isComplete ? '✅' : '📊'}\n\n`;
    statusText += `❓ *Soal:* ${gameSession.soal}\n\n`;

    // Tampilkan jawaban
    statusText += `📋 *Jawaban* (${gameSession.correctAnswers}/${gameSession.totalAnswers}):\n`;
    gameSession.jawaban.forEach((jawaban, index) => {
      if (gameSession.terjawab[index]) {
        statusText += `✅ (${index + 1}) ${jawaban} - @${gameSession.answeredBy[index].split('@')[0]}\n`;
      } else {
        statusText += `❌ (${index + 1}) _______________\n`;
      }
    });

    if (isComplete) {
      statusText += `\n🎉 *SEMUA JAWABAN TERJAWAB!*\n`;
      statusText += `🚀 Soal berikutnya akan muncul dalam 3 detik...\n`;
    } else {
      statusText += `\n💰 *1000* poin per jawaban benar\n`;
      statusText += `⏰ Game berlanjut... Cari jawaban yang tersisa!\n`;
    }

    const mentions = gameSession.answeredBy.filter(Boolean);
    await bot.sendMessage(msg.from, { 
      text: statusText, 
      mentions: [...new Set(mentions)]
    });

    if (isComplete) {
      // Lanjut ke soal berikutnya setelah 3 detik
      setTimeout(() => {
        if (bot.game.family100[msg.from]) {
          const family100Command = bot.commands.get('family100');
          if (family100Command) {
            family100Command.sendQuestion(bot, msg.from);
          }
        }
      }, 3000);
    }

    return true;

  } catch (error) {
    console.error('Error handling Family 100 answer:', error);
    return false;
  }
}

module.exports = {
  async chatUpdate(messages) {
    const msg = await Serializer.serializeMessage(this, messages.messages[0]);
    const { from, sender, isGroup, body } = msg;
    let groupMetadata = null; // Inisialisasi sebagai null

    try {
      if (!msg.message || msg.isBaileys) return;

      // Debug log untuk melihat tipe pesan dan isi text
      console.log(`[MSG_DEBUG] Type: ${msg.type}, mType: ${msg.mtype}, Text: "${msg.text}", From: ${msg.sender}`);

      const botPrefix = new RegExp("^[" + "/!#$%+£¢€¥^°=¶∆×÷π√✓©®:;?&.\\-".replace(/[|\\{}()[\]^$+*?.\-\^]/g, "\\$&") + "]");
      const isCommand = msg.text && botPrefix.test(msg.text);

      // ========== INISIALISASI GAME OBJECT ==========
      if (!this.game) {
        this.game = {};
      }
      if (!this.game.tebakkata) {
        this.game.tebakkata = {};
      }
      if (!this.game.family100) {
        this.game.family100 = {};
      }

      // ========== SPAM CHECK - DIPINDAH KE ATAS SEBELUM BUTTON HANDLERS ==========
      // Spam check dilakukan early untuk mencegah spam pada semua jenis interaksi
      if (isCommand) {
        if (isUserSpamming(msg.sender)) {
          if (userSpamData.get(msg.sender).count === SPAM_LIMIT) {
            return msg.reply("⚠️ Anda mengirim perintah terlalu cepat! Mohon tunggu beberapa saat.");
          }
          return;
        }
      }

      // ========== HANDLER UNTUK BUTTON RESPONSE UNO ==========
      if (msg.text && (msg.text.startsWith("Mainkan Kartu ") || msg.text.startsWith("Mainkan Wild ") || msg.text.startsWith("Mainkan +4 Wild "))) {
        console.log(`[BUTTON_HANDLER] UNO card button detected: "${msg.text}" from ${msg.sender}`);

        // Pastikan ini adalah pesan dari PM (bukan grup)
        if (msg.isGroup) {
          console.log(`[BUTTON_HANDLER] Ignoring UNO button from group`);
          return;
        }

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

      // ========== HANDLER UNTUK BUTTON RESPONSE TELEGRAM STICKER ==========
      if (msg.text && msg.text === "Aku mau") {
        console.log(`[BUTTON_HANDLER] Telegram sticker button detected: "${msg.text}" from ${msg.sender}`);

        // Cek apakah user memiliki session Telegram sticker yang aktif
        if (global.telegramStickerSessions && global.telegramStickerSessions[msg.sender]) {
          console.log(`[SESSION] Found active telegram sticker session for ${msg.sender}`);

          try {
            // Ambil command sticker
            const stickerCommand = this.commands.get('sticker') || this.commands.get('s');
            if (stickerCommand && stickerCommand.downloadAllStickers) {
              console.log(`[COMMAND] Executing telegram sticker download`);

              // Execute downloadAllStickers function
              return await stickerCommand.downloadAllStickers(this, msg);
            } else {
              console.log(`[ERROR] sticker command or downloadAllStickers function not found`);
              return msg.reply("❌ Command sticker tidak ditemukan atau fungsi download tidak tersedia.");
            }
          } catch (error) {
            console.error('Error handling Telegram sticker button response:', error);
            return msg.reply("❌ Terjadi kesalahan saat memproses download sticker pack Telegram.");
          }
        } else {
          console.log(`[SESSION] No active telegram sticker session found for ${msg.sender}`);
          console.log(`[SESSION] Available telegram sticker sessions:`, Object.keys(global.telegramStickerSessions || {}));
          return msg.reply("❌ Session expired. Silakan kirim ulang perintah download sticker pack.");
        }
      }

      // ========== ADDITIONAL BUTTON HANDLERS ==========
      // Handler untuk button response lainnya bisa ditambahkan di sini
      if (msg.text && msg.text.startsWith("Download ") && !msg.text.match(/Download (2160p|1440p|1080p60|1080p|720p60|720p|480p|360p|240p|144p|Audio \d+kbps)/)) {
        console.log(`[BUTTON_HANDLER] Other button response detected: "${msg.text}" from ${msg.sender}`);
        // Tambahkan handler untuk button lainnya jika diperlukan
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

      // ========== HANDLER FAMILY100 ANSWER ==========
      // Cek family100 answer SEBELUM memproses game tebak kata dan command lain
      if (!isCommand) { // Hanya proses jika bukan command
        const isFamily100Answer = await handleFamily100Answer(msg, this);
        if (isFamily100Answer) {
          console.log(`[FAMILY100] Answer processed for ${msg.sender}: "${msg.body}"`);
          return; // Stop processing jika ini adalah jawaban family100
        }
      }

      // ========== LOGIKA GAME TEBAK KATA ==========
      const gameSession = this.game.tebakkata?.[msg.from];
      console.log(`[GAME_DEBUG] Game session exists: ${!!gameSession}`);
      
      if (gameSession) {
        console.log(`[GAME_DEBUG] Question msg ID: ${gameSession.questionMsgId}`);
        console.log(`[GAME_DEBUG] Is quoted: ${!!msg.quoted}`);
        console.log(`[GAME_DEBUG] Quoted key ID: ${msg.quoted?.key?.id}`);
        console.log(`[GAME_DEBUG] User answer: "${msg.body?.trim()?.toUpperCase()}"`);
        console.log(`[GAME_DEBUG] Correct answer: "${gameSession.answer}"`);
      }

      // Cek apakah ini adalah jawaban untuk game tebak kata
      if (gameSession && msg.quoted && msg.quoted.key && msg.quoted.key.id === gameSession.questionMsgId) {
        const userAnswer = msg.body.trim().toUpperCase();
        const correctAnswer = gameSession.answer.toUpperCase();
        
        console.log(`[GAME_ANSWER] User: ${msg.sender}, Answer: "${userAnswer}", Correct: "${correctAnswer}", Already answered: ${gameSession.isAnswered}`);
        
        // Cek apakah soal sudah dijawab oleh orang lain
        if (gameSession.isAnswered) {
          // Jika user memberikan jawaban benar tapi terlambat
          if (userAnswer === correctAnswer) {
            await this.sendMessage(msg.from, { 
              text: `⏰ *Terlambat!* @${msg.sender.split('@')[0]}\n\n` +
                    `Jawaban kamu benar, tapi seseorang sudah menjawab lebih dulu!\n` +
                    `💨 Bersiaplah untuk soal berikutnya!`, 
              mentions: [msg.sender] 
            });
          }
          console.log(`[GAME_ANSWER] Question already answered, ignoring response from ${msg.sender}`);
          return; // Abaikan jawaban jika soal sudah dijawab
        }
        
        if (userAnswer === correctAnswer) {
          // Tandai soal sudah dijawab SEGERA untuk mencegah race condition
          gameSession.isAnswered = true;
          
          // Jawaban benar
          clearTimeout(gameSession.timeout);

          const userPoints = gameSession.sessionScores[msg.sender] || 0;
          gameSession.sessionScores[msg.sender] = userPoints + gameSession.points;

          await this.sendMessage(msg.from, { 
            text: `🎉 *BENAR!* 🎉\n\n` +
                  `Jawaban: *${gameSession.answer}*\n` +
                  `Level: ${gameSession.level}\n` +
                  `Poin: *+${gameSession.points}*\n\n` +
                  `🏆 Selamat @${msg.sender.split('@')[0]}!\n` +
                  `💫 Total poin kamu: *${gameSession.sessionScores[msg.sender]}*\n\n` +
                  `🔄 *Bersiap untuk soal berikutnya...*`, 
            mentions: [msg.sender] 
          });

          // Lanjut ke soal berikutnya setelah 3 detik
          setTimeout(() => {
            if (this.game.tebakkata[msg.from]) { // Pastikan game masih aktif
              this.commands.get('tebakkata').sendQuestion(this, msg.from);
            }
          }, 3000);
        } else {
          // Jawaban salah - berikan feedback
          const wrongMessages = [
            `❌ Salah! Coba lagi ya @${msg.sender.split('@')[0]}!`,
            `🤔 Belum tepat, @${msg.sender.split('@')[0]}! Pikirkan lagi!`,
            `❌ Oops! Jawaban kamu belum benar @${msg.sender.split('@')[0]}!`,
            `🙃 Salah jawab nih @${msg.sender.split('@')[0]}! Coba sekali lagi!`,
            `❌ Belum benar @${msg.sender.split('@')[0]}! Jangan menyerah!`,
            `🔄 Coba lagi @${msg.sender.split('@')[0]}! Kamu pasti bisa!`,
            `💭 Hmm, belum tepat @${msg.sender.split('@')[0]}! Baca clue lagi!`
          ];
          
          const randomWrongMessage = wrongMessages[Math.floor(Math.random() * wrongMessages.length)];
          
          await this.sendMessage(msg.from, { 
            text: randomWrongMessage, 
            mentions: [msg.sender] 
          });
        }
        
        // Return early untuk mencegah pesan diproses sebagai command
        return;
      }

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