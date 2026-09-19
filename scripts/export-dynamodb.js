// DynamoDB table -> site/data/facilities.json (the snapshot the website reads).
// Usage: node scripts/export-dynamodb.js site/data/facilities.json
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { writeFacilitiesJson } from './lib/facilities.js';

const TABLE = process.env.AARYA_TABLE || 'aarya-facilities';
const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error('Usage: node scripts/export-dynamodb.js <output.json>');
  process.exit(1);
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({
  region: process.env.AWS_REGION || 'ap-south-1',
  ...(process.env.DYNAMODB_ENDPOINT ? { endpoint: process.env.DYNAMODB_ENDPOINT } : {}),
}));

try {
  const facilities = [];
  let startKey;
  do { // Scan returns pages; keep going until there is no LastEvaluatedKey
    const page = await client.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: startKey }));
    facilities.push(...(page.Items || []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  const count = writeFacilitiesJson(jsonPath, facilities);
  console.log(`Exported ${count} facilities from ${TABLE} to ${jsonPath}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
