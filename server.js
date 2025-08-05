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

// Recebe o pedido de pagamento
app.post('/pagar', async (req, res) => {
    const { nome, email, telefone, metodo } = req.body;
    if (!nome || !email || !telefone || !metodo) {
        return res.redirect('/');
    }
    // Validar telefone (84,85,86,87 + 7 dígitos)
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

        // Armazenar transação pendente
        if (!global.transacoes) global.transacoes = new Map();
        global.transacoes.set(reference, { nome, telefone, metodo, valor: '297', status: 'PENDENTE' });

        // Enviar requisição para iniciar pagamento
        await axios.post(endpoint, paymentPayload, { headers });

        // Responde com página para polling de status (serve para o front continuar)
        res.send(`
            <html>
            <head>
                <meta charset="UTF-8" />
                <title>Pagamento Iniciado</title>
                <script>
                    fbq('track', 'InitiateCheckout');
                    setTimeout(() => {
                        window.location.href = '/aguardando?ref=${reference}';
                    }, 1000);
                </script>
            </head>
            <body>
                <p>🔄 Iniciando pagamento...</p>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('❌ Erro no pagamento:', error.response?.data || error.message);
        return res.redirect('/');
    }
});

// Página de espera/processamento com polling
app.get('/aguardando', (req, res) => {
    const ref = req.query.ref;
    res.send(`
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Processando Pagamento</title>
            <style>
                body { font-family: sans-serif; background: #f4f4f4; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .popup { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 0 10px rgba(0,0,0,0.2); text-align: center; max-width: 400px; }
                .countdown { font-size: 24px; color: #333; margin-top: 15px; }
            </style>
        </head>
        <body>
            <div class="popup">
                <h2>🔒 Processando Pagamento...</h2>
                <p>Você verá uma tela para digitar seu PIN.<br>Não feche esta página.</p>
                <div class="countdown" id="countdown">180</div>
                <p id="mensagem"></p>
            </div>
            <script>
                let segundos = 180;
                let countdown = document.getElementById('countdown');
                let mensagem = document.getElementById('mensagem');

                const intervalo = setInterval(() => {
                    segundos--;
                    countdown.textContent = segundos;
                    if (segundos <= 0) {
                        clearInterval(intervalo);
                        mensagem.innerHTML = '⚠️ Pagamento não foi concluído.<br><a href="/">Tentar novamente</a>';
                    }
                }, 1000);

                const verificar = setInterval(() => {
                    fetch('/status?ref=${ref}').then(r => r.json()).then(data => {
                        if (data.status === 'PAGO') {
                            clearInterval(verificar);
                            window.location.href = 'https://wa.me/message/5PVL4ECXMEWPI1';
                        }
                    });
                }, 5000);
            </script>
        </body>
        </html>
    `);
});

// Endpoint para front polling status do pagamento
app.get('/status', (req, res) => {
    const ref = req.query.ref;
    const t = global.transacoes?.get(ref);
    res.json({ status: t?.status || 'PENDENTE' });
});

// Webhook que recebe confirmação real da e2payments
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
                // Enviar notificação Pushcut
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

app.use('*', (req, res) => {
    res.status(404).send('Página não encontrada.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
