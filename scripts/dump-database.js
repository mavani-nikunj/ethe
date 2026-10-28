const { mkdirSync, writeFileSync, existsSync, rmSync } = require('fs');
const { join } = require('path');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ethesis_platform';
const dbName = new URL(URI).pathname.replace(/^\//, '') || 'ethesis_platform';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const outDir = process.argv[2] || join(process.cwd(), 'db-backup', `ethesis_platform_mock_${stamp}`);
const mongoDir = join(outDir, 'mongo');
const colDir = join(mongoDir, 'collections');

async function run() {
  if (existsSync(mongoDir)) rmSync(mongoDir, { recursive: true, force: true });
  mkdirSync(colDir, { recursive: true });

  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(dbName);
  const collections = await db.listCollections().toArray();
  const summary = {};

  for (const col of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    const collection = db.collection(col.name);
    const docs = await collection.find({}).toArray();
    const indexes = await collection.indexes();
    summary[col.name] = { documents: docs.length, indexes: indexes.length };
    writeFileSync(join(colDir, `${col.name}.json`), EJSON.stringify({ indexes, documents: docs }, { relaxed: false }), 'utf8');
    console.log(`dumped ${col.name}: ${docs.length} docs`);
  }

  const metadata = {
    database: dbName,
    uriHost: new URL(URI).host,
    dumpedAt: new Date().toISOString(),
    collections: summary,
  };
  writeFileSync(join(mongoDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
  writeFileSync(
    join(outDir, 'RESTORE.txt'),
    [
      'eThesis mock database backup',
      `Database: ${dbName}`,
      `Dumped: ${metadata.dumpedAt}`,
      '',
      'On the other system:',
      '  1. Install and start MongoDB (port 27017).',
      '  2. Copy this folder onto that machine.',
      '  3. From the project root, run:',
      `     node scripts/restore-database.js "${outDir.replace(/\\/g, '/')}"`,
      '  4. Copy the uploads folder to apps/api/uploads if it is not copied automatically.',
      '',
      'Demo logins after restore:',
      '  Super Admin   superadmin@ethesis.local   Admin@123',
      '  Institute staff (all)                    Staff@123',
      '    admin@aiims.local',
      '    dealing@aiims.local',
      '    ace@aiims.local',
      '    ao@aiims.local',
      '    dean@aiims.local',
      '    anatomy@aiims.local',
      '',
    ].join('\n'),
    'utf8',
  );

  await client.close();
  console.log(`wrote ${outDir}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
