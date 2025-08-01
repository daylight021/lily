const { proto } = require('lily-baileys');
const fs = require('fs');
const path = require('path');

// --- Fungsi Helper ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// FIX 1: Menggunakan fungsi konversi nama file yang benar dari file uno copy.js Anda
const valueToString = (value) => {
    switch (value) {
        case '0': return 'zero'; case '1': return 'one'; case '2': return 'two'; case '3': return 'three'; case '4': return 'four'; case '5': return 'five';
        case '6': return 'six'; case '7': return 'seven'; case '8': return 'eight'; case '9': return 'nine';
        case 'Draw Two': return 'draw-two'; case 'Wild Draw Four': return 'wild-draw-four'; case 'Wild': return 'wild';
        default: return value.toLowerCase();
    }
};
const colorToString = (color) => color.toLowerCase();
const cardToFileName = (card) => card.isWild ? `${valueToString(card.value)}.png` : `${colorToString(card.color)}_${valueToString(card.value)}.png`;

/**
 * Fungsi untuk mengirim kartu pemain ke private message (PM)
 * @param {object} bot Objek bot Baileys
 * @param {object} player Objek pemain (id, name, hand)
 * @param {object} game Objek game saat ini
 */
async function sendPlayerCards(bot, player, game) {
    try {
        const topCard = game.getTopCard();
        // FIX 2: Pesan "giliranmu!" hanya dikirim ke pemain yang aktif
        const initialMessage = player.id === game.getCurrentPlayer().id
            ? ` giliranmu! Kartu teratas di meja adalah *${topCard.color} ${topCard.value}*. Ini dek kartumu:`
            : `Menunggu giliran. Kartu teratas adalah *${topCard.color} ${topCard.value}*. Ini dek kartumu:`;

        await bot.sendMessage(player.id, { text: initialMessage });

        // FIX 4: Pastikan semua kartu terkirim
        for (const card of player.hand) {
            const fileName = cardToFileName(card);
            const imagePath = path.join(__dirname, `../../media/uno/${fileName}`);

            if (fs.existsSync(imagePath)) {
                let buttons;
                const cardIdentifier = `${card.color.replace(/ /g, '_')}_${card.value.replace(/ /g, '_')}`;

                // FIX 6: Sesuaikan displayText agar cocok dengan CommandHandler.js
                if (card.isWild) {
                    const wildDisplayText = card.value === 'Wild' ? 'Wild' : '+4 Wild';
                    buttons = ['Red', 'Green', 'Blue', 'Yellow'].map(color => ({
                        buttonId: `.uno wild ${cardIdentifier}|${color}`,
                        buttonText: { displayText: `Mainkan ${wildDisplayText} ${color}` },
                        type: 1
                    }));
                } else {
                    buttons = [{
                        buttonId: `.uno card ${cardIdentifier}`,
                        buttonText: { displayText: `Mainkan Kartu ${card.color} ${card.value}` },
                        type: 1
                    }];
                }
                
                // FIX 3: Mengirim sebagai gambar dengan tombol
                await bot.sendMessage(player.id, {
                    image: fs.readFileSync(imagePath),
                    caption: `Kartu: *${card.color} ${card.value}*`,
                    footer: "UNO Game by Shikimori",
                    buttons: buttons,
                    headerType: 4
                });
                await sleep(400); // Jeda diperlambat sedikit untuk stabilitas
            } else {
                console.log(`[UNO] File kartu tidak ditemukan: ${imagePath}`);
            }
        }
    } catch (e) {
        console.error(`[UNO] Gagal mengirim kartu ke ${player.id}:`, e);
    }
}

// --- Class Game dan Card ---
class Card {
    constructor(color, value) { this.color = color; this.value = value; }
    get isSpecial() { return ['Draw Two', 'Skip', 'Reverse', 'Wild', 'Wild Draw Four'].includes(this.value); }
    get isWild() { return ['Wild', 'Wild Draw Four'].includes(this.value); }
}

class Game {
    constructor(chatId, creatorId) {
        this.chatId = chatId; this.creatorId = creatorId; this.players = []; this.deck = [];
        this.discardPile = []; this.currentPlayerIndex = 0; this.direction = 1;
        this.isGameRunning = false; this.unoCalled = {};
    }
    addPlayer(player) {
        if (!this.isGameRunning && this.players.length < 10) {
            this.players.push({ id: player.id, name: player.name, hand: [] });
            return true;
        }
        return false;
    }
    shufflePlayers() {
        for (let i = this.players.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.players[i], this.players[j]] = [this.players[j], this.players[i]];
        }
    }
    startGame() {
        if (this.players.length < 2) return false;
        this.isGameRunning = true; this.shufflePlayers(); this.createDeck(); this.shuffleDeck(); this.dealCards();
        let firstCard = this.deck.pop();
        while (firstCard.isWild) { this.deck.push(firstCard); this.shuffleDeck(); firstCard = this.deck.pop(); }
        this.discardPile.push(firstCard);
        return true;
    }
    createDeck() {
        this.deck = [];
        const c = ['Red', 'Green', 'Blue', 'Yellow'], v = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Draw Two', 'Skip', 'Reverse'], w = ['Wild', 'Wild Draw Four'];
        c.forEach(a => v.forEach(b => { this.deck.push(new Card(a, b)); if (b !== '0') this.deck.push(new Card(a, b)); }));
        w.forEach(a => { for (let i = 0; i < 4; i++) this.deck.push(new Card('Wild', a)); });
    }
    shuffleDeck() { for (let i = this.deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]]; } }
    dealCards() { this.players.forEach(p => { p.hand = []; for (let i = 0; i < 7; i++) { if (this.deck.length === 0) this.resetDeck(); p.hand.push(this.deck.pop()); } }); }
    getCurrentPlayer() { return this.players[this.currentPlayerIndex]; }
    getTopCard() { return this.discardPile[this.discardPile.length - 1]; }
    getNextPlayer() {
        let nextIndex = (this.currentPlayerIndex + this.direction);
        if (nextIndex < 0) nextIndex = this.players.length - 1; else if (nextIndex >= this.players.length) nextIndex = 0;
        return this.players[nextIndex];
    }
    nextTurn() {
        this.currentPlayerIndex = (this.currentPlayerIndex + this.direction);
        if (this.currentPlayerIndex < 0) this.currentPlayerIndex = this.players.length - 1;
        else if (this.currentPlayerIndex >= this.players.length) this.currentPlayerIndex = 0;
    }
    drawCards(playerId, amount) {
        const p = this.players.find(pl => pl.id === playerId);
        if (!p) return;
        for (let i = 0; i < amount; i++) { if (this.deck.length === 0) this.resetDeck(); p.hand.push(this.deck.pop()); }
    }
    resetDeck() { this.deck = this.discardPile.slice(0, -1); this.discardPile = [this.discardPile.pop()]; this.shuffleDeck(); }
}

// --- Module Export dan Logika Perintah ---
module.exports = {
    name: 'uno',
    alias: ['uno'],
    description: 'Mainkan game UNO dengan teman-temanmu!',
    category: 'game',
    execute: async (msg, { bot, args, usedPrefix }) => {
        const { from, sender, senderName, body } = msg;
        bot.uno = bot.uno || {};
        const command = args[0]?.toLowerCase();
        let game = bot.uno[from];

        if (!msg.isGroup && body.startsWith('Mainkan Kartu')) {
            const activeGames = Object.values(bot.uno);
            game = activeGames.find(g => g.isGameRunning && g.players.some(p => p.id === sender));
            if (!game) return msg.reply('Kamu tidak sedang dalam permainan UNO manapun.');
            
            const fromGroup = game.chatId;
            const currentPlayer = game.getCurrentPlayer();
            if (currentPlayer.id !== sender) return msg.reply('Sabar, ini bukan giliranmu!');
            
            // Parsing dari displayText
            let parts = body.replace('Mainkan Kartu ', '').split(' ');
            let color, value, chosenColor;
            
            if (parts[0] === 'Wild' || parts[0] === '+4') {
                value = parts[0] === 'Wild' ? 'Wild' : 'Wild Draw Four';
                color = 'Wild';
                chosenColor = parts[parts.length - 1];
            } else {
                color = parts[0];
                value = parts.slice(1).join(' ');
            }

            const cardIndex = currentPlayer.hand.findIndex(c => c.color.toLowerCase() === color.toLowerCase() && c.value.toLowerCase() === value.toLowerCase());
            if (cardIndex === -1) return msg.reply('Kartu tidak ditemukan di tanganmu. Coba ketik `.uno cards` di grup.');

            const playedCard = currentPlayer.hand[cardIndex];
            const topCard = game.getTopCard();
            
            if (!playedCard.isWild && playedCard.color !== topCard.color && playedCard.value !== topCard.value) {
                return msg.reply('Kartu tidak cocok dengan kartu teratas!');
            }

            if (playedCard.isWild) playedCard.color = chosenColor;

            currentPlayer.hand.splice(cardIndex, 1);
            game.discardPile.push(playedCard);
            
            let announcement = `@${sender.split('@')[0]} memainkan kartu *${playedCard.color} ${playedCard.value}*.`;
            if(playedCard.isWild) announcement = `@${sender.split('@')[0]} memainkan *${value}* dan memilih warna *${chosenColor}*.`;
            await bot.sendMessage(fromGroup, { text: announcement, mentions: [sender] });
            
            if (currentPlayer.hand.length === 1) {
                game.unoCalled[sender] = true;
                await bot.sendMessage(fromGroup, { text: `UNO! @${sender.split('@')[0]} sisa 1 kartu!`, mentions: [sender] });
            } else {
                game.unoCalled[sender] = false;
            }

            if (currentPlayer.hand.length === 0) {
                await bot.sendMessage(fromGroup, { text: `🎉 @${sender.split('@')[0]} MENANG! Permainan selesai. Terima kasih sudah bermain!`, mentions: [sender] });
                const playersInGame = game.players.map(p => p.id);
                for(const player of playersInGame) bot.sendMessage(player, { text: 'Permainan telah berakhir karena sudah ada pemenangnya.' });
                delete bot.uno[fromGroup];
                return;
            }

            let skipTurn = false;
            if (playedCard.value === 'Reverse') { game.direction *= -1; await bot.sendMessage(fromGroup, { text: `↩️ Arah permainan dibalik!` }); }
            if (playedCard.value === 'Skip') { game.nextTurn(); skipTurn = true; const p = game.getCurrentPlayer(); await bot.sendMessage(fromGroup, { text: `🚫 Giliran @${p.id.split('@')[0]} dilewati!`, mentions: [p.id] }); }
            if (playedCard.value === 'Draw Two') { const p = game.getNextPlayer(); game.drawCards(p.id, 2); await bot.sendMessage(fromGroup, { text: `➕2️⃣ @${p.id.split('@')[0]} harus mengambil 2 kartu.`, mentions: [p.id] }); await sendPlayerCards(bot, p, game); game.nextTurn(); skipTurn = true; }
            if (playedCard.value === 'Wild Draw Four') { const p = game.getNextPlayer(); game.drawCards(p.id, 4); await bot.sendMessage(fromGroup, { text: `➕4️⃣ @${p.id.split('@')[0]} harus mengambil 4 kartu.`, mentions: [p.id] }); await sendPlayerCards(bot, p, game); game.nextTurn(); skipTurn = true; }
            
            if(!skipTurn) game.nextTurn();
            
            const nextPlayer = game.getCurrentPlayer();
            await bot.sendMessage(fromGroup, { text: `Sekarang giliran @${nextPlayer.id.split('@')[0]}! Cek PM untuk melihat kartumu.`, mentions: [nextPlayer.id] });
            await sendPlayerCards(bot, nextPlayer, game);
            return;
        }

        switch (command) {
            case 'create':
                if (game) return msg.reply('Sudah ada sesi UNO di grup ini.');
                bot.uno[from] = new Game(from, sender);
                game = bot.uno[from];
                game.addPlayer({ id: sender, name: senderName });
                msg.reply(`Sesi UNO berhasil dibuat oleh @${sender.split('@')[0]}!\n\nPemain lain bisa bergabung dengan mengetik \`.uno join\`.`, { mentions: [sender] });
                break;

            case 'join': {
                if (!game) return msg.reply('Tidak ada sesi UNO. Ketik `.uno create` untuk memulai.');
                if (game.isGameRunning) return msg.reply('Game sudah dimulai, tidak bisa bergabung.');
                if (game.players.find(p => p.id === sender)) return msg.reply('Kamu sudah bergabung.');

                if (game.addPlayer({ id: sender, name: senderName })) {
                    const playerMentions = game.players.map(p => p.id);
                    const playerList = game.players.map(p => `- @${p.id.split('@')[0]}`).join('\n');
                    msg.reply(`@${sender.split('@')[0]} berhasil bergabung!\n\n*Pemain di Lobi (${game.players.length}/10):*\n${playerList}`, { mentions: [...playerMentions, sender] });
                } else {
                    msg.reply('Gagal bergabung. Lobi sudah penuh.');
                }
                break;
            }

            case 'start': {
                if (!game) return msg.reply('Tidak ada sesi UNO. Buat dulu dengan `.uno create`.');
                if (game.creatorId !== sender) return msg.reply('Hanya pembuat sesi yang bisa memulai game.');
                if (game.players.length < 2) return msg.reply('Minimal butuh 2 pemain untuk memulai!');

                if (game.startGame()) {
                    await msg.reply('Permainan UNO dimulai! Mengirim 7 kartu awal ke setiap pemain di PM...');
                    
                    for (const player of game.players) {
                        await sendPlayerCards(bot, player, game);
                    }
                    
                    const currentPlayer = game.getCurrentPlayer();
                    const topCard = game.getTopCard();
                    const fileName = cardToFileName(topCard);
                    const imagePath = path.join(__dirname, `../../media/uno/${fileName}`);

                    if (fs.existsSync(imagePath)) {
                        await bot.sendMessage(from, {
                            image: fs.readFileSync(imagePath),
                            caption: `Kartu pertama adalah *${topCard.color} ${topCard.value}*.\n\nGiliran pertama adalah @${currentPlayer.id.split('@')[0]}!`,
                            mentions: [currentPlayer.id]
                        });
                    } else {
                         await bot.sendMessage(from, { text: `Kartu pertama adalah *${topCard.color} ${topCard.value}*.\n\nGiliran pertama adalah @${currentPlayer.id.split('@')[0]}!`, mentions: [currentPlayer.id] });
                    }
                } else {
                    msg.reply('Gagal memulai game.');
                }
                break;
            }
            
            case 'draw': {
                 if (!game || !game.isGameRunning) return msg.reply('Game belum dimulai.');
                 const currentPlayer = game.getCurrentPlayer();
                 if (currentPlayer.id !== sender) return msg.reply('Bukan giliranmu!');
                 
                 game.drawCards(sender, 1);
                 await msg.reply('Kamu mengambil 1 kartu. Kartu baru telah dikirim ke PM.');
                 
                 game.nextTurn();
                 const nextPlayer = game.getCurrentPlayer();
                 
                 await bot.sendMessage(from, { text: `@${sender.split('@')[0]} telah mengambil kartu. Sekarang giliran @${nextPlayer.id.split('@')[0]}!`, mentions: [sender, nextPlayer.id] });
                 await sendPlayerCards(bot, currentPlayer, game);
                 await sendPlayerCards(bot, nextPlayer, game);
                 break;
            }

            case 'cards':
            case 'kartu': {
                if (!game || !game.isGameRunning) return msg.reply('Game belum dimulai.');
                const player = game.players.find(p => p.id === sender);
                if (!player) return msg.reply('Kamu tidak ada dalam game ini.');
                await sendPlayerCards(bot, player, game);
                msg.reply('Kartu terbarumu sudah dikirim ulang ke PM.');
                break;
            }
            
            case 'end':
                if (!game) return msg.reply('Tidak ada sesi UNO.');
                if (game.creatorId !== sender) return msg.reply('Hanya pembuat sesi yang bisa mengakhiri game.');
                
                const playersToEnd = game.players.map(p => p.id);
                for (const player of playersToEnd) {
                    if (player !== sender) bot.sendMessage(player, { text: 'Permainan telah dihentikan oleh host.' });
                }
                
                delete bot.uno[from];
                msg.reply('Sesi UNO telah dihentikan.');
                break;
                
            default:
                msg.reply('🃏 *Perintah Game UNO* 🃏\n\n`.uno create` - Membuat lobi permainan\n`.uno join` - Bergabung ke lobi\n`.uno start` - Memulai permainan\n`.uno cards` - Meminta kartu dikirim ulang ke PM\n`.uno draw` - Mengambil satu kartu dari dek\n`.uno end` - Menghentikan permainan (hanya host)');
                break;
        }
    }
};