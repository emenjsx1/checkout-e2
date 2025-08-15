require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');

const app = express();

// Middlewares
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static('public'));

// Configurações
const BASE_URL = 'https://mpesaemolatech.com';
const CLIENT_ID = process.env.CLIENT_ID || '9f903862-a780-440d-8ed5-b8d8090b180e';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'BJjRaIVYDCWkvumR32iLBk9ekkiltpIhXlDuwGwz';
const WALLET_MPESA = process.env.WALLET_MPESA || '993607';
const WALLET_EMOLA = process.env.WALLET_EMOLA || '993606';
const PUSHCUT_URL = 'https://api.pushcut.io/QsggCCih4K4SGeZy3F37z/notifications/MinhaNotifica%C3%A7%C3%A3o';

// Função para obter token
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

// Página principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota de pagamento
app.post('/pagar', async (req, res) => {
    const { nome, email, telefone, metodo } = req.body;

    // Validações básicas
    if (!nome || !email || !telefone || !metodo) {
        return res.status(400).json({ success: false, message: 'Dados incompletos' });
    }

    if (!/^(84|85|86|87)\d{7}$/.test(telefone)) {
        return res.status(400).json({ success: false, message: 'Número de telefone inválido' });
    }

    try {
        const token = await getToken();
        const walletId = metodo === 'mpesa' ? WALLET_MPESA : WALLET_EMOLA;
        const reference = `Premise${Date.now()}`; // sem espaços

        const paymentPayload = {
            client_id: CLIENT_ID,
            amount: "1",       // valor real do pagamento
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

        const response = await axios.post(
            `${BASE_URL}/v1/c2b/mpesa-payment/${walletId}`,
            paymentPayload,
            { headers }
        );

        console.log('Resposta da API e2Payments:', response.data);

        if (response.data && (response.data.status === 'SUCCESS' || response.data.success === true)) {
            global.transacoes.set(reference, { nome, telefone, metodo, valor: '1', status: 'APROVADA' });

            await axios.post(PUSHCUT_URL, {
                text: `${nome} pagou 297,00 MT por ${metodo}`,
                title: '💰 Venda Aprovada!'
            });

            return res.json({ success: true, redirectUrl: 'https://wa.me/message/5PVL4ECXMEWPI1' });
        } else {
            return res.status(400).json({ success: false, message: 'Pagamento não foi processado. Tente novamente.' });
        }

    } catch (error) {
        console.error('Erro no pagamento:', error.response?.data || error.message);
        return res.status(500).json({ success: false, message: 'Erro interno no servidor. Tente novamente.' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 404
app.use('*', (req, res) => {
    res.status(404).send('Página não encontrada');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
