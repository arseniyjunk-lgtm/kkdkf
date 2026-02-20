const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ==================== КОНФИГУРАЦИЯ ====================
// 🔴 ЗАМЕНИТЕ НА СВОИ ДАННЫЕ
const TOKEN = '8457323450:AAGuPjJVdAjddmIPivP_xR0SEibD7_LijzU'; // Токен от @BotFather
const ADMIN_ID = '5156389903'; // Ваш Telegram ID (узнать в @userinfobot)

const app = express();
const bot = new TelegramBot(TOKEN, { polling: true });
const PORT = process.env.PORT || 3000;

// Путь к файлу с данными
const DATA_FILE = path.join(__dirname, 'users_data.json');

// ==================== РАБОТА С ДАННЫМИ ====================

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
    return {
        users: {},
        depositRequests: [],
        withdrawRequests: []
    };
}

// Сохранение данных
function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Ошибка сохранения данных:', error);
    }
}

// ==================== API ДЛЯ ВЕБ-ПРИЛОЖЕНИЯ ====================

app.use(express.json());

// Синхронизация данных из веб-приложения
app.post('/api/sync', (req, res) => {
    try {
        const data = loadData();
        const userData = req.body;

        console.log('📥 Получены данные от пользователя:', userData.userId);

        if (userData.userId) {
            // Сохраняем или обновляем пользователя
            if (!data.users[userData.userId]) {
                data.users[userData.userId] = {
                    id: userData.userId,
                    name: userData.userName || 'Игрок',
                    balance: 0,
                    transactions: [],
                    registered: new Date().toLocaleString()
                };
            }

            // Обновляем данные пользователя
            data.users[userData.userId].name = userData.userName || data.users[userData.userId].name;
            data.users[userData.userId].balance = userData.balance || 0;
            data.users[userData.userId].lastSeen = new Date().toLocaleString();

            // Обновляем транзакции
            if (userData.transactions) {
                data.users[userData.userId].transactions = userData.transactions;
            }

            // Обновляем заявки (сохраняем все, не только текущего пользователя)
            if (userData.depositRequests) {
                // Добавляем новые заявки, сохраняя старые
                const existingIds = new Set(data.depositRequests.map(r => r.id));
                const newRequests = userData.depositRequests.filter(r => !existingIds.has(r.id));
                data.depositRequests = [...data.depositRequests, ...newRequests];
            }

            if (userData.withdrawRequests) {
                const existingIds = new Set(data.withdrawRequests.map(r => r.id));
                const newRequests = userData.withdrawRequests.filter(r => !existingIds.has(r.id));
                data.withdrawRequests = [...data.withdrawRequests, ...newRequests];
            }

            saveData(data);
            res.json({ success: true });
        } else {
            res.json({ success: false, error: 'No userId' });
        }
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

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    console.log(`📱 Пользователь ${userId} запустил бота`);

    if (userId === ADMIN_ID) {
        // Админ - показываем полное меню
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
        // Обычный пользователь
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

    // Проверка прав админа
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
        const totalDeposits = db.depositRequests?.length || 0;
        const totalWithdraws = db.withdrawRequests?.length || 0;
        const pendingDeposits = db.depositRequests?.filter(r => r.status === 'pending').length || 0;
        const pendingWithdraws = db.withdrawRequests?.filter(r => r.status === 'pending').length || 0;

        const text = `
📊 **СТАТИСТИКА**

👥 **Всего игроков:** ${users.length}
⭐ **Всего звезд в системе:** ${totalStars}

💰 **Пополнения:**
   • Всего: ${totalDeposits}
   • Ожидают: ${pendingDeposits}

💸 **Выводы:**
   • Всего: ${totalWithdraws}
   • Ожидают: ${pendingWithdraws}
        `;

        bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(callbackQuery.id);
    }

    // ===== ЗАЯВКИ НА ПОПОЛНЕНИЕ =====
    else if (data === 'deposits') {
        const requests = db.depositRequests?.filter(r => r.status === 'pending') || [];

        if (requests.length === 0) {
            bot.sendMessage(chatId, '💰 **Нет новых заявок на пополнение**', { parse_mode: 'Markdown' });
            bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        for (const req of requests) {
            const text = `
💰 **ЗАЯВКА НА ПОПОЛНЕНИЕ**
━━━━━━━━━━━━━━━━
🆔 ID заявки: \`${req.id}\`
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
            bot.sendMessage(chatId, '💸 **Нет новых заявок на вывод**', { parse_mode: 'Markdown' });
            bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        for (const req of requests) {
            const text = `
💸 **ЗАЯВКА НА ВЫВОД**
━━━━━━━━━━━━━━━━
🆔 ID заявки: \`${req.id}\`
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
            bot.sendMessage(chatId, '👥 **Нет пользователей**', { parse_mode: 'Markdown' });
            bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        // Сортируем по балансу (у кого больше звезд - сверху)
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

        bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(callbackQuery.id);
    }

    // ===== ВЫДАЧА ЗВЕЗД (запрос ID) =====
    else if (data === 'give_stars') {
        bot.sendMessage(chatId, '⭐ **Введите ID пользователя и количество звезд через пробел**\n\nНапример:\n`5156389903 1000`', {
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

                bot.sendMessage(chatId, `✅ **Пополнение подтверждено!**\n\nПользователю ${req.userName} начислено ${req.amount} ⭐`, {
                    parse_mode: 'Markdown'
                });

                // Обновляем сообщение с заявкой (убираем кнопки)
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
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

            bot.sendMessage(chatId, `❌ **Заявка отклонена**\n\nСумма: ${req.amount} ⭐`, {
                parse_mode: 'Markdown'
            });

            bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
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

                    bot.sendMessage(chatId, `✅ **Вывод подтвержден!**\n\nСо счета пользователя ${req.userName} списано ${req.amount} ⭐`, {
                        parse_mode: 'Markdown'
                    });

                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                        chat_id: chatId,
                        message_id: msg.message_id
                    });
                } else {
                    bot.sendMessage(chatId, `❌ **Ошибка!**\n\nУ пользователя недостаточно средств (баланс: ${user.balance} ⭐)`, {
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

            bot.sendMessage(chatId, `❌ **Заявка отклонена**\n\nСумма: ${req.amount} ⭐`, {
                parse_mode: 'Markdown'
            });

            bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: chatId,
                message_id: msg.message_id
            });
        }
        bot.answerCallbackQuery(callbackQuery.id);
    }
});

// ==================== ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ (ДЛЯ ВЫДАЧИ ЗВЕЗД) ====================

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const text = msg.text;

    // Игнорируем команды
    if (!text || text.startsWith('/')) return;

    // Только админ может выдавать звезды
    if (userId !== ADMIN_ID) return;

    // Парсим сообщение: ожидаем "ID СУММА"
    const parts = text.split(' ');
    if (parts.length === 2) {
        const targetUserId = parts[0].trim();
        const amount = parseInt(parts[1]);

        if (!isNaN(amount) && amount > 0) {
            const db = loadData();

            // Ищем пользователя по ID
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

                bot.sendMessage(chatId, `✅ **Звезды выданы!**\n\n👤 Пользователь: ${user.name}\n🆔 ID: \`${targetUserId}\`\n⭐ Сумма: +${amount}\n💰 Новый баланс: ${user.balance} ⭐`, {
                    parse_mode: 'Markdown'
                });
            } else {
                bot.sendMessage(chatId, `❌ **Пользователь с ID \`${targetUserId}\` не найден!**`, {
                    parse_mode: 'Markdown'
                });
            }
        } else {
            bot.sendMessage(chatId, '❌ **Неверная сумма!** Введите положительное число.', {
                parse_mode: 'Markdown'
            });
        }
    } else if (parts.length !== 2 && !text.startsWith('/')) {
        // Если сообщение не подходит под формат, но админ его отправил - показываем подсказку
        bot.sendMessage(chatId, '⭐ **Формат выдачи звезд:**\n`ID СУММА`\n\nНапример: `5156389903 1000`', {
            parse_mode: 'Markdown'
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================

app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`✅ Админ ID: ${ADMIN_ID}`);
    console.log(`✅ Бот готов к работе!`);
});