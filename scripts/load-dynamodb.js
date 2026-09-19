// CSV -> DynamoDB table (the source of truth).
// Usage: node scripts/load-dynamodb.js data/facilities.csv
// Env: AARYA_TABLE (default aarya-facilities), AWS_REGION (default ap-south-1),
//      DYNAMODB_ENDPOINT (optional, e.g. http://localhost:8000 for DynamoDB Local)
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { readFacilitiesCsv } from './lib/facilities.js';

const TABLE = process.env.AARYA_TABLE || 'aarya-facilities';
const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scripts/load-dynamodb.js <facilities.csv>');
  process.exit(1);
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({
  region: process.env.AWS_REGION || 'ap-south-1',
  ...(process.env.DYNAMODB_ENDPOINT ? { endpoint: process.env.DYNAMODB_ENDPOINT } : {}),
}));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function writeBatch(items) {
  let requests = items.map((Item) => ({ PutRequest: { Item } }));
  for (let attempt = 0; requests.length && attempt < 5; attempt++) {
    const result = await client.send(new BatchWriteCommand({ RequestItems: { [TABLE]: requests } }));
    requests = result.UnprocessedItems?.[TABLE] || [];
    if (requests.length) await sleep(200 * 2 ** attempt); // back off, then retry what DynamoDB didn't process
  }
  if (requests.length) throw new Error(`${requests.length} items were not written after retries`);
}

try {
  const facilities = readFacilitiesCsv(csvPath);
  for (let i = 0; i < facilities.length; i += 25) { // BatchWrite takes at most 25 items
    await writeBatch(facilities.slice(i, i + 25));
  }
  console.log(`Loaded ${facilities.length} facilities into ${TABLE}`);
  console.log('Note: rows deleted from the CSV are not deleted from the table.');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
