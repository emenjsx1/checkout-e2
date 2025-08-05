require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');

const app = express();

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static('public'));

const BASE_URL = 'https://e2payments.explicador.co.mz';
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const WALLET_MPESA = process.env.WALLET_MPESA;
const WALLET_EMOLA = process.env.WALLET_EMOLA;
const PUSHCUT_URL = 'https://api.pushcut.io/QsggCCih4K4SGeZy3F37z/notifications/MinhaNotificacao';
const META_PIXEL_ID = '4179716432354886';

// Função para obter token OAuth
async function getToken() {
  try {
    const response = await axios.post(`${BASE_URL}/oauth/token`, {
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    return response.data.access_token;
  } catch (error) {
    console.error('❌ Erro ao obter token:', error.response?.data || error.message);
    throw new Error('Falha na autenticação');
  }
}

// Página principal serve o index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota para iniciar o pagamento
app.post('/pagar', async (req, res) => {
  const { nome, email, telefone, metodo } = req.body;

  if (!nome || !email || !telefone || !metodo) {
    return res.redirect('/');
  }

  // Validação simples do telefone
  if (!/^(84|85|86|87)\d{7}$/.test(telefone)) {
    return res.redirect('/');
  }

  try {
    const token = await getToken();
    const walletId = metodo === 'mpesa' ? WALLET_MPESA : WALLET_EMOLA;
    const endpoint = `${BASE_URL}/v1/c2b/mpesa-payment/${walletId}`;
    const reference = `Premise${Date.now()}`;

    const paymentPayload = {
      client_id: CLIENT_ID,
      amount: "1",
      phone: telefone,
      reference
    };

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (!global.transacoes) global.transacoes = new Map();
    global.transacoes.set(reference, { nome, telefone, metodo, valor: '297', status: 'PENDENTE' });

    await axios.post(endpoint, paymentPayload, { headers });

    // Aqui, respondemos que pagamento foi iniciado,
    // sem redirecionar para páginas intermediárias
    res.send(`
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Pagamento iniciado</title>
          <script>
            // Tracking Meta Pixel
            fbq('track', 'InitiateCheckout');

            // Só informa que pagamento iniciou e pede para aguardar confirmação via webhook
            document.write('<p>Pagamento iniciado! Aguarde confirmação...</p>');
          </script>
          <script src="https://connect.facebook.net/en_US/fbevents.js"></script>
        </head>
        <body></body>
      </html>
    `);

  } catch (error) {
    console.error('❌ Erro no pagamento:', error.response?.data || error.message);
    return res.redirect('/');
  }
});

// Webhook para receber confirmação de pagamento da E2Payments
app.post('/webhook/pagamento-confirmado', async (req, res) => {
  const payload = req.body;
  console.log('📬 Webhook recebido:', payload);

  if (payload.status === "SUCCESS") {
    const reference = payload.reference;
    const transacao = global.transacoes?.get(reference);

    if (transacao) {
      transacao.status = 'PAGO';
      const nome = transacao.nome || "Cliente";
      const valor = transacao.valor || "297";

      try {
        // Envia notificação via Pushcut
        await axios.post(PUSHCUT_URL, {
          title: "💰 Venda Aprovada",
          text: `📦 ${nome} pagou ${valor} MT`,
          sound: "default"
        }, {
          headers: { 'Content-Type': 'application/json' }
        });
        console.log("🔔 Pushcut enviado com sucesso");
      } catch (err) {
        console.error("❌ Falha ao enviar Pushcut:", err.message);
      }

      // Aqui poderia mandar outras ações, como log, email, etc.
    }
  }
  res.sendStatus(200);
});

// Saúde da API
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Premise Checkout API' });
});

// Catch all 404
app.use('*', (req, res) => {
  res.status(404).send('Página não encontrada.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
