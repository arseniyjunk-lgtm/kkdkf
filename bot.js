const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ==================== КОНФИГУРАЦИЯ ====================
const TOKEN = '8457323450:AAGuPjJVdAjddmIPivP_xR0SEibD7_LijzU';
const ADMIN_ID = '5156389903';

const app = express();
const bot = new TelegramBot(TOKEN, { polling: true });
const PORT = process.env.PORT || 3000;

// Путь к файлу с данными
const DATA_FILE = path.join(__dirname, 'users_data.json');

// ==================== РАБОТА С ДАННЫМИ ====================

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Ошибка загрузки данных:', error);
    }
    return {
        users: {},
        depositRequests: [],
        withdrawRequests: []
    };
}

function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Ошибка сохранения данных:', error);
    }
}

// ==================== API ДЛЯ ВЕБ-ПРИЛОЖЕНИЯ ====================

app.use(express.json({ limit: '50mb' }));

// Синхронизация данных из веб-приложения
app.post('/api/sync', (req, res) => {
    try {
        const { users, depositRequests, withdrawRequests } = req.body;
        const currentData = loadData();

        console.log('📥 Получены данные для синхронизации');

        // Обновляем пользователей
        if (users) {
            for (let userId in users) {
                if (userId !== '_global') {
                    if (!currentData.users[userId]) {
                        currentData.users[userId] = users[userId];
                    } else {
                        // Обновляем существующего пользователя
                        currentData.users[userId].balance = users[userId].balance;
                        currentData.users[userId].lastSeen = users[userId].lastSeen;
                        if (users[userId].transactions) {
                            currentData.users[userId].transactions = users[userId].transactions;
                        }
                    }
                }
            }
        }

        // Обновляем заявки
        if (depositRequests) {
            const existingIds = new Set(currentData.depositRequests.map(r => r.id));
            const newRequests = depositRequests.filter(r => !existingIds.has(r.id));
            currentData.depositRequests = [...currentData.depositRequests, ...newRequests];
        }

        if (withdrawRequests) {
            const existingIds = new Set(currentData.withdrawRequests.map(r => r.id));
            const newRequests = withdrawRequests.filter(r => !existingIds.has(r.id));
            currentData.withdrawRequests = [...currentData.withdrawRequests, ...newRequests];
        }

        saveData(currentData);
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка синхронизации:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Получение всех данных
app.get('/api/data', (req, res) => {
    try {
        const data = loadData();
        res.json(data);
    } catch (error) {
        console.error('Ошибка получения данных:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => {
    res.send('✅ Darkz Casino Bot is running!');
});

// ==================== КОМАНДЫ БОТА ====================

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    console.log(`📱 Пользователь ${userId} запустил бота`);

    if (userId === ADMIN_ID) {
        bot.sendMessage(chatId, '👑 **Добро пожаловать в админ-панель!**', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📊 СТАТИСТИКА', callback_data: 'stats' }],
                    [{ text: '💰 ЗАЯВКИ НА ПОПОЛНЕНИЕ', callback_data: 'deposits' }],
                    [{ text: '💸 ЗАЯВКИ НА ВЫВОД', callback_data: 'withdraws' }],
                    [{ text: '👥 ВСЕ ПОЛЬЗОВАТЕЛИ', callback_data: 'users' }],
                    [{ text: '⭐ ВЫДАТЬ ЗВЕЗДЫ', callback_data: 'give_stars' }]
                ]
            }
        });
    } else {
        bot.sendMessage(chatId, '🎰 **Добро пожаловать в Darkz Casino!**\n\nОткройте приложение через меню бота.', {
            parse_mode: 'Markdown'
        });
    }
});

// ==================== ОБРАБОТКА КНОПОК ====================

bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const userId = callbackQuery.from.id.toString();
    const data = callbackQuery.data;

    console.log(`🖱️ Нажата кнопка: ${data} от пользователя ${userId}`);

    if (userId !== ADMIN_ID) {
        bot.answerCallbackQuery(callbackQuery.id, {
            text: '❌ Доступ запрещен! Только для администратора.',
            show_alert: true
        });
        return;
    }

    const db = loadData();

    // ===== СТАТИСТИКА =====
    if (data === 'stats') {
        const users = Object.values(db.users);
        const totalStars = users.reduce((sum, u) => sum + (u.balance || 0), 0);
        const pendingDeposits = db.depositRequests?.filter(r => r.status === 'pending').length || 0;
        const pendingWithdraws = db.withdrawRequests?.filter(r => r.status === 'pending').length || 0;

        const text = `
📊 **СТАТИСТИКА**

👥 **Всего игроков:** ${users.length}
⭐ **Всего звезд в системе:** ${totalStars}

💰 **Ожидают пополнений:** ${pendingDeposits}
💸 **Ожидают выводов:** ${pendingWithdraws}
        `;

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(callbackQuery.id);
    }

    // ===== ЗАЯВКИ НА ПОПОЛНЕНИЕ =====
    else if (data === 'deposits') {
        const requests = db.depositRequests?.filter(r => r.status === 'pending') || [];

        if (requests.length === 0) {
            await bot.sendMessage(chatId, '💰 **Нет новых заявок на пополнение**', { parse_mode: 'Markdown' });
            bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        for (const req of requests) {
            const text = `
💰 **ЗАЯВКА НА ПОПОЛНЕНИЕ**
━━━━━━━━━━━━━━━━
👤 Пользователь: ${req.userName}
🆔 ID: \`${req.userId}\`
💵 Сумма: ${req.amount} ⭐
📱 Метод: ${req.method === 'stars' ? '⭐ Stars' : '💵 USDT'}
📅 Дата: ${req.date}
━━━━━━━━━━━━━━━━
            `;

            await bot.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ ПОДТВЕРДИТЬ', callback_data: `approve_deposit_${req.id}` },
                            { text: '❌ ОТКЛОНИТЬ', callback_data: `reject_deposit_${req.id}` }
                        ]
                    ]
                }
            });
        }
        bot.answerCallbackQuery(callbackQuery.id);
    }

    // ===== ЗАЯВКИ НА ВЫВОД =====
    else if (data === 'withdraws') {
        const requests = db.withdrawRequests?.filter(r => r.status === 'pending') || [];

        if (requests.length === 0) {
            await bot.sendMessage(chatId, '💸 **Нет новых заявок на вывод**', { parse_mode: 'Markdown' });
            bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        for (const req of requests) {
            const text = `
💸 **ЗАЯВКА НА ВЫВОД**
━━━━━━━━━━━━━━━━
👤 Пользователь: ${req.userName}
🆔 ID: \`${req.userId}\`
💵 Сумма: ${req.amount} ⭐
📱 Реквизиты: ${req.details}
📅 Дата: ${req.date}
━━━━━━━━━━━━━━━━
            `;

            await bot.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ ПОДТВЕРДИТЬ', callback_data: `approve_withdraw_${req.id}` },
                            { text: '❌ ОТКЛОНИТЬ', callback_data: `reject_withdraw_${req.id}` }
                        ]
                    ]
                }
            });
        }
        bot.answerCallbackQuery(callbackQuery.id);
    }

    // ===== ВСЕ ПОЛЬЗОВАТЕЛИ =====
    else if (data === 'users') {
        const users = Object.values(db.users);

        if (users.length === 0) {
            await bot.sendMessage(chatId, '👥 **Нет пользователей**', { parse_mode: 'Markdown' });
            bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        users.sort((a, b) => (b.balance || 0) - (a.balance || 0));

        let text = '👥 **ВСЕ ПОЛЬЗОВАТЕЛИ**\n━━━━━━━━━━━━━━━━\n\n';

        for (let i = 0; i < Math.min(15, users.length); i++) {
            const u = users[i];
            text += `${i+1}. **${u.name}**\n`;
            text += `   🆔 \`${u.id}\`\n`;
            text += `   ⭐ Баланс: ${u.balance || 0}\n`;
            text += `   📊 Транзакций: ${u.transactions?.length || 0}\n`;
            text += `   📅 Последний визит: ${u.lastSeen || 'неизвестно'}\n\n`;
        }

        if (users.length > 15) {
            text += `... и еще ${users.length - 15} пользователей\n`;
        }

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(callbackQuery.id);
    }

    // ===== ВЫДАЧА ЗВЕЗД =====
    else if (data === 'give_stars') {
        await bot.sendMessage(chatId, '⭐ **Введите ID пользователя и количество звезд через пробел**\n\nНапример:\n`5156389903 1000`', {
            parse_mode: 'Markdown'
        });
        bot.answerCallbackQuery(callbackQuery.id);
    }

    // ===== ПОДТВЕРЖДЕНИЕ ПОПОЛНЕНИЯ =====
    else if (data.startsWith('approve_deposit_')) {
        const id = parseInt(data.replace('approve_deposit_', ''));
        const req = db.depositRequests?.find(r => r.id === id);

        if (req) {
            const user = db.users[req.userId];
            if (user) {
                user.balance += req.amount;
                req.status = 'approved';

                if (!user.transactions) user.transactions = [];
                user.transactions.unshift({
                    type: 'deposit',
                    amount: req.amount,
                    method: req.method,
                    date: new Date().toLocaleString()
                });

                saveData(db);

                await bot.sendMessage(chatId, `✅ **Пополнение подтверждено!**\n\nПользователю ${req.userName} начислено ${req.amount} ⭐`, {
                    parse_mode: 'Markdown'
                });

                await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                    chat_id: chatId,
                    message_id: msg.message_id
                });
            }
        }
        bot.answerCallbackQuery(callbackQuery.id);
    }

    // ===== ОТКЛОНЕНИЕ ПОПОЛНЕНИЯ =====
    else if (data.startsWith('reject_deposit_')) {
        const id = parseInt(data.replace('reject_deposit_', ''));
        const req = db.depositRequests?.find(r => r.id === id);

        if (req) {
            req.status = 'rejected';
            saveData(db);

            await bot.sendMessage(chatId, `❌ **Заявка отклонена**\n\nСумма: ${req.amount} ⭐`, {
                parse_mode: 'Markdown'
            });

            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: chatId,
                message_id: msg.message_id
            });
        }
        bot.answerCallbackQuery(callbackQuery.id);
    }

    // ===== ПОДТВЕРЖДЕНИЕ ВЫВОДА =====
    else if (data.startsWith('approve_withdraw_')) {
        const id = parseInt(data.replace('approve_withdraw_', ''));
        const req = db.withdrawRequests?.find(r => r.id === id);

        if (req) {
            const user = db.users[req.userId];
            if (user) {
                if (user.balance >= req.amount) {
                    user.balance -= req.amount;
                    req.status = 'approved';

                    if (!user.transactions) user.transactions = [];
                    user.transactions.unshift({
                        type: 'withdraw',
                        amount: req.amount,
                        details: req.details,
                        date: new Date().toLocaleString()
                    });

                    saveData(db);

                    await bot.sendMessage(chatId, `✅ **Вывод подтвержден!**\n\nСо счета пользователя ${req.userName} списано ${req.amount} ⭐`, {
                        parse_mode: 'Markdown'
                    });

                    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                        chat_id: chatId,
                        message_id: msg.message_id
                    });
                } else {
                    await bot.sendMessage(chatId, `❌ **Ошибка!**\n\nУ пользователя недостаточно средств (баланс: ${user.balance} ⭐)`, {
                        parse_mode: 'Markdown'
                    });
                }
            }
        }
        bot.answerCallbackQuery(callbackQuery.id);
    }

    // ===== ОТКЛОНЕНИЕ ВЫВОДА =====
    else if (data.startsWith('reject_withdraw_')) {
        const id = parseInt(data.replace('reject_withdraw_', ''));
        const req = db.withdrawRequests?.find(r => r.id === id);

        if (req) {
            req.status = 'rejected';
            saveData(db);

            await bot.sendMessage(chatId, `❌ **Заявка отклонена**\n\nСумма: ${req.amount} ⭐`, {
                parse_mode: 'Markdown'
            });

            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: chatId,
                message_id: msg.message_id
            });
        }
        bot.answerCallbackQuery(callbackQuery.id);
    }
});

// ==================== ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ ====================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    if (userId !== ADMIN_ID) return;

    const parts = text.split(' ');
    if (parts.length === 2) {
        const targetUserId = parts[0].trim();
        const amount = parseInt(parts[1]);

        if (!isNaN(amount) && amount > 0) {
            const db = loadData();

            if (db.users[targetUserId]) {
                const user = db.users[targetUserId];
                user.balance += amount;

                if (!user.transactions) user.transactions = [];
                user.transactions.unshift({
                    type: 'admin_gift',
                    amount: amount,
                    date: new Date().toLocaleString()
                });

                saveData(db);

                await bot.sendMessage(chatId, `✅ **Звезды выданы!**\n\n👤 Пользователь: ${user.name}\n🆔 ID: \`${targetUserId}\`\n⭐ Сумма: +${amount}\n💰 Новый баланс: ${user.balance} ⭐`, {
                    parse_mode: 'Markdown'
                });
            } else {
                await bot.sendMessage(chatId, `❌ **Пользователь с ID \`${targetUserId}\` не найден!**`, {
                    parse_mode: 'Markdown'
                });
            }
        }
    }
});

// ==================== ЗАПУСК ====================

app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`✅ Админ ID: ${ADMIN_ID}`);
    console.log(`✅ Бот готов к работе!`);
});