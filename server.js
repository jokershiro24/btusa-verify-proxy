const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;

if (!SHOPIFY_STORE_DOMAIN) {
  console.error('FATAL: SHOPIFY_STORE_DOMAIN environment variable is not set');
  process.exit(1);
}

const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

if (!SHOPIFY_TOKEN) {
  console.error('FATAL: SHOPIFY_ADMIN_TOKEN environment variable is not set');
  process.exit(1);
}

const normalizeOrderNumber = (value) => {
  if (!value) return '';
  return value.trim().toLowerCase().replace(/^#/, '');
};

app.post('/verify', async (req, res) => {
  const { order_number, batch_number, name, mobile } = req.body;
  if (!order_number) return res.json({ status: 'error', message: 'Order number required' });

  console.log('[verify] incoming order_number raw:', JSON.stringify(order_number));
  console.log('[verify] incoming order_number trimmed:', JSON.stringify(order_number.trim()));

  try {
    const query = `{
  metaobjects(type: "sidekick_batch_registry", first: 250) {
    edges {
      node {
        id
        handle
        orderNumber: field(key: "order_number") { jsonValue }
        lotNumber: field(key: "lot_number") { jsonValue }
        productName: field(key: "product_name") { jsonValue }
        status: field(key: "status") { jsonValue }
      }
    }
  }
}`;

    const response = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-10/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        },
        body: JSON.stringify({ query }),
      }
    );

    const data = await response.json();
    console.log('[verify] raw Shopify response data:', JSON.stringify(data.data));

    const records = data.data?.metaobjects?.edges ?? [];
    console.log('[verify] orderNumber values from metaobjects:', records.map(e => e.node.orderNumber?.jsonValue));

    const normalizedIncoming = normalizeOrderNumber(order_number);
    console.log('[verify] normalized incoming:', JSON.stringify(normalizedIncoming));

    const match = records.find(e => {
      const normalizedStored = normalizeOrderNumber(e.node.orderNumber?.jsonValue);
      console.log('[verify] comparing stored:', JSON.stringify(normalizedStored), 'vs incoming:', JSON.stringify(normalizedIncoming));
      return normalizedStored === normalizedIncoming;
    });

    let result;
    if (!match) {
      result = { status: 'not_found', message: 'Order not found in registry' };
    } else if (match.node.status?.jsonValue === 'Verified') {
      result = { status: 'verified', message: 'Authentic',
                 product: match.node.productName?.jsonValue,
                 lot: match.node.lotNumber?.jsonValue };
    } else if (match.node.status?.jsonValue === 'Flagged') {
      result = { status: 'flagged', message: 'Flagged — please contact support' };
    } else {
      result = { status: 'pending', message: 'Pending verification' };
    }

    console.log('[verify] match result:', JSON.stringify(result));

    // Log the attempt
    await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      },
      body: JSON.stringify({
        query: `mutation CreateLog($m: MetaobjectCreateInput!) {
          metaobjectCreate(metaobject: $m) { metaobject { id } }
        }`,
        variables: {
          m: {
            type: 'sidekick_verification_log',
            handle: `log-${Date.now()}`,
            fields: [
              { key: 'submitter_name', value: name || '' },
              { key: 'mobile', value: mobile || '' },
              { key: 'order_number', value: order_number },
              { key: 'lot_number', value: batch_number || '' },
              { key: 'result', value: result.status },
              { key: 'submitted_at', value: new Date().toISOString() },
            ],
          },
        },
      }),
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.listen(process.env.PORT || 3000, () => console.log('Proxy running'));
