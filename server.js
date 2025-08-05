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

const PUSHCUT_URL = process.env.PUSHCUT_URL;
const WHATSAPP_FINAL = process.env.WHATSAPP_FINAL;

if (!CLIENT_ID || !CLIENT_SECRET || !WALLET_MPESA || !WALLET_EMOLA || !PUSHCUT_URL || !WHATSAPP_FINAL) {
    console.error('❌ Variáveis de ambiente faltando! Confira seu .env');
    process.exit(1);
}

// Para guardar transações pendentes (na memória)
const transacoes = new Map();

// Função para obter token OAuth2
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

// Função para consultar status da transação na e2payments
async function checkPaymentStatus(token, walletId, reference) {
    try {
        // Exemplo hipotético - ajuste conforme docs oficiais da e2payments para consulta status
        const url = `${BASE_URL}/v1/payments/status/${walletId}/${reference}`;
        const res = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });
        // Supondo que a resposta tem { status: 'SUCCESS' } ou similar
        return res.data.status;
    } catch (error) {
        console.error('❌ Erro ao checar status:', error.response?.data || error.message);
        return null;
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota para iniciar pagamento
app.post('/pagar', async (req, res) => {
    const { nome, email, telefone, metodo } = req.body;

    if (!nome || !email || !telefone || !metodo) return res.redirect('/');
    if (!/^(84|85|86|87)\d{7}$/.test(telefone)) return res.redirect('/');

    try {
        const token = await getToken();

        const walletId = metodo === 'mpesa' ? WALLET_MPESA : WALLET_EMOLA;
        const endpoint = `${BASE_URL}/v1/c2b/mpesa-payment/${walletId}`;
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

        // Salvar a transação com status pendente
        transacoes.set(reference, { nome, telefone, metodo, valor: '297', status: 'PENDENTE' });

        await axios.post(endpoint, paymentPayload, { headers });

        // Enviar página com popup e contagem + referência para frontend consultar
        res.send(`
            <html>
            <head>
                <meta charset="UTF-8" />
                <title>Aguarde - Premise</title>
                <style>
                    body {
                        font-family: sans-serif;
                        background: #f4f4f4;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                    }
                    .popup {
                        background: white;
                        padding: 30px;
                        border-radius: 10px;
                        box-shadow: 0 0 10px rgba(0,0,0,0.2);
                        text-align: center;
                        max-width: 400px;
                    }
                    .countdown {
                        font-size: 24px;
                        color: #333;
                        margin-top: 15px;
                    }
                    .error {
                        color: red;
                        margin-top: 20px;
                        font-weight: bold;
                    }
                </style>
            </head>
            <body>
                <div class="popup">
                    <h2>🔒 Aguarde...</h2>
                    <p>Você verá uma tela para digitar seu PIN.<br>Não feche esta página.</p>
                    <div class="countdown" id="countdown">180</div>
                    <div class="error" id="error" style="display:none;"></div>
                </div>

                <script>
                    const reference = "${reference}";
                    const WHATSAPP_FINAL = "${WHATSAPP_FINAL}";
                    let seconds = 180;
                    const countdown = document.getElementById('countdown');
                    const errorDiv = document.getElementById('error');

                    const interval = setInterval(() => {
                        seconds--;
                        countdown.textContent = seconds;
                        if(seconds <= 0){
                            clearInterval(interval);
                            errorDiv.textContent = "❌ Tempo esgotado. Por favor, tente novamente.";
                            errorDiv.style.display = "block";
                            // Recarregar para voltar ao form de pagamento
                            setTimeout(() => window.location.href = '/', 4000);
                        }
                    }, 1000);

                    // Função para consultar status do pagamento a cada 5 segundos
                    async function checkStatus(){
                        try {
                            const resp = await fetch('/check-status?reference=' + reference);
                            const data = await resp.json();

                            if(data.status === 'PAGO'){
                                clearInterval(interval);
                                window.location.href = WHATSAPP_FINAL;
                            } else if(data.status === 'FALHOU'){
                                clearInterval(interval);
                                errorDiv.textContent = "❌ Pagamento não aprovado. Tente novamente.";
                                errorDiv.style.display = "block";
                                setTimeout(() => window.location.href = '/', 4000);
                            } else {
                                // Ainda pendente, tentar de novo
                                setTimeout(checkStatus, 5000);
                            }
                        } catch(e){
                            console.error("Erro ao verificar status:", e);
                            setTimeout(checkStatus, 5000);
                        }
                    }

                    checkStatus();
                </script>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('❌ Erro no pagamento:', error.response?.data || error.message);
        return res.redirect('/');
    }
});

// Endpoint para o frontend checar o status do pagamento
app.get('/check-status', async (req, res) => {
    const { reference } = req.query;
    if (!reference) return res.status(400).json({ error: 'reference required' });

    const transacao = transacoes.get(reference);
    if (!transacao) return res.status(404).json({ error: 'transaction not found' });

    if (transacao.status === 'PAGO') {
        return res.json({ status: 'PAGO' });
    }
    if (transacao.status === 'FALHOU') {
        return res.json({ status: 'FALHOU' });
    }

    // Se pendente, vamos consultar a API para atualizar status
    try {
        const token = await getToken();
        const walletId = transacao.metodo === 'mpesa' ? WALLET_MPESA : WALLET_EMOLA;
        const status = await checkPaymentStatus(token, walletId, reference);

        if(status === 'SUCCESS'){
            transacao.status = 'PAGO';

            // Enviar notificação pushcut
            try {
                await axios.post(PUSHCUT_URL, {
                    title: "💰 Venda Aprovada",
                    text: `📦 ${transacao.nome} pagou ${transacao.valor},00 MT`,
                    sound: "default"
                }, {
                    headers: { 'Content-Type': 'application/json' }
                });
                console.log("🔔 Pushcut enviado com sucesso");
            } catch (err) {
                console.error("❌ Falha ao enviar Pushcut:", err.message);
            }

            return res.json({ status: 'PAGO' });
        } else if(status === 'FAILED' || status === 'REJECTED'){
            transacao.status = 'FALHOU';
            return res.json({ status: 'FALHOU' });
        } else {
            // Continua pendente
            return res.json({ status: 'PENDENTE' });
        }

    } catch (err) {
        console.error('Erro ao atualizar status:', err);
        return res.status(500).json({ error: 'Erro interno' });
    }
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
