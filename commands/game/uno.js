const { proto, generateWAMessageFromContent, prepareWAMessageMedia } = require('lily-baileys');
const fs = require('fs');
const path = require('path');

// --- Fungsi Helper ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// FIX 1: Mengambil fungsi konversi nama file dari uno copy.js
const valueToString = (value) => {
    switch (value) {
        case '0': return 'zero';
        case '1': return 'one';
        case '2': return 'two';
        case '3': return 'three';
        case '4': return 'four';
        case '5': return 'five';
        case '6': return 'six';
        case '7': return 'seven';
        case '8': return 'eight';
        case '9': return 'nine';
        case 'Draw Two': return 'draw-two';
        case 'Wild Draw Four': return 'wild-draw-four';
        case 'Wild': return 'wild';
        default: return value.toLowerCase();
    }
};

const colorToString = (color) => {
    return color.toLowerCase();
};

const cardToFileName = (card) => {
    if (card.isWild) {
        return `${valueToString(card.value)}.png`;
    }
    return `${colorToString(card.color)}_${valueToString(card.value)}.png`;
};


/**
 * Fungsi baru untuk mengirim kartu pemain ke private message (PM)
 * Mengirim setiap kartu sebagai gambar dengan tombol.
 * @param {object} bot Objek bot Baileys
 * @param {object} player Objek pemain (id, name, hand)
 * @param {object} game Objek game saat ini
 */
async function sendPlayerCards(bot, player, game) {
    try {
        const topCard = game.getTopCard();
        // FIX 2: Pesan "giliranmu" hanya untuk pemain aktif
        const initialMessage = player.id === game.getCurrentPlayer().id 
            ? ` giliranmu! Kartu teratas adalah *${topCard.color} ${topCard.value}*. Ini dek kartumu:`
            : `Menunggu giliran. Kartu teratas adalah *${topCard.color} ${topCard.value}*. Ini dek kartumu:`;
            
        await bot.sendMessage(player.id, { text: initialMessage });

        for (const card of player.hand) {
            const fileName = cardToFileName(card);
            const imagePath = path.join(__dirname, `../../lib/cards/${fileName}`);

            if (fs.existsSync(imagePath)) {
                let buttons;
                // FIX 6: Mengubah format buttonId dan displayText
                const cardValueForId = card.value.replace(/ /g, '_');
                const cardIdentifier = `${card.color}_${cardValueForId}`;

                if (card.isWild) {
                    const wildDisplayText = card.value === 'Wild' ? 'Wild' : '+4 Wild';
                    buttons = ['Red', 'Green', 'Blue', 'Yellow'].map(color => ({
                        // CommandHandler.js akan membaca displayText
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

                // Mengirim sebagai gambar dengan tombol untuk memastikan thumbnail terlihat
                await bot.sendMessage(player.id, {
                    image: fs.readFileSync(imagePath),
                    caption: `Kartu: *${card.color} ${card.value}*`,
                    footer: "UNO Game by 『∂αуℓιgнт』",
                    buttons: buttons,
                    headerType: 4
                });
                await sleep(350);
            } else {
                console.log(`[UNO] File kartu tidak ditemukan: ${imagePath}`);
                await bot.sendMessage(player.id, { text: `Kartu: ${card.color} ${card.value} (gambar tidak ditemukan)` });
            }
        }
    } catch (e) {
        console.error(`[UNO] Gagal mengirim kartu ke ${player.id}:`, e);
        try {
            await bot.sendMessage(player.id, { text: `Maaf, terjadi kesalahan saat mengirim kartumu. Coba ketik \`.uno cards\` di grup.` });
        } catch (err) {}
    }
}


// --- Class Game dan Card (Logika Inti) ---
class Card {
    constructor(color, value) {
        this.color = color;
        this.value = value;
    }
    get isSpecial() { return ['Draw Two', 'Skip', 'Reverse', 'Wild', 'Wild Draw Four'].includes(this.value); }
    get isWild() { return ['Wild', 'Wild Draw Four'].includes(this.value); }
}

class Game {
    constructor(chatId, creatorId) {
        this.chatId = chatId;
        this.creatorId = creatorId;
        this.players = [];
        this.deck = [];
        this.discardPile = [];
        this.currentPlayerIndex = 0;
        this.direction = 1;
        this.isGameRunning = false;
        this.unoCalled = {};
    }

    addPlayer(player) {
        if (!this.isGameRunning && this.players.length < 10) {
            this.players.push({ id: player.id, name: player.name, hand: [] });
            return true;
        }
        return false;
    }

    // FIX 5: Fungsi untuk mengacak urutan pemain
    shufflePlayers() {
        for (let i = this.players.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.players[i], this.players[j]] = [this.players[j], this.players[i]];
        }
    }

    startGame() {
        if (this.players.length < 2) return false;
        this.isGameRunning = true;
        this.shufflePlayers(); // Acak pemain sebelum mulai
        this.createDeck();
        this.shuffleDeck();
        this.dealCards();
        
        let firstCard = this.deck.pop();
        while (firstCard.isWild) {
            this.deck.push(firstCard);
            this.shuffleDeck();
            firstCard = this.deck.pop();
        }
        this.discardPile.push(firstCard);
        return true;
    }

    createDeck() {
        this.deck = [];
        const colors = ['Red', 'Green', 'Blue', 'Yellow'];
        const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Draw Two', 'Skip', 'Reverse'];
        const wildValues = ['Wild', 'Wild Draw Four'];
        colors.forEach(color => values.forEach(value => {
            this.deck.push(new Card(color, value));
            if (value !== '0') this.deck.push(new Card(color, value));
        }));
        wildValues.forEach(value => {
            for (let i = 0; i < 4; i++) this.deck.push(new Card('Wild', value));
        });
    }

    shuffleDeck() {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    dealCards() {
        this.players.forEach(player => {
            player.hand = [];
            for (let i = 0; i < 7; i++) {
                if (this.deck.length === 0) this.resetDeck();
                player.hand.push(this.deck.pop());
            }
        });
    }

    getCurrentPlayer() { return this.players[this.currentPlayerIndex]; }
    getTopCard() { return this.discardPile[this.discardPile.length - 1]; }
    
    getNextPlayer() {
        let nextIndex = (this.currentPlayerIndex + this.direction);
        if (nextIndex < 0) nextIndex = this.players.length - 1;
        else if (nextIndex >= this.players.length) nextIndex = 0;
        return this.players[nextIndex];
    }
    
    nextTurn() {
        this.currentPlayerIndex = (this.currentPlayerIndex + this.direction);
        if (this.currentPlayerIndex < 0) this.currentPlayerIndex = this.players.length - 1;
        else if (this.currentPlayerIndex >= this.players.length) this.currentPlayerIndex = 0;
    }

    drawCards(playerId, amount) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return;
        for (let i = 0; i < amount; i++) {
            if (this.deck.length === 0) this.resetDeck();
            player.hand.push(this.deck.pop());
        }
    }
    
    resetDeck() {
        this.deck = this.discardPile.slice(0, -1);
        this.discardPile = [this.discardPile.pop()];
        this.shuffleDeck();
    }
}

// --- Module Export dan Logika Perintah ---
module.exports = {
    name: 'uno',
    alias: ['uno'],
    description: 'Mainkan game UNO dengan teman-temanmu!',
    category: 'game',
    execute: async (msg, { bot, args, usedPrefix }) => {
        const { from, sender, senderName, body } = msg; // Ambil body dari serializer
        bot.uno = bot.uno || {};
        const command = args[0]?.toLowerCase();
        let game = bot.uno[from];
        
        // Logika untuk menangani klik tombol yang berasal dari PM
        // Karena `from` di PM adalah JID user, kita cari game aktif dimana user ini terdaftar
        if (!msg.isGroup) {
            const activeGames = Object.values(bot.uno);
            game = activeGames.find(g => g.isGameRunning && g.players.some(p => p.id === sender));
            
            if (game && (body.startsWith('.uno card') || body.startsWith('.uno wild'))) {
                const fromGroup = game.chatId;
                const currentPlayer = game.getCurrentPlayer();
                if (currentPlayer.id !== sender) return msg.reply('Sabar, ini bukan giliranmu!');
                
                const parts = body.split(' ');
                const cardType = parts[1];
                const cardData = parts.slice(2).join(' ');
                
                let color, value, chosenColor;
                
                if (cardType === 'card') {
                    [color, value] = cardData.split('_');
                    value = value.replace(/_/g, ' ');
                } else { // wild
                    const [wildIdentifier, wildColor] = cardData.split('|');
                    color = "Wild";
                    value = wildIdentifier.replace(/_/g, ' ');
                    chosenColor = wildColor;
                }

                const cardIndex = currentPlayer.hand.findIndex(c => c.color === color && c.value === value);
                if (cardIndex === -1) return msg.reply('Kartu tidak ditemukan di tanganmu. Mungkin sudah dimainkan? Coba ketik `.uno cards` di grup.');

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
                } else if (currentPlayer.hand.length > 1) {
                    game.unoCalled[sender] = false;
                }

                if (currentPlayer.hand.length === 0) {
                    await bot.sendMessage(fromGroup, { text: `🎉 @${sender.split('@')[0]} MENANG! Permainan selesai. Terima kasih sudah bermain!`, mentions: [sender] });
                    const playersInGame = game.players.map(p => p.id);
                    for(const player of playersInGame) {
                        bot.sendMessage(player, { text: 'Permainan telah berakhir karena sudah ada pemenangnya.' });
                    }
                    delete bot.uno[fromGroup];
                    return;
                }

                let skipTurn = false;
                if (playedCard.value === 'Reverse') { game.direction *= -1; await bot.sendMessage(fromGroup, { text: `↩️ Arah permainan dibalik!` }); }
                if (playedCard.value === 'Skip') { game.nextTurn(); skipTurn = true; const skippedPlayer = game.getCurrentPlayer(); await bot.sendMessage(fromGroup, { text: `🚫 Giliran @${skippedPlayer.id.split('@')[0]} dilewati!`, mentions: [skippedPlayer.id] }); }
                if (playedCard.value === 'Draw Two') { const p = game.getNextPlayer(); game.drawCards(p.id, 2); await bot.sendMessage(fromGroup, { text: `➕2️⃣ @${p.id.split('@')[0]} harus mengambil 2 kartu.`, mentions: [p.id] }); await sendPlayerCards(bot, p, game); game.nextTurn(); skipTurn = true; }
                if (playedCard.value === 'Wild Draw Four') { const p = game.getNextPlayer(); game.drawCards(p.id, 4); await bot.sendMessage(fromGroup, { text: `➕4️⃣ @${p.id.split('@')[0]} harus mengambil 4 kartu.`, mentions: [p.id] }); await sendPlayerCards(bot, p, game); game.nextTurn(); skipTurn = true; }
                
                if(!skipTurn) game.nextTurn();
                
                const nextPlayer = game.getCurrentPlayer();
                await bot.sendMessage(fromGroup, { text: `Sekarang giliran @${nextPlayer.id.split('@')[0]}! Cek PM untuk melihat kartumu.`, mentions: [nextPlayer.id] });
                await sendPlayerCards(bot, nextPlayer, game);
                return;
            }
        }

        // Logika perintah di grup
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
                    const imagePath = path.join(__dirname, `../../lib/cards/${fileName}`);

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
                    if (player !== sender) {
                        bot.sendMessage(player, { text: 'Permainan telah dihentikan oleh host.' });
                    }
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