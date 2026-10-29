import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function generateReceipt(prefix: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}${suffix}`;
}

function cloudFunctionsDarajaPlugin(): Plugin {
  return {
    name: 'kawigrid-cloud-functions-bridge',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        if (!req.url?.startsWith('/api/')) {
          return next();
        }

        res.setHeader('Content-Type', 'application/json');

        try {
          if (req.method === 'POST' && req.url === '/api/daraja/stkpush') {
            const payload = await readJsonBody(req);
            const amountKes = Number(payload.amountKes || 0);
            const tariffKesPerKwh = Number(payload.tariffKesPerKwh || 18.5);
            const phone = String(payload.phone || '');
            const meterNumber = String(payload.meterNumber || 'KPLC-882104');

            if (amountKes < 20 || amountKes > 250000) {
              res.statusCode = 400;
              res.end(
                JSON.stringify({
                  error: 'Amount must be between KES 20 and KES 250,000 for M-Pesa STK Push.',
                })
              );
              return;
            }

            const receipt = generateReceipt('SJK');
            const purchasedKwh = Number((amountKes / tariffKesPerKwh).toFixed(2));
            const checkoutRequestId = `ws_CO_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;

            res.statusCode = 200;
            res.end(
              JSON.stringify({
                ok: true,
                ResponseCode: '0',
                CustomerMessage: 'Success. Request accepted for processing',
                CheckoutRequestID: checkoutRequestId,
                MpesaReceiptNumber: receipt,
                amountKes,
                purchasedKwh,
                phone,
                meterNumber,
                webhookVerified: true,
                completedAtIso: new Date().toISOString(),
              })
            );
            return;
          }

          if (req.method === 'POST' && req.url === '/api/daraja/b2c') {
            const payload = await readJsonBody(req);
            const withdrawalKes = Number(payload.withdrawalKes || 0);
            const phone = String(payload.phone || '');

            if (withdrawalKes < 50) {
              res.statusCode = 400;
              res.end(
                JSON.stringify({
                  error: 'Minimum B2C M-Pesa withdrawal is KES 50.',
                })
              );
              return;
            }

            const b2cFeeKes = withdrawalKes <= 1000 ? 15 : withdrawalKes <= 5000 ? 25 : 45;
            const netPayoutKes = Number((withdrawalKes - b2cFeeKes).toFixed(2));
            const receipt = generateReceipt('SJI');
            const conversationId = `AG_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;

            res.statusCode = 200;
            res.end(
              JSON.stringify({
                ok: true,
                ResponseCode: '0',
                ConversationID: conversationId,
                TransactionID: receipt,
                withdrawalKes,
                b2cFeeKes,
                netPayoutKes,
                phone,
                webhookVerified: true,
                completedAtIso: new Date().toISOString(),
              })
            );
            return;
          }

          if (req.method === 'POST' && req.url === '/api/iot/meter-ingest') {
            const payload = await readJsonBody(req);
            const deltaKwh = Number(payload.deltaKwh || 0);
            const tariffKesPerKwh = Number(payload.tariffKesPerKwh || 18.5);
            const consumerMeter = String(payload.consumerMeter || 'KPLC-882104');
            const prosumerMeter = String(payload.prosumerMeter || 'KPLC-551902');
            const voltageV = Number(payload.voltageV || 239.4);
            const frequencyHz = Number(payload.frequencyHz || 50.02);

            if (deltaKwh <= 0 || deltaKwh > 500) {
              res.statusCode = 400;
              res.end(
                JSON.stringify({
                  error: 'Smart meter pulse deltaKwh must be between 0.1 and 500 kWh.',
                })
              );
              return;
            }

            const grossKes = Number((deltaKwh * tariffKesPerKwh).toFixed(2));
            const platformFeeKes = Number((grossKes * 0.025).toFixed(2));
            const prosumerNetCreditKes = Number((grossKes - platformFeeKes).toFixed(2));
            const pulseReceipt = `IOT-PULSE-${generateReceipt('').slice(0, 6)}`;

            res.statusCode = 200;
            res.end(
              JSON.stringify({
                ok: true,
                pulseReceipt,
                consumerMeter,
                prosumerMeter,
                deltaKwh,
                grossKes,
                platformFeeKes,
                prosumerNetCreditKes,
                voltageV,
                frequencyHz,
                ingestedAtIso: new Date().toISOString(),
              })
            );
            return;
          }

          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Endpoint not found' }));
        } catch (err) {
          res.statusCode = 500;
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : 'Internal Cloud Function error',
            })
          );
        }
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), cloudFunctionsDarajaPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
