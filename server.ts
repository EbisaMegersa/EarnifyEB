import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import TelegramBot from 'node-telegram-bot-api';
import {
  connectDatabase,
  isDatabaseConnected,
  getUser,
  addUser,
  referUser,
  updateUserBalance,
  removeBalance,
  updateUserAccNo,
  getAllUsers,
  addWithdrawal,
  getWithdrawals,
  updateWithdrawalStatus
} from './db_store';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Load Config from Environment
const PORT = Number(process.env.PORT || '3000');
const TOKEN = process.env.TOKEN || '';
const OWNER_ID = Number(process.env.OWNER_ID || '0');
const LOGGER_ID = Number(process.env.LOGGER_ID || '0');
const FSUB_IDS = (process.env.FSUB_IDS || '').split(',').map(Number).filter(n => !isNaN(n) && n !== 0);
const SECRET_TOKEN = process.env.SECRET_TOKEN || 'SherlockSecretToken';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

// Database connection (Asynchronous / Non-blocking to guarantee instant port binding)
connectDatabase(process.env.MONGO_URI).catch(err => {
  console.error('[DB] Database connection error:', err);
});

// Conversation states for the bot (in-memory)
// Keys are chat IDs, values are the current expected state
const userStates = new Map<number, 'SetAcc' | 'Withdrawal'>();

// Bot status
let botInfo: any = null;
let botError: string | null = null;
let telegramBot: TelegramBot | null = null;

// Initialize Telegram Bot
if (TOKEN) {
  try {
    if (WEBHOOK_URL) {
      telegramBot = new TelegramBot(TOKEN, { webHook: false });
      // Set webhook
      const webhookUrlWithToken = `${WEBHOOK_URL.endsWith('/') ? WEBHOOK_URL : WEBHOOK_URL + '/'}${TOKEN}`;
      await telegramBot.setWebHook(webhookUrlWithToken, {
        secret_token: SECRET_TOKEN,
        allowed_updates: ['message', 'callback_query']
      });
      console.log(`[BOT] Webhook set to: ${webhookUrlWithToken}`);
    } else {
      // In development, we use polling
      telegramBot = new TelegramBot(TOKEN, { polling: true });
      console.log('[BOT] Polling started in background');
    }

    telegramBot.getMe().then((me) => {
      botInfo = me;
      console.log(`[BOT] Connected as: @${me.username}`);
    }).catch(err => {
      botError = err.message || 'Failed to authenticate bot token';
      console.error('[BOT] Error fetching bot details:', err);
    });

    setupBotHandlers(telegramBot);
  } catch (err: any) {
    botError = err.message || 'Failed to initialize bot client';
    console.error('[BOT] Initialization error:', err);
  }
} else {
  botError = 'TOKEN environment variable is not set';
  console.warn('[BOT] Token not set. Telegram Bot is disabled.');
}

// Handler helper for Force Sub (fSub) checking
async function checkForceSubscription(bot: TelegramBot, chatId: number, userId: number, startArg = ''): Promise<boolean> {
  if (FSUB_IDS.length === 0) {
    return true; // No forced subscription set
  }

  const memberStatuses = ['member', 'administrator', 'creator'];

  for (const channelId of FSUB_IDS) {
    try {
      const member = await bot.getChatMember(channelId, userId);
      if (!memberStatuses.includes(member.status)) {
        // Fetch invite link
        let inviteLink = '';
        try {
          const chat = await bot.getChat(channelId);
          inviteLink = chat.invite_link || '';
        } catch {
          // Fallback invite link generation
          try {
            inviteLink = await bot.exportChatInviteLink(channelId);
          } catch {
            inviteLink = `https://t.me/c/${Math.abs(channelId)}`;
          }
        }

        // Generate Keyboard
        const inline_keyboard: any[][] = [[{ text: 'Jᴏɪɴ Cʜᴀɴɴᴇʟ', url: inviteLink }]];
        if (startArg) {
          inline_keyboard.push([{ text: 'Tʀʏ ᴀɢᴀɪɴ', url: `https://t.me/${botInfo?.username || 'bot'}?start=${startArg}` }]);
        }

        await bot.sendMessage(chatId, '❌ *You must be a member of our channel to use this bot.*\n\nPlease join and click Try Again.', {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard }
        });
        return false;
      }
    } catch (err) {
      console.error(`[BOT] Error checking chat member for channel ${channelId}:`, err);
      // If we can't check, let's allow or warning
    }
  }

  return true;
}

// Set up bot command & interaction handlers
function setupBotHandlers(bot: TelegramBot) {
  // Generate Main Menu Keyboard
  const getMainMenuMarkup = (userId: number) => {
    const referUrl = `https://t.me/${botInfo?.username || 'bot'}?start=${userId}`;
    return {
      inline_keyboard: [
        [
          { text: '👤 Owner', url: OWNER_ID ? `tg://user?id=${OWNER_ID}` : 'https://t.me/' }
        ],
        [
          { text: '🔗 Refer & Earn', url: `https://t.me/share/url?url=${encodeURIComponent(referUrl)}` },
          { text: 'ℹ️ Info', callback_data: `info.${userId}` }
        ],
        [
          { text: '💼 Wallet', callback_data: `wallet.${userId}` },
          { text: '💸 Withdraw', callback_data: `withdraw.${userId}` }
        ]
      ]
    };
  };

  // /start command
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!userId) return;

    const startArg = match ? (match[1] || '').trim() : '';

    // Check forcing channel subscriptions
    const isSubscribed = await checkForceSubscription(bot, chatId, userId, startArg);
    if (!isSubscribed) return;

    try {
      const existingUser = await getUser(userId);
      const firstName = msg.from?.first_name || `User ${userId}`;

      if (existingUser) {
        // Welcome back existing user
        const replyText = `👋 *Welcome back, ${firstName}!*\n\n` +
          `💰 *Balance:* ${existingUser.Balance.toFixed(2)} tokens\n` +
          `🤝 *Referred Users:* ${existingUser.ReferredUsers ? existingUser.ReferredUsers.length : 0}\n\n` +
          `🚀 Keep earning rewards by referring your friends!`;

        await bot.sendMessage(chatId, replyText, {
          parse_mode: 'Markdown',
          reply_markup: getMainMenuMarkup(userId)
        });
        return;
      }

      // Handle referral signup
      let referrerID = 0;
      if (startArg) {
        const parsedReferrer = parseInt(startArg, 10);
        if (!isNaN(parsedReferrer) && parsedReferrer > 0 && parsedReferrer !== userId) {
          const referrer = await getUser(parsedReferrer);
          if (referrer) {
            referrerID = parsedReferrer;
            await referUser(referrerID, userId, firstName);
            
            // Credit Referrer
            await updateUserBalance(referrerID, 10.0);
            
            // Notify referrer
            try {
              await bot.sendMessage(referrerID, `🎉 *Referral Successful!*\n\n` +
                `👤 You referred *${firstName}* (${userId}) successfully!\n` +
                `💵 You’ve earned *10.00 tokens*! Keep sharing and earning more! 🚀`, {
                parse_mode: 'Markdown'
              });
            } catch (err) {
              console.error(`[BOT] Failed to notify referrer ${referrerID}:`, err);
            }
          } else {
            await bot.sendMessage(chatId, '❌ *The referral code is not valid.*', { parse_mode: 'Markdown' });
          }
        }
      }

      // If no valid referrer, register as standard user
      if (referrerID === 0) {
        await addUser({
          ID: userId,
          Referrer: 0,
          ReferredUsers: [],
          AccNo: 0,
          Balance: 0.0,
          firstName,
          createdAt: new Date().toISOString()
        });
      }

      // Success greeting for new registration
      const welcomeText = `🎉 *Welcome to the Refer & Earn Bot, ${firstName}!*\n\n` +
        `💰 *Balance:* 0.00 tokens\n` +
        `🤝 *Referred Users:* 0\n\n` +
        `🔗 Use your referral link to invite friends and earn rewards!`;

      await bot.sendMessage(chatId, welcomeText, {
        parse_mode: 'Markdown',
        reply_markup: getMainMenuMarkup(userId)
      });
    } catch (err) {
      console.error('[BOT] Start command error:', err);
      await bot.sendMessage(chatId, '❌ An error occurred while processing your request. Please try /start again.');
    }
  });

  // /help command
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const text = `*🤖 Bot Commands*\n` +
      `Here are the commands you can use:\n\n` +
      `*🔹 General Commands*\n` +
      `/start - 🚀 Start the bot\n` +
      `/help - 📖 Show this help message\n` +
      `/info - ℹ️ Show your user info\n` +
      `/accno <account_number> - 🆔 Set/update account number\n\n` +
      `*🔸 Owner Commands*\n` +
      `/add <user_id> <amount> - ➕ Add balance\n` +
      `/remove <user_id> <amount> - ➖ Remove balance\n` +
      `/stats - 📊 Show bot statistics\n` +
      `/broadcast - 📢 Broadcast a message (reply to target)\n\n` +
      `⚠️ _Note: Owner commands are restricted to the bot owner only._`;

    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🏠 Home', callback_data: 'home' }]]
      }
    });
  });

  // /info command
  bot.onText(/\/info(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    let targetUserId = msg.from?.id;
    if (!targetUserId) return;

    if (match && match[1]) {
      const parsedId = parseInt(match[1].trim(), 10);
      if (!isNaN(parsedId)) {
        targetUserId = parsedId;
      }
    }

    try {
      const info = await getUser(targetUserId);
      if (!info) {
        await bot.sendMessage(chatId, '❌ *User not found in database.*', { parse_mode: 'Markdown' });
        return;
      }

      const text = `👤 *User Information*\n\n` +
        `🔹 *User ID:* \`${info.ID}\`\n` +
        `🔗 *Referrer ID:* \`${info.Referrer}\`\n` +
        `🤝 *Referred Users:* ${info.ReferredUsers ? info.ReferredUsers.length : 0}\n` +
        `💰 *Account Balance:* ${info.Balance.toFixed(2)} tokens\n` +
        `🆔 *Account Number:* \`${info.AccNo || 'Not Set'}\``;

      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[BOT] Info command error:', err);
    }
  });

  // /accno command
  bot.onText(/\/accno(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!userId) return;

    if (!match || !match[1]) {
      await bot.sendMessage(chatId, '❌ Please provide an account number.\nUsage: `/accno <account_number>`', { parse_mode: 'Markdown' });
      return;
    }

    const accNo = parseInt(match[1].trim(), 10);
    if (isNaN(accNo) || accNo <= 0) {
      await bot.sendMessage(chatId, '❌ Invalid account number. Must be a positive numeric value.', { parse_mode: 'Markdown' });
      return;
    }

    try {
      await updateUserAccNo(userId, accNo);
      await bot.sendMessage(chatId, `✅ *Account number updated successfully!*\n\n🔹 *New Account Number:* \`${accNo}\``, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[BOT] accno command error:', err);
      await bot.sendMessage(chatId, '❌ Failed to update account number.');
    }
  });

  // /cancel command
  bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;
    userStates.delete(chatId);
    await bot.sendMessage(chatId, '❌ *Conversation cancelled*', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🏠 Home', callback_data: 'home' }]]
      }
    });
  });

  // /add command (Owner only)
  bot.onText(/\/add\s+(\d+)\s+([\d.]+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (userId !== OWNER_ID) {
      await bot.sendMessage(chatId, '❌ You are not authorized to use this command.');
      return;
    }

    if (!match) return;
    const targetId = parseInt(match[1], 10);
    const amount = parseFloat(match[2]);

    if (isNaN(targetId) || isNaN(amount) || amount <= 0) {
      await bot.sendMessage(chatId, '❌ Invalid input parameters.');
      return;
    }

    try {
      await updateUserBalance(targetId, amount);
      const updated = await getUser(targetId);
      await bot.sendMessage(chatId, `✅ Successfully added balance for user *${targetId}*.\n\n` +
        `🔹 *Amount Added:* ${amount.toFixed(2)}\n` +
        `💵 *New Balance:* ${updated?.Balance.toFixed(2)} tokens`, { parse_mode: 'Markdown' });
    } catch (err: any) {
      await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  });

  // /remove command (Owner only)
  bot.onText(/\/remove\s+(\d+)\s+([\d.]+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (userId !== OWNER_ID) {
      await bot.sendMessage(chatId, '❌ You are not authorized to use this command.');
      return;
    }

    if (!match) return;
    const targetId = parseInt(match[1], 10);
    const amount = parseFloat(match[2]);

    if (isNaN(targetId) || isNaN(amount) || amount <= 0) {
      await bot.sendMessage(chatId, '❌ Invalid input parameters.');
      return;
    }

    try {
      await removeBalance(targetId, amount);
      const updated = await getUser(targetId);
      await bot.sendMessage(chatId, `✅ Successfully deducted balance for user *${targetId}*.\n\n` +
        `🔹 *Amount Deducted:* ${amount.toFixed(2)}\n` +
        `💵 *New Balance:* ${updated?.Balance.toFixed(2)} tokens`, { parse_mode: 'Markdown' });
    } catch (err: any) {
      await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  });

  // /stats command (Owner only)
  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (userId !== OWNER_ID) {
      await bot.sendMessage(chatId, '❌ You are not authorized to use this command.');
      return;
    }

    try {
      const users = await getAllUsers();
      await bot.sendMessage(chatId, `📊 *Bot Statistics*\n\n` +
        `Total Registered Users: *${users.length}*\n` +
        `Total Wallet Balances: *${users.reduce((acc, u) => acc + u.Balance, 0).toFixed(2)}* tokens`, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[BOT] Stats error:', err);
    }
  });

  // /broadcast command (Owner only)
  bot.onText(/\/broadcast/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (userId !== OWNER_ID) {
      await bot.sendMessage(chatId, '❌ You are not authorized to use this command.');
      return;
    }

    const replyMsg = msg.reply_to_message;
    if (!replyMsg) {
      await bot.sendMessage(chatId, '❌ *Reply to a message to broadcast it.*', { parse_mode: 'Markdown' });
      return;
    }

    try {
      const users = await getAllUsers();
      await bot.sendMessage(chatId, `📢 *Broadcasting message to ${users.length} users...*`, { parse_mode: 'Markdown' });

      let successCount = 0;
      for (const u of users) {
        try {
          await bot.copyMessage(u.ID, chatId, replyMsg.message_id, {
            reply_markup: replyMsg.reply_markup
          });
          successCount++;
        } catch (err) {
          // ignore failures for blocked users
        }
        // sleep 33ms to avoid hitting limits
        await new Promise(resolve => setTimeout(resolve, 33));
      }

      await bot.sendMessage(chatId, `✅ *Broadcast complete!*\n\nSuccessfully sent to *${successCount}/${users.length}* active users.`, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[BOT] Broadcast error:', err);
    }
  });

  // Callback query dispatcher
  bot.on('callback_query', async (query) => {
    const data = query.data || '';
    const chatId = query.message?.chat.id;
    const msgId = query.message?.message_id;
    if (!chatId || !msgId) return;

    try {
      // Home callback
      if (data === 'home') {
        const u = await getUser(query.from.id);
        if (!u) {
          await bot.answerCallbackQuery(query.id, { text: 'User not registered. Send /start' });
          return;
        }

        const replyText = `👋 *Welcome back, ${query.from.first_name}!*\n\n` +
          `💰 *Balance:* ${u.Balance.toFixed(2)} tokens\n` +
          `🤝 *Referred Users:* ${u.ReferredUsers ? u.ReferredUsers.length : 0}\n\n` +
          `🚀 Keep earning rewards by referring your friends!`;

        await bot.editMessageText(replyText, {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'Markdown',
          reply_markup: getMainMenuMarkup(u.ID)
        });
        await bot.answerCallbackQuery(query.id, { text: 'Main Menu loaded' });
      }

      // Info callback
      else if (data.startsWith('info.')) {
        const targetId = Number(data.split('.')[1]);
        const info = await getUser(targetId);
        if (!info) {
          await bot.answerCallbackQuery(query.id, { text: 'User not found' });
          return;
        }

        const text = `👤 *User Information*\n\n` +
          `🔹 *User ID:* \`${info.ID}\`\n` +
          `🔗 *Referrer ID:* \`${info.Referrer}\`\n` +
          `🤝 *Referred Users:* ${info.ReferredUsers ? info.ReferredUsers.length : 0}\n` +
          `💰 *Account Balance:* ${info.Balance.toFixed(2)} tokens\n` +
          `🆔 *Account Number:* \`${info.AccNo || 'Not Set'}\``;

        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🏠 Home', callback_data: 'home' }]]
          }
        });
        await bot.answerCallbackQuery(query.id, { text: 'User info loaded' });
      }

      // Wallet callback
      else if (data.startsWith('wallet.')) {
        const targetId = Number(data.split('.')[1]);
        const info = await getUser(targetId);
        if (!info) {
          await bot.answerCallbackQuery(query.id, { text: 'User not found' });
          return;
        }

        const text = `💰 *Wallet Information*\n\n` +
          `🔹 *User ID:* \`${info.ID}\`\n` +
          `🔗 *Referrer ID:* \`${info.Referrer}\`\n` +
          `🤝 *Referred Users:* ${info.ReferredUsers ? info.ReferredUsers.length : 0}\n` +
          `💵 *Account Balance:* ${info.Balance.toFixed(2)} tokens\n` +
          `🆔 *Account Number:* \`${info.AccNo || 'Not Set'}\``;

        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🆔 Set Account Number', callback_data: `setAccNo.${info.ID}` }],
              [
                { text: '💸 Withdraw', callback_data: `withdraw.${info.ID}` },
                { text: '🏠 Home', callback_data: 'home' }
              ]
            ]
          }
        });
        await bot.answerCallbackQuery(query.id, { text: 'Wallet loaded' });
      }

      // Set account number prompt
      else if (data.startsWith('setAccNo.')) {
        const targetId = Number(data.split('.')[1]);
        if (query.from.id !== targetId) {
          await bot.answerCallbackQuery(query.id, { text: 'Unauthorized callback action' });
          return;
        }

        userStates.set(chatId, 'SetAcc');
        await bot.editMessageText('🆔 *Please enter your Account Number:*\n\nSend the number as a reply. To abort, send /cancel .', {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'Markdown'
        });
        await bot.answerCallbackQuery(query.id);
      }

      // Withdraw amount prompt
      else if (data.startsWith('withdraw.')) {
        const targetId = Number(data.split('.')[1]);
        if (query.from.id !== targetId) {
          await bot.answerCallbackQuery(query.id, { text: 'Unauthorized callback action' });
          return;
        }

        const user = await getUser(targetId);
        if (!user) return;

        if (user.Balance <= 0) {
          await bot.answerCallbackQuery(query.id, { text: '❌ You have no balance to withdraw', show_alert: true });
          return;
        }

        if (!user.AccNo) {
          await bot.answerCallbackQuery(query.id, { text: '❌ Please set your account number first', show_alert: true });
          return;
        }

        userStates.set(chatId, 'Withdrawal');
        await bot.editMessageText(`💸 *Please send the amount you wish to withdraw.*\n\nAvailable Balance: *${user.Balance.toFixed(2)} tokens*\n\nTo cancel, send /cancel .`, {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'Markdown'
        });
        await bot.answerCallbackQuery(query.id);
      }

      // Confirm withdrawal (Logger Channel Action)
      else if (data.startsWith('confirm_withdrawal.')) {
        const parts = data.split('.');
        const targetUserId = Number(parts[1]);
        const amount = Number(parts[2]);
        const reqId = parts[3] || '';

        // Check and confirm
        await bot.answerCallbackQuery(query.id, { text: 'Processing approval...' });

        // Update withdrawal in DB
        let finalId = reqId;
        if (!finalId) {
          // Fallback, try to find matching pending withdrawal
          const pendingList = await getWithdrawals();
          const found = pendingList.find(w => w.userId === targetUserId && w.amount === amount && w.status === 'pending');
          if (found) finalId = found.id;
        }

        if (finalId) {
          await updateWithdrawalStatus(finalId, 'approved');
        }

        await bot.editMessageText(`✅ *Approved!*\n\nAmount of *${amount.toFixed(2)} tokens* successfully processed for user \`${targetUserId}\`.`, {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'Markdown'
        });

        // Send alert to User
        try {
          const approvalMessage = `🎉 *Withdrawal Approved!*\n\n` +
            `✅ Your withdrawal request has been successfully approved!\n\n` +
            `💸 *Amount:* ${amount.toFixed(2)} tokens\n\n` +
            `Thank you for trusting us! 🚀`;
          await bot.sendMessage(targetUserId, approvalMessage, { parse_mode: 'Markdown' });
        } catch (err) {
          console.error(`[BOT] Failed to send approval notification to user ${targetUserId}:`, err);
        }
      }
    } catch (err) {
      console.error('[BOT] Callback query error:', err);
    }
  });

  // Handle all text messages for state machines (conversations)
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    if (!text || text.startsWith('/')) return; // Commands handled elsewhere

    const state = userStates.get(chatId);
    if (!state) return;

    try {
      const userId = msg.from?.id;
      if (!userId) return;

      const user = await getUser(userId);
      if (!user) return;

      // STATE: Set Account Number
      if (state === 'SetAcc') {
        const accNo = parseInt(text, 10);
        if (isNaN(accNo) || accNo <= 0) {
          await bot.sendMessage(chatId, '❌ *Invalid account number.* Please send a valid positive numeric account number:', { parse_mode: 'Markdown' });
          return;
        }

        await updateUserAccNo(userId, accNo);
        userStates.delete(chatId);
        await bot.sendMessage(chatId, '✅ *Account number set successfully!*', {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🏠 Home', callback_data: 'home' }]]
          }
        });
      }

      // STATE: Withdrawal Amount
      else if (state === 'Withdrawal') {
        const amount = parseFloat(text);
        if (isNaN(amount) || amount <= 0) {
          await bot.sendMessage(chatId, '❌ *Invalid amount.* Please enter a valid positive number:', { parse_mode: 'Markdown' });
          return;
        }

        if (amount > user.Balance) {
          await bot.sendMessage(chatId, `❌ *Insufficient balance.*\nAvailable Balance: *${user.Balance.toFixed(2)} tokens*\n\nPlease enter a lower amount:`, { parse_mode: 'Markdown' });
          return;
        }

        // Processing withdrawal
        await removeBalance(userId, amount);
        userStates.delete(chatId);

        // Save withdrawal record
        const reqId = 'w_' + Date.now();
        await addWithdrawal({
          id: reqId,
          userId,
          firstName: msg.from?.first_name || `User ${userId}`,
          amount,
          accNo: user.AccNo,
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        // Send confirmation logging message to LoggerID channel
        if (LOGGER_ID) {
          const loggerMsg = `💰 *Withdrawal Request*\n\n` +
            `👤 *User:* ${msg.from?.first_name || 'User'} (\`${userId}\`)\n` +
            `💵 *Amount:* ${amount.toFixed(2)} tokens\n` +
            `🆔 *AccNo:* \`${user.AccNo}\``;

          try {
            await bot.sendMessage(LOGGER_ID, loggerMsg, {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [[
                  { text: '✅ Approve', callback_data: `confirm_withdrawal.${userId}.${amount}.${reqId}` }
                ]]
              }
            });
          } catch (err) {
            console.error(`[BOT] Failed to send withdrawal to logger ${LOGGER_ID}:`, err);
          }
        }

        await bot.sendMessage(chatId, `🎉 *Withdrawal Request Submitted!*\n\n` +
          `- 🕒 *Processing Time:* Please allow a few hours for our team to review and approve your request.`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🏠 Home', callback_data: 'home' }]]
          }
        });
      }
    } catch (err: any) {
      console.error('[BOT] Message state handler error:', err);
      await bot.sendMessage(chatId, `❌ *An error occurred:* ${err.message || 'Please try again.'}`, { parse_mode: 'Markdown' });
    }
  });
}

// REST API Endpoints for Dashboard

// Telegram Webhook endpoint
if (TOKEN && WEBHOOK_URL) {
  app.post(`/${TOKEN}`, (req, res) => {
    const xTelegramBotApiSecretToken = req.headers['x-telegram-bot-api-secret-token'];
    if (SECRET_TOKEN && xTelegramBotApiSecretToken !== SECRET_TOKEN) {
      res.status(403).send('Unauthorized');
      return;
    }
    telegramBot?.processUpdate(req.body);
    res.sendStatus(200);
  });
  console.log(`[SERVER] Registered Express webhook route at: /${TOKEN}`);
}

// Get Bot & System Status
app.get('/api/status', (req, res) => {
  res.json({
    botName: botInfo?.username || 'EarnifyEB_Bot',
    botId: botInfo?.id || null,
    connected: !!botInfo,
    error: botError,
    ownerId: OWNER_ID,
    loggerId: LOGGER_ID,
    fSubCount: FSUB_IDS.length,
    fSubIds: FSUB_IDS,
    mongoConnected: isDatabaseConnected(),
    mode: WEBHOOK_URL ? 'Webhook' : 'Polling'
  });
});

// Summary Stats
app.get('/api/stats', async (req, res) => {
  try {
    const users = await getAllUsers();
    const withdrawals = await getWithdrawals();

    const totalBalance = users.reduce((sum, u) => sum + (u.Balance || 0), 0);
    const totalReferrals = users.reduce((sum, u) => sum + (u.ReferredUsers ? u.ReferredUsers.length : 0), 0);
    
    const pendingWithdrawals = withdrawals.filter(w => w.status === 'pending');
    const approvedWithdrawals = withdrawals.filter(w => w.status === 'approved');

    const totalPendingAmount = pendingWithdrawals.reduce((sum, w) => sum + w.amount, 0);
    const totalApprovedAmount = approvedWithdrawals.reduce((sum, w) => sum + w.amount, 0);

    // Latest user signs
    const sortedUsers = [...users].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

    res.json({
      totalUsers: users.length,
      totalBalance,
      totalReferrals,
      pendingCount: pendingWithdrawals.length,
      approvedCount: approvedWithdrawals.length,
      totalPendingAmount,
      totalApprovedAmount,
      latestUsers: sortedUsers.slice(0, 5)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get Users List
app.get('/api/users', async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update user balance from UI
app.post('/api/users/:id/balance', async (req, res) => {
  const userId = Number(req.params.id);
  const { amount, action } = req.body; // action: 'add' or 'remove'
  const val = Number(amount);

  if (isNaN(userId) || isNaN(val) || val <= 0) {
    res.status(400).json({ error: 'Invalid parameters' });
    return;
  }

  try {
    const user = await getUser(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (action === 'remove') {
      if (user.Balance < val) {
        res.status(400).json({ error: 'Insufficient balance' });
        return;
      }
      await removeBalance(userId, val);
    } else {
      await updateUserBalance(userId, val);
    }

    const updated = await getUser(userId);

    // Send telegram notification if possible
    if (telegramBot) {
      try {
        const text = action === 'remove' 
          ? `⚠️ *Balance Deducted:*\n\nAn administrator has deducted *${val.toFixed(2)} tokens* from your balance. Your new balance is *${updated?.Balance.toFixed(2)} tokens*.`
          : `🎉 *Balance Credited:*\n\nAn administrator has credited *${val.toFixed(2)} tokens* to your balance! Your new balance is *${updated?.Balance.toFixed(2)} tokens*.`;
        
        await telegramBot.sendMessage(userId, text, { parse_mode: 'Markdown' });
      } catch {
        // user might have blocked the bot
      }
    }

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update user Account Number from UI
app.post('/api/users/:id/accno', async (req, res) => {
  const userId = Number(req.params.id);
  const { accNo } = req.body;
  const val = Number(accNo);

  if (isNaN(userId) || isNaN(val) || val <= 0) {
    res.status(400).json({ error: 'Invalid parameters' });
    return;
  }

  try {
    await updateUserAccNo(userId, val);
    const updated = await getUser(userId);

    if (telegramBot) {
      try {
        await telegramBot.sendMessage(userId, `ℹ️ *Account Number Updated:*\n\nAn administrator has set your account number to \`${val}\`.`, { parse_mode: 'Markdown' });
      } catch {
        // ignore
      }
    }

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get Withdrawals
app.get('/api/withdrawals', async (req, res) => {
  try {
    const withdrawals = await getWithdrawals();
    res.json(withdrawals);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update withdrawal status (Approve / Reject)
app.post('/api/withdrawals/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'approved' or 'rejected'

  if (status !== 'approved' && status !== 'rejected') {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  try {
    const list = await getWithdrawals();
    const w = list.find(item => item.id === id);
    if (!w) {
      res.status(404).json({ error: 'Withdrawal request not found' });
      return;
    }

    if (w.status !== 'pending') {
      res.status(400).json({ error: 'Request already processed' });
      return;
    }

    if (status === 'rejected') {
      // Refund user balance
      await updateUserBalance(w.userId, w.amount);
    }

    const updated = await updateWithdrawalStatus(id, status);

    // Notify user
    if (telegramBot) {
      try {
        const text = status === 'approved'
          ? `🎉 *Withdrawal Approved!*\n\n✅ Your withdrawal request has been successfully approved!\n\n💸 *Amount:* ${w.amount.toFixed(2)} tokens\n\nThank you for trusting us! 🚀`
          : `❌ *Withdrawal Rejected:*\n\nYour withdrawal request for *${w.amount.toFixed(2)} tokens* has been rejected and the funds have been returned to your balance. Contact support for details.`;
        
        await telegramBot.sendMessage(w.userId, text, { parse_mode: 'Markdown' });
      } catch {
        // ignore
      }
    }

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Broadcast notification to all users
app.post('/api/broadcast', async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    res.status(400).json({ error: 'Message cannot be empty' });
    return;
  }

  if (!telegramBot) {
    res.status(503).json({ error: 'Telegram Bot is not active' });
    return;
  }

  try {
    const users = await getAllUsers();
    
    // Broadcast in background asynchronously so request does not hang
    const runBroadcast = async () => {
      let successCount = 0;
      for (const u of users) {
        try {
          await telegramBot!.sendMessage(u.ID, message, { parse_mode: 'Markdown' });
          successCount++;
        } catch {
          // ignore failures for blocked users
        }
        await new Promise(resolve => setTimeout(resolve, 33)); // Rate limiting
      }
      console.log(`[UI BROADCAST] Broadcast complete. Sent to ${successCount}/${users.length} users.`);
    };

    runBroadcast();

    res.json({ success: true, message: `Broadcast started to ${users.length} users.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Integration support with Vite for Single Turn Development
const root = path.resolve(__dirname);
if (process.env.NODE_ENV === 'production') {
  // Serve static assets from client dist folder
  app.use(express.static(path.join(root, 'dist/client')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(root, 'dist/client/index.html'));
  });
} else {
  // Mount Vite development middlewares
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom'
  });
  
  app.use(vite.middlewares);
  
  app.get('*', async (req, res, next) => {
    const url = req.originalUrl;
    try {
      let template = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
      template = await vite.transformIndexHtml(url, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
    } catch (err) {
      vite.ssrFixStacktrace(err as Error);
      next(err);
    }
  });
}

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Full-Stack server running on http://0.0.0.0:${PORT}`);
});
