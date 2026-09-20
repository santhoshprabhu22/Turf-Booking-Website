import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'data', 'db.json');

// Ensure data folder exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Default Database Structure
const DEFAULT_DB = {
  users: [],
  otps: [],
  bookings: [],
  holds: [] // Slot holds: { slotDate, slotTime, userId, heldAt }
};

class Database {
  constructor() {
    this.lock = false;
    this.init();
  }

  init() {
    if (!fs.existsSync(DB_PATH)) {
      this.writeSync(DEFAULT_DB);
    }
  }

  readSync() {
    try {
      const data = fs.readFileSync(DB_PATH, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading database:', error);
      return DEFAULT_DB;
    }
  }

  writeSync(data) {
    try {
      // Write to temp file then rename (atomic write)
      const tempPath = `${DB_PATH}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tempPath, DB_PATH);
    } catch (error) {
      console.error('Error writing database:', error);
    }
  }

  // Safe concurrent-friendly write
  async save(data) {
    while (this.lock) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    this.lock = true;
    try {
      this.writeSync(data);
    } finally {
      this.lock = false;
    }
  }

  // Collection operations
  async getCollection(name) {
    const db = this.readSync();
    return db[name] || [];
  }

  async insert(collectionName, record) {
    const db = this.readSync();
    if (!db[collectionName]) {
      db[collectionName] = [];
    }
    
    // Add unique auto-increment or random ID
    const newRecord = {
      id: record.id || Math.random().toString(36).substring(2, 11),
      ...record,
      createdAt: new Date().toISOString()
    };
    
    db[collectionName].push(newRecord);
    await this.save(db);
    return newRecord;
  }

  async update(collectionName, id, updates) {
    const db = this.readSync();
    const collection = db[collectionName] || [];
    const index = collection.findIndex(item => item.id === id);
    
    if (index !== -1) {
      collection[index] = {
        ...collection[index],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      db[collectionName] = collection;
      await this.save(db);
      return collection[index];
    }
    return null;
  }

  async find(collectionName, predicate) {
    const collection = await this.getCollection(collectionName);
    return collection.filter(predicate);
  }

  async findOne(collectionName, predicate) {
    const collection = await this.getCollection(collectionName);
    return collection.find(predicate) || null;
  }

  async delete(collectionName, predicate) {
    const db = this.readSync();
    if (db[collectionName]) {
      const initialLength = db[collectionName].length;
      db[collectionName] = db[collectionName].filter(item => !predicate(item));
      if (db[collectionName].length !== initialLength) {
        await this.save(db);
        return true;
      }
    }
    return false;
  }
}

export const db = new Database();
