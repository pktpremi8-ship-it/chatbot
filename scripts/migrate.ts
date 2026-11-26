import 'dotenv/config';
import { closeDb, getDb, getDbPath } from '../src/server/db.ts';

const db = getDb();
const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
  .all() as Array<{ name: string }>;

console.log(`SQLite migrations verified at ${getDbPath()}`);
console.log(`Tables (${tables.length}): ${tables.map((t) => t.name).join(', ')}`);
closeDb();
