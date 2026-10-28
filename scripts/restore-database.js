const { readdirSync, readFileSync, existsSync, cpSync, mkdirSync } = require('fs');
const { join } = require('path');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ethesis_platform';
const fromDir = process.argv[2];

async function run() {
  if (!fromDir) {
    console.error('Usage: node scripts/restore-database.js <backup-folder>');
    process.exit(1);
  }
  const mongoDir = existsSync(join(fromDir, 'mongo', 'collections')) ? join(fromDir, 'mongo') : fromDir;
  const colDir = join(mongoDir, 'collections');
  if (!existsSync(colDir)) {
    console.error(`No collections found in ${fromDir}`);
    process.exit(1);
  }

  const metadataPath = join(mongoDir, 'metadata.json');
  const metadata = existsSync(metadataPath) ? JSON.parse(readFileSync(metadataPath, 'utf8')) : {};
  const dbName = metadata.database || new URL(URI).pathname.replace(/^\//, '') || 'ethesis_platform';

  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(dbName);
  await db.dropDatabase();
  console.log(`Dropped ${dbName}`);

  const files = readdirSync(colDir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const payload = EJSON.parse(readFileSync(join(colDir, file), 'utf8'), { relaxed: false });
    const name = file.replace(/\.json$/, '');
    const collection = db.collection(name);
    const docs = payload.documents || [];
    const indexes = (payload.indexes || []).filter((idx) => idx.name !== '_id_');
    if (docs.length) {
      const batch = 500;
      for (let i = 0; i < docs.length; i += batch) {
        await collection.insertMany(docs.slice(i, i + batch), { ordered: true });
      }
    }
    for (const idx of indexes) {
      const spec = { ...idx };
      const keys = spec.key;
      delete spec.key;
      delete spec.v;
      delete spec.ns;
      try {
        await collection.createIndex(keys, spec);
      } catch (err) {
        console.warn(`index ${name}.${spec.name || JSON.stringify(keys)}: ${err.message}`);
      }
    }
    console.log(`restored ${name}: ${docs.length} docs`);
  }

  const uploadsSrc = join(fromDir, 'uploads');
  if (existsSync(uploadsSrc)) {
    const uploadsDest = join(process.cwd(), 'apps', 'api', 'uploads');
    mkdirSync(uploadsDest, { recursive: true });
    cpSync(uploadsSrc, uploadsDest, { recursive: true });
    console.log(`copied uploads to ${uploadsDest}`);
  }

  await client.close();
  console.log(`Restore complete: ${dbName}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
