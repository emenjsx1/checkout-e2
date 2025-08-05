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

async function getToken() {
    try {
        const response = await axios.post(`${BASE_URL}/oauth/token`, {
            grant_type: 'client_credentials',
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        return response.data.access_token;
    } catch (error) {
        console.error('Erro ao obter token:', error.response?.data || error.message);
        throw new Error('Falha na autenticação');
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/pagar', async (req, res) => {
    const { nome, email, telefone, metodo } = req.body;

    if (!nome || !email || !telefone || !metodo) {
        return res.status(400).send(`<h2>❌ Todos os campos são obrigatórios.</h2><a href="/">← Voltar</a>`);
    }

    if (!/^(84|85|86|87)\d{7}$/.test(telefone)) {
        return res.status(400).send(`<h2>❌ Número inválido.</h2><a href="/">← Voltar</a>`);
    }

    try {
        const token = await getToken();
        const walletId = metodo === 'mpesa' ? WALLET_MPESA : WALLET_EMOLA;
        const endpoint = `${BASE_URL}/v1/c2b/mpesa-payment/${walletId}`;

        const paymentPayload = {
            client_id: CLIENT_ID,
            amount: "297",
            phone: telefone,
            reference: `Premise${Date.now()}`
        };

        const headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };

        const paymentResponse = await axios.post(endpoint, paymentPayload, { headers });

        return res.send(`
            <h1>✅ Pagamento Iniciado com Sucesso!</h1>
            <p>Verifique seu telemóvel para confirmar.</p>
            <a href="/">← Voltar ao início</a>
        `);
    } catch (error) {
        console.error('Erro no pagamento:', error.response?.data || error.message);
        return res.status(500).send(`
            <h2>❌ Erro no pagamento.</h2>
            <p>Verifique saldo, número ou tente mais tarde.</p>
            <a href="/">← Tentar novamente</a>
        `);
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'Premise Checkout API'
    });
});

app.use('*', (req, res) => {
    res.status(404).send(`<h2>404 - Página não encontrada</h2><a href="/">← Voltar</a>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
