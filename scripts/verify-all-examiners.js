const { MongoClient } = require('mongodb');

async function main() {
  const client = new MongoClient('mongodb://127.0.0.1:27017');
  await client.connect();
  const db = client.db('ethesis_platform');

  const r1 = await db.collection('tasktokens').updateMany(
    { purpose: 'CONSENT' },
    { $set: { verified: true } }
  );

  const r2 = await db.collection('tasktokens').updateMany(
    { purpose: 'EVALUATE', panelIndex: { $exists: true, $ne: null } },
    { $set: { verified: true } }
  );

  console.log(`Updated examiner tokens: ${r1.modifiedCount} consent, ${r2.modifiedCount} evaluate`);

  // Test peek on our token
  const token = '495b0edb3b42e21c15532965b6ae212b35b1792cd1c90ce4';
  const res = await fetch(`http://localhost:4000/api/tasks/${token}`);
  const peek = await res.json();
  console.log('Token peek:', {
    purpose: peek.purpose,
    verified: peek.verified,
    isExaminer: peek.isExaminer,
    passcodeRequested: peek.passcodeRequested,
    logoUrl: peek.institute?.logoUrl
  });

  // Test detail without any otp verification
  const detailRes = await fetch(`http://localhost:4000/api/tasks/${token}/detail`);
  const detail = await detailRes.json();
  console.log('Token detail status:', detailRes.status, 'Title:', detail.file?.title);

  await client.close();
}

main().catch(console.error);
