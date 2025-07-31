const { proto, generateWAMessageFromContent, prepareWAMessageMedia } = require('lily-baileys');
const fs = require('fs');

// Mengirim setiap kartu sebagai dokumen dengan thumbnail dan tombol
async function sendPlayerCards(bot, player) {
    await bot.sendMessage(player.id, { text: ` giliranmu! Ini kartumu saat ini. Pilih satu untuk dimainkan.` });
    
    for (const card of player.hand) {
        const cardName = card.isSpecial ? `${card.color}_${card.value}` : `${card.color}_${card.value}`;
        const imagePath = `./media/uno/${cardName.toLowerCase()}.png`;

        if (fs.existsSync(imagePath)) {
            // Membuat tombol dengan perintah yang akan ditangkap oleh Serializer.js
            let buttons = [{
                buttonId: `.uno card ${card.color} ${card.value}`,
                buttonText: { displayText: 'Mainkan Kartu Ini 🃏' },
                type: 1
            }];
            
            // Jika kartu adalah Wild, tambahkan opsi untuk memilih warna
            if (card.value === 'Wild' || card.value === 'Wild Draw Four') {
                buttons = ['Red', 'Green', 'Blue', 'Yellow'].map(color => ({
                    buttonId: `.uno wild ${card.value === 'Wild' ? 'wild' : 'wild_draw_four'} ${color}`,
                    buttonText: { displayText: `Pilih Warna ${color}` },
                    type: 1
                }));
            }

            // Mengirim kartu sebagai dokumen dengan thumbnail
            await bot.sendMessage(player.id, {
                document: fs.readFileSync(imagePath),
                mimetype: 'image/png',
                fileName: `UNO Card - ${card.color} ${card.value}.png`,
                jpegThumbnail: fs.readFileSync(imagePath), // Thumbnail agar terlihat seperti gambar
                caption: `Kartu Anda: ${card.color} ${card.value}`,
                footer: `Klik tombol untuk memainkan kartu ini`,
                buttons: buttons,
                headerType: 5
            });
            // Beri jeda sedikit agar tidak ter-spam
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
}


// --- Logika Inti Game UNO (Sebagian besar tidak diubah) ---
class Card {
    constructor(color, value) {
        this.color = color;
        this.value = value;
    }

    get isSpecial() {
        return ['Draw Two', 'Skip', 'Reverse', 'Wild', 'Wild Draw Four'].includes(this.value);
    }

    get isWild() {
        return ['Wild', 'Wild Draw Four'].includes(this.value);
    }
}

class Game {
    constructor(chatId, creatorId) {
        this.chatId = chatId;
        this.creatorId = creatorId;
        this.players = [];
        this.deck = [];
        this.discardPile = [];
        this.currentPlayerIndex = 0;
        this.direction = 1; // 1 for forward, -1 for reverse
        this.isGameRunning = false;
        this.unoCalled = {}; // player id -> boolean
    }

    addPlayer(player) {
        if (!this.isGameRunning && this.players.length < 10) {
            this.players.push({ id: player, hand: [] });
            return true;
        }
        return false;
    }

    startGame(bot) {
        if (this.players.length < 2) return false;
        this.isGameRunning = true;
        this.createDeck();
        this.shuffleDeck();
        this.dealCards();

        // Letakkan kartu pertama yang bisa dimainkan
        let firstCard = this.deck.pop();
        while (firstCard.isWild) {
            this.deck.push(firstCard);
            this.shuffleDeck();
            firstCard = this.deck.pop();
        }
        this.discardPile.push(firstCard);
        
        // Kirim kartu ke semua pemain via PM
        this.players.forEach(p => {
            bot.sendMessage(p.id, { text: `Permainan UNO dimulai! Kartu Anda ada di bawah.` });
        });

        return true;
    }
    
    // ... (sisa metode dari class Game seperti createDeck, shuffleDeck, dll tetap sama)
    createDeck() {
        const colors = ['Red', 'Green', 'Blue', 'Yellow'];
        const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Draw Two', 'Skip', 'Reverse'];
        const wildValues = ['Wild', 'Wild Draw Four'];

        colors.forEach(color => {
            values.forEach(value => {
                this.deck.push(new Card(color, value));
                if (value !== '0') {
                    this.deck.push(new Card(color, value));
                }
            });
        });

        wildValues.forEach(value => {
            for (let i = 0; i < 4; i++) {
                this.deck.push(new Card('Wild', value));
            }
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
            for (let i = 0; i < 7; i++) {
                player.hand.push(this.deck.pop());
            }
        });
    }
    
    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }
    
    getTopCard() {
        return this.discardPile[this.discardPile.length - 1];
    }
    
    playCard(playerId, cardIndex, chosenColor = null) {
        const player = this.players.find(p => p.id === playerId);
        if (!player || player !== this.getCurrentPlayer()) return 'Bukan giliranmu!';

        const card = player.hand[cardIndex];
        const topCard = this.getTopCard();

        if (card.isWild) {
            if (!chosenColor) return 'Pilih warna!';
            card.color = chosenColor; // Ganti warna kartu wild
        } else if (card.color !== topCard.color && card.value !== topCard.value) {
            return 'Kartu tidak cocok!';
        }

        player.hand.splice(cardIndex, 1);
        this.discardPile.push(card);

        // Logika kartu spesial
        if (card.value === 'Reverse') this.direction *= -1;
        if (card.value === 'Skip') this.nextTurn();
        if (card.value === 'Draw Two') {
            const nextPlayer = this.getNextPlayer();
            this.drawCards(nextPlayer.id, 2);
            this.nextTurn();
        }
        if (card.value === 'Wild Draw Four') {
            const nextPlayer = this.getNextPlayer();
            this.drawCards(nextPlayer.id, 4);
            this.nextTurn();
        }

        // Cek UNO
        if (player.hand.length === 1 && !this.unoCalled[playerId]) {
            this.drawCards(playerId, 2); // Penalti
            return `Pemain ${player.id.split('@')[0]} lupa bilang UNO! Ambil 2 kartu.`;
        } else if (player.hand.length > 1) {
            this.unoCalled[playerId] = false; // Reset status UNO
        }
        
        this.nextTurn();
        return { card, player };
    }

    drawCards(playerId, amount) {
        const player = this.players.find(p => p.id === playerId);
        for (let i = 0; i < amount; i++) {
            if (this.deck.length === 0) this.resetDeck();
            player.hand.push(this.deck.pop());
        }
    }

    nextTurn() {
        this.currentPlayerIndex = (this.currentPlayerIndex + this.direction + this.players.length) % this.players.length;
    }
    
    getNextPlayer() {
        const nextIndex = (this.currentPlayerIndex + this.direction + this.players.length) % this.players.length;
        return this.players[nextIndex];
    }

    resetDeck() {
        this.deck = [...this.discardPile.slice(0, -1)];
        this.shuffleDeck();
        this.discardPile = [this.discardPile.pop()];
    }
}


module.exports = {
    name: 'uno',
    alias: ['uno'],
    description: 'Mainkan game UNO dengan teman-temanmu!',
    category: 'game',
    execute: async (msg, { bot, args }) => {
        const { from, sender } = msg;
        bot.uno = bot.uno || {};
        const command = args[0]?.toLowerCase();
        let game = bot.uno[from];

        switch (command) {
            case 'create':
                if (game) return msg.reply('Sudah ada sesi UNO di grup ini.');
                bot.uno[from] = new Game(from, sender);
                msg.reply('Sesi UNO berhasil dibuat! Ketik `.uno join` untuk bergabung.');
                break;

            case 'join':
                if (!game) return msg.reply('Tidak ada sesi UNO di grup ini. Ketik `.uno create` untuk memulai.');
                if (game.players.find(p => p.id === sender)) return msg.reply('Kamu sudah bergabung.');
                if (game.addPlayer(sender)) {
                    msg.reply(`Kamu berhasil bergabung! Pemain saat ini: ${game.players.length}`);
                } else {
                    msg.reply('Gagal bergabung. Mungkin game sudah dimulai atau sudah penuh.');
                }
                break;

            case 'start':
                if (!game) return msg.reply('Tidak ada sesi UNO. Buat dulu dengan `.uno create`.');
                if (game.creatorId !== sender) return msg.reply('Hanya pembuat sesi yang bisa memulai game.');
                if (game.startGame(bot)) {
                    msg.reply('Permainan UNO dimulai! Cek PM untuk melihat kartumu.');
                    const currentPlayer = game.getCurrentPlayer();
                    await bot.sendMessage(from, { text: `Kartu pertama adalah ${game.getTopCard().color} ${game.getTopCard().value}. Giliran pertama adalah @${currentPlayer.id.split('@')[0]}!`, mentions: [currentPlayer.id] });
                    await sendPlayerCards(bot, currentPlayer);
                } else {
                    msg.reply('Gagal memulai game. Minimal harus ada 2 pemain.');
                }
                break;

            // KASUS BARU UNTUK MENANGANI TOMBOL
            case 'card': {
                if (!game || !game.isGameRunning) return msg.reply('Game belum dimulai.');
                if (msg.isGroup) return msg.reply('Mainkan kartu melalui tombol di chat pribadi (PM)!');
                
                const currentPlayer = game.getCurrentPlayer();
                if (currentPlayer.id !== sender) return msg.reply('Bukan giliranmu!');

                const [_, color, value] = msg.body.split(' ');
                const cardToPlay = currentPlayer.hand.findIndex(c => c.color.toLowerCase() === color.toLowerCase() && c.value.toLowerCase() === value.toLowerCase());

                if (cardToPlay === -1) return msg.reply('Kamu tidak punya kartu itu!');

                const topCard = game.getTopCard();
                const playedCard = currentPlayer.hand[cardToPlay];
                
                if (playedCard.color !== topCard.color && playedCard.value !== topCard.value && !playedCard.isWild) {
                    return msg.reply('Kartu tidak cocok dengan kartu teratas!');
                }

                // Mainkan kartu
                currentPlayer.hand.splice(cardToPlay, 1);
                game.discardPile.push(playedCard);
                
                // Cek UNO
                if (currentPlayer.hand.length === 1) {
                    game.unoCalled[sender] = true; // Otomatis panggil UNO
                    bot.sendMessage(from, { text: `UNO! @${sender.split('@')[0]} sisa 1 kartu!`, mentions: [sender] });
                }
                
                // Cek kemenangan
                if (currentPlayer.hand.length === 0) {
                    bot.sendMessage(from, { text: `🎉 @${sender.split('@')[0]} MENANG! Permainan selesai.`, mentions: [sender] });
                    delete bot.uno[from];
                    return;
                }
                
                // Logika kartu spesial
                if (playedCard.value === 'Reverse') game.direction *= -1;
                if (playedCard.value === 'Skip') game.nextTurn();
                if (playedCard.value === 'Draw Two') {
                    const nextPlayer = game.getNextPlayer();
                    game.drawCards(nextPlayer.id, 2);
                    bot.sendMessage(from, { text: `@${nextPlayer.id.split('@')[0]} harus mengambil 2 kartu.`, mentions: [nextPlayer.id] });
                    game.nextTurn();
                }

                game.nextTurn();
                const nextPlayer = game.getCurrentPlayer();

                await bot.sendMessage(from, { text: `@${sender.split('@')[0]} memainkan kartu ${playedCard.color} ${playedCard.value}.\n\nSekarang giliran @${nextPlayer.id.split('@')[0]}!`, mentions: [sender, nextPlayer.id] });
                
                // Kirim kartu ke pemain selanjutnya
                await sendPlayerCards(bot, nextPlayer);
                break;
            }
                
            case 'wild': {
                if (!game || !game.isGameRunning) return msg.reply('Game belum dimulai.');
                if (msg.isGroup) return msg.reply('Pilih warna melalui tombol di chat pribadi (PM)!');
                
                const currentPlayer = game.getCurrentPlayer();
                if (currentPlayer.id !== sender) return msg.reply('Bukan giliranmu!');

                const [_, wildType, chosenColor] = msg.body.split(' ');
                const cardValue = wildType === 'wild' ? 'Wild' : 'Wild Draw Four';
                
                const cardIndex = currentPlayer.hand.findIndex(c => c.value === cardValue);
                if (cardIndex === -1) return msg.reply('Kamu tidak punya kartu Wild itu!');

                const playedCard = currentPlayer.hand[cardIndex];
                playedCard.color = chosenColor; // Set warna pilihan

                // Mainkan kartu
                currentPlayer.hand.splice(cardIndex, 1);
                game.discardPile.push(playedCard);

                bot.sendMessage(from, { text: `@${sender.split('@')[0]} memainkan ${cardValue} dan memilih warna ${chosenColor}.`, mentions: [sender] });

                if (cardValue === 'Wild Draw Four') {
                    const nextPlayer = game.getNextPlayer();
                    game.drawCards(nextPlayer.id, 4);
                    bot.sendMessage(from, { text: `@${nextPlayer.id.split('@')[0]} harus mengambil 4 kartu.`, mentions: [nextPlayer.id] });
                    game.nextTurn();
                }

                game.nextTurn();
                const nextPlayer = game.getCurrentPlayer();

                await bot.sendMessage(from, { text: `Sekarang giliran @${nextPlayer.id.split('@')[0]}!`, mentions: [nextPlayer.id] });
                await sendPlayerCards(bot, nextPlayer); // Kirim kartu ke pemain selanjutnya
                break;
            }

            case 'draw': {
                 if (!game || !game.isGameRunning) return msg.reply('Game belum dimulai.');
                 const currentPlayer = game.getCurrentPlayer();
                 if (currentPlayer.id !== sender) return msg.reply('Bukan giliranmu!');
                 
                 game.drawCards(sender, 1);
                 msg.reply('Kamu mengambil 1 kartu. Cek PM.');
                 
                 game.nextTurn();
                 const nextPlayer = game.getCurrentPlayer();
                 
                 await bot.sendMessage(from, { text: `@${sender.split('@')[0]} telah mengambil kartu. Sekarang giliran @${nextPlayer.id.split('@')[0]}!`, mentions: [sender, nextPlayer.id] });
                 await sendPlayerCards(bot, currentPlayer); // Update kartu di tangan sendiri
                 await sendPlayerCards(bot, nextPlayer); // Kirim kartu ke pemain selanjutnya
                 break;
            }

            case 'cards':
            case 'kartu': {
                if (!game || !game.isGameRunning) return msg.reply('Game belum dimulai.');
                const player = game.players.find(p => p.id === sender);
                if (!player) return msg.reply('Kamu tidak ada dalam game ini.');
                await sendPlayerCards(bot, player);
                msg.reply('Kartu terbarumu sudah dikirim ke PM.');
                break;
            }
                
            case 'exit':
            case 'leave':
                if (!game) return msg.reply('Tidak ada sesi UNO.');
                const playerIndex = game.players.findIndex(p => p.id === sender);
                if (playerIndex === -1) return msg.reply('Kamu tidak ada dalam game ini.');
                
                game.players.splice(playerIndex, 1);
                msg.reply('Kamu telah keluar dari permainan.');
                
                if (game.isGameRunning && game.players.length < 2) {
                     bot.sendMessage(from, { text: 'Pemain kurang dari 2, permainan dihentikan.' });
                     delete bot.uno[from];
                }
                break;

            case 'end':
                if (!game) return msg.reply('Tidak ada sesi UNO.');
                if (game.creatorId !== sender) return msg.reply('Hanya pembuat sesi yang bisa mengakhiri game.');
                delete bot.uno[from];
                msg.reply('Sesi UNO telah dihentikan.');
                break;
                
            default:
                msg.reply('Perintah UNO:\n`.uno create` - Membuat room\n`.uno join` - Bergabung\n`.uno start` - Memulai game\n`.uno cards` - Cek kartu di PM\n`.uno draw` - Ambil kartu\n`.uno leave` - Keluar\n`.uno end` - Mengakhiri game');
                break;
        }
    }
};