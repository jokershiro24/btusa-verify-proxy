const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const PORT = process.env.PORT || 8080;

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/verify', async (req, res) => {
  const { order_number, name, mobile } = req.body;

  console.log('[verify] incoming order_number raw:', order_number);

  if (!order_number) {
    return res.status(400).json({ status: 'error', message: 'order_number is required' });
  }

  const normalized = order_number.trim().toLowerCase();
  console.log('[verify] normalized incoming:', normalized);

  try {
    const query = `{
      metaobjects(type: "sidekick_batch_registry", first: 250) {
        edges {
          node {
            orderNumber: field(key: "order_number") { jsonValue }
            lotNumber: field(key: "lot_number") { jsonValue }
            productName: field(key: "product_name") { jsonValue }
            status: field(key: "status") { jsonValue }
          }
        }
      }
    }`;

    const shopifyRes = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
        },
        body: JSON.stringify({ query }),
      }
    );

    const shopifyJson = await shopifyRes.json();
    console.log('[verify] full shopify response:', JSON.stringify(shopifyJson));

    const edges = shopifyJson?.data?.metaobjects?.edges ?? [];
    console.log('[verify] total records found:', edges.length);

    const match = edges.find((e) => {
      const stored = (e.node.orderNumber?.jsonValue ?? '').trim().toLowerCase();
      console.log('[verify] comparing stored:', stored, 'vs incoming:', normalized);
      return stored === normalized;
    });

    if (!match) {
      return res.json({ status: 'not_found', message: 'Order not found in registry' });
    }

    const status = (match.node.status?.jsonValue ?? '').toLowerCase();

    if (status === 'verified') {
      return res.json({
        status: 'verified',
        message: 'Product is authentic',
        product_name: match.node.productName?.jsonValue ?? '',
        lot_number: match.node.lotNumber?.jsonValue ?? '',
      });
    } else if (status === 'flagged') {
      return res.json({
        status: 'flagged',
        message: 'This batch has been flagged. Please contact BioTechUSA Egypt support.',
      });
    } else {
      return res.json({
        status: 'pending',
        message: 'This batch is pending verification.',
      });
    }

  } catch (err) {
    console.error('[verify] error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
