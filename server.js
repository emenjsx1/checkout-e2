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
const META_PIXEL_ID = '4179716432354886';
const PUSHCUT_URL = 'https://api.pushcut.io/QsggCCih4K4SGeZy3F37z/notifications/MinhaNotifica%C3%A7%C3%A3o';

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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/pagar', async (req, res) => {
    const { nome, email, telefone, metodo } = req.body;
    if (!nome || !email || !telefone || !metodo) {
        return res.redirect('/');
    }

    if (!/^(84|85|86|87)\d{7}$/.test(telefone)) {
        return res.redirect('/');
    }

    try {
        const token = await getToken();
        const walletId = metodo === 'mpesa' ? WALLET_MPESA : WALLET_EMOLA;
        const reference = `Premise${Date.now()}`;

        const paymentPayload = {
            client_id: CLIENT_ID,
            amount: "297",
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

        await axios.post(`${BASE_URL}/v1/c2b/mpesa-payment/${walletId}`, paymentPayload, { headers });

        res.redirect('https://wa.me/message/5PVL4ECXMEWPI1');
    } catch (error) {
        console.error('❌ Erro no pagamento:', error.response?.data || error.message);
        return res.redirect('/');
    }
});

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
                await axios.post(PUSHCUT_URL, {
                    title: "💰 Venda Aprovada",
                    text: `📦 ${nome} pagou ${valor},00 MT`,
                    sound: "default"
                }, {
                    headers: { 'Content-Type': 'application/json' }
                });
                console.log("🔔 Pushcut enviado com sucesso");
            } catch (err) {
                console.error("❌ Falha ao enviar Pushcut:", err.message);
            }
        }
    }

    res.sendStatus(200);
});

app.get('/status', (req, res) => {
    const ref = req.query.ref;
    const t = global.transacoes?.get(ref);
    res.json({ status: t?.status || 'PENDENTE' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'Premise Checkout API' });
});

app.use('*', (req, res) => {
    res.status(404).send('Página não encontrada.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
