const fs = require('fs');
const path = require('path');

const soalPath = path.join(__dirname, '..', '..', 'lib', 'tebakkata-soal.json');
const allSoal = JSON.parse(fs.readFileSync(soalPath));

// Fungsi untuk membuat soal hangman
function generateHangman(word) {
    let letters = word.split('');
    let lettersToRemove = Math.floor(letters.length * (Math.random() * 0.2 + 0.4));
    if (lettersToRemove === 0) lettersToRemove = 2; // Pastikan minimal 2 huruf hilang

    for (let i = 0; i < lettersToRemove; i++) {
        let randomIndex;
        do {
            randomIndex = Math.floor(Math.random() * letters.length);
        } while (letters[randomIndex] === '_');
        letters[randomIndex] = '_';
    }
    return letters.join(' ');
}

// Fungsi untuk tag semua member grup (seperti hidetag)
function getAllMembers(participants) {
    return participants
        .filter((participant) => participant.admin !== "superadmin" && participant.admin !== "admin")
        .map((participant) => participant.id);
}

// Fungsi untuk mengirim soal
async function sendQuestion(bot, groupId) {
    const gameSession = bot.game.tebakkata[groupId];
    if (!gameSession) return;

    const levels = ['mudah', 'menengah', 'sulit'];
    const randomLevel = levels[Math.floor(Math.random() * levels.length)];
    const soalPool = allSoal[randomLevel];
    const currentSoal = soalPool[Math.floor(Math.random() * soalPool.length)];

    const questionText = generateHangman(currentSoal.soal);
    const points = randomLevel === 'mudah' ? 1000 : randomLevel === 'menengah' ? 3000 : 5000;

    // Tambahkan counter soal
    if (!gameSession.questionCount) gameSession.questionCount = 0;
    gameSession.questionCount++;

    const message = await bot.sendMessage(groupId, {
        text: `🧩 *Tebak Kata* 🧩\n\n` +
              `📊 Soal ke-${gameSession.questionCount}\n` +
              `🎯 Level: *${randomLevel.toUpperCase()}*\n` +
              `💡 Clue: *${currentSoal.clue}*\n` +
              `🔤 Soal: \`\`\`${questionText}\`\`\`\n\n` +
              `💰 Poin: *${points}*\n` +
              `⏰ Timeout: 60 detik\n\n` +
              `📝 *Reply pesan ini untuk menjawab!*`
    });

    gameSession.answer = currentSoal.soal;
    gameSession.points = points;
    gameSession.questionMsgId = message.key.id;
    gameSession.level = randomLevel;

    console.log(`[GAME_QUESTION] Sent question #${gameSession.questionCount}, ID: ${message.key.id}, Answer: ${currentSoal.soal}`);

    // Clear timeout lama jika ada
    if (gameSession.timeout) {
        clearTimeout(gameSession.timeout);
    }

    // Set timeout untuk mengakhiri game jika tidak ada yang jawab
    gameSession.timeout = setTimeout(() => {
        endGame(bot, groupId, 'timeout');
    }, 60000);
}

// Fungsi untuk mengakhiri game
async function endGame(bot, groupId, reason = 'manual') {
    const gameSession = bot.game.tebakkata[groupId];
    if (!gameSession) return;

    // Clear timeout jika ada
    if (gameSession.timeout) {
        clearTimeout(gameSession.timeout);
    }

    let endGameText = '';
    if (reason === 'timeout') {
        endGameText = `⏰ *WAKTU HABIS!*\n\n` +
                     `Jawaban yang benar adalah: *${gameSession.answer}*\n` +
                     `Level: ${gameSession.level}\n\n` +
                     `🏁 *GAME BERAKHIR KARENA TIDAK ADA YANG MENJAWAB*\n\n`;
    } else {
        endGameText = `🛑 *GAME DIHENTIKAN SECARA MANUAL*\n\n`;
    }

    let sessionLeaderboardText = '-- LEADERBOARD SESI INI --\n';
    const sessionScores = gameSession.sessionScores;
    const sortedSession = Object.entries(sessionScores).sort(([, a], [, b]) => b - a);

    if (sortedSession.length > 0) {
        sortedSession.forEach(([userId, score], index) => {
            const medal = ['🥇', '🥈', '🥉'][index] || '🏅';
            sessionLeaderboardText += `${medal} @${userId.split('@')[0]} - *${score}* Poin\n`;
        });

        // Simpan ke database global
        const db = bot.db;
        if (!db.data.tebakKataLeaderboard) {
            db.data.tebakKataLeaderboard = {};
        }
        for (const [userId, score] of sortedSession) {
            db.data.tebakKataLeaderboard[userId] = (db.data.tebakKataLeaderboard[userId] || 0) + score;
        }
        await db.write();
    } else {
        sessionLeaderboardText += '_Tidak ada yang berhasil menjawab di sesi ini._\n';
    }

    const globalLeaderboard = bot.db.data.tebakKataLeaderboard || {};
    const sortedGlobal = Object.entries(globalLeaderboard).sort(([, a], [, b]) => b - a).slice(0, 10);
    let globalLeaderboardText = '\n-- LEADERBOARD GLOBAL --\n';
    if (sortedGlobal.length > 0) {
         sortedGlobal.forEach(([userId, score], index) => {
            const medal = ['🏆', '🏅', '🏅'][index] || '🏅';
            globalLeaderboardText += `${medal} ${index + 1}. @${userId.split('@')[0]} - *${score}* Poin\n`;
        });
    } else {
        globalLeaderboardText += '_Leaderboard global masih kosong._'
    }

    const mentions = sortedSession.map(([userId]) => userId).concat(sortedGlobal.map(([userId]) => userId));
    await bot.sendMessage(groupId, { 
        text: `🎮 ${endGameText}` +
              `📊 Total soal dimainkan: ${gameSession.questionCount || 0}\n\n` +
              `${sessionLeaderboardText}${globalLeaderboardText}\n\n` +
              `Terima kasih telah bermain! 🎉\n` +
              `Mulai lagi dengan *.tebakkata start*`,
        mentions: [...new Set(mentions)]
    });
    
    delete bot.game.tebakkata[groupId];
}

module.exports = {
    name: 'tebakkata',
    category: 'game',
    aliases: ['tkata'],
    description: 'Mini-game tebak kata seru!',
    group: true, // Hanya bisa dimainkan di grup
    async execute(msg, extra) {
        const { from } = msg;
        const { bot, args, participants } = extra;
        const subCommand = args[0]?.toLowerCase();

        // Inisialisasi game object jika belum ada
        if (!bot.game) {
            bot.game = {};
        }
        if (!bot.game.tebakkata) {
            bot.game.tebakkata = {};
        }

        if (subCommand === 'start') {
            if (bot.game.tebakkata?.[from]) {
                return bot.sendMessage(from, { 
                    text: '⚠️ Sesi "Tebak Kata" sudah berjalan di grup ini!\n\n' +
                          'Sesi akan berakhir otomatis jika tidak ada yang bisa menjawab soal dalam 60 detik.\n\n' +
                          'Gunakan `.tebakkata status` untuk melihat status game saat ini.' 
                });
            }
            
            // Inisialisasi sesi game baru
            bot.game.tebakkata[from] = {
                sessionScores: {},
                answer: null,
                points: 0,
                questionMsgId: null,
                timeout: null,
                questionCount: 0,
                level: null
            };

            // Tag semua member grup dengan pesan ajakan
            const allMembers = getAllMembers(participants);
            const challengeMessages = [
                `🎮 *GAME TEBAK KATA DIMULAI!* 🧩\n\n` +
                `🔥 Ayo buktikan siapa yang paling jago tebak kata!\n` +
                `💪 Tantangan untuk semua member grup!\n` +
                `🏆 Raih poin tertinggi dan jadilah juara!\n\n` +
                `🚀 *Soal pertama akan segera muncul...*\n` +
                `📝 Jangan lupa reply pesan soal untuk menjawab!`,
                
                `🧩 *ARENA TEBAK KATA TERBUKA!* 🎯\n\n` +
                `⚡ Siapa yang siap mengasah otak?\n` +
                `🎊 Game seru untuk semua member!\n` +
                `💎 Kumpulkan poin sebanyak-banyaknya!\n\n` +
                `🎲 *Mari kita mulai petualangan kata...*\n` +
                `🔍 Baca clue dengan teliti ya!`,
                
                `🎪 *FESTIVAL TEBAK KATA DIMULAI!* 🎭\n\n` +
                `🌟 Calling all smart members!\n` +
                `🎯 Uji kemampuan kosakata kalian!\n` +
                `🏅 Siapa yang akan menjadi master kata?\n\n` +
                `🎨 *Get ready for the word challenge!*\n` +
                `💡 Setiap soal punya clue yang membantu!`
            ];
            
            const randomMessage = challengeMessages[Math.floor(Math.random() * challengeMessages.length)];
            
            await bot.sendMessage(from, { 
                text: randomMessage,
                mentions: allMembers
            });
            
            // Delay 3 detik sebelum soal pertama untuk memberi waktu member melihat
            setTimeout(() => {
                if (bot.game.tebakkata[from]) {
                    sendQuestion(bot, from);
                }
            }, 3000);

        } else if (subCommand === 'leaderboard' || subCommand === 'lb') {
            const globalLeaderboard = bot.db.data.tebakKataLeaderboard || {};
            const sortedGlobal = Object.entries(globalLeaderboard).sort(([, a], [, b]) => b - a).slice(0, 10);
            
            if (sortedGlobal.length === 0) {
                return bot.sendMessage(from, { text: '🏆 Leaderboard "Tebak Kata" masih kosong.\n\nMulai bermain dengan `.tebakkata start`!' });
            }

            let text = '🏆 *LEADERBOARD GLOBAL TEBAK KATA*\n\n';
            const mentions = [];
            sortedGlobal.forEach(([userId, score], index) => {
                 const medal = index === 0 ? '👑' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏅';
                 text += `${medal} ${index + 1}. @${userId.split('@')[0]} - *${score}* Poin\n`;
                 mentions.push(userId);
            });
            
            text += '\n💡 *Tip:* Semakin sulit level soal, semakin besar poin yang didapat!';
            await bot.sendMessage(from, { text, mentions });

        } else if (subCommand === 'status') {
            const gameSession = bot.game.tebakkata?.[from];
            if (!gameSession) {
                return bot.sendMessage(from, { 
                    text: '❌ Tidak ada sesi game yang aktif.\n\nMulai dengan `.tebakkata start`!' 
                });
            }

            const sessionScores = Object.entries(gameSession.sessionScores).sort(([, a], [, b]) => b - a);
            let statusText = `🎮 *STATUS GAME TEBAK KATA*\n\n`;
            statusText += `📊 Soal ke: ${gameSession.questionCount || 0}\n`;
            statusText += `🎯 Level saat ini: ${gameSession.level || 'Belum dimulai'}\n`;
            statusText += `💰 Poin soal ini: ${gameSession.points || 0}\n\n`;
            
            if (sessionScores.length > 0) {
                statusText += `🏆 *Skor Sementara:*\n`;
                sessionScores.forEach(([userId, score], index) => {
                    const medal = ['🥇', '🥈', '🥉'][index] || '🏅';
                    statusText += `${medal} @${userId.split('@')[0]} - ${score} poin\n`;
                });
            } else {
                statusText += `🏆 *Skor Sementara:*\n_Belum ada yang menjawab benar_`;
            }
            
            statusText += `\n⏰ Game akan berakhir otomatis jika tidak ada yang menjawab dalam 60 detik.`;

            const mentions = sessionScores.map(([userId]) => userId);
            await bot.sendMessage(from, { text: statusText, mentions });

        } else {
            const helpText = `🎯 *BANTUAN GAME TEBAK KATA* 🧩\n\n` +
                           `📋 *Perintah yang tersedia:*\n\n` +
                           `1️⃣ \`.tebakkata start\`\n   🚀 Memulai sesi permainan baru\n\n` +
                           `2️⃣ \`.tebakkata leaderboard\`\n   🏆 Melihat peringkat poin global\n\n` +
                           `3️⃣ \`.tebakkata status\`\n   📊 Melihat status game saat ini\n\n` +
                           `🎮 *Cara Bermain:*\n` +
                           `• Bot akan mengirimkan soal hangman\n` +
                           `• Reply/balas pesan soal dengan jawabanmu\n` +
                           `• Game berlanjut selama ada yang bisa jawab\n` +
                           `• Game berakhir jika tidak ada yang jawab dalam 60 detik\n` +
                           `• Poin berbeda untuk setiap level:\n` +
                           `  - Mudah: 1000 poin\n` +
                           `  - Menengah: 3000 poin\n` +
                           `  - Sulit: 5000 poin\n\n` +
                           `💡 *Tips:* Baca clue dengan teliti untuk bantuan!`;
            await bot.sendMessage(from, { text: helpText });
        }
    },
    sendQuestion,
    endGame
};