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

        await axios.post(`${BASE_URL}/v1/c2b/mpesa-payment/${walletId}`, paymentPayload, { headers });

            // Envia notificação Pushcut
        await axios.post(PUSHCUT_URL, {
            text: `${nome} pagou 300,00 MT por ${metodo}`,
            title: '💰 Venda Aprovada!'
        });

        res.redirect('https://wa.me/message/5PVL4ECXMEWPI1');
  } catch (error) {
        console.error('❌ Erro no pagamento, mas redirecionando mesmo assim:', error.response?.data || error.message);
    }

    // Redirecionar para o WhatsApp independentemente do erro
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










