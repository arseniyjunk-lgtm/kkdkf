const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ==================== КОНФИГУРАЦИЯ ====================
const TOKEN = '8457323450:AAGuPjJVdAjddmIPivP_xR0SEibD7_LijzU'; // 🔴 СЮДА ВСТАВЬТЕ ТОКЕН
const ADMIN_ID = '5156389903'; // 🔴 ВАШ TELEGRAM ID

const app = express();
const bot = new TelegramBot(TOKEN, { polling: true });
const PORT = process.env.PORT || 3000;

// Путь к файлу с данными
const DATA_FILE = path.join(__dirname, 'users_data.json');

// Загрузка данных
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Ошибка загрузки данных:', error);
    }
    return { users: {}, depositRequests: [], withdrawRequests: [] };
}

// Сохранение данных
function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Ошибка сохранения данных:', error);
    }
}

// API для веб-приложения
app.use(express.json());

app.post('/api/sync', (req, res) => {
    const data = loadData();
    const userData = req.body;

    if (userData.userId) {
        if (!data.users[userData.userId]) {
            data.users[userData.userId] = {
                id: userData.userId,
                name: userData.userName,
                balance: 0,
                transactions: [],
                registered: new Date().toLocaleString()
            };
        }
        data.users[userData.userId].lastSeen = new Date().toLocaleString();
        data.users[userData.userId].balance = userData.balance;

        if (userData.depositRequests) {
            data.depositRequests = userData.depositRequests;
        }
        if (userData.withdrawRequests) {
            data.withdrawRequests = userData.withdrawRequests;
        }

        saveData(data);
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.get('/api/data', (req, res) => {
    const data = loadData();
    res.json(data);
});

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    if (chatId.toString() === ADMIN_ID) {
        bot.sendMessage(chatId, '👑 Добро пожаловать в админ-панель!', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📊 Статистика', callback_data: 'stats' }],
                    [{ text: '💰 Заявки на пополнение', callback_data: 'deposits' }],
                    [{ text: '💸 Заявки на вывод', callback_data: 'withdraws' }],
                    [{ text: '👥 Все пользователи', callback_data: 'users' }]
                ]
            }
        });
    } else {
        bot.sendMessage(chatId, '🎰 Добро пожаловать в Darkz Casino!\n\nОткройте приложение через меню бота.');
    }
});

// Обработка кнопок
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;

    if (chatId.toString() !== ADMIN_ID) {
        bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Доступ запрещен' });
        return;
    }

    const db = loadData();

    if (data === 'stats') {
        const users = Object.values(db.users);
        const totalStars = users.reduce((sum, u) => sum + (u.balance || 0), 0);
        const pendingDeposits = db.depositRequests?.filter(r => r.status === 'pending').length || 0;
        const pendingWithdraws = db.withdrawRequests?.filter(r => r.status === 'pending').length || 0;

        bot.sendMessage(chatId, `
📊 *СТАТИСТИКА*

👥 Игроков: ${users.length}
⭐ Всего звезд: ${totalStars}

💰 Ожидают пополнений: ${pendingDeposits}
💸 Ожидают выводов: ${pendingWithdraws}
        `, { parse_mode: 'Markdown' });
    }

    if (data === 'deposits') {
        const requests = db.depositRequests?.filter(r => r.status === 'pending') || [];

        if (requests.length === 0) {
            bot.sendMessage(chatId, '💰 Нет новых заявок');
            return;
        }

        for (const req of requests) {
            bot.sendMessage(chatId, `
💰 *ЗАЯВКА*
Пользователь: ${req.userName}
ID: \`${req.userId}\`
Сумма: ${req.amount} ⭐
Метод: ${req.method}
            `, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅', callback_data: `approve_deposit_${req.id}` },
                            { text: '❌', callback_data: `reject_deposit_${req.id}` }
                        ]
                    ]
                }
            });
        }
    }

    if (data === 'withdraws') {
        const requests = db.withdrawRequests?.filter(r => r.status === 'pending') || [];

        if (requests.length === 0) {
            bot.sendMessage(chatId, '💸 Нет новых заявок');
            return;
        }

        for (const req of requests) {
            bot.sendMessage(chatId, `
💸 *ЗАЯВКА*
Пользователь: ${req.userName}
ID: \`${req.userId}\`
Сумма: ${req.amount} ⭐
Реквизиты: ${req.details}
            `, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅', callback_data: `approve_withdraw_${req.id}` },
                            { text: '❌', callback_data: `reject_withdraw_${req.id}` }
                        ]
                    ]
                }
            });
        }
    }

    if (data === 'users') {
        const users = Object.values(db.users);
        let text = '👥 *ПОЛЬЗОВАТЕЛИ*\n\n';

        users.slice(0, 10).forEach((u, i) => {
            text += `${i+1}. ${u.name} - ${u.balance} ⭐\n`;
        });

        bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    }

    // Обработка подтверждения пополнения
    if (data.startsWith('approve_deposit_')) {
        const id = parseInt(data.replace('approve_deposit_', ''));
        const req = db.depositRequests?.find(r => r.id === id);

        if (req) {
            const user = db.users[req.userId];
            if (user) {
                user.balance += req.amount;
                req.status = 'approved';
                saveData(db);
                bot.sendMessage(chatId, `✅ Пополнение ${req.amount} ⭐ подтверждено`);
            }
        }
    }

    if (data.startsWith('reject_deposit_')) {
        const id = parseInt(data.replace('reject_deposit_', ''));
        const req = db.depositRequests?.find(r => r.id === id);
        if (req) {
            req.status = 'rejected';
            saveData(db);
            bot.sendMessage(chatId, `❌ Пополнение отклонено`);
        }
    }

    // Обработка вывода
    if (data.startsWith('approve_withdraw_')) {
        const id = parseInt(data.replace('approve_withdraw_', ''));
        const req = db.withdrawRequests?.find(r => r.id === id);

        if (req) {
            const user = db.users[req.userId];
            if (user && user.balance >= req.amount) {
                user.balance -= req.amount;
                req.status = 'approved';
                saveData(db);
                bot.sendMessage(chatId, `✅ Вывод ${req.amount} ⭐ подтвержден`);
            } else {
                bot.sendMessage(chatId, `❌ Недостаточно средств`);
            }
        }
    }

    if (data.startsWith('reject_withdraw_')) {
        const id = parseInt(data.replace('reject_withdraw_', ''));
        const req = db.withdrawRequests?.find(r => r.id === id);
        if (req) {
            req.status = 'rejected';
            saveData(db);
            bot.sendMessage(chatId, `❌ Вывод отклонен`);
        }
    }

    bot.answerCallbackQuery(callbackQuery.id);
});

app.get('/', (req, res) => {
    res.send('Bot is running!');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});