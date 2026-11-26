// Roda o sistema no computador para testar: banco em memória (apaga ao fechar) e entrada sem Google.
// Uso: npm install  e depois  npm run dev   →  abra http://localhost:3000/login
process.env.DATABASE_URL = process.env.DATABASE_URL || 'memoria';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'teste-local-'.padEnd(48, 'x');
process.env.DEV_LOGIN = '1';
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || 'gestor@darmand.com.br';
require('../server.js');
