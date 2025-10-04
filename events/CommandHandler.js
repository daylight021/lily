const Serializer = require("../lib/Serializer");
const { getGroupMetadata } = require("../lib/CachedGroupMetadata");
const similarity = require('similarity');

// Anti-banjir global
const userSpamData = new Map();
const SPAM_LIMIT = 5;
const SPAM_COOLDOWN = 10 * 1000;

function isUserSpamming(userId) {
  if (userSpamData.has(userId)) {
    const userData = userSpamData.get(userId);
    const now = Date.now();
    if (now - userData.lastCommandTime < SPAM_COOLDOWN) {
      userData.count++;
      if (userData.count >= SPAM_LIMIT) {
        if (userData.count === SPAM_LIMIT) {
          userData.lastWarningTime = now;
          return true;
        }
        return now - (userData.lastWarningTime || 0) < SPAM_COOLDOWN;
      }
    } else {
      userData.count = 1;
      userData.lastCommandTime = now;
    }
  } else {
    userSpamData.set(userId, { count: 1, lastCommandTime: Date.now() });
  }
  return false;
}

// Logika game Tebak Kata 
async function handleTebakKataAnswer(msg, bot) {
  const gameSession = bot.game.tebakkata?.[msg.from];
  if (!gameSession || !msg.quoted || msg.quoted.key?.id !== gameSession.questionMsgId) {
    return false; // Bukan jawaban untuk game tebak kata yang aktif
  }

  const userAnswer = msg.body.trim().toUpperCase();
  const correctAnswer = gameSession.answer.toUpperCase();

  if (gameSession.isAnswered) {
    if (userAnswer === correctAnswer) {
      await bot.sendMessage(msg.from, {
        text: `⏰ *Terlambat!* @${msg.sender.split('@')[0]}\n\nJawaban kamu benar, tapi soal ini sudah dijawab!`,
        mentions: [msg.sender]
      });
    }
    return true;
  }

  if (userAnswer === correctAnswer) {
    gameSession.isAnswered = true;
    clearTimeout(gameSession.timeout);

    const userPoints = gameSession.sessionScores[msg.sender] || 0;
    const pointsWon = gameSession.points;
    gameSession.sessionScores[msg.sender] = userPoints + pointsWon;

    await bot.sendMessage(msg.from, {
      text: `🎉 *BENAR!* 🎉\n\n` +
        `Jawaban: *${gameSession.answer}*\n` +
        `Level: ${gameSession.level}\n` +
        `Poin: *+${pointsWon}*\n\n` +
        `🏆 Selamat @${msg.sender.split('@')[0]}!\n` +
        `💫 Total poin kamu: *${gameSession.sessionScores[msg.sender]}*\n\n` +
        `🔄 *Bersiap untuk soal berikutnya...*`,
      mentions: [msg.sender]
    });

    setTimeout(() => {
      if (bot.game.tebakkata[msg.from]) {
        bot.commands.get('tebakkata').sendQuestion(bot, msg.from);
      }
    }, 3000);

  } else {
    const wrongMessages = [
      `❌ Salah! Coba lagi ya @${msg.sender.split('@')[0]}!`,
      `🤔 Belum tepat, @${msg.sender.split('@')[0]}! Pikirkan lagi!`,
      `🔄 Coba lagi @${msg.sender.split('@')[0]}! Kamu pasti bisa!`,
      `💭 Hmm, belum tepat @${msg.sender.split('@')[0]}! Baca clue lagi!`
    ];
    const randomWrongMessage = wrongMessages[Math.floor(Math.random() * wrongMessages.length)];
    await bot.sendMessage(msg.from, { text: randomWrongMessage, mentions: [msg.sender] });
  }

  return true;
}

module.exports = {
  async chatUpdate(messages) {
    const msg = await Serializer.serializeMessage(this, messages.messages[0]);
    if (!msg.message || msg.isBaileys) return;

    this.game = this.game || { tebakkata: {}, family100: {} };

    try {
      const botPrefix = new RegExp("^[" + "/!#$%+£¢€¥^°=¶∆×÷π√✓©®:;?&.\\-".replace(/[|\\{}()[\]^$+*?.\-\^]/g, "\\$&") + "]");
      const isCommand = msg.text && botPrefix.test(msg.text);

      if (isCommand && isUserSpamming(msg.sender)) {
        return msg.reply("⚠️ Anda mengirim perintah terlalu cepat! Mohon tunggu beberapa saat.");
      }

      require("./DatabaseHandler")(msg, this);
      require("./AFKHandler")(msg, this);

      const isOwner = [this.user.id.split("@")[0], process.env.owner].map((v) => v?.replace(/[^0-9]/g, "")).includes(msg.sender.split("@")[0]) || msg.key.fromMe;
      if (isOwner) userSpamData.delete(msg.sender);

      // --- Game Answer Handlers ---
      if (!isCommand) {
        if (await handleTebakKataAnswer(msg, this)) return;

        const family100Command = this.commands.get('family100');
        if (family100Command && await family100Command.checkAnswer(this, msg)) {
          return;
        }
      }

      const textCommandHandlers = {
        'uno': {
          // Regex untuk mendeteksi perintah kartu UNO
          condition: /^(Mainkan Kartu|Mainkan Wild|Mainkan \+4 Wild)/i,
          // Fungsi untuk mengecek sesi (jika ada)
          sessionCheck: () => !msg.isGroup,
          // Pesan jika sesi tidak valid
          sessionFailMsg: "Perintah UNO hanya bisa dari chat pribadi.",
        },
        'ytmp4': {
          condition: /^Download (2160p|1440p|1080p60|1080p|720p60|720p|480p|360p|240p|144p)/i,
          sessionCheck: () => global.ytSessions && global.ytSessions[msg.sender],
          sessionFailMsg: "❌ Sesi unduh video berakhir. Silakan kirim ulang URL YouTube.",
        },
        'ytmp3': {
          condition: /^Download Audio (\d+kbps)/i,
          sessionCheck: () => global.ytmp3Sessions && global.ytmp3Sessions[msg.sender],
          sessionFailMsg: "❌ Sesi unduh audio berakhir. Silakan kirim ulang URL YouTube.",
        }
      };

      let textCommandExecuted = false;
      for (const commandName in textCommandHandlers) {
        const handler = textCommandHandlers[commandName];
        if (handler.condition.test(msg.text)) {
          if (handler.sessionCheck()) {
            const command = this.commands.get(commandName);
            if (command) {
              const extra = { bot: this, args: [msg.text], usedPrefix: '.', command: commandName };
              await command.execute.call(this, msg, extra);
            }
          } else {
            await msg.reply(handler.sessionFailMsg);
          }
          textCommandExecuted = true;
          break;
        }
      }
      if (textCommandExecuted) return;

      // --- Standard Command Processing ---
      if (isCommand) {
        const groupMetadata = msg.isGroup ? await getGroupMetadata(msg.from, this) : null;
        const participants = groupMetadata?.participants || [];
        const user = participants.find((u) => u.id == msg.sender) || {};
        const bot = participants.find((u) => u.id == Serializer.decodeJid(this.user.id)) || {};
        const isAdmin = user.admin === "admin" || user.admin === "superadmin";
        const isBotAdmin = bot.admin === "admin" || bot.admin === "superadmin";

        const usedPrefix = msg.text.match(botPrefix)[0];
        const args = msg.text.slice(usedPrefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const command = this.commands.get(commandName);
        if (!command) return;

        if (command.admin && !isAdmin) return msg.reply("Perintah ini hanya untuk admin grup.");
        if (command.botAdmin && !isBotAdmin) return msg.reply("Bot harus menjadi admin untuk menjalankan perintah ini.");
        if (command.group && !msg.isGroup) return msg.reply("Perintah ini hanya bisa digunakan di dalam grup.");
        if (command.owner && !isOwner) return msg.reply("Perintah ini khusus untuk Owner Bot.");

        const extra = { bot: this, usedPrefix, participants, groupMetadata, args, command: commandName };
        try {
          await command.execute.call(this, msg, extra);
        } catch (error) {
          console.error(`Error saat menjalankan perintah '${commandName}':`, error);
          msg.reply("Terjadi kesalahan internal saat menjalankan perintah.");
        }
      }
    } catch (error) {
      console.error("Error fatal di chatUpdate:", error);
    } finally {
      try {
        const finalGroupMetadata = msg.isGroup ? await getGroupMetadata(msg.from, this) : {};
        require("../lib/print")(this, msg, finalGroupMetadata);
      } catch (e) {
        console.error("Error di dalam blok finally (print.js):", e);
      }
    }
  },
};