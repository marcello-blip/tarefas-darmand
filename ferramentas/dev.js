// Roda o sistema no computador para testar: banco em memória (apaga ao fechar) e entrada sem Google.
// Uso: npm install  e depois  npm run dev   →  abra http://localhost:3000/login
process.env.DATABASE_URL = process.env.DATABASE_URL || 'memoria';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'teste-local-'.padEnd(48, 'x');
process.env.DEV_LOGIN = '1';
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || 'gestor@darmand.com.br';
// módulos do portal: se a exportação da tarefa diária estiver neste computador, carrega os dados das lojas para testar
const fs = require('fs'), kit = process.env.LOCALAPPDATA ? require('path').join(process.env.LOCALAPPDATA, 'DarmandPainel', 'kit') : '';
if (!process.env.PORTAL_SEMENTE && kit && fs.existsSync(require('path').join(kit, 'export'))) process.env.PORTAL_SEMENTE = [require('path').join(kit, 'export'), require('path').join(kit, 'db')].join(';');
process.env.PORTAL_VINCULOS = process.env.PORTAL_VINCULOS || 'gerente@darmand.com.br:macapa1,gerente2@darmand.com.br:maraba';
require('../server.js');
