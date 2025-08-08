const fs = require('fs');
const path = require('path');
const similarity = require('similarity');

// Path ke file soal, pastikan lokasinya benar (sejajar dengan database.json)
const soalPath = path.join(__dirname, '..', '..', 'lib', 'family100-soal.json');
const allSoal = JSON.parse(fs.readFileSync(soalPath));

const threshold = 0.72; // Nilai similarity untuk jawaban yang hampir benar
const winScore = 1000; // Poin per jawaban benar

// Fungsi untuk tag semua member grup (seperti hidetag)
function getAllMembers(participants) {
    return participants
        .filter((participant) => participant.admin !== "superadmin" && participant.admin !== "admin")
        .map((participant) => participant.id);
}

// Fungsi untuk mengirim soal baru
async function sendQuestion(bot, groupId) {
    const gameSession = bot.game.family100[groupId];
    if (!gameSession) return;

    // Pilih soal random
    const currentSoal = allSoal[Math.floor(Math.random() * allSoal.length)];
    
    // Tambahkan counter soal
    if (!gameSession.questionCount) gameSession.questionCount = 0;
    gameSession.questionCount++;

    const message = await bot.sendMessage(groupId, {
        text: `🎯 *FAMILY 100* 🎯\n\n` +
              `📊 Soal ke-${gameSession.questionCount}\n` +
              `❓ *Soal:* ${currentSoal.soal}\n\n` +
              `📋 Terdapat *${currentSoal.jawaban.length}* jawaban${currentSoal.jawaban.find(v => v.includes(' ')) ? `\n(beberapa jawaban terdapat spasi)` : ''}\n\n` +
              `💰 *${winScore}* poin per jawaban benar\n` +
              `⏰ Timeout: 120 detik\n\n` +
              `📝 *Ketik jawaban langsung di chat!*\n` +
              `💡 *Ketik "nyerah" untuk menyerah*`
    });

    gameSession.soal = currentSoal.soal;
    gameSession.jawaban = currentSoal.jawaban;
    gameSession.terjawab = Array.from(currentSoal.jawaban, () => false);
    gameSession.questionMsgId = message.key.id;
    gameSession.answeredBy = Array.from(currentSoal.jawaban, () => null);
    gameSession.totalAnswers = currentSoal.jawaban.length;
    gameSession.correctAnswers = 0;

    console.log(`[FAMILY100_QUESTION] Sent question #${gameSession.questionCount}, ID: ${message.key.id}, Answers: ${currentSoal.jawaban.length}`);

    // Clear timeout lama jika ada
    if (gameSession.timeout) {
        clearTimeout(gameSession.timeout);
    }

    // Set timeout untuk mengakhiri game jika tidak ada aktivitas
    gameSession.timeout = setTimeout(() => {
        endGame(bot, groupId, 'timeout');
    }, 120000); // 2 menit
}

// Fungsi untuk check jawaban
async function checkAnswer(bot, msg) {
    const { from: groupId, sender } = msg;
    const gameSession = bot.game.family100[groupId];
    if (!gameSession || !gameSession.jawaban) return false;

    const userAnswer = msg.body.toLowerCase().replace(/[^\w\s\-]+/g, '').trim();
    const isSurrender = /^((me)?nyerah|surr?ender)$/i.test(msg.body);

    if (isSurrender) {
        endGame(bot, groupId, 'surrender');
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
            await bot.sendMessage(groupId, {
                text: `💡 Hampir benar! Coba lagi dengan kata yang lebih tepat!`
            });
        }
        
        if (answerIndex < 0 || gameSession.terjawab[answerIndex]) {
            return false; // Jawaban salah atau sudah terjawab
        }
    }

    // Jika jawaban sudah terjawab sebelumnya
    if (gameSession.terjawab[answerIndex]) {
        await bot.sendMessage(groupId, {
            text: `❌ Jawaban "${gameSession.jawaban[answerIndex]}" sudah dijawab oleh @${gameSession.answeredBy[answerIndex].split('@')[0]}!`,
            mentions: [gameSession.answeredBy[answerIndex]]
        });
        return true;
    }

    // Jawaban benar!
    gameSession.terjawab[answerIndex] = true;
    gameSession.answeredBy[answerIndex] = sender;
    gameSession.correctAnswers++;

    // Update skor session
    if (!gameSession.sessionScores[sender]) {
        gameSession.sessionScores[sender] = 0;
    }
    gameSession.sessionScores[sender] += winScore;

    // Reset timeout karena ada aktivitas
    if (gameSession.timeout) {
        clearTimeout(gameSession.timeout);
        gameSession.timeout = setTimeout(() => {
            endGame(bot, groupId, 'timeout');
        }, 120000);
    }

    // Cek apakah sudah semua terjawab
    const isComplete = gameSession.terjawab.every(Boolean);
    
    if (isComplete) {
        // Semua jawaban sudah benar
        await showCurrentStatus(bot, groupId, true);
        setTimeout(() => {
            sendQuestion(bot, groupId); // Lanjut ke soal berikutnya
        }, 3000);
    } else {
        // Masih ada jawaban yang belum ditemukan
        await showCurrentStatus(bot, groupId, false);
    }

    return true;
}

// Fungsi untuk menampilkan status jawaban saat ini
async function showCurrentStatus(bot, groupId, isComplete) {
    const gameSession = bot.game.family100[groupId];
    if (!gameSession) return;

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
        statusText += `\n💰 *${winScore}* poin per jawaban benar\n`;
        statusText += `⏰ Game berlanjut... Cari jawaban yang tersisa!\n`;
    }

    const mentions = gameSession.answeredBy.filter(Boolean);
    await bot.sendMessage(groupId, { 
        text: statusText, 
        mentions: [...new Set(mentions)]
    });
}

// Fungsi untuk mengakhiri game
async function endGame(bot, groupId, reason = 'manual') {
    const gameSession = bot.game.family100[groupId];
    if (!gameSession) return;

    // Clear timeout jika ada
    if (gameSession.timeout) {
        clearTimeout(gameSession.timeout);
    }

    let endGameText = '';
    if (reason === 'timeout') {
        endGameText = `⏰ *WAKTU HABIS!*\n\n` +
                     `❓ Soal terakhir: ${gameSession.soal || 'Belum ada soal'}\n\n`;
        
        // Tampilkan jawaban yang belum terjawab
        if (gameSession.jawaban) {
            endGameText += `📋 *Jawaban yang belum ditemukan:*\n`;
            gameSession.jawaban.forEach((jawaban, index) => {
                if (!gameSession.terjawab[index]) {
                    endGameText += `• ${jawaban}\n`;
                }
            });
            endGameText += `\n`;
        }
        
        endGameText += `🏁 *GAME BERAKHIR KARENA TIDAK ADA AKTIVITAS*\n\n`;
    } else if (reason === 'surrender') {
        endGameText = `🏳️ *GAME DIHENTIKAN - MENYERAH*\n\n`;
        
        // Tampilkan semua jawaban
        if (gameSession.jawaban) {
            endGameText += `📋 *Semua jawaban untuk soal terakhir:*\n`;
            gameSession.jawaban.forEach((jawaban, index) => {
                const status = gameSession.terjawab[index] ? '✅' : '❌';
                const answerer = gameSession.terjawab[index] ? ` - @${gameSession.answeredBy[index].split('@')[0]}` : '';
                endGameText += `${status} ${jawaban}${answerer}\n`;
            });
            endGameText += `\n`;
        }
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
        if (!db.data.family100Leaderboard) {
            db.data.family100Leaderboard = {};
        }
        for (const [userId, score] of sortedSession) {
            db.data.family100Leaderboard[userId] = (db.data.family100Leaderboard[userId] || 0) + score;
        }
        await db.write();
    } else {
        sessionLeaderboardText += '_Tidak ada yang berhasil menjawab di sesi ini._\n';
    }

    const globalLeaderboard = bot.db.data.family100Leaderboard || {};
    const sortedGlobal = Object.entries(globalLeaderboard).sort(([, a], [, b]) => b - a).slice(0, 10);
    let globalLeaderboardText = '\n-- LEADERBOARD GLOBAL --\n';
    if (sortedGlobal.length > 0) {
        sortedGlobal.forEach(([userId, score], index) => {
            const medal = ['🏆', '🏅', '🏅'][index] || '🏅';
            globalLeaderboardText += `${medal} ${index + 1}. @${userId.split('@')[0]} - *${score}* Poin\n`;
        });
    } else {
        globalLeaderboardText += '_Leaderboard global masih kosong._';
    }

    const allMentions = [
        ...sortedSession.map(([userId]) => userId),
        ...sortedGlobal.map(([userId]) => userId),
        ...(gameSession.answeredBy || []).filter(Boolean)
    ];

    await bot.sendMessage(groupId, { 
        text: `🎮 ${endGameText}` +
              `📊 Total soal dimainkan: ${gameSession.questionCount || 0}\n\n` +
              `${sessionLeaderboardText}${globalLeaderboardText}\n\n` +
              `Terima kasih telah bermain! 🎉\n` +
              `Mulai lagi dengan *.family100 start*`,
        mentions: [...new Set(allMentions)]
    });
    
    delete bot.game.family100[groupId];
}

module.exports = {
    name: 'family100',
    category: 'game',
    aliases: ['f100'],
    description: 'Mini-game Family 100 seru!',
    group: true, // Hanya bisa dimainkan di grup
    async execute(msg, extra) {
        const { from } = msg;
        const { bot, args, participants } = extra;
        const subCommand = args[0]?.toLowerCase();

        // Inisialisasi game object jika belum ada
        if (!bot.game) {
            bot.game = {};
        }
        if (!bot.game.family100) {
            bot.game.family100 = {};
        }

        if (subCommand === 'start') {
            if (bot.game.family100?.[from]) {
                return bot.sendMessage(from, { 
                    text: '⚠️ Sesi "Family 100" sudah berjalan di grup ini!\n\n' +
                          'Sesi akan berakhir otomatis jika tidak ada aktivitas dalam 120 detik.\n\n' +
                          'Gunakan `.family100 status` untuk melihat status game saat ini.' 
                });
            }
            
            // Inisialisasi sesi game baru
            bot.game.family100[from] = {
                sessionScores: {},
                soal: null,
                jawaban: null,
                terjawab: [],
                answeredBy: [],
                timeout: null,
                questionCount: 0,
                questionMsgId: null,
                totalAnswers: 0,
                correctAnswers: 0
            };

            // Tag semua member grup dengan pesan ajakan
            const allMembers = getAllMembers(participants);
            const challengeMessages = [
                `🎯 *GAME FAMILY 100 DIMULAI!* 🎯\n\n` +
                `🔥 Siapa yang jago survei dan tebak jawaban populer?\n` +
                `💪 Tantangan untuk semua member grup!\n` +
                `🏆 Kumpulkan poin sebanyak-banyaknya!\n\n` +
                `🚀 *Soal pertama akan segera muncul...*\n` +
                `📝 Langsung ketik jawaban di chat!`,
                
                `🎪 *ARENA FAMILY 100 TERBUKA!* 🎭\n\n` +
                `⚡ Ayo tebak jawaban yang paling populer!\n` +
                `🎊 Game survey seru untuk semua!\n` +
                `💎 Setiap jawaban benar = ${winScore} poin!\n\n` +
                `🎲 *Mari mulai permainan survey...*\n` +
                `🔍 Pikirkan jawaban yang paling umum!`,
                
                `🌟 *FAMILY 100 CHALLENGE!* 🌟\n\n` +
                `🧠 Uji pengetahuan dan logika kalian!\n` +
                `🎯 Cari jawaban yang paling masuk akal!\n` +
                `🏅 Siapa yang akan jadi master survey?\n\n` +
                `🎨 *Get ready for the ultimate survey game!*\n` +
                `💡 Ingat, jawaban terpopuler yang dicari!`
            ];
            
            const randomMessage = challengeMessages[Math.floor(Math.random() * challengeMessages.length)];
            
            await bot.sendMessage(from, { 
                text: randomMessage,
                mentions: allMembers
            });
            
            // Delay 3 detik sebelum soal pertama
            setTimeout(() => {
                if (bot.game.family100[from]) {
                    sendQuestion(bot, from);
                }
            }, 3000);

        } else if (subCommand === 'leaderboard' || subCommand === 'lb') {
            const globalLeaderboard = bot.db.data.family100Leaderboard || {};
            const sortedGlobal = Object.entries(globalLeaderboard).sort(([, a], [, b]) => b - a).slice(0, 10);
            
            if (sortedGlobal.length === 0) {
                return bot.sendMessage(from, { text: '🏆 Leaderboard "Family 100" masih kosong.\n\nMulai bermain dengan `.family100 start`!' });
            }

            let text = '🏆 *LEADERBOARD GLOBAL FAMILY 100*\n\n';
            const mentions = [];
            sortedGlobal.forEach(([userId, score], index) => {
                const medal = index === 0 ? '👑' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏅';
                text += `${medal} ${index + 1}. @${userId.split('@')[0]} - *${score}* Poin\n`;
                mentions.push(userId);
            });
            
            text += `\n💡 *Tip:* Setiap jawaban benar memberikan ${winScore} poin!`;
            await bot.sendMessage(from, { text, mentions });

        } else if (subCommand === 'status') {
            const gameSession = bot.game.family100?.[from];
            if (!gameSession) {
                return bot.sendMessage(from, { 
                    text: '❌ Tidak ada sesi game yang aktif.\n\nMulai dengan `.family100 start`!' 
                });
            }

            if (!gameSession.soal) {
                return bot.sendMessage(from, { 
                    text: '🎯 Game sudah dimulai tapi belum ada soal.\nMenunggu soal pertama...' 
                });
            }

            await showCurrentStatus(bot, from, false);

        } else {
            const helpText = `🎯 *BANTUAN GAME FAMILY 100* 🎯\n\n` +
                           `📋 *Perintah yang tersedia:*\n\n` +
                           `1️⃣ \`.family100 start\`\n   🚀 Memulai sesi permainan baru\n\n` +
                           `2️⃣ \`.family100 leaderboard\`\n   🏆 Melihat peringkat poin global\n\n` +
                           `3️⃣ \`.family100 status\`\n   📊 Melihat status game saat ini\n\n` +
                           `🎮 *Cara Bermain:*\n` +
                           `• Bot akan mengirimkan pertanyaan survey\n` +
                           `• Langsung ketik jawaban di chat (tanpa reply)\n` +
                           `• Cari semua jawaban yang tersedia\n` +
                           `• Setiap jawaban benar = ${winScore} poin\n` +
                           `• Game berlanjut ke soal berikutnya otomatis\n` +
                           `• Game berakhir jika tidak ada aktivitas 120 detik\n` +
                           `• Ketik "nyerah" untuk mengakhiri game\n\n` +
                           `💡 *Tips:* Pikirkan jawaban yang paling umum dan populer!`;
            await bot.sendMessage(from, { text: helpText });
        }
    },
    checkAnswer,
    sendQuestion,
    endGame
};