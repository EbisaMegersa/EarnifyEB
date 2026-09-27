import { MongoClient, Db, Collection } from 'mongodb';
import fs from 'fs';
import path from 'path';

export interface User {
  ID: number;
  Referrer: number;
  ReferredUsers: number[];
  AccNo: number;
  Balance: number;
  firstName?: string;
  createdAt?: string;
}

export interface Withdrawal {
  id: string;
  userId: number;
  firstName?: string;
  amount: number;
  accNo: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
}

// Local filesystem fallback
const DB_FILE_DIR = path.resolve('./data');
const DB_FILE_PATH = path.join(DB_FILE_DIR, 'db.json');

interface LocalData {
  users: User[];
  withdrawals: Withdrawal[];
}

let localData: LocalData = {
  users: [],
  withdrawals: []
};

// Ensure directory exists
if (!fs.existsSync(DB_FILE_DIR)) {
  fs.mkdirSync(DB_FILE_DIR, { recursive: true });
}

// Load local database
if (fs.existsSync(DB_FILE_PATH)) {
  try {
    const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8');
    localData = JSON.parse(raw);
    if (!localData.users) localData.users = [];
    if (!localData.withdrawals) localData.withdrawals = [];
  } catch (err) {
    console.error('[DB] Error reading local fallback database:', err);
  }
} else {
  // Seed initial data for a beautiful dashboard preview
  localData.users = [
    { ID: 12345678, Referrer: 0, ReferredUsers: [87654321, 99887766], AccNo: 1002003004, Balance: 250.0, firstName: "Alice Smith", createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
    { ID: 87654321, Referrer: 12345678, ReferredUsers: [], AccNo: 9988112233, Balance: 10.0, firstName: "Bob Jones", createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
    { ID: 99887766, Referrer: 12345678, ReferredUsers: [], AccNo: 5544332211, Balance: 0.0, firstName: "Charlie Brown", createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() }
  ];
  localData.withdrawals = [
    { id: "w_1", userId: 12345678, firstName: "Alice Smith", amount: 50.0, accNo: 1002003004, status: "pending", createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), updatedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString() },
    { id: "w_2", userId: 87654321, firstName: "Bob Jones", amount: 10.0, accNo: 9988112233, status: "approved", createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() }
  ];
  try {
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(localData, null, 2));
  } catch (err) {
    console.error('[DB] Error saving initial seed data:', err);
  }
}

function saveLocalData() {
  try {
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(localData, null, 2));
  } catch (err) {
    console.error('[DB] Error saving local fallback database:', err);
  }
}

// MongoDB instances
let mongoClient: MongoClient | null = null;
let mongoDb: Db | null = null;
let usersCollection: Collection | null = null;
let withdrawalsCollection: Collection | null = null;
let isMongoConnected = false;

export async function connectDatabase(uri: string | undefined) {
  if (!uri) {
    console.warn('[DB] No MONGO_URI provided. Running on local JSON file database fallback.');
    return;
  }

  try {
    mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
    await mongoClient.connect();
    mongoDb = mongoClient.db('tgreferearn');
    usersCollection = mongoDb.collection('users');
    withdrawalsCollection = mongoDb.collection('withdrawals');
    isMongoConnected = true;
    console.log('[DB] Successfully connected to MongoDB!');

    // Sync state
    const mongoCount = await usersCollection.countDocuments();
    if (mongoCount === 0 && localData.users.length > 0) {
      console.log('[DB] Seeding MongoDB with local fallback data...');
      const mongoUsers = localData.users.map(u => ({ _id: u.ID as any, ...u }));
      await usersCollection.insertMany(mongoUsers);
      if (localData.withdrawals.length > 0) {
        await withdrawalsCollection.insertMany(localData.withdrawals.map(w => ({ _id: w.id as any, ...w })));
      }
    } else {
      const mongoUsers = await usersCollection.find().toArray();
      localData.users = mongoUsers.map(mu => {
        const { _id, ...rest } = mu;
        return { ID: Number(_id || rest.ID), ...rest } as User;
      });
      const mongoWithdrawals = await withdrawalsCollection.find().toArray();
      localData.withdrawals = mongoWithdrawals.map(mw => {
        const { _id, ...rest } = mw;
        return { id: String(_id || rest.id), ...rest } as Withdrawal;
      });
      saveLocalData();
    }
  } catch (err) {
    console.error('[DB] Failed to connect to MongoDB. Staying on local JSON database.', err);
    isMongoConnected = false;
  }
}

export function isDatabaseConnected() {
  return isMongoConnected;
}

export async function addUser(user: User): Promise<void> {
  const existing = localData.users.find(u => u.ID === user.ID);
  if (existing) {
    throw new Error(`User with ID ${user.ID} already exists`);
  }

  const newUser = {
    ...user,
    createdAt: user.createdAt || new Date().toISOString()
  };

  localData.users.push(newUser);
  saveLocalData();

  if (isMongoConnected && usersCollection) {
    try {
      await usersCollection.insertOne({ _id: user.ID as any, ...newUser });
    } catch (err) {
      console.error('[DB] MongoDB addUser error:', err);
    }
  }
}

export async function getUser(userID: number): Promise<User | null> {
  const localUser = localData.users.find(u => u.ID === userID);
  
  if (isMongoConnected && usersCollection) {
    try {
      const mongoUser = await usersCollection.findOne({ _id: userID as any });
      if (mongoUser) {
        const { _id, ...rest } = mongoUser;
        const u = { ID: userID, ...rest } as User;
        
        // Update local cache
        const idx = localData.users.findIndex(item => item.ID === userID);
        if (idx !== -1) {
          localData.users[idx] = u;
        } else {
          localData.users.push(u);
        }
        saveLocalData();
        return u;
      }
    } catch (err) {
      console.error('[DB] MongoDB getUser error:', err);
    }
  }

  return localUser || null;
}

export async function referUser(referrerID: number, newUserID: number, newFirstName?: string): Promise<void> {
  const referrer = await getUser(referrerID);
  if (!referrer) {
    throw new Error(`Referrer with ID ${referrerID} does not exist`);
  }

  const newUser: User = {
    ID: newUserID,
    Referrer: referrerID,
    ReferredUsers: [],
    AccNo: 0,
    Balance: 0,
    firstName: newFirstName || `User ${newUserID}`,
    createdAt: new Date().toISOString()
  };

  await addUser(newUser);

  // Update referrer
  if (!referrer.ReferredUsers) referrer.ReferredUsers = [];
  referrer.ReferredUsers.push(newUserID);
  saveLocalData();

  if (isMongoConnected && usersCollection) {
    try {
      await usersCollection.updateOne(
        { _id: referrerID as any },
        { $push: { referred_users: newUserID as any } }
      );
    } catch (err) {
      console.error('[DB] MongoDB referUser referrer update error:', err);
    }
  }
}

export async function updateUserBalance(userID: number, amount: number): Promise<void> {
  const user = await getUser(userID);
  if (!user) {
    throw new Error(`User with ID ${userID} does not exist`);
  }

  user.Balance = Number((user.Balance + amount).toFixed(2));
  saveLocalData();

  if (isMongoConnected && usersCollection) {
    try {
      await usersCollection.updateOne(
        { _id: userID as any },
        { $inc: { balance: amount } }
      );
    } catch (err) {
      console.error('[DB] MongoDB updateUserBalance error:', err);
    }
  }
}

export async function removeBalance(userID: number, amount: number): Promise<number> {
  if (amount <= 0) {
    throw new Error('Amount to remove must be greater than zero');
  }

  const user = await getUser(userID);
  if (!user) {
    throw new Error(`User with ID ${userID} does not exist`);
  }

  if (user.Balance < amount) {
    throw new Error(`Insufficient balance for user ${userID}`);
  }

  user.Balance = Number((user.Balance - amount).toFixed(2));
  saveLocalData();

  if (isMongoConnected && usersCollection) {
    try {
      await usersCollection.updateOne(
        { _id: userID as any },
        { $inc: { balance: -amount } }
      );
    } catch (err) {
      console.error('[DB] MongoDB removeBalance error:', err);
    }
  }

  return user.Balance;
}

export async function updateUserAccNo(userID: number, accNo: number): Promise<void> {
  const user = await getUser(userID);
  if (!user) {
    throw new Error(`User with ID ${userID} does not exist`);
  }

  user.AccNo = accNo;
  saveLocalData();

  if (isMongoConnected && usersCollection) {
    try {
      await usersCollection.updateOne(
        { _id: userID as any },
        { $set: { acc_no: accNo } }
      );
    } catch (err) {
      console.error('[DB] MongoDB updateUserAccNo error:', err);
    }
  }
}

export async function getAllUsers(): Promise<User[]> {
  if (isMongoConnected && usersCollection) {
    try {
      const mongoUsers = await usersCollection.find().toArray();
      localData.users = mongoUsers.map(mu => {
        const { _id, ...rest } = mu;
        return { ID: Number(_id || rest.ID), ...rest } as User;
      });
      saveLocalData();
    } catch (err) {
      console.error('[DB] MongoDB getAllUsers error:', err);
    }
  }

  return localData.users;
}

export async function addWithdrawal(w: Withdrawal): Promise<void> {
  localData.withdrawals.push(w);
  saveLocalData();

  if (isMongoConnected && withdrawalsCollection) {
    try {
      await withdrawalsCollection.insertOne({ _id: w.id as any, ...w });
    } catch (err) {
      console.error('[DB] MongoDB addWithdrawal error:', err);
    }
  }
}

export async function getWithdrawals(): Promise<Withdrawal[]> {
  if (isMongoConnected && withdrawalsCollection) {
    try {
      const mongoWithdrawals = await withdrawalsCollection.find().toArray();
      localData.withdrawals = mongoWithdrawals.map(mw => {
        const { _id, ...rest } = mw;
        return { id: String(_id || rest.id), ...rest } as Withdrawal;
      });
      saveLocalData();
    } catch (err) {
      console.error('[DB] MongoDB getWithdrawals error:', err);
    }
  }

  return localData.withdrawals;
}

export async function updateWithdrawalStatus(id: string, status: 'pending' | 'approved' | 'rejected'): Promise<Withdrawal | null> {
  const withdrawal = localData.withdrawals.find(w => w.id === id);
  if (!withdrawal) {
    return null;
  }

  withdrawal.status = status;
  withdrawal.updatedAt = new Date().toISOString();
  saveLocalData();

  if (isMongoConnected && withdrawalsCollection) {
    try {
      await withdrawalsCollection.updateOne(
        { _id: id as any },
        { $set: { status, updatedAt: withdrawal.updatedAt } }
      );
    } catch (err) {
      console.error('[DB] MongoDB updateWithdrawalStatus error:', err);
    }
  }

  return withdrawal;
}
